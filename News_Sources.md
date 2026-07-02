# News Sources — Sitemap Scraper Results

Generated 2026-07-02. Method: replicate the CNN news-sitemap crawler on each publisher — locate a Google News sitemap (via `robots.txt` or common paths), fetch it, and extract article links and headlines. A site counts as **successful** only if a *news* sitemap returns article links; a generic content sitemap does not count.

**48 of 67** sites had a working, scrapable news sitemap.

> Note: "Headlines" = the sitemap exposes `<news:title>` (headline + link, exactly like CNN). "Links only" = a news sitemap was found but without embedded titles (you'd get article URLs but would need to fetch each page for the headline).

## Successful

### Global Wire Services

- **Associated Press (AP)** — `https://apnews.com/news-sitemap-content.xml` — 648 articles (headlines + links)
- **Reuters** — `https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml` — 50 articles (headlines + links)
- **Bloomberg** — `https://www.bloomberg.com/sitemaps/news/latest.xml` — 585 articles (headlines + links)

### International & National Broadcasters

- **BBC News** — `https://www.bbc.com/sitemaps/https-sitemap-com-news-1.xml` — 1000 articles (headlines + links)
- **PBS News** — `https://www.pbs.org/newshour/sitemaps/news` — 63 articles (headlines + links)
- **NPR** — `https://googlecrawl.npr.org/news/sitemap_news.xml` — 177 articles (headlines + links)
- **Deutsche Welle (DW)** — `https://www.dw.com/en/news-sitemap.xml` — 45 articles (headlines + links)
- **Al Jazeera** — `https://www.aljazeera.com/news-sitemap.xml` — 196 articles (headlines + links)
- **France 24** — `https://www.france24.com/sitemaps/en/news.xml` — 207 articles (headlines + links)
- **ABC News (Australia)** — `https://www.abc.net.au/sitemaps/sitemap-news-0.xml.gz` — 50000 articles (links only) — ⚠️ large archival dump (50k cap, not a rolling 48h news feed like most others)

### Major Newspapers & Digital Publishers (Global)

- **The New York Times** — `https://www.nytimes.com/sitemaps/new/news.xml.gz` — 856 articles (headlines + links)
- **The Washington Post** — `https://www.washingtonpost.com/sitemaps/news-sitemap.xml.gz` — 164 articles (headlines + links)
- **The Wall Street Journal** — `https://www.wsj.com/wsjsitemaps/wsj_google_news.xml` — 368 articles (headlines + links)
- **The Guardian** — `http://www.theguardian.com/sitemaps/news.xml` — 568 articles (headlines + links)
- **Financial Times** — `https://www.ft.com/sitemaps/news.xml` — 231 articles (headlines + links)
- **Le Monde (English)** — `https://www.lemonde.fr/en/sitemap_news.xml` — 60 articles (headlines + links)
- **The Globe and Mail** — `https://www.theglobeandmail.com/arc/outboundfeeds/news-sitemap/?outputType=xml` — 100 articles (headlines + links)
- **The Sydney Morning Herald** — `https://www.smh.com.au/sitemaps/news/brands/smh` — 217 articles (headlines + links)
- **The Straits Times** — `https://www.straitstimes.com/googlenews.xml` — 807 articles (headlines + links)
- **Haaretz** — `https://www.haaretz.com/news-sitemap-content.xml` — 72 articles (headlines + links)
- **The Hindu** — `https://www.thehindu.com/sitemap/googlenews/all/all.xml` — 1000 articles (headlines + links)

### National Focused News (US)

- **CBS News** — `https://www.cbsnews.com/xml-sitemap/news.xml` — 605 articles (headlines + links)
- **NBC News** — `https://www.nbcnews.com/sitemap/nbcnews/sitemap-news` — 152 articles (headlines + links)
- **ABC News** — `https://abcnews.com/xmlLatestStories` — 1000 articles (headlines + links)
- **USA Today** — `https://www.usatoday.com/news-sitemap.xml` — 803 articles (headlines + links)
- **Christian Science Monitor** — `https://www.csmonitor.com/sitemap-news-auto-1.xml` — 18 articles (headlines + links)
- **New Yorker** — `https://www.newyorker.com/feed/google-news-sitemap-feed/sitemap-google-news` — 25 articles (headlines + links)
- **Vox** — `https://www.vox.com/sitemaps/google_news` — 16 articles (headlines + links)
- **Axios** — `https://www.axios.com/sitemaps/news.xml` — 299 articles (headlines + links)

### National Focused News (International)

- **The Independent** — `https://www.independent.co.uk/sitemaps/googlenews` — 500 articles (headlines + links)

### Financial & Business Journalism

- **CNBC** — `https://www.cnbc.com/sitemap_news.xml` — 158 articles (headlines + links)
- **MarketWatch** — `https://www.marketwatch.com/mw_news_sitemap_1.xml` — 1000 articles (headlines + links)
- **Barron’s** — `https://www.barrons.com/bol_news_sitemap.xml` — 150 articles (headlines + links)
- **Investopedia** — `https://www.investopedia.com/google-news-sitemap.xml` — 47 articles (headlines + links)
- **Nikkei Asia** — `https://asia.nikkei.com/news_sitemap.xml?date=20260701` — 32 articles (headlines + links)
- **Fortune** — `https://fortune.com/feed/googlenews/articles.xml` — 86 articles (headlines + links)
- **Forbes** — `https://www.forbes.com/news_sitemap.xml` — 351 articles (headlines + links)
- **Business Insider** — `https://www.businessinsider.com/sitemap/google-news.xml` — 139 articles (headlines + links)

### Science

- **Nature** — `https://www.nature.com/latest-news/sitemap.xml` — 24 articles (headlines + links)
- **Space.com** — `https://www.space.com/sitemap-news.xml` — 24 articles (headlines + links)

### Tech

- **The Verge** — `https://theverge.com/sitemaps/google_news` — 39 articles (headlines + links)
- **WIRED** — `https://www.wired.com/feed/google-latest-news/sitemap-google-news` — 30 articles (headlines + links)
- **TechCrunch** — `https://techcrunch.com/news-sitemap.xml` — 35 articles (headlines + links)

### Health

- **KFF Health News** — `http://kffhealthnews.org/news-sitemap.xml` — 7 articles (headlines + links)
- **Stat News** — `https://statnews.com/news-sitemap.xml` — 27 articles (headlines + links)

### Sports

- **CBS Sports** — `https://www.cbssports.com/sitemaps/all-news-2026-07-sitemap.xml` — 552 articles (links only)
- **Yahoo Sports** — `https://sports.yahoo.com/news-sitemap.xml` — 929 articles (headlines + links)
- **Bleacher Report** — `https://bleacherreport.com/sitemaps/google-news` — 257 articles (headlines + links)

## Failed

Sites where no working news sitemap was found (blocked by bot protection, no news sitemap published, gated/paywalled, or non-parseable).

- **CBC/Radio-Canada** (cbc.ca) — no news sitemap found (404)
- **RTÉ News** (rte.ie) — no news sitemap (only generic/other sitemaps)
- **SBS News** (sbs.com.au) — no news sitemap (only generic/other sitemaps)
- **The Economist** (economist.com) — blocked (401/403)
- **The Times** (thetimes.com) — no news sitemap (not-xml, not-xml, not-xml)
- **The Atlantic** (theatlantic.com) — no news sitemap (only generic/other sitemaps)
- **Politico** (politico.com) — blocked (401/403)
- **ProPublica** (propublica.org) — no news sitemap (only generic/other sitemaps)
- **Daily Telegraph** (telegraph.co.uk) — no news sitemap (only generic/other sitemaps)
- **Irish Times** (irishtimes.com) — no news sitemap (only generic/other sitemaps)
- **Harvard Business Review** (hbr.org) — no news sitemap found (404)
- **Quartz** (qz.com) — blocked (401/403)
- **Science** (science.org) — blocked (401/403)
- **Scientific American** (scientificamerican.com) — no news sitemap (only generic/other sitemaps)
- **National Geographic** (nationalgeographic.com) — blocked (401/403)
- **Inside Climate News** (insideclimatenews.org) — blocked (401/403)
- **Grist** (grist.org) — no news sitemap (only generic/other sitemaps)
- **Ars Technica** (arstechnica.com) — no news sitemap (only generic/other sitemaps)
- **ESPN** (espn.com) — no news sitemap (not-xml, not-xml, not-xml)

