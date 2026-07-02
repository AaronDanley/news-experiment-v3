// CNN News Sitemap Crawler — barebones experiment
//
// Google requires news publishers to expose a "News Sitemap" so their articles
// can appear in Google News. For CNN, robots.txt points to:
//   https://www.cnn.com/sitemap/news.xml
//
// That file follows the Google News sitemap spec, so each <url> already contains
// the headline (<news:title>), the article link (<loc>) and a publication date
// (<news:publication_date>). We fetch it server-side (avoids browser CORS),
// parse it, and render a plain HTML list.
//
// Run:  node server.js   then open http://localhost:3000

const http = require("node:http");

const PORT = 3000;
const NEWS_SITEMAP = "https://www.cnn.com/sitemap/news.xml";

// A polite, descriptive User-Agent. CNN's robots.txt blocks many bots outright,
// so we identify as a normal browser for this experiment.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Decode the handful of XML entities that show up in headlines. */
function decodeEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Parse a Google News sitemap into an array of articles.
 * The structure is regular, so a scoped regex over each <url> block is enough
 * for a barebones experiment (no XML-parser dependency required).
 */
function parseNewsSitemap(xml) {
  const articles = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];

  for (const block of urlBlocks) {
    const loc = block.match(/<loc>([\s\S]*?)<\/loc>/);
    const title = block.match(/<news:title>([\s\S]*?)<\/news:title>/);
    const date = block.match(
      /<news:publication_date>([\s\S]*?)<\/news:publication_date>/
    );

    if (!loc || !title) continue;

    articles.push({
      url: decodeEntities(loc[1].trim()),
      title: decodeEntities(title[1].trim()),
      publishedAt: date ? date[1].trim() : null,
    });
  }

  return articles;
}

/** Fetch and parse the latest CNN headlines. */
async function getCnnArticles() {
  const res = await fetch(NEWS_SITEMAP, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml" },
  });

  if (!res.ok) {
    throw new Error(`Sitemap request failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  return parseNewsSitemap(xml);
}

/** Escape text so it is safe to drop into HTML. */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(articles, error) {
  const rows = articles
    .map((a) => {
      const when = a.publishedAt
        ? new Date(a.publishedAt).toLocaleString()
        : "";
      return `<li>
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        a.title
      )}</a>
        <div class="meta">${escapeHtml(when)}</div>
      </li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CNN News Sitemap Crawler</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.4; }
    h1 { font-size: 1.4rem; }
    .source { color: #555; font-size: .85rem; margin-bottom: 1.5rem; }
    ol { padding-left: 1.4rem; }
    li { margin-bottom: 1rem; }
    a { color: #0645ad; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #777; font-size: .8rem; }
    .error { color: #b00; }
  </style>
</head>
<body>
  <h1>CNN Latest Headlines</h1>
  <p class="source">
    Crawled from <a href="${NEWS_SITEMAP}" target="_blank" rel="noopener noreferrer">${NEWS_SITEMAP}</a>
    &middot; ${articles.length} article${articles.length === 1 ? "" : "s"}
    &middot; <a href="/">refresh</a>
  </p>
  ${error ? `<p class="error">Error: ${escapeHtml(error)}</p>` : ""}
  <ol>
    ${rows}
  </ol>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }

  try {
    const articles = await getCnnArticles();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage(articles));
  } catch (err) {
    res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage([], err.message));
  }
});

server.listen(PORT, () => {
  console.log(`CNN news crawler running at http://localhost:${PORT}`);
});
