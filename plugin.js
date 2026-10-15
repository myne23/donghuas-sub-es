/// <reference path="./kino.d.ts" />
// Kino plugin: Donghuas Sub ES.
// Two sources in one: SeriesDonghua (seriesdonghua.com) and MundoDonghua (mundodonghua.com).
// Home: the latest episodes and the full catalog of each site. In MundoDonghua's latest episodes the
// "Episodios Limitados" come first (they play like any other episode).
// Both sites show the video through embedded players, so resolve() opens them in Kino's hidden browser
// (kino.browser.capture) and lists the other servers as labelled lazy copies.
//
// Refs:  series   "sd:/slug/"                  "md:/donghua/slug"
//        episode  "sd:/slug-episodio-12/"      "md:/ver/slug/12[/token]"
//        server   "srv:<n>:<episode ref>"      (a lazy copy: server number n of that episode)
//        rows     "latest:sd" "latest:md" "cat:sd" "cat:md"

const SD = { key: "sd", name: "SeriesDonghua", base: "https://seriesdonghua.com" };
const MD = { key: "md", name: "MundoDonghua", base: "https://www.mundodonghua.com" };

// Players the sites embed. kino.browser.capture only starts on a declared host.
const EMBED_HOSTS = ["dailymotion.com", "ok.ru", "rumble.com", "voe.sx", "odysee.com", "odycdn.com", "bysekoze.com", "vidhidepro.com", "embedwish.com"];
const MD_SERVER_NAMES = { fmoon: "Filemoon", amagi: "Voe", vhide: "VidHide", swish: "StreamWish" };

const CAPTURE_MS = 20000;
const MAX_ATTEMPTS = 2; // servers tried inside one resolve; the others become lazy copies
const SOFT_DEADLINE_MS = 45000; // stop starting new attempts after this (resolve has 75 s)

// kino.log never breaks what it reports on.
function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // the line is lost, the result is not
  }
}

function isEnglish() {
  try {
    return String(kino.lang || "").toLowerCase().startsWith("en");
  } catch {
    return false;
  }
}
const say = (es, en) => (isEnglish() ? en : es);

// ---------- text helpers ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s == null ? "" : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}
function text(html) {
  return decode(String(html == null ? "" : html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function first(re, s) {
  const m = re.exec(s);
  return m ? m[1] : "";
}
function safeId(s) {
  return String(s).replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 120);
}

// "/path" or "https://host/path?x" -> "/path?x"
function pathOf(href) {
  const h = decode(href).trim();
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      return u.pathname + u.search;
    } catch {
      return h;
    }
  }
  return h.startsWith("/") ? h : "/" + h;
}
function abs(site, src) {
  const s = decode(src).trim();
  if (!s) return undefined;
  if (s.startsWith("//")) return "https:" + s;
  if (/^https?:\/\//i.test(s)) return s;
  return site.base + (s.startsWith("/") ? s : "/" + s);
}
function ymd(dmy) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(dmy || "");
  return m ? m[3] + "-" + m[2] + "-" + m[1] : undefined;
}

// Throws only AFTER its first await: before it, a throw can't be caught by the caller on Kino 0.9.49 and older.
async function getPage(site, path, options) {
  const url = /^https?:/i.test(path) ? path : site.base + path;
  const r = await kino.fetch(url, options);
  if (!r.ok) {
    throw kino.error(r.status === 404 ? "not_found" : r.status === 429 ? "rate_limited" : "unavailable", site.name + " respondió " + r.status);
  }
  return r.text();
}

// ---------- card parsers ----------

// SeriesDonghua: <article class="donghua-card"> with href, img, h3.card-title and an optional "EP n" badge.
function sdCards(html) {
  const out = [];
  const re = /<article class="donghua-card(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[1];
    const href = first(/<a href="([^"]+)"/, b);
    if (!href) continue;
    const path = pathOf(href);
    const ep = /-episodio-(\d+)\/?$/.exec(path);
    const slugPath = ep ? path.replace(/-episodio-\d+\/?$/, "/") : path;
    out.push({
      path: slugPath,
      episode: ep ? Number(ep[1]) : 0,
      title: text(first(/<h3 class="card-title"[^>]*>([\s\S]*?)<\/h3>/, b)),
      poster: abs(SD, first(/<img[^>]+src="([^"]+)"/, b)),
    });
  }
  return out;
}

