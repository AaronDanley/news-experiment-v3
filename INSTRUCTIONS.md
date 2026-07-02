# Instructions

Requirements: Node.js (no npm packages needed — everything uses built-ins).

## 1. CNN news viewer (`server.js`)

Fetches CNN's Google News sitemap and serves the headlines as a barebones web page.

```
node server.js
```

Then open `http://localhost:3000` in a browser.

## 2. Batch sitemap checker (`check_sitemaps.js`)

Checks ~67 publishers for a working, scrapable Google News sitemap (via
`robots.txt` first, then common guessed paths) and writes the results to
[News_Sources.md](News_Sources.md).

```
node check_sitemaps.js
```

Takes about 1–2 minutes. Re-running regenerates `News_Sources.md` from
scratch — any manual edits to that file will be overwritten.

To add or remove a publisher, edit the `SITES` array near the top of
`check_sitemaps.js` (format: `[category, name, host]`).
