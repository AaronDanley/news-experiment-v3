// Batch news-sitemap checker.
//
// Replicates the CNN approach for a list of publishers:
//   1. Look for a news sitemap (robots.txt "Sitemap:" entries + common paths).
//   2. Fetch it; if it's a sitemap index, follow the news child.
//   3. Count article <loc> entries and detect Google-News <news:title> headlines.
//
// A site "passes" only if we find a *news* sitemap (Google News namespace, or a
// URL that is clearly a news sitemap) that returns article links — a generic
// content sitemap does not count, since it wouldn't reproduce the CNN result.
//
// Writes results to News_Sources.md.

const fs = require("node:fs");
const zlib = require("node:zlib");

// A handful of aggressively-defended sites (WaPo, Politico, ...) sometimes tear
// down the HTTP/2 socket asynchronously after our code has already moved on
// from that request; that surfaces as an unhandled 'error' event that would
// otherwise crash the whole batch run after results are already computed.
// Swallowing it here is safe since every real request path already has its
// own try/catch and reports its own failure status.
process.on("uncaughtException", (err) => {
  if (err && err.code === "UND_ERR_SOCKET") return;
  throw err;
});

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PATHS = [
  "/sitemap-news.xml",
  "/news-sitemap.xml",
  "/sitemap_news.xml",
  "/sitemap/news.xml",
  "/sitemaps/news.xml",
  "/sitemaps/sitemap-news.xml",
  "/googlenews.xml",
  "/google-news-sitemap.xml",
  "/news/sitemap.xml",
  "/arc/outboundfeeds/news-sitemap/index.xml",
  "/arc/outboundfeeds/news-sitemap/?outputType=xml",
  "/sitemap_news_index.xml",
  "/rss/sitemap_news.xml",
  "/feeds/sitemap_news.xml",
];

