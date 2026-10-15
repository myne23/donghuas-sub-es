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
const EMBED_HOSTS = ["dailymotion.com", "ok.ru", "rumble.com", "voe.sx", "odysee.com", "odycdn.com", "bysekoze.com", "vidhidepro.com", "embedwish.com", "strp2p.com"];
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
function parseOkruPlayerOptions(html) {
  const tags = String(html || "").match(/<[^>]+\bdata-options\s*=\s*(?:"[\s\S]*?"|'[\s\S]*?')[^>]*>/gi) || [];
  for (const tag of tags) {
    const m = /\bdata-options\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (!m) continue;
    const raw = decode(m[2]).replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/\\+\"/g, '"');
    try { return JSON.parse(raw); } catch {}
    try { return JSON.parse(decode(raw)); } catch {}
  }
  return null;
}

async function resolveRumbleDirect(embedUrl, site, label, userAgent) {
  let parsed;
  try { parsed = new URL(embedUrl); } catch { return null; }
  const id = (parsed.pathname.match(/\/embed\/([a-z0-9_-]+)/i) || parsed.pathname.match(/\/v([a-z0-9_-]+)\/?$/i) || [])[1];
  if (!id) return null;
  const apiUrl = "https://rumble.com/embedJS/u3/?request=video&ver=2&v=" + encodeURIComponent(id);
  const r = await kino.fetch(apiUrl, {
    headers: { Accept: "application/json,text/plain,*/*", Referer: embedUrl, "User-Agent": userAgent },
    timeoutMs: 9000
  });
  if (!r.ok) {
    log("servidor " + label + ": API de Rumble respondió HTTP " + r.status);
    return null;
  }
  let data;
  try { data = r.json(); } catch { try { data = JSON.parse(r.text()); } catch {
    log("servidor " + label + ": respuesta JSON inválida de Rumble");
    return null;
  } }
  const candidates = [];
  const shape = [];
  const noteShape = (node, path, depth) => {
    if (depth > 4 || node == null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const next = path ? path + "." + key : key;
      if (/(?:hls|mp4|webm|url|stream|ua)/i.test(key)) shape.push(next + ":" + (Array.isArray(value) ? "array" : value === null ? "null" : typeof value));
      if (shape.length < 35 && typeof value === "object") noteShape(value, next, depth + 1);
      if (shape.length >= 35) return;
    }
  };
  noteShape(data, "", 0);
  // Rumble nests stream URLs under ua.hls.url / ua.mp4.<quality>.url.
  // Preserve the parent format hint while descending; otherwise the leaf key
  // is only "url" and a valid stream is incorrectly discarded.
  const walk = (node, key, depth, inheritedHint) => {
    if (depth > 12 || node == null) return;
    const ownHint = String(key || "").toLowerCase();
    const hint = /(?:^|[^a-z])(hls|m3u8|mpegurl|mp4|webm)(?:$|[^a-z])/.test(ownHint) ? ownHint : String(inheritedHint || "").toLowerCase();
    if (typeof node === "string") {
      const value = unescapePlayerText(node).trim();
      if (!/^https?:\/\//i.test(value)) return;
      const hls = /hls|m3u8|mpegurl/.test(hint) || /\.m3u8(?:[?#]|$)/i.test(value);
      const webm = /webm/.test(hint) || /\.webm(?:[?#]|$)/i.test(value);
      const mp4 = /mp4/.test(hint) || /\.mp4(?:[?#]|$)/i.test(value);
      if (hls || mp4 || webm) {
        const quality = /(?:^|\D)(2160|1440|1080|720|480|360|240)(?:\D|$)/.exec(hint + " " + value);
        candidates.push({ url: value, type: hls ? "hls" : webm ? "webm" : "mp4", quality: quality ? Number(quality[1]) : 0 });
      }
      return;
    }
    if (Array.isArray(node)) { for (const item of node) walk(item, key, depth + 1, hint); return; }
    if (typeof node === "object") {
      for (const [childKey, value] of Object.entries(node)) walk(value, childKey, depth + 1, hint);
    }
  };
  walk(data, "", 0, "");
  const uniqueCandidates = candidates.filter((item, index, all) => all.findIndex((x) => x.url === item.url) === index);
  uniqueCandidates.sort((a, b) => {
    const rank = (x) => x.type === "hls" ? 0 : x.type === "mp4" ? 1 : 2;
    return rank(a) - rank(b) || b.quality - a.quality;
  });
  const chosen = uniqueCandidates[0];
  if (!chosen) {
    log("servidor " + label + ": la API de Rumble no expuso una URL HLS/MP4/WebM reconocible; estructura=" + JSON.stringify(shape).slice(0, 900));
    return null;
  }
  const mime = chosen.type === "hls" ? "application/x-mpegURL" : chosen.type === "webm" ? "video/webm" : "video/mp4";
  log("servidor " + label + ": fuente de Rumble resuelta directamente (" + chosen.type.toUpperCase() + ")");
  return directStream(chosen.url, label + " · " + site.name, embedUrl, mime);
}

// Extract HLS/MP4/DASH URLs from ordinary HTML or packed player scripts without a browser.
function findDirectMedia(html) {
  const candidates = [];
  const add = (text) => {
    const clean = unescapePlayerText(text).replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
    const re = /https?:\/\/[^"'<>\\\s]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'<>\\\s]*)?/gi;
    let m;
    while ((m = re.exec(clean))) {
      const raw = m[0].replace(/[),;]+$/, "");
      try {
        const u = new URL(raw);
        if (u.protocol === "https:") candidates.push({ url: u.href, hls: /\.m3u8(?:$|\?)/i.test(u.href), dash: /\.mpd(?:$|\?)/i.test(u.href) });
      } catch {}
    }
  };
  add(String(html || ""));
  for (const unpacked of unpackAll(String(html || ""))) add(unpacked);
  return candidates.find((x) => x.hls) || candidates.find((x) => !x.dash) || candidates[0] || null;
}

async function resolvePageMedia(embed, site, label, headers) {
  let response;
  try {
    response = await kino.fetch(embed, { headers: { ...headers, Referer: site.base + "/" }, timeoutMs: 9000 });
  } catch { return null; }
  if (!response.ok) {
    log("servidor " + label + ": página del reproductor respondió HTTP " + response.status);
    return null;
  }
  const media = findDirectMedia(response.text());
  if (!media) {
    log("servidor " + label + ": HTML consultado directamente; no expuso URL HLS/MP4");
    return null;
  }
  log("servidor " + label + ": URL " + (media.hls ? "HLS" : media.dash ? "DASH" : "MP4") + " extraída sin navegador");
  return directStream(media.url, label + " · " + site.name, embed, media.hls ? "application/x-mpegURL" : media.dash ? "application/dash+xml" : "video/mp4");
}


// ---------- Bysekoze / n1mwq encrypted playback API ----------
function b64urlToBytes(value) {
  const s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - s.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function bytesToB64(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(raw);
}
function b64url(value) {
  return String(value || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function byseRotate(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
function byseMix(a) {
  a[0] = (a[0] + a[1]) >>> 0;
  a[3] = byseRotate((a[3] ^ a[0]) >>> 0, 16);
  a[2] = (a[2] + a[3]) >>> 0;
  a[1] = byseRotate((a[1] ^ a[2]) >>> 0, 12);
  a[0] = (a[0] + a[1]) >>> 0;
  a[3] = byseRotate((a[3] ^ a[0]) >>> 0, 8);
  a[2] = (a[2] + a[3]) >>> 0;
  a[1] = byseRotate((a[1] ^ a[2]) >>> 0, 7);
}
function byseWorkHash(input) {
  const mask = 0xffffffff;
  const state = [1779033703, 3144134277, 1013904242, 2773480762];
  const memory = new Uint32Array(512);
  for (let i = 0; i < input.length; i++) {
    state[0] = byseRotate((state[0] + input.charCodeAt(i)) >>> 0, 7);
    byseMix(state);
  }
  for (let i = 0; i < 8; i++) byseMix(state);
  for (let i = 0; i < 512; i++) {
    byseMix(state);
    memory[i] = (state[0] ^ state[2]) >>> 0;
  }
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 512; i++) {
      const a = memory[i] & 511;
      let c = (memory[i] + memory[a]) >>> 0;
      c = byseRotate(c, 13);
      c = (c ^ Math.imul(memory[(i + 1) & 511], 2654435761)) >>> 0;
      memory[i] = c;
      state[0] = (state[0] ^ c) >>> 0;
      byseMix(state);
    }
  }
  const out = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    byseMix(state);
    let v = state[0] >>> 0;
    for (let j = i * 64; j < (i + 1) * 64; j++) {
      const d = memory[j];
      v = (v + d) >>> 0;
      v = byseRotate(v, 5);
      v = (v ^ Math.imul(d, 2246822519)) >>> 0;
    }
    out[i] = (v ^ state[2]) >>> 0;
  }
  return out;
}
function byseLeadingZeroBits(words) {
  let count = 0;
  for (const word of words) {
    if (word === 0) { count += 32; continue; }
    return count + Math.clz32(word);
  }
  return count;
}
async function byseSolvePow(nonce, difficulty) {
  const bits = Number(difficulty);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return null;
  if (bits <= 0) return "0";
  const start = Date.now();
  for (let counter = 0; counter < 200000 && Date.now() - start < 14000; counter++) {
    const hash = byseWorkHash(String(nonce) + ":" + counter);
    if (byseLeadingZeroBits(hash) >= bits) return String(counter);
    if ((counter & 31) === 31) await kino.sleep(0);
  }
  return null;
}
function byseFingerprint(tokenData) {
  return { token: tokenData.token, viewer_id: tokenData.viewer_id, device_id: tokenData.device_id, confidence: tokenData.confidence };
}
async function resolveBysekoze(embed, site, label, headers) {
  const inputUrl = new URL(embed);
  const code = (inputUrl.pathname.match(/\/(?:e|embed|sovm9|boh)\/([a-z0-9_-]+)/i) || [])[1];
  if (!code) return null;
  // Follow the site's redirect first: Bysekoze commonly forwards to its rotating n1mwq.org origin.
  let pageResponse;
  try { pageResponse = await kino.fetch(embed, { headers, timeoutMs: 9000 }); } catch { return null; }
  if (!pageResponse.ok) return null;
  let origin = inputUrl.origin;
  try { origin = new URL(pageResponse.url || embed).origin; } catch {}
  const pageUrl = pageResponse.url || embed;
  const pageHeaders = {
    ...headers,
    Origin: origin,
    Referer: pageUrl,
    "X-Embed-Origin": new URL(site.base).origin,
    "X-Embed-Referer": site.base + "/",
    "X-Embed-Parent": site.base + "/"
  };
  // If the redirect ends on the main site, use its embed API paths and keep the response's cookies.
  const embedMode = /\/(?:e|embed|sovm9|boh)\//i.test(new URL(pageUrl).pathname);
  const prefix = "/api/videos/" + code + (embedMode ? "/embed" : "");
  const getJson = async (path, opts) => {
    const r = await kino.fetch(origin + path, { headers: pageHeaders, timeoutMs: 12000, ...(opts || {}) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  try {
    const settings = await getJson(prefix + "/settings");
    let fingerprint = null;
    let captchaToken = "";
    if (settings && settings.captcha_required) {
      const challenge = await getJson("/api/videos/access/challenge", { method: "POST", body: { json: {} }, timeoutMs: 15000 });
      if (!challenge || !challenge.nonce || !challenge.challenge_id) throw new Error("challenge incompleto");
      const pair = kino.crypto.generateKeyPair({ type: "ec", namedCurve: "P-256" });
      const signature = b64url(kino.crypto.sign({ key: pair.privateKey, data: challenge.nonce, hash: "SHA-256", format: "ieee-p1363", outputEncoding: "base64" }));
      const rand = () => Number.parseInt(kino.crypto.randomBytes(4, "hex"), 16) / 0xffffffff;
      const fingerprintHash = (n) => {
        const hex = kino.crypto.hash("sha256", String(n), { outputEncoding: "hex" });
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return b64url(bytesToB64(bytes));
      };
      const r = rand();
      const client = {
        user_agent: headers["User-Agent"],
        architecture: "arm", bitness: "32", platform: "Android", platform_version: "6.0.1",
        model: "SM-G5510", ua_full_version: "59.0.3071.125",
        brand_full_versions: [{ brand: "SamsungBrowser", version: "7.2" }],
        pixel_ratio: 1, screen_width: 1280, screen_height: 720, color_depth: 24,
        languages: ["en-US"], timezone: "America/New_York", hardware_concurrency: 4,
        device_memory: 2, touch_points: 1,
        canvas_hash: fingerprintHash(r), audio_hash: fingerprintHash(r + 1),
        fonts_hash: fingerprintHash(r + 3), codecs_hash: fingerprintHash(r + 4),
        media_devices: "ai1ao1vi4", pointer_type: "coarse",
        extra: { vendor: "Samsung", appVersion: "7.2" }
      };
      const attest = await getJson("/api/videos/access/attest", {
        method: "POST",
        body: { json: {
          viewer_id: "", device_id: "", challenge_id: challenge.challenge_id, nonce: challenge.nonce,
          signature, public_key: { ...pair.publicKey.jwk, ext: true, key_ops: ["verify"] },
          client, storage: {}, attributes: { entropy: "high" }
        } },
        timeoutMs: 20000
      });
      if (!attest || !attest.token || !attest.viewer_id || !attest.device_id) throw new Error("atestación incompleta");
      fingerprint = byseFingerprint(attest);
      const captcha = await getJson(prefix + "/captcha", { method: "POST", body: { json: { fingerprint } }, timeoutMs: 15000 });
      if (!captcha || !captcha.pow_nonce || !captcha.pow_token) throw new Error("desafío PoW incompleto");
      const solution = await byseSolvePow(captcha.pow_nonce, captcha.pow_difficulty);
      if (solution == null) throw new Error("PoW agotó el tiempo");
      const verified = await getJson(prefix + "/captcha/verify", {
        method: "POST", body: { json: { pow_token: captcha.pow_token, solution, fingerprint } }, timeoutMs: 15000
      });
      captchaToken = String((verified && verified.token) || "");
      if (!captchaToken) throw new Error("verificación CAPTCHA sin token");
    }
    const playback = await getJson(prefix + "/playback", {
      method: "POST",
      headers: { ...pageHeaders, ...(captchaToken ? { "X-Captcha-Token": captchaToken } : {}) },
      body: { json: settings && settings.captcha_required ? { fingerprint } : {} },
      timeoutMs: 20000
    });
    let sources = Array.isArray(playback.sources) ? playback.sources : null;
    if (!sources && playback.playback && Array.isArray(playback.playback.key_parts)) {
      const pd = playback.playback;
      let parts = pd.key_parts;
      const version = Number(pd.version);
      if (version && version >= 1 && version <= parts.length) parts = [parts[version - 1], parts[parts.length - version]];
      const keyBytes = parts.map(b64urlToBytes);
      const keyLength = keyBytes.reduce((sum, b) => sum + b.length, 0);
      const key = new Uint8Array(keyLength);
      let offset = 0;
      for (const bytes of keyBytes) { key.set(bytes, offset); offset += bytes.length; }
      const decrypted = kino.crypto.decrypt("aes-256-gcm", {
        key: bytesToB64(key), keyEncoding: "base64",
        iv: bytesToB64(b64urlToBytes(pd.iv)), ivEncoding: "base64",
        data: bytesToB64(b64urlToBytes(pd.payload)), inputEncoding: "base64", outputEncoding: "utf8"
      });
      const parsed = JSON.parse(decrypted);
      sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    }
    if (!sources || !sources.length) throw new Error("el playback no devolvió fuentes");
    const candidates = sources.map((x) => ({
      label: String(x.label || x.name || "Bysekoze"),
      url: String(x.url || "")
    })).filter((x) => x.url);
    candidates.sort((a, b) => {
      const quality = (s) => Number((/(\d{3,4})\s*[pP]?/.exec(s) || [])[1]) || 0;
      return quality(b.label) - quality(a.label);
    });
    const chosen = candidates.find((x) => /^https?:\/\//i.test(x.url)) || candidates[0];
    if (!chosen) throw new Error("fuentes sin URL");
    const streamUrl = new URL(chosen.url, origin + "/").href;
    log("servidor " + label + ": Bysekoze resolvió " + chosen.label.slice(0, 32));
    return directStream(streamUrl, (chosen.label + " · " + site.name).slice(0, 48), origin + "/", /\.m3u8(?:$|[?#])/i.test(streamUrl) ? "application/x-mpegURL" : "video/mp4");
  } catch (e) {
    log("servidor " + label + ": Bysekoze HTTP no completó la resolución (" + String(e && e.message || e).slice(0, 80) + ")");
    return null;
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
    if (host === "bysekoze.com" || host.endsWith(".bysekoze.com") || host === "n1mwq.org" || host.endsWith(".n1mwq.org")) {
      const stream = await resolveBysekoze(embed, site, label, headers);
      if (stream) return stream;
      return null;
    }

    if (host === "strp2p.com" || host.endsWith(".strp2p.com") ||
        host === "vidhidepro.com" || host.endsWith(".vidhidepro.com") ||
        host === "embedwish.com" || host.endsWith(".embedwish.com")) {
      return await resolvePageMedia(embed, site, label, headers);
    }

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

    if (host === "rumble.com" || host.endsWith(".rumble.com")) {
      const stream = await resolveRumbleDirect(embed, site, label, headers["User-Agent"]);
      if (stream) return stream;
      return null;
    }

    if (host === "ok.ru" || host.endsWith(".ok.ru")) {
      const id = (url.pathname.match(/\/video(?:embed)?\/(\d+)/i) || [])[1];
      if (!id) return null;
      const embedUrl = "https://ok.ru/videoembed/" + id;
      const r = await kino.fetch(embedUrl, { headers: { ...headers, Referer: "https://ok.ru/" }, timeoutMs: 9000 });
      if (!r.ok) {
        log("servidor " + label + ": OK.ru respondió HTTP " + r.status);
        return null;
      }
      // Parse data-options from the original HTML. Decoding &quot; across the
      // whole page first can turn escaped attribute quotes into delimiters and
      // truncate the tag before JSON.parse ever sees the metadata.
      const html = r.text();
      const player = parseOkruPlayerOptions(html);
      const flashvars = player && player.flashvars;
      if (!flashvars) {
        log("servidor " + label + ": no se encontró flashvars en data-options de OK.ru");
        return null;
      }
      let metadata = flashvars.metadata;
      if (typeof metadata === "string") {
        try { metadata = JSON.parse(decode(metadata)); } catch { metadata = null; }
      }
      if (!metadata && flashvars.metadataUrl) {
        try {
          const metadataUrl = new URL(decode(flashvars.metadataUrl), "https://ok.ru/").href;
          const mr = await kino.fetch(metadataUrl, { headers: { ...headers, Referer: "https://ok.ru/" }, timeoutMs: 7000 });
          if (mr.ok) metadata = mr.json();
        } catch (e) { log("servidor " + label + ": no se pudieron leer metadatos de OK.ru"); }
      }
      const videos = metadata && Array.isArray(metadata.videos) ? metadata.videos.slice() : [];
      const metadataShape = metadata && typeof metadata === "object" ? Object.keys(metadata).slice(0, 30) : [];
      const videoSummary = videos.slice(0, 12).map((v) => ({
        name: String(v.name || v.quality || "").slice(0, 20),
        keys: v && typeof v === "object" ? Object.keys(v).slice(0, 12) : [],
        url: typeof v.url === "string" ? (() => { try { const u = new URL(v.url); return { host: u.hostname, path: u.pathname.slice(-28), extension: /\.(m3u8|mp4|webm)$/i.exec(u.pathname)?.[1] || "none", length: v.url.length, queryKeys: Array.from(u.searchParams.keys()).slice(0, 10) }; } catch { return { invalid: true }; } })() : typeof v.url
      }));
      const hlsFields = ["hlsMasterPlaylistUrl", "hlsManifestUrl", "ondemandHls", "ondemandDash", "hlsMasterUrl"]
        .map((key) => ({ key, type: !metadata || metadata[key] == null ? "missing" : Array.isArray(metadata[key]) ? "array" : typeof metadata[key] }));
      log("servidor " + label + ": metadatos OK.ru keys=" + JSON.stringify(metadataShape) + " hls=" + JSON.stringify(hlsFields) + " videos=" + JSON.stringify(videoSummary).slice(0, 1100));
      const rank = (v) => {
        const quality = String(v.name || v.quality || "").toLowerCase();
        if (/1080|full/.test(quality)) return 0;
        if (/720|hd/.test(quality)) return 1;
        if (/480|sd/.test(quality)) return 2;
        return 3;
      };
      const directVideo = (v) => typeof v.url === "string" && /^https:\/\//i.test(v.url) && /\.(?:mp4|webm)(?:[?#]|$)/i.test(v.url);
      videos.sort((a, b) => rank(a) - rank(b));
      const streamHeaders = { Referer: embedUrl, Origin: "https://ok.ru", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36" };
      // OK.ru puede llamar "ondemandHls" a una URL DASH .mpd. No clasificarla
      // por el nombre del campo: el protocolo real lo determina el manifiesto.
      const manifests = [];
      const manifestUrlShape = (value) => {
        try {
          const u = new URL(value);
          const ext = /\.(mpd|m3u8)$/i.exec(u.pathname);
          return {
            host: u.hostname,
            pathTail: /\.(mpd|m3u8)$/i.exec(u.pathname)?.[0].toLowerCase() || "(sin extensión)",
            extension: ext ? ext[1].toLowerCase() : "none",
            length: value.length,
            queryKeys: Array.from(u.searchParams.keys()).slice(0, 12)
          };
        } catch { return { invalid: true }; }
      };
      const collectManifests = (node, key, depth) => {
        if (depth > 8 || node == null) return;
        if (typeof node === "string") {
          const value = node.replace(/\\u0026/gi, "&").replace(/\\\\\//g, "/").trim();
          if (!/^https:\/\//i.test(value)) return;
          let pathname = "";
          try { pathname = new URL(value).pathname; } catch { return; }
          // Use the actual URL extension when present. If the server gives an extensionless
          // manifest endpoint, retain the metadata field as a fallback but log that fact.
          if (/\.mpd$/i.test(pathname)) manifests.push({ url: value, kind: "dash", field: key, confirmedExtension: true });
          else if (/\.m3u8$/i.test(pathname)) manifests.push({ url: value, kind: "hls", field: key, confirmedExtension: true });
          else if (/ondemandDash/i.test(key)) manifests.push({ url: value, kind: "dash", field: key, confirmedExtension: false });
          else if (/hls/i.test(key)) manifests.push({ url: value, kind: "hls", field: key, confirmedExtension: false });
          return;
        }
        if (Array.isArray(node)) { for (const item of node) collectManifests(item, key, depth + 1); return; }
        if (typeof node === "object") for (const [childKey, value] of Object.entries(node)) collectManifests(value, key + "." + childKey, depth + 1);
      };
      for (const key of ["ondemandDash", "hlsMasterPlaylistUrl", "hlsManifestUrl", "ondemandHls", "hlsMasterUrl"]) collectManifests(metadata && metadata[key], key, 0);
      log("servidor " + label + ": candidatos manifiesto OK.ru=" + JSON.stringify(manifests.map((item) => ({
        field: item.field, kind: item.kind, confirmedExtension: item.confirmedExtension, url: manifestUrlShape(item.url)
      }))).slice(0, 1600));
      // If both protocols are offered, try HLS first: Kino's playback path is
      // already confirmed to handle HLS, while the OK.ru DASH manifest currently
      // returns HTTP 400. Keep DASH available as a selectable fallback.
      const manifest = manifests.find((item) => item.kind === "hls" && item.confirmedExtension) ||
        manifests.find((item) => item.kind === "dash" && item.confirmedExtension) ||
        manifests.find((item) => item.kind === "hls") ||
        manifests.find((item) => item.kind === "dash");
      const direct = videos.find(directVideo);
      const alternatives = (selectedUrl) => {
        const otherManifests = manifests.filter((item) => item.url !== selectedUrl).map((item) => ({
          url: item.url,
          mime: item.kind === "dash" ? "application/dash+xml" : "application/x-mpegURL",
          headers: streamHeaders,
          label: "OK.ru · " + (item.kind === "dash" ? "DASH alternativo" : "HLS alternativo")
        }));
        const directVideos = videos.filter((v) => directVideo(v) && v.url !== selectedUrl).slice(0, 7).map((v) => ({
          url: v.url,
          mime: /\\.webm(?:[?#]|$)/i.test(v.url) ? "video/webm" : "video/mp4",
          headers: streamHeaders,
          label: ("OK.ru · " + String(v.name || v.quality || "Video")).slice(0, 48)
        }));
        return [...otherManifests, ...directVideos].slice(0, 8);
      };
      if (manifest) {
        const dash = manifest.kind === "dash";
        const mime = dash ? "application/dash+xml" : "application/x-mpegURL";
        const stream = { url: manifest.url, mime, headers: streamHeaders, label: dash ? "OK.ru · DASH" : "OK.ru · HLS" };
        stream.alternatives = alternatives(manifest.url);
        if (!stream.alternatives.length) delete stream.alternatives;
        log("servidor " + label + ": manifiesto " + (dash ? "DASH" : "HLS") + (manifest.confirmedExtension ? (dash ? " (.mpd)" : " (.m3u8)") : " (extensión no confirmada; inferido de " + manifest.field + ")") + " de OK.ru resuelto desde metadata");
        return stream;
      }
      if (direct) {
        const stream = {
          url: direct.url,
          mime: /\.webm(?:[?#]|$)/i.test(direct.url) ? "video/webm" : "video/mp4",
          headers: streamHeaders,
          label: ("OK.ru · " + String(direct.name || direct.quality || "Video")).slice(0, 48)
        };
        stream.alternatives = alternatives(direct.url);
        if (!stream.alternatives.length) delete stream.alternatives;
        log("servidor " + label + ": video de OK.ru resuelto desde metadata");
        return stream;
      }
      return null;
    }

    if (host === "voe.sx" || host.endsWith(".voe.sx")) {
      const r = await kino.fetch(embed, { headers: { "User-Agent": headers["User-Agent"] } });
      if (!r.ok) return null;
      let html = r.text();
      let realUrl = embed;
      const redirect = /window\.location\.href\s*=\s*['"]([^'"]+\/e\/[^'"]+)['"]/.exec(html);
      if (redirect && redirect[1]) {
        realUrl = new URL(redirect[1], embed).href;
        const rr = await kino.fetch(realUrl, { headers: { "User-Agent": headers["User-Agent"] } });
        if (!rr.ok) return null;
        html = rr.text();
      }
      let config = /<script[^>]+type=["']application\/json["'][^>]*>\s*(?:\[\s*)?["']([^"']+)["']/.exec(html);
      let encoded = config && config[1];
      if (!encoded) {
        // Some VOE pages protect the source with ALTCHA proof-of-work. Solve the bounded challenge
        // directly; if the challenge is unsupported or too expensive, use Kino's browser fallback.
        const csrf = /name=["']_token["'][^>]+value=["']([^"']+)["']/.exec(html);
        const challenge = /<altcha-widget[^>]+challenge=["']([^"']+)["']/.exec(html);
        if (!csrf || !challenge) return null;
        const challengeUrl = new URL(challenge[1], realUrl).href;
        const cr = await kino.fetch(challengeUrl, { headers: { "User-Agent": headers["User-Agent"], Referer: realUrl }, timeoutMs: 15000 });
        if (!cr.ok) return null;
        const cj = cr.json();
        const algorithm = String(cj.algorithm || "").toLowerCase().replace(/-/g, "");
        const cost = Number(cj.cost), keyLength = Number(cj.keyLength);
        const keyPrefix = String(cj.keyPrefix || ""), nonce = String(cj.nonce || ""), salt = String(cj.salt || "");
        if (!algorithm.includes("sha256") || !Number.isInteger(cost) || cost < 1 || cost > 100000 ||
            !Number.isInteger(keyLength) || keyLength < 1 || keyLength > 64 ||
            !/^[a-f0-9]+$/i.test(nonce) || !/^[a-f0-9]+$/i.test(salt) || !keyPrefix) return null;
        const started = Date.now();
        let solution = null;
        for (let counter = 0; counter < 1000000 && Date.now() - started < 22000; counter++) {
          const counterHex = counter.toString(16).padStart(8, "0");
          const derived = kino.crypto.pbkdf2("sha256", nonce + counterHex, salt, cost, keyLength, {
            inputEncoding: "hex", outputEncoding: "hex",
          });
          if (derived.startsWith(keyPrefix.toLowerCase())) {
            solution = { counter, derivedKey: derived, time: Date.now() - started };
            break;
          }
        }
        if (!solution) return null;
        const payload = { challenge: cj, solution };
        const payloadB64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        const origin = new URL(realUrl).origin;
        const posted = await kino.fetch(realUrl, {
          method: "POST",
          headers: {
            "User-Agent": headers["User-Agent"], Referer: realUrl, Origin: origin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: { form: { _token: csrf[1], access: "0", altcha: payloadB64 } },
          timeoutMs: 15000,
        });
        if (!posted.ok) return null;
        html = posted.text();
        config = /<script[^>]+type=["']application\/json["'][^>]*>\s*\[\s*["']([^"']+)["']\s*\]\s*<\/script>/i.exec(html);
        encoded = config && config[1];
      }
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
  if (!embed) {
    log("servidor " + server.name + ": dirección del reproductor vacía");
    return null;
  }
  if (!embedAllowed(embed)) {
    let where = "host desconocido";
    try {
      const u = new URL(embed);
      where = u.hostname + u.pathname.slice(0, 80);
    } catch {}
    log("servidor " + server.name + ": reproductor no admitido (" + where + ")");
    return null;
  }
  const manual = await resolveManual(embed, site, server.name);
  if (manual) return manual;
  // sp2p stays HTTP-only. Byse/Filemoon now falls back to capture because its
  // player obtains the signed HLS URL through an encrypted playback API after JS runs.
  try {
    const host = new URL(embed).hostname.toLowerCase();
    if (host === "strp2p.com" || host.endsWith(".strp2p.com")) {
      log("servidor " + server.name + ": no se pudo resolver por HTTP directo; sp2p omite captura de navegador");
      return null;
    }
  } catch {}
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
