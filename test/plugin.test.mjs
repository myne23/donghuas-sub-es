// Offline tests: both sites are answered from small pages written here, shaped like the real ones
// (cards, episode lists, server tabs, a packed player script). Nothing touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sdCard = (path, title, ep) =>
  `<article class="donghua-card"><a href="${path}" title="x"><div class="card-poster-wrap"><img src="/imagenes-serie/a.webp" alt="x">` +
  (ep ? `<span class="badge-tag badge-ep">EP ${ep}</span>` : "") +
  `</div><div class="card-body"><h3 class="card-title">${title}</h3></div></a></article>`;

const mdCard = (path, title, { limited = false, badge = "Donghua" } = {}) =>
  `<div class="md-card${limited ? " limited" : ""}"><a href="${path}"><div class="md-card-img"><img src="/thumbs/a.jpg" alt="${title}">` +
  `<span class="md-card-badge donghua">${badge}</span></div><div class="md-card-info"><h3 class="md-card-title">${title} Episodio 1</h3></div></a></div>`;

const SD_HOME =
  `<h2 class="section-title">Nuevos Episodios</h2>` +
  sdCard("/gu-an-episodio-13/", "Gu An", 13) + sdCard("/gu-an-episodio-12/", "Gu An", 12) + sdCard("/doupo-7-episodio-3/", "Doupo &amp; Co", 3) +
  `<h2 class="section-title">Series Donghua en Emisión</h2>` + sdCard("/gu-an/", "Gu An");

const MD_HOME =
  `<h2 class="md-section-title">Episodios Limitados</h2>` +
  mdCard("/ver/swallowed-star-3/160/dG9rZW4=", "Swallowed Star 3", { limited: true }) +
  `<h2 class="md-section-title">Nuevos Episodios</h2>` +
  mdCard("/ver/legend-of-xian-wu-3/76", "Legend of Xian Wu 3") + mdCard("/ver/swallowed-star-3/159", "Swallowed Star 3");

const SD_SERIES =
  `<h1 class="hero-title">Gu An</h1><img src="/p.webp" alt="Gu An" class="hero-poster">` +
  `<meta property="og:image" content="https://seriesdonghua.com/b.webp">` +
  `<h2>Sinopsis</h2><div style="x"><p>Una historia.</p></div><a href="/accion/" class="genre-pill">Acción</a>` +
  [2, 1].map((n) => `<article class="donghua-card episode-card-item" data-ep="${n}"><a href="/gu-an-episodio-${n}/"><span><i class="fas fa-calendar-alt"></i> 11-10-2026</span></a></article>`).join("");

const MD_SERIES =
  `<h1 class="md-detail-title">Swallowed Star 3</h1><div class="md-detail-poster"><img src="/thumbs/p.jpg"></div>` +
  `<p class="md-detail-synopsis">Una historia.<br /></p><a href="/genero/x" class="md-genre-tag">Acción</a>` +
  [159, 158].map((n) => `<li class="md-episode-item" data-ep="${n}"><a href="/ver/swallowed-star-3/${n}" class="md-ep-link">`).join("");

// A real player script of the site, packed with p.a.c.k.e.r (base 36): it appends an iframe to #amagi_play.
const PACKED_VOE = String.raw`eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('$("#w").7(6(e){3(!8){8=1;v 2=u;$("#t").7(6(e){$(s).r();$("#q").p("<4 o=\'n://m.l/e/k\' j=\'5%\' i=\'5%\' h=\'0\' g=\'1\'></4>");3(!2){f.d("c b");a(9);2=1}})}});',33,33,'|true|amagi_done|if|iframe|100|function|click|trigger_amagi|113741|ApplyView|once|buffered|log||console|allowfullscreen|frameborder|height|width|qi68ljjc49gf|sx|voe|https|src|append|amagi_play|remove|this|amagiplay|false|var|amagi_tab'.split('|'),0,{}))`;

const MD_EPISODE = `<button id="amagi_tab" class="md-server-tab">Voe</button><script>${PACKED_VOE}</script>`;

const SD_EPISODE =
  `<meta name="csrf-token" content="tok123">` +
  [["Dailymotion", 0], ["OK.ru", 1], ["Rumble", 2]].map(([n, i]) => `<button type="button" class="server-tab-btn active"\n data-video-id="77"\n data-server-index="${i}"><span>${n}</span><span class="server-badge">Sub ES</span></button>`).join("");

