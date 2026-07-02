// Local spot-check page for data/headlines.json — reads the file fresh on
// every request (no separate "build the HTML" step), groups headlines into
// the 7 topic categories, and shows each one as [tag] headline — source.
//
// Run:  node view_headlines.js   then open http://localhost:3001
// (Run fetch_headlines.js first to actually populate data/headlines.json.)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 3001;
const DATA_FILE = path.join(__dirname, "data", "headlines.json");

const CATEGORY_ORDER = [
  "Politics",
  "Business",
  "Technology",
  "Arts & Entertainment",
  "Sports",
  "Science",
  "Health",
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadHeadlines() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function renderPage(headlines) {
  const fetchedAt = headlines[0]?.fetchedAt;
  const when = fetchedAt ? new Date(fetchedAt).toLocaleString() : "no data yet — run fetch_headlines.js first";

  const sections = CATEGORY_ORDER.map((category) => {
    const rows = headlines.filter((h) => h.category === category);
    if (!rows.length) return "";
    const items = rows
      .map(
        (h) => `<li>
        <span class="tag">${escapeHtml(h.region)}</span>
        <a href="${escapeHtml(h.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.headline)}</a>
        <span class="src">— ${escapeHtml(h.source)}</span>
      </li>`
      )
      .join("\n");
    return `<h2>${escapeHtml(category)} <span class="count">(${rows.length})</span></h2>\n<ul>\n${items}\n</ul>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Headline Spot-Check</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.4; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1.1rem; border-bottom: 1px solid #ccc; padding-bottom: .25rem; margin-top: 2rem; }
    .count { color: #888; font-weight: normal; font-size: .9rem; }
    .meta { color: #555; font-size: .85rem; margin-bottom: 1rem; }
    ul { padding-left: 0; list-style: none; }
    li { margin-bottom: .6rem; }
    .tag { display: inline-block; min-width: 3.2rem; font-size: .75rem; font-weight: bold; color: #555; border: 1px solid #ccc; border-radius: 3px; padding: 0 .3rem; margin-right: .4rem; text-align: center; }
    a { color: #0645ad; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .src { color: #777; font-size: .85rem; }
  </style>
</head>
<body>
  <h1>Headline Spot-Check</h1>
  <p class="meta">${headlines.length} headlines &middot; fetched ${escapeHtml(when)} &middot; <a href="/">refresh</a></p>
  ${sections || "<p>No headlines to show yet.</p>"}
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  const headlines = loadHeadlines();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderPage(headlines));
});

server.listen(PORT, () => {
  console.log(`Headline spot-check running at http://localhost:${PORT}`);
});