// MundoDonghua: <div class="md-card"> (or "md-card limited") with an href to /donghua/slug or /ver/slug/n[/token].
function mdCards(html) {
  const out = [];
  const re = /<div class="md-card( limited)?">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const href = pathOf(m[2]);
    const b = m[3];
    const ver = /^\/ver\/([^/]+)\/(\d+)(?:\/(.+))?$/.exec(href);
    const don = /^\/donghua\/([^/?#]+)/.exec(href);
    const slug = ver ? ver[1] : don ? don[1] : "";
    if (!slug) continue;
    const alt = decode(first(/<img[^>]+alt="([^"]*)"/, b)).trim();
    const t = text(first(/<h[1-6] class="md-card-title"[^>]*>([\s\S]*?)<\/h[1-6]>/, b));
    out.push({
      slug,
      episode: ver ? Number(ver[2]) : 0,
      epPath: ver ? href : "",
      limited: !!m[1] && !!ver,
      kindLabel: text(first(/class="md-card-badge[^"]*">([\s\S]*?)<\/span>/, b)),
      title: alt || t.replace(/\s+Episodio\s+\d+\s*$/i, ""),
      poster: abs(MD, first(/<img[^>]+src="([^"]+)"/, b)),
    });
  }
  return out;
}

function sdItem(c) {
  const slug = c.path.replace(/^\/|\/$/g, "");
  const badges = [];
  if (c.episode) badges.push("EP " + c.episode);
  badges.push(SD.name);
  return {
    id: safeId("sd-" + slug),
    ref: "sd:" + c.path,
    title: c.title || slug,
    kind: "series",
    poster: c.poster,
    badges,
  };
}

function mdItem(c) {
  const badges = [];
  if (c.episode) badges.push("EP " + c.episode);
  if (c.kindLabel && !/^donghua$/i.test(c.kindLabel)) badges.push(c.kindLabel.slice(0, 20));
  badges.push(MD.name);
  return {
    id: safeId("md-" + c.slug),
    ref: "md:/donghua/" + c.slug,
    title: c.title || c.slug,
    kind: "series",
    poster: c.poster,
    badges: badges.slice(0, 3),
  };
}

// One item per series (the first, i.e. the newest, card wins).
function unique(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

// ---------- pagination ----------

// The address of the next page of a listing.
// SeriesDonghua: <a href="...?page=2" rel="next">. MundoDonghua: /lista-donghuas, /lista-donghuas/2, /lista-donghuas/3...
function nextPath(html, path, numberedBase) {
  if (numberedBase) {
    const cur = Number((new RegExp("^" + numberedBase + "/(\\d+)")).exec(path) || [0, 1])[1] || 1;
    const next = numberedBase + "/" + (cur + 1);
    return html.includes('href="' + next + '"') ? next : "";
  }
  const m = /<a[^>]+rel="next"[^>]+href="([^"]+)"/i.exec(html) || /<a[^>]+href="([^"]+)"[^>]+rel="next"/i.exec(html);
  return m ? pathOf(m[1]) : "";
}

// ---------- MundoDonghua's limited episodes ----------
// A limited episode has an address with a token that only the home page shows. Remember it, so the series page
// can list the episode too.

function rememberLimited(cards) {
  try {
    const bySlug = {};
    for (const c of cards) if (c.limited) (bySlug[c.slug] = bySlug[c.slug] || {})[c.episode] = c.epPath;
    for (const slug of Object.keys(bySlug)) {
      let known = {};
      try {
        known = JSON.parse(kino.storage.get("lim:" + slug) || "{}");
      } catch {
        known = {};
      }
      kino.storage.set("lim:" + slug, JSON.stringify(Object.assign(known, bySlug[slug])), { ttlMs: 14 * 24 * 3600 * 1000 });
    }
  } catch (e) {
    log("no se pudo guardar un episodio limitado");
  }
}
function limitedFor(slug) {
  try {
    return JSON.parse(kino.storage.get("lim:" + slug) || "{}");
  } catch {
    return {};
  }
}

// ---------- rows ----------

const PAGE_LIMIT = 60;

// SeriesDonghua's latest episodes: /episodios, 24 per page, ?page=N.
async function sdLatestPage(cursor) {
  const path = cursor || "/episodios";
  const html = await getPage(SD, path);
  const items = unique(sdCards(html).filter((c) => c.episode).map(sdItem));
  const next = nextPath(html, path);
  return { items, next: next && next !== path ? next : undefined };
}

async function mdLatestItems() {
  const html = await getPage(MD, "/");
  const cards = mdCards(html).filter((c) => c.episode);
  rememberLimited(cards);
  // Limited episodes first, then the rest in the order the site lists them.
  const ordered = cards.filter((c) => c.limited).concat(cards.filter((c) => !c.limited));
  return unique(ordered.map(mdItem)).slice(0, PAGE_LIMIT);
}

const MD_CATALOG = "/lista-donghuas";

async function catalogPage(siteKey, cursor) {
  const site = siteKey === "sd" ? SD : MD;
  const path = cursor || (siteKey === "sd" ? "/todos-los-donghuas" : MD_CATALOG);
  const html = await getPage(site, path);
  const items = siteKey === "sd" ? sdCards(html).filter((c) => !c.episode).map(sdItem) : mdCards(html).filter((c) => !c.episode).map(mdItem);
  const next = nextPath(html, path, siteKey === "md" ? MD_CATALOG : "");
  return { items: unique(items).slice(0, 100), next: next && next !== path ? next : undefined };
}

async function safe(name, fn) {
  try {
    return await fn();
  } catch (e) {
    log("fila " + name + " falló: " + (e && e.message ? e.message : e));
    return null;
  }
}

export async function home() {
  await null;
  const [sdLatest, mdLatest, sdCat, mdCat] = await Promise.all([
    safe("sd-latest", async () => (await sdLatestPage(null)).items.slice(0, PAGE_LIMIT)),
    safe("md-latest", mdLatestItems),
    safe("sd-cat", async () => (await catalogPage("sd", null)).items.slice(0, PAGE_LIMIT)),
    safe("md-cat", async () => (await catalogPage("md", null)).items.slice(0, PAGE_LIMIT)),
  ]);
  const rows = [
    { id: "latest-sd", title: say("Últimos episodios de SeriesDonghua", "Latest episodes on SeriesDonghua"), items: sdLatest, ref: "latest:sd" },
    { id: "latest-md", title: say("Últimos episodios de MundoDonghua", "Latest episodes on MundoDonghua"), items: mdLatest, ref: "latest:md" },
    { id: "cat-sd", title: say("Catálogo completo de SeriesDonghua", "Full catalog of SeriesDonghua"), items: sdCat, ref: "cat:sd" },
    { id: "cat-md", title: say("Catálogo completo de MundoDonghua", "Full catalog of MundoDonghua"), items: mdCat, ref: "cat:md" },
  ];
  return rows.filter((r) => r.items && r.items.length).map((r) => Object.assign(r, { genre: "anime" }));
}

export async function browse(ref, cursor) {
  await null;
  if (ref === "cat:sd" || ref === "cat:md") return catalogPage(ref.slice(4), cursor);
  if (ref === "latest:sd") return sdLatestPage(cursor);
  if (ref === "latest:md") {
    if (!cursor) {
      const items = await mdLatestItems();
      return { items, next: items.length ? "24" : undefined };
    }
    const offset = Number(cursor) || 0;
    const r = await kino.fetch(MD.base + "/ajax_latest_episodes.php?offset=" + offset, { headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!r.ok) throw kino.error("unavailable", "ajax_latest_episodes respondió " + r.status);
    let data;
    try {
      data = r.json();
    } catch {
      throw kino.error("unavailable", "respuesta inválida de ajax_latest_episodes");
    }
    const items = unique(mdCards(String((data && data.html) || "")).filter((c) => c.episode).map(mdItem));
    const count = Number(data && data.count) || 0;
    return { items, next: data && data.has_more && count ? String(offset + count) : undefined };
  }
  throw kino.error("not_found", "fila desconocida");
}

// ---------- search ----------

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").trim();
  if (!q) return [];
  const [a, b] = await Promise.all([
    safe("buscar-sd", async () => unique(sdCards(await getPage(SD, "/buscar.php?s=" + encodeURIComponent(q))).filter((c) => !c.episode).map(sdItem))),
    safe("buscar-md", async () => unique(mdCards(await getPage(MD, "/busquedas?donghua=" + encodeURIComponent(q))).filter((c) => !c.episode).map(mdItem))),
  ]);
  return (a || []).concat(b || []).slice(0, 100);
}

// ---------- episodes ----------

function splitRef(ref) {
  const m = /^(sd|md):(\/.*)$/.exec(String(ref));
  return m ? { site: m[1] === "sd" ? SD : MD, path: m[2] } : null;
}

export async function episodes(ref) {
  await null;
  const r = splitRef(ref);
  if (!r) throw kino.error("not_found", "ref desconocido");
  return r.site === SD ? sdEpisodes(r.path) : mdEpisodes(r.path);
}

async function sdEpisodes(path) {
  const html = await getPage(SD, path);
  const list = [];
  const seen = new Set();
  const re = /<article class="donghua-card episode-card-item" data-ep="(\d+)">\s*<a href="([^"]+)"([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const n = Number(m[1]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    list.push({ number: n, ref: "sd:" + pathOf(m[2]), airDate: ymd(first(/fa-calendar-alt"><\/i>\s*([\d-]+)/, m[3])) });
  }
  list.sort((a, b) => a.number - b.number);
  const genres = [];
  const gre = /class="genre-pill">\s*([^<]+?)\s*<\/a>/g;
  while ((m = gre.exec(html))) genres.push(decode(m[1]).slice(0, 30));
  return {
    series: {
      title: text(first(/<h1 class="hero-title"[^>]*>([\s\S]*?)<\/h1>/, html)) || undefined,
      poster: abs(SD, first(/class="hero-poster"[^>]*src="([^"]+)"/, html) || first(/<img src="([^"]+)" alt="[^"]*" class="hero-poster"/, html)),
      backdrop: abs(SD, first(/<meta property="og:image" content="([^"]+)"/, html)),
      overview: text(first(/Sinopsis\s*<\/h2>\s*<div[^>]*>\s*<p>([\s\S]*?)<\/p>/, html)).slice(0, 1000) || undefined,
      genres: genres.slice(0, 5),
    },
    episodes: list,
  };
}