function sites(extra = {}) {
  const asked = [];
  const pages = {
    "https://seriesdonghua.com/": SD_HOME,
    "https://www.mundodonghua.com/": MD_HOME,
    "https://seriesdonghua.com/episodios": sdCard("/gu-an-episodio-13/", "Gu An", 13) + sdCard("/gu-an-episodio-12/", "Gu An", 12) + sdCard("/doupo-7-episodio-3/", "Doupo &amp; Co", 3) + `<a href="https://seriesdonghua.com/episodios?page=2" rel="next">2</a>`,
    "https://seriesdonghua.com/episodios?page=2": sdCard("/gu-an-episodio-1/", "Gu An", 1),
    "https://www.mundodonghua.com/lista-donghuas/2": mdCard("/donghua/gu-an", "Gu An"),
    "https://seriesdonghua.com/todos-los-donghuas": sdCard("/gu-an/", "Gu An") + sdCard("/doupo-7/", "Doupo 7") + `<a rel="next" href="/todos-los-donghuas?page=2">2</a>`,
    "https://www.mundodonghua.com/lista-donghuas": mdCard("/donghua/swallowed-star-3", "Swallowed Star 3") + `<a href="/lista-donghuas/2"><i class="fas fa-chevron-right"></i></a>`,
    "https://seriesdonghua.com/buscar.php?s=gu": sdCard("/gu-an/", "Gu An"),
    "https://www.mundodonghua.com/busquedas?donghua=gu": mdCard("/donghua/gu-an", "Gu An"),
    "https://seriesdonghua.com/gu-an/": SD_SERIES,
    "https://www.mundodonghua.com/donghua/swallowed-star-3": MD_SERIES,
    "https://seriesdonghua.com/gu-an-episodio-1/": SD_EPISODE,
    "https://www.mundodonghua.com/ver/swallowed-star-3/159": MD_EPISODE,
    ...extra,
  };
  const fetchImpl = async (url, init = {}) => {
    asked.push((init.method || "GET") + " " + url);
    if (String(url).endsWith("/api/player/get-server")) {
      const { server_index } = JSON.parse(init.body);
      return new Response(JSON.stringify({ success: true, embed_url: ["https://www.dailymotion.com/embed/video/x1", "https://ok.ru/videoembed/9", "https://rumble.com/embed/v7eiaew/"][server_index] }), { status: 200 });
    }
    return pages[url] === undefined ? new Response("no", { status: 404 }) : new Response(pages[url], { status: 200 });
  };
  return { fetchImpl, asked };
}

async function run(fn, args) {
  const { fetchImpl, asked } = sites();
  const r = await validate(root, { run: fn, args, fetchImpl });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  return { out: r.output, asked };
}

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});

test("home: four rows, one per site and kind, and the limited episodes come first", async () => {
  const { out } = await run("home", []);
  assert.deepEqual(out.map((r) => r.id), ["latest-sd", "latest-md", "cat-sd", "cat-md"]);
  assert.ok(out.every((r) => r.genre === "anime" && r.ref));
  const sd = out[0].items;
  assert.deepEqual(sd.map((i) => i.id), ["sd-gu-an", "sd-doupo-7"]); // one card per series, the newest episode
  assert.equal(sd[1].title, "Doupo & Co");
  const md = out[1].items;
  assert.equal(md[0].id, "md-swallowed-star-3");
  assert.ok(md[0].badges.includes("EP 160"));
  assert.equal(md[1].id, "md-legend-of-xian-wu-3");
});

test("browse pages a catalog with the site's next link", async () => {
  const { out } = await run("browse", ["cat:sd"]);
  assert.equal(out.items.length, 2);
  assert.equal(out.next, "/todos-los-donghuas?page=2");
});

test("browse pages the MundoDonghua catalog (/lista-donghuas/N) and the last page has no next", async () => {
  const first = (await run("browse", ["cat:md"])).out;
  assert.equal(first.next, "/lista-donghuas/2");
  const second = (await run("browse", ["cat:md", "/lista-donghuas/2"])).out;
  assert.equal(second.items.length, 1);
  assert.ok(!second.next);
});