// [category, name, host]
const SITES = [
  ["Global Wire Services", "Associated Press (AP)", "apnews.com"],
  ["Global Wire Services", "Reuters", "reuters.com"],
  ["Global Wire Services", "Bloomberg", "bloomberg.com"],

  ["International & National Broadcasters", "BBC News", "bbc.com"],
  ["International & National Broadcasters", "PBS News", "pbs.org"],
  ["International & National Broadcasters", "NPR", "npr.org"],
  ["International & National Broadcasters", "Deutsche Welle (DW)", "dw.com"],
  ["International & National Broadcasters", "CBC/Radio-Canada", "cbc.ca"],
  ["International & National Broadcasters", "Al Jazeera", "aljazeera.com"],
  ["International & National Broadcasters", "France 24", "france24.com"],
  ["International & National Broadcasters", "ABC News (Australia)", "abc.net.au"],
  ["International & National Broadcasters", "RTÉ News", "rte.ie"],
  ["International & National Broadcasters", "SBS News", "sbs.com.au"],

  ["Major Newspapers & Digital Publishers (Global)", "The New York Times", "nytimes.com"],
  ["Major Newspapers & Digital Publishers (Global)", "The Washington Post", "washingtonpost.com"],
  ["Major Newspapers & Digital Publishers (Global)", "The Guardian", "theguardian.com"],
  ["Major Newspapers & Digital Publishers (Global)", "The Economist", "economist.com"],
  ["Major Newspapers & Digital Publishers (Global)", "The Times", "thetimes.com"],
  ["Major Newspapers & Digital Publishers (Global)", "Le Monde (English)", "lemonde.fr"],
  ["Major Newspapers & Digital Publishers (Global)", "The Globe and Mail", "theglobeandmail.com"],
  ["Major Newspapers & Digital Publishers (Global)", "The Sydney Morning Herald", "smh.com.au"],
  ["Major Newspapers & Digital Publishers (Global)", "The Straits Times", "straitstimes.com"],
  ["Major Newspapers & Digital Publishers (Global)", "Haaretz", "haaretz.com"],
  ["Major Newspapers & Digital Publishers (Global)", "The Hindu", "thehindu.com"],

  ["National Focused News (US)", "CBS News", "cbsnews.com"],
  ["National Focused News (US)", "NBC News", "nbcnews.com"],
  ["National Focused News (US)", "ABC News", "abcnews.go.com"],
  ["National Focused News (US)", "USA Today", "usatoday.com"],
  ["National Focused News (US)", "Christian Science Monitor", "csmonitor.com"],
  ["National Focused News (US)", "The Atlantic", "theatlantic.com"],
  ["National Focused News (US)", "New Yorker", "newyorker.com"],
  ["National Focused News (US)", "Vox", "vox.com"],
  ["National Focused News (US)", "Politico", "politico.com"],
  ["National Focused News (US)", "Axios", "axios.com"],
  ["National Focused News (US)", "ProPublica", "propublica.org"],

  ["National Focused News (International)", "The Independent", "independent.co.uk"],
  ["National Focused News (International)", "Daily Telegraph", "telegraph.co.uk"],
  ["National Focused News (International)", "Irish Times", "irishtimes.com"],

  ["Financial & Business Journalism", "CNBC", "cnbc.com"],
  ["Financial & Business Journalism", "MarketWatch", "marketwatch.com"],
  ["Financial & Business Journalism", "Investopedia", "investopedia.com"],
  ["Financial & Business Journalism", "Nikkei Asia", "asia.nikkei.com"],
  ["Financial & Business Journalism", "Harvard Business Review", "hbr.org"],
  ["Financial & Business Journalism", "Quartz", "qz.com"],
  ["Financial & Business Journalism", "Fortune", "fortune.com"],
  ["Financial & Business Journalism", "Forbes", "forbes.com"],
  ["Financial & Business Journalism", "Business Insider", "businessinsider.com"],

  ["Science", "Nature", "nature.com"],
  ["Science", "Science", "science.org"],
  ["Science", "Scientific American", "scientificamerican.com"],
  ["Science", "National Geographic", "nationalgeographic.com"],
  ["Science", "Space.com", "space.com"],
  ["Science", "Inside Climate News", "insideclimatenews.org"],
  ["Science", "Grist", "grist.org"],

  ["Tech", "Ars Technica", "arstechnica.com"],
  ["Tech", "The Verge", "theverge.com"],
  ["Tech", "WIRED", "wired.com"],
  ["Tech", "TechCrunch", "techcrunch.com"],
  ["Tech", "Engadget", "engadget.com"],
  ["Tech", "MIT Technology Review", "technologyreview.com"],
  ["Tech", "9to5Mac", "9to5mac.com"],
  ["Tech", "Gizmodo", "gizmodo.com"],
  ["Tech", "Tom's Hardware", "tomshardware.com"],
  ["Tech", "Android Authority", "androidauthority.com"],
  ["Tech", "VentureBeat", "venturebeat.com"],
  ["Tech", "The Register", "theregister.com"],

  ["Health", "KFF Health News", "kffhealthnews.org"],
  ["Health", "Stat News", "statnews.com"],

  ["Sports", "ESPN", "espn.com"],
  ["Sports", "CBS Sports", "cbssports.com"],
  ["Sports", "Yahoo Sports", "sports.yahoo.com"],
  ["Sports", "Bleacher Report", "bleacherreport.com"],
];

function hostVariants(host) {
  const v = [host];
  if (host.startsWith("www.")) v.push(host.slice(4));
  else if (host.split(".").length === 2) v.push("www." + host);
  return [...new Set(v)];
}