async function mdEpisodes(path) {
  const html = await getPage(MD, path);
  const slug = (/^\/donghua\/([^/?#]+)/.exec(path) || [])[1] || "";
  const byNumber = new Map();
  const re = /<li class="md-episode-item" data-ep="(\d+)">\s*<a href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const n = Number(m[1]);
    if (n && !byNumber.has(n)) byNumber.set(n, { number: n, ref: "md:" + pathOf(m[2]) });
  }
  // Limited episodes the home page showed, missing from this list.
  const lim = limitedFor(slug);
  for (const k of Object.keys(lim)) {
    const n = Number(k);
    if (n && !byNumber.has(n)) byNumber.set(n, { number: n, ref: "md:" + lim[k] });
  }
  const list = Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
  const genres = [];
  const gre = /class="md-genre-tag">([^<]+)</g;
  while ((m = gre.exec(html))) genres.push(decode(m[1]).trim().slice(0, 30));
  return {
    series: {
      title: text(first(/<h1 class="md-detail-title"[^>]*>([\s\S]*?)<\/h1>/, html)) || undefined,
      poster: abs(MD, first(/md-detail-poster">\s*<img[^>]+src="([^"]+)"/, html)),
      backdrop: abs(MD, first(/md-detail-banner-bg">\s*<img[^>]+src="([^"]+)"/, html)),
      overview: text(first(/<p class="md-detail-synopsis">([\s\S]*?)<\/p>/, html)).slice(0, 1000) || undefined,
      genres: genres.slice(0, 5),
    },
    episodes: list,
  };
}

// ---------- servers ----------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function toBase(n, base) {
  return (n < base ? "" : toBase(Math.floor(n / base), base)) + ALPHABET[n % base];
}

// Undoes Dean Edwards' p.a.c.k.e.r (eval(function(p,a,c,k,e,d){...}('payload',base,count,'w1|w2'.split('|')))
// without running anything: it is only a table of words.
function unpackAll(html) {
  const out = [];
  const re = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
  let m;
  while ((m = re.exec(html))) {
    const unesc = (s) => s.replace(/\\(['"\\])/g, "$1");
    const payload = unesc(m[1]);
    const base = Number(m[2]);
    const count = Number(m[3]);
    const words = unesc(m[4]).split("|");
    if (!(base >= 2 && base <= 62)) continue;
    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = toBase(i, base);
      dict.set(key, words[i] || key);
    }
    out.push(payload.replace(/\b\w+\b/g, (w) => (dict.has(w) ? dict.get(w) : w)));
  }
  return out;
}

// MundoDonghua: the page hides each player's address inside packed scripts; tabs name the servers.
async function mdServers(path) {
  const html = await getPage(MD, path);
  const embeds = {};
  for (const code of unpackAll(html)) {
    const re = /\$\("#(\w+)_play"\)\.append\("<iframe src='([^']+)'/g;
    let m;
    while ((m = re.exec(code))) embeds[m[1]] = decode(m[2]);
  }
  const servers = [];
  const tabs = /id="(\w+)_tab"/g;
  let t;
  while ((t = tabs.exec(html))) {
    const id = t[1];
    if (embeds[id]) servers.push({ name: MD_SERVER_NAMES[id] || id, embed: async () => embeds[id] });
  }
  // A page whose tabs we could not read: still offer what the scripts held.
  if (!servers.length) for (const id of Object.keys(embeds)) servers.push({ name: MD_SERVER_NAMES[id] || id, embed: async () => embeds[id] });
  return servers;
}

// SeriesDonghua: the server tabs carry a video id and an index; the player address comes from an API call.
async function sdServers(path) {
  const pageUrl = SD.base + path;
  const html = await getPage(SD, path);
  const csrf = first(/<meta name="csrf-token" content="([^"]+)"/, html);
  const servers = [];
  const re = /<button[^>]*server-tab-btn[^>]*data-video-id="(\d+)"[^>]*data-server-index="(\d+)"[^>]*>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const videoId = Number(m[1]);
    const index = Number(m[2]);
    const name = text(first(/<span>([^<]+)<\/span>/, m[3])) || "Servidor " + (index + 1);
    servers.push({
      name,
      embed: async () => {
        const r = await kino.fetch(SD.base + "/api/player/get-server", {
          method: "POST",
          headers: { "X-CSRF-TOKEN": csrf, "X-Requested-With": "XMLHttpRequest", Accept: "application/json", Referer: pageUrl },
          body: { json: { video_id: videoId, server_index: index } },
        });
        if (!r.ok) return "";
        let data;
        try {
          data = r.json();
        } catch {
          return "";
        }
        return data && data.success && data.embed_url ? abs(SD, data.embed_url) : "";
      },
    });
  }
  return servers;
}

function embedAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return EMBED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

// Manual resolvers for the common embeds. These run before browser capture so the app
// does not need to execute the player's JavaScript for hosts whose stream URL is exposed by HTTP.
function unescapePlayerText(raw) {
  return String(raw || "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\\+u0026/gi, "&").replace(/\\+u003d/gi, "=")
    .replace(/\\+(?:\/|u002f)/gi, "/").replace(/\\+"/g, '"');
}
function directStream(url, label, referer, mime) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { url, label: String(label).slice(0, 48), headers: referer ? { Referer: referer } : {}, mime: mime || (/\.m3u8(?:$|[?#])/i.test(url) ? "application/x-mpegURL" : undefined) };
}
function decodeBase64Text(value) {
  try {
    const raw = atob(value);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
function decodeVoeConfig(encoded) {
  try {
    let value = String(encoded).replace(/[A-Za-z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
    for (const separator of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) value = value.split(separator).join("_");
    value = value.replace(/_/g, "");
    let bytes = Uint8Array.from(atob(value), (c) => (c.charCodeAt(0) - 3 + 256) & 255);
    bytes = bytes.reverse();
    return decodeBase64Text(String.fromCharCode(...bytes));
  } catch {
    return "";
  }
}
async function resolveManual(embed, site, label) {
  let host = "";
  let url;
  try {
    url = new URL(embed);
    host = url.hostname.toLowerCase();
  } catch {
    return null;
  }
  const headers = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36", Referer: embed };
  try {
    if (host === "dailymotion.com" || host.endsWith(".dailymotion.com")) {
      const id = (url.searchParams.get("video") || (url.pathname.match(/\/video\/([A-Za-z0-9]+)/) || [])[1] || "").trim();
      if (!id) return null;
      const r = await kino.fetch("https://geo.dailymotion.com/videos/" + encodeURIComponent(id), {
        headers: { Accept: "application/json", Referer: "https://geo.dailymotion.com/", "User-Agent": headers["User-Agent"] },
      });
      if (!r.ok) return null;
      const data = r.json();
      const streamUrl = data && data.stream && data.stream.url;
      if (streamUrl) {
        log("servidor " + label + ": URL de Dailymotion resuelta directamente");
        return directStream(streamUrl, label + " · " + site.name, "https://geo.dailymotion.com/", "application/x-mpegURL");
      }
      return null;
    }

    if (host === "ok.ru" || host.endsWith(".ok.ru")) {
      const embedUrl = embed.replace("://m.ok.ru", "://ok.ru").replace("/video/", "/videoembed/");
      const r = await kino.fetch(embedUrl, { headers });
      if (!r.ok) return null;
      const html = unescapePlayerText(r.text());
      const links = [];
      const qualities = { mobile: 144, lowest: 240, low: 360, sd: 480, hd: 720, full: 1080, quad: 1440, ultra: 2160 };
      const entry = /"name":"([a-z]+)","url":"(https?:\/\/[^"]+)"/gi;
      let m;
      while ((m = entry.exec(html))) {
        const q = qualities[m[1].toLowerCase()];
        if (q) links.push({ url: m[2].trim(), q });
      }
      const hls = /"(?:hlsManifestUrl|ondemandHls|hlsMasterPlaylistUrl)":"(https?:\/\/[^"]+)"/i.exec(html);
      if (hls && hls[1]) {
        log("servidor " + label + ": URL HLS de OK.ru resuelta directamente");
        return directStream(hls[1], label + " · " + site.name, embedUrl, "application/x-mpegURL");
      }
      links.sort((a, b) => b.q - a.q);
      if (links.length) {
        log("servidor " + label + ": video de OK.ru resuelto directamente");
        return directStream(links[0].url, label + " · " + site.name, embedUrl, "video/mp4");
      }
      return null;
    }

    if (host === "voe.sx" || host.endsWith(".voe.sx")) {
      const r = await kino.fetch(embed, { headers: { "User-Agent": headers["User-Agent"] } });
      if (!r.ok) return null;
      let html = r.text();
      const redirect = /window\.location\.href\s*=\s*['"]([^'"]+\/e\/[^'"]+)['"]/.exec(html);
      if (redirect && redirect[1]) {
        const rr = await kino.fetch(new URL(redirect[1], embed).href, { headers: { "User-Agent": headers["User-Agent"] } });
        if (!rr.ok) return null;
        html = rr.text();
      }
      let config = /<script[^>]+type=["']application\/json["'][^>]*>\s*(?:\[\s*)?["']([^"']+)["']/.exec(html);
      let encoded = config && config[1];
      // ALTCHA-gated VOE pages need a challenge POST; leave those to Kino's browser fallback.
      if (!encoded) return null;
      const decoded = decodeVoeConfig(encoded);
      const source = /"source"\s*:\s*"([^"]+)"/.exec(decoded);
      if (!source || !source[1]) return null;
      const streamUrl = source[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      log("servidor " + label + ": URL de VOE resuelta directamente");
      return directStream(streamUrl, label + " · " + site.name, embed, /\.m3u8/i.test(streamUrl) ? "application/x-mpegURL" : undefined);
    }

    if (host === "odysee.com" || host.endsWith(".odysee.com") || host === "player.odycdn.com" || host.endsWith(".odycdn.com")) {
      const r = await kino.fetch(embed, { headers });
      if (!r.ok) return null;
      const html = r.text().replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\u003D/g, "=").replace(/\\\//g, "/");
      const m = /"contentUrl"\s*:\s*"([^"]+)"/i.exec(html);
      if (!m || !m[1]) return null;
      const streamUrl = m[1].replace(/\\u0026/g, "&").replace(/\\u003D/g, "=").replace(/\\\//g, "/");
      log("servidor " + label + ": URL de Odysee resuelta directamente");
      return directStream(streamUrl, label + " · " + site.name, embed, /\.m3u8/i.test(streamUrl) ? "application/x-mpegURL" : "video/mp4");
    }
  } catch (e) {
    log("servidor " + label + ": resolver manual no disponible; pruebo navegador");
  }
  return null;
}

// Opens one player in the hidden browser and returns the video it requested, or null.
async function capture(site, server) {
  let embed = "";
  try {
    embed = await server.embed();
  } catch (e) {
    log("servidor " + server.name + ": no dio la dirección del reproductor");
    return null;
  }
  if (!embed || !embedAllowed(embed)) {
    log("servidor " + server.name + ": reproductor no admitido");
    return null;
  }
  const manual = await resolveManual(embed, site, server.name);
  if (manual) return manual;
  let res;
  try {
    res = await kino.browser.capture(embed, { timeoutMs: CAPTURE_MS, headers: { Referer: site.base + "/" } });
  } catch (e) {
    log("servidor " + server.name + ": " + ((e && e.code) || "error") + " al abrir el reproductor");
    return null;
  }
  const media = (res && res.media) || [];
  const pick = media.find((x) => /\.m3u8|mpegurl/i.test(x.url + " " + (x.mime || ""))) || media[0];
  if (!pick) {
    log("servidor " + server.name + ": no se vio ningún video");
    return null;
  }
  const hls = /\.m3u8|mpegurl/i.test(pick.url + " " + (pick.mime || ""));
  const stream = { url: pick.url, headers: pick.headers || {}, label: (server.name + " · " + site.name).slice(0, 48) };
  stream.mime = hls ? "application/x-mpegURL" : pick.mime && /^[a-z]+\/[\w.+-]+$/i.test(pick.mime) ? pick.mime : undefined;
  if (!stream.mime) delete stream.mime;
  return stream;
}

export async function resolve(ref) {
  await null;
  const lazy = /^srv:(\d+):((?:sd|md):\/.*)$/.exec(String(ref));
  const epRef = lazy ? lazy[2] : String(ref);
  const r = splitRef(epRef);
  if (!r) throw kino.error("not_found", "ref desconocido");
  const started = Date.now();
  const servers = r.site === SD ? await sdServers(r.path) : await mdServers(r.path);
  if (!servers.length) throw kino.error("not_found", "el episodio no tiene servidores");

  if (lazy) {
    const server = servers[Number(lazy[1])];
    const s = server ? await capture(r.site, server) : null;
    if (!s) throw failure();
    return s;
  }

  let stream = null;
  let tried = 0;
  const left = [];
  for (let i = 0; i < servers.length; i++) {
    if (stream || tried >= MAX_ATTEMPTS || Date.now() - started > SOFT_DEADLINE_MS) {
      left.push(i);
      continue;
    }
    tried++;
    const s = await capture(r.site, servers[i]);
    if (s) stream = s;
  }
  if (!stream) throw failure();
  const alternatives = left.slice(0, 8).map((i) => ({ label: (servers[i].name + " · " + r.site.name).slice(0, 48), ref: "srv:" + i + ":" + epRef }));
  if (alternatives.length) stream.alternatives = alternatives;
  return stream;
}

function failure() {
  return kino.error("unavailable", "ningún servidor dio video", {
    userMessage: say("No se pudo abrir ningún servidor de este episodio. Prueba otro servidor o inténtalo más tarde.", "No server of this episode could be opened. Try another server or try again later."),
  });
}