test("browse pages the latest episodes of SeriesDonghua", async () => {
  const first = (await run("browse", ["latest:sd"])).out;
  assert.equal(first.next, "/episodios?page=2");
  assert.equal(first.items.length, 2);
  const second = (await run("browse", ["latest:sd", "/episodios?page=2"])).out;
  assert.deepEqual(second.items.map((i) => i.id), ["sd-gu-an"]);
});

test("search asks both sites", async () => {
  const { out, asked } = await run("search", ["gu"]);
  const items = Array.isArray(out) ? out : out.items;
  assert.deepEqual(items.map((i) => i.id).sort(), ["md-gu-an", "sd-gu-an"]);
  assert.equal(asked.length, 2);
});

test("episodes of each site", async () => {
  const sd = (await run("episodes", ["sd:/gu-an/"])).out;
  assert.deepEqual(sd.episodes.map((e) => e.number), [1, 2]);
  assert.equal(sd.episodes[0].airDate, "2026-10-11");
  assert.equal(sd.series.title, "Gu An");
  const md = (await run("episodes", ["md:/donghua/swallowed-star-3"])).out;
  assert.deepEqual(md.episodes.map((e) => e.number), [158, 159]);
});

// resolve needs Kino's hidden browser, which the kit doesn't have: the plugin runs here with a small stand-in.
async function withKino(pages, body) {
  const { fetchImpl } = sites(pages);
  const captured = [];
  const logs = [];
  const stand = {
    lang: "es-CO",
    log(...args) { logs.push(args.join(" ")); },
    error: (code, msg, o) => Object.assign(new Error(msg), { code, userMessage: o && o.userMessage }),
    storage: { get: () => null, set() {} },
    fetch: async (url, o) => {
      const r = await fetchImpl(url, o && o.body ? { method: o.method, body: JSON.stringify(o.body.json) } : o);
      const body = await r.text();
      return { ok: r.ok, status: r.status, text: () => body, json: () => JSON.parse(body) };
    },
    browser: {
      capture: async (url) => {
        captured.push(url);
        if (/dailymotion/.test(url)) throw Object.assign(new Error("blocked"), { code: "blocked" });
        return { media: [{ url: "https://cdn.example/a/index.m3u8", headers: { Referer: url } }], subtitles: [], finalUrl: url };
      },
    },
  };
  const before = globalThis.kino;
  globalThis.kino = stand;
  try {
    const plugin = await import(pathToFileURL(join(root, "plugin.js")).href + "?t=" + Math.random());
    await body(plugin, captured, logs);
  } finally {
    globalThis.kino = before;
  }
}

test("resolve (SeriesDonghua): skips a server that gives nothing and offers the rest as lazy copies", async () => {
  await withKino({}, async (plugin, captured) => {
    const s = await plugin.resolve("sd:/gu-an-episodio-1/");
    assert.equal(s.url, "https://cdn.example/a/index.m3u8");
    assert.equal(s.mime, "application/x-mpegURL");
    assert.match(s.label, /OK\.ru/);
    assert.deepEqual(captured, ["https://www.dailymotion.com/embed/video/x1", "https://ok.ru/videoembed/9"]);
    const lazy = await plugin.resolve("srv:1:sd:/gu-an-episodio-1/");
    assert.equal(lazy.url, "https://cdn.example/a/index.m3u8");
  });
});

test("resolve (MundoDonghua): reads the player address out of the packed script", async () => {
  await withKino({}, async (plugin, captured) => {
    const s = await plugin.resolve("md:/ver/swallowed-star-3/159");
    assert.equal(s.url, "https://cdn.example/a/index.m3u8");
    assert.deepEqual(captured, ["https://voe.sx/e/qi68ljjc49gf"]);
    assert.match(s.label, /Voe/);
  });
});

test("resolve (Dailymotion): uses the direct stream API without browser capture", async () => {
  await withKino({
    "https://geo.dailymotion.com/videos/x1": JSON.stringify({ stream: { url: "https://cdn.example/master.m3u8" } }),
  }, async (plugin, captured) => {
    const stream = await plugin.resolve("sd:/gu-an-episodio-1/");
    assert.equal(stream.url, "https://cdn.example/master.m3u8");
    assert.equal(stream.mime, "application/x-mpegURL");
    assert.deepEqual(captured, []);
  });
});

