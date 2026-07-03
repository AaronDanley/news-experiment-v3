// Local page for data/ranked_stories.json — the deduped + Groq-ranked output
// from groq_dedupe_rank.js. Reads the file fresh on every request (no build
// step) and shows one row per unique story in rank order, with a badge for how
// many sources covered it.
//
// Run:  node view_ranked.js   then open http://localhost:3002
// (Run fetch_headlines.js then groq_dedupe_rank.js first to populate the data.)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 3002;
const DATA_FILE = path.join(__dirname, "data", "ranked_stories.json");

const CATEGORY_ORDER = [
  "Politics",
  "Business",
  "Technology",
  "Arts & Entertainment",
  "Sports",
  "Science",
  "Health",
];

function slug(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadRanked() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return null;
  }
}

function renderPage(data) {
  if (!data || !Array.isArray(data.stories) || !data.stories.length) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
      <title>Ranked Stories</title></head><body>
      <p>No ranked data yet — run <code>node fetch_headlines.js</code> then
      <code>node groq_dedupe_rank.js</code> first.</p></body></html>`;
  }

  const when = data.rankedAt ? new Date(data.rankedAt).toLocaleString() : "unknown";
  const multi = data.stories.filter((s) => s.totalSources > 1).length;

  const renderStory = (s) => {
    const badge =
      s.totalSources > 1
        ? `<span class="badge multi" title="${escapeHtml(s.sources.join(", "))}">${s.totalSources} sources</span>`
        : `<span class="badge">1 source</span>`;
    const primary = s.primarySource || s.sources[0] || "";
    const others = (s.sources || []).filter((src) => src !== primary);
    const othersLine = others.length
      ? `<div class="sources">also: ${escapeHtml(others.join(" · "))}</div>`
      : "";
    return `<li>
        <span class="rank">${s.rank}</span>
        <div class="story">
          <div class="line">
            <span class="tag">${escapeHtml(s.region)}</span>
            ${badge}
          </div>
          <a href="${escapeHtml(s.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.headline)}</a>
          <div class="primary">${escapeHtml(primary)}</div>
          ${othersLine}
        </div>
      </li>`;
  };

  // Group stories under category headings, preserving global rank order within
  // each section. Any category not in the fixed order is appended after.
  const seen = new Set(CATEGORY_ORDER);
  const extraCats = [...new Set(data.stories.map((s) => s.category))].filter((c) => !seen.has(c));
  const categories = [...CATEGORY_ORDER, ...extraCats];

  const present = categories
    .map((cat) => ({ cat, rows: data.stories.filter((s) => s.category === cat) }))
    .filter((g) => g.rows.length);

  const nav = present
    .map((g) => `<a href="#${slug(g.cat)}">${escapeHtml(g.cat)} <span class="count">${g.rows.length}</span></a>`)
    .join("");

  const sections = present
    .map(
      (g) => `<section id="${slug(g.cat)}">
      <h2>${escapeHtml(g.cat)} <span class="count">(${g.rows.length})</span></h2>
      <ol>
${g.rows.map(renderStory).join("\n")}
      </ol>
    </section>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ranked Stories</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.4; color: #222; }
    h1 { font-size: 1.4rem; margin-bottom: .25rem; }
    .meta { color: #555; font-size: .85rem; margin-bottom: 1rem; }
    nav { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1.5rem; }
    nav a { font-size: .8rem; color: #333; text-decoration: none; border: 1px solid #ddd; border-radius: 14px; padding: .1rem .6rem; background: #fafafa; }
    nav a:hover { background: #eee; }
    nav .count { color: #999; }
    h2 { font-size: 1.15rem; border-bottom: 2px solid #ccc; padding-bottom: .25rem; margin-top: 2.2rem; scroll-margin-top: 1rem; }
    h2 .count { color: #999; font-weight: normal; font-size: .9rem; }
    ol, ul { list-style: none; padding-left: 0; }
    li { display: flex; gap: .75rem; padding: .6rem 0; border-bottom: 1px solid #eee; align-items: baseline; }
    .rank { color: #999; font-variant-numeric: tabular-nums; min-width: 2.5rem; text-align: right; font-size: .95rem; }
    .story { flex: 1; }
    .line { margin-bottom: .15rem; }
    a { color: #0645ad; text-decoration: none; font-size: 1.02rem; }
    a:hover { text-decoration: underline; }
    .tag { display: inline-block; min-width: 3rem; font-size: .7rem; font-weight: bold; color: #555; border: 1px solid #ccc; border-radius: 3px; padding: 0 .3rem; margin-right: .35rem; text-align: center; }
    .badge { font-size: .7rem; color: #777; border: 1px solid #ddd; border-radius: 10px; padding: 0 .5rem; }
    .badge.multi { color: #b30000; border-color: #f0b0b0; background: #fff5f5; font-weight: bold; cursor: help; }
    .primary { color: #555; font-size: .8rem; font-weight: 600; margin-top: .15rem; }
    .sources { color: #999; font-size: .75rem; margin-top: .05rem; }
  </style>
</head>
<body>
  <h1>Ranked Stories</h1>
  <p class="meta">${data.totalStories} unique stories from ${data.totalHeadlines} headlines &middot; ${multi} covered by multiple sources &middot; ranked ${escapeHtml(when)} &middot; <a href="/">refresh</a></p>
  <nav>${nav}</nav>
${sections}
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderPage(loadRanked()));
});

server.listen(PORT, () => {
  console.log(`Ranked stories page running at http://localhost:${PORT}`);
});