async function fetchRaw(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/xml,text/xml,text/html,*/*",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url) {
  try {
    const res = await fetchRaw(url);
    if (!res.ok) return { ok: false, status: res.status };
    let text;
    if (url.endsWith(".gz")) {
      // Some publishers (e.g. NYT) name the URL ".gz" but actually serve plain
      // XML \u2014 detect real gzip via magic bytes instead of trusting the extension.
      const buf = Buffer.from(await res.arrayBuffer());
      const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
      text = isGzip ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    } else {
      text = await res.text();
    }
    return { ok: true, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === "AbortError" ? "timeout" : e.message };
  }
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map(
    (m) => m[1].trim()
  );
}

// Puts URLs that look like the English-language variant first, but ONLY among
// genuine locale-siblings (the same URL/path with just a language segment
// swapped, e.g. "/fr/news.xml" vs "/en/news.xml", or an implicit-default-locale
// root sitemap vs its "/en/" counterpart). Multi-language publishers (DW,
// France 24, Le Monde, ...) shard their news sitemap per locale, and
// robots.txt / document order often lists a non-English locale first --
// without this we'd silently "succeed" on the wrong language. Crucially this
// must NOT reorder unrelated URLs that merely contain "en" somewhere (e.g. a
// wire-syndication sub-feed path like ".../afp_news/en/...") since those
// aren't actually siblings of the publisher's main news sitemap.
function preferEnglish(urls) {
  const localeToken =
    /\/(en|fr|de|es|ar|ru|zh(?:-[a-z]+)?|pt(?:-[a-z0-9]+)?|ja|ko|it|nl|pl|tr|hi|bn|ur|fa(?:-[a-z]+)?|sw|ha|sq|am|bs|bg|el|id|mk|ps|ro|sr|uk)\//i;
  const groups = new Map();
  for (const u of urls) {
    const key = u.replace(localeToken, "/");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  const result = [...urls];
  for (const group of groups.values()) {
    if (group.length < 2) continue; // no real locale sibling, leave order alone
    const english = group.find((u) => /\/en\//i.test(u));
    if (!english) continue;
    const firstPos = result.indexOf(group[0]);
    const engPos = result.indexOf(english);
    if (engPos <= firstPos) continue;
    result.splice(engPos, 1);
    result.splice(firstPos, 0, english);
  }
  return result;
}

// Returns {success, sitemapUrl, articleCount, hasTitles} or {success:false, status}
async function evaluate(url, depth = 0) {
  const r = await fetchText(url);
  if (!r.ok) return { success: false, status: r.status || r.error };
  const xml = r.text;
  if (!xml || xml.length < 40) return { success: false, status: "empty" };

  if (/<sitemapindex[\s>]/i.test(xml)) {
    if (depth > 1) return { success: false, status: 200 };
    const locs = extractLocs(xml);
    const news = locs.filter((l) => /news/i.test(l));
    const pool = news.length ? news : locs;
    const tryList = preferEnglish(pool).slice(0, 8);
    let lastStatus = 200;
    for (const child of tryList) {
      const res = await evaluate(child, depth + 1);
      if (res.success) return res;
      lastStatus = res.status;
    }
    return { success: false, status: lastStatus };
  }

  if (/<urlset[\s>]/i.test(xml)) {
    // Require an actual per-article news element (e.g. <news:news> or a
    // non-standard prefix like <n:news>) — a mere xmlns:news declaration is
    // sometimes left over in a site's shared sitemap template and unused.
    const hasNewsElement = /<[\w-]+:news>/i.test(xml);
    // Word-boundary match against the filename only (not the whole URL) so a
    // generic sub-sitemap living under a "/news/" section path (e.g. a stale
    // video sitemap at "/news/sitemap-video-2017-12.xml") doesn't false-match.
    const path = url.split(/[?#]/)[0];
    const segments = path.split("/").filter(Boolean);
    const filename = segments[segments.length - 1] || "";
    const urlLooksLikeNews = /(?:^|[^a-z])news(?:$|[^a-z])/i.test(filename);
    const locs = extractLocs(xml);
    const titles = (xml.match(/<[\w-]+:title>/gi) || []).length;
    if (locs.length > 0 && (hasNewsElement || urlLooksLikeNews)) {
      return {
        success: true,
        sitemapUrl: url,
        articleCount: locs.length,
        hasTitles: titles > 0,
      };
    }
    return { success: false, status: hasNewsElement ? 200 : "not-news" };
  }

  return { success: false, status: "not-xml" };
}

function reasonFrom(statuses) {
  const s = statuses.filter(Boolean);
  if (s.some((x) => x === "sparse")) return "only near-empty news sitemap (no usable articles)";
  if (s.some((x) => x === 403 || x === 401)) return "blocked (401/403)";
  if (s.some((x) => x === "not-news" || x === 200)) return "no news sitemap (only generic/other sitemaps)";
  if (s.some((x) => x === 404)) return "no news sitemap found (404)";
  if (s.some((x) => x === "timeout")) return "timeout / unreachable";
  if (s.length === 0) return "no sitemap candidates found";
  return `no news sitemap (${s.slice(0, 3).join(", ")})`;
}

async function checkSite([category, name, host]) {
  const variants = hostVariants(host);
  const statuses = [];
  let candidates = [];

  for (const h of variants) {
    const robots = await fetchText(`https://${h}/robots.txt`);
    if (robots.ok && robots.text) {
      const sm = [...robots.text.matchAll(/sitemap:\s*(\S+)/gi)].map((m) => m[1].trim());
      candidates.push(...sm);
    } else {
      statuses.push(robots.status || robots.error);
    }
  }

  // Candidates found via robots.txt are authoritative and must never be crowded
  // out by guessed paths, so they always go first (news-shaped and English-looking
  // ones first within that group). Guessed common paths are only a fallback.
  let fromRobots = [...new Set(candidates)].filter((c) => /^https?:\/\//i.test(c));
  fromRobots.sort((a, b) => (/news/i.test(b) ? 1 : 0) - (/news/i.test(a) ? 1 : 0));
  fromRobots = preferEnglish(fromRobots);

  const primary = variants[0];
  const guessed = PATHS.map((p) => `https://${primary}${p}`);

  const tried = [...fromRobots, ...guessed].slice(0, 20);

  for (const c of tried) {
    let res;
    try {
      res = await evaluate(c);
    } catch {
      res = { success: false, status: "err" };
    }
    // Require a handful of articles — a 1-entry match is a stale/empty shard,
    // not a real news feed.
    if (res.success && res.articleCount >= 3) {
      return { category, name, host, success: true, ...res };
    }
    statuses.push(res.success ? "sparse" : res.status);
  }

  return { category, name, host, success: false, reason: reasonFrom(statuses) };
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
      process.stdout.write(
        `  ${out[idx].success ? "OK  " : "FAIL"}  ${out[idx].name}\n`
      );
    }
  }
  await Promise.all(Array.from({ length: size }, run));
  return out;
}

// Known per-site caveats worth surfacing next to a successful match, keyed by
// the display name used in SITES.
const CAVEATS = {
  "ABC News (Australia)": "large archival dump (50k cap, not a rolling 48h news feed like most others)",
};

function buildMarkdown(results) {
  const ok = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  const date = new Date().toISOString().slice(0, 10);

  let md = `# News Sources — Sitemap Scraper Results\n\n`;
  md += `Generated ${date}. Method: replicate the CNN news-sitemap crawler on each publisher — locate a Google News sitemap (via \`robots.txt\` or common paths), fetch it, and extract article links and headlines. A site counts as **successful** only if a *news* sitemap returns article links; a generic content sitemap does not count.\n\n`;
  md += `**${ok.length} of ${results.length}** sites had a working, scrapable news sitemap.\n\n`;
  md += `> Note: "Headlines" = the sitemap exposes \`<news:title>\` (headline + link, exactly like CNN). "Links only" = a news sitemap was found but without embedded titles (you'd get article URLs but would need to fetch each page for the headline).\n\n`;

  md += `## Successful\n\n`;
  const cats = [...new Set(SITES.map((s) => s[0]))];
  for (const cat of cats) {
    const rows = ok.filter((r) => r.category === cat);
    if (!rows.length) continue;
    md += `### ${cat}\n\n`;
    for (const r of rows) {
      const kind = r.hasTitles ? "headlines + links" : "links only";
      const caveat = CAVEATS[r.name] ? ` — ⚠️ ${CAVEATS[r.name]}` : "";
      md += `- **${r.name}** — \`${r.sitemapUrl}\` — ${r.articleCount} articles (${kind})${caveat}\n`;
    }
    md += `\n`;
  }

  md += `## Failed\n\n`;
  md += `Sites where no working news sitemap was found (blocked by bot protection, no news sitemap published, gated/paywalled, or non-parseable).\n\n`;
  for (const cat of cats) {
    const rows = fail.filter((r) => r.category === cat);
    if (!rows.length) continue;
    for (const r of rows) {
      md += `- **${r.name}** (${r.host}) — ${r.reason}\n`;
    }
  }
  md += `\n`;
  return md;
}

(async () => {
  console.log(`Checking ${SITES.length} sites...\n`);
  const results = await pool(SITES, 8, checkSite);
  const md = buildMarkdown(results);
  fs.writeFileSync("News_Sources.md", md);
  const ok = results.filter((r) => r.success).length;
  console.log(`\nDone. ${ok}/${results.length} successful. Wrote News_Sources.md`);
})();