test("resolve (OK.ru): reads player metadata and prefers a direct video with required headers", async () => {
  await withKino({
    "https://geo.dailymotion.com/videos/x1": JSON.stringify({ stream: {} }),
    "https://ok.ru/videoembed/9": String.raw`<div data-options='{"flashvars":{"metadata":{"videos":[{"name":"hd","url":"https://cdn.example/ok-file?token=abc"}],"hlsManifestUrl":"https://cdn.example/ok.m3u8"}}}'></div>`,
  }, async (plugin, captured) => {
    const stream = await plugin.resolve("sd:/gu-an-episodio-1/");
    assert.equal(stream.url, "https://cdn.example/ok.mp4");
    assert.equal(stream.mime, "video/mp4");
    assert.equal(stream.headers.Referer, "https://ok.ru/videoembed/9");
    assert.equal(stream.headers.Origin, "https://ok.ru");
    assert.deepEqual(captured, ["https://www.dailymotion.com/embed/video/x1"]);
  });
});

test("resolve (OK.ru): classifies ondemandHls .mpd as DASH, not HLS", async () => {
  const mpd = "https://cdn.example/dash4_9.signed.mpd";
  await withKino({
    "https://geo.dailymotion.com/videos/x1": JSON.stringify({ stream: {} }),
    "https://ok.ru/videoembed/9": String.raw`<div data-options='{"flashvars":{"metadata":{"videos":[],"ondemandHls":"${mpd}"}}}'></div>`,
  }, async (plugin, captured) => {
    const stream = await plugin.resolve("sd:/gu-an-episodio-1/");
    assert.equal(stream.url, mpd);
    assert.equal(stream.mime, "application/dash+xml");
    assert.equal(stream.label, "OK.ru · DASH");
    assert.equal(stream.headers.Referer, "https://ok.ru/videoembed/9");
    assert.equal(stream.headers.Origin, "https://ok.ru");
    assert.deepEqual(captured, []);
  });
});

test("resolve (OK.ru): prefers HLS when both HLS and DASH manifests are present", async () => {
  const mpd = "https://cdn.example/dash4_9.signed.mpd";
  const hls = "https://cdn.example/master.m3u8";
  await withKino({
    "https://geo.dailymotion.com/videos/x1": JSON.stringify({ stream: {} }),
    "https://ok.ru/videoembed/9": String.raw`<div data-options='{\"flashvars\":{\"metadata\":{\"videos\":[],\"ondemandHls\":\"https://cdn.example/opaque-hls-token\",\"ondemandDash\":\"${mpd}\"}}}'></div>`,
  }, async (plugin, captured, logs) => {
    const stream = await plugin.resolve("sd:/gu-an-episodio-1/");
    assert.equal(stream.url, hls);
    assert.equal(stream.mime, "application/x-mpegURL");
    assert.equal(stream.label, "OK.ru · HLS");
    assert.equal(stream.headers.Referer, "https://ok.ru/videoembed/9");
    assert.equal(stream.headers.Origin, "https://ok.ru");
    assert.deepEqual(captured, []);
    assert.ok(stream.alternatives.some((item) => item.url === mpd && item.mime === "application/dash+xml"));
    assert.ok(logs.some((line) => line.includes('"extension":"mpd"') && line.includes('"confirmedExtension":true')));
  });
});

test("resolve (Rumble): reads its public embedJS API without browser capture", async () => {
  await withKino({
    "https://rumble.com/embedJS/u3/?request=video&v=v7eiaew": JSON.stringify({ ua: { hls: { url: "https://cdn.example/rumble.m3u8" } } }),
  }, async (plugin, captured) => {
    const stream = await plugin.resolve("srv:2:sd:/gu-an-episodio-1/");
    assert.equal(stream.url, "https://cdn.example/rumble.m3u8");
    assert.equal(stream.mime, "application/x-mpegURL");
    assert.equal(stream.headers.Referer, "https://rumble.com/embed/v7eiaew/");
    assert.deepEqual(captured, []);
  });
});

test("resolve fails with a message for the person when no server gives video", async () => {
  await withKino({ "https://seriesdonghua.com/gu-an-episodio-1/": SD_EPISODE.replace(/OK\.ru/, "Dailymotion") }, async (plugin) => {
    await assert.rejects(plugin.resolve("srv:0:sd:/gu-an-episodio-1/"), (e) => e.code === "unavailable" && /servidor/.test(e.userMessage));
  });
});
