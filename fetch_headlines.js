// Fetches today's headlines from every source in sources.json, tags each one
// with a region (U.S. / World) and a topic category, and writes the whole
// thing to data/headlines.json (overwritten fresh on every run — no history,
// no database, just one small JSON file).
//
// Run:  node fetch_headlines.js

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SOURCES = require("./sources.json");

const DATA_DIR = path.join(__dirname, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "headlines.json");

// Keep the JSON light and Groq-batch-friendly later: only keep the newest N
// articles per source (most of these sitemaps are ordered newest-first).
const MAX_PER_SOURCE = 40;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Some source URLs embed a date that would go stale — fill those in with today's date. */
function resolveUrl(url) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return url
    .replace("{YYYYMMDD}", `${yyyy}${mm}${dd}`)
    .replace("{YYYY-MM}", `${yyyy}-${mm}`);
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/xml,text/xml,text/html,*/*",
        // A couple of CDNs (e.g. Nikkei Asia) cache a distinct — sometimes
        // empty — response per Accept-Encoding value; asking for identity
        // avoids landing on a bad cached compressed variant.
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    let text;
    if (url.split(/[?#]/)[0].endsWith(".gz")) {
      // Some publishers name the URL ".gz" but actually serve plain XML —
      // detect real gzip via magic bytes instead of trusting the extension.
      const buf = Buffer.from(await res.arrayBuffer());
      const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
      text = isGzip ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    } else {
      text = await res.text();
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntitiesOnce(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric entities (some publishers, e.g. The Verge/MIT Tech Review, use
    // these for curly quotes/ampersands instead of named entities).
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

// A handful of publishers (Investopedia, Yahoo Sports, ...) double-encode
// entities in their sitemaps (e.g. "&amp;#039;" for an apostrophe) — a
// single decode pass only unwraps the outer "&amp;" layer, leaving a raw
// "&#039;" behind. Running the pass twice cleans that up without a full
// recursive/general-purpose decoder.
function decodeEntities(str) {
  return decodeEntitiesOnce(decodeEntitiesOnce(str));
}

/**
 * Turn a URL's path into a readable fallback headline when a source has no
 * <news:title> (e.g. ABC News Australia, CBS Sports). Some sites (ABC) put a
 * numeric article ID as the very last segment after the descriptive slug
 * (".../shining-a-light-on-women/106866344") — skip trailing digits-only
 * segments so we land on the actual slug instead of a bare ID number.
 */
function fallbackHeadlineFromUrl(url) {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  while (segments.length > 1 && /^\d+$/.test(segments[segments.length - 1])) {
    segments.pop();
  }
  const slug = segments[segments.length - 1] || url;
  const words = slug.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : url;
}

// A few wire services (AP especially) publish non-English headlines (mostly
// Spanish) in the same feed as their English ones. This page is English-only,
// so drop anything that looks like it — 2+ hits on common Spanish words/
// stopwords is a reliable-enough signal without needing a language library.
// (Not foolproof: a handful of terse Spanish headlines with no recognizable
// stopword can still slip through — acceptable given this is a lightweight
// heuristic, not a full language detector.)
const SPANISH_WORDS =
  /\b(el|la|los|las|de|del|una|uno|con|para|que|por|se|es|su|al|en|y|más|fue|fueron|según|tras|dijo|entre|gobierno|presidente|ministro|país|años|contra|políticos?|presos)\b/gi;
function looksNonEnglish(text) {
  const matches = text.match(SPANISH_WORDS) || [];
  return matches.length >= 2;
}

// BBC's single combined news sitemap includes ~40 non-English World Service
// editions (Turkish, Arabic, Tamil, Ukrainian, Igbo, ...) alongside the
// English site — those live under their own path segment (bbc.com/turkce/...,
// bbc.com/arabic/..., etc.) with no reliable text signal in some scripts, so
// this is enforced as a URL allowlist rather than relying on looksNonEnglish.
const ENGLISH_PATH_ALLOWLIST = {
  "BBC News": ["news", "sport", "weather", "newsround", "culture", "travel", "worklife", "future", "reel"],
};

function isAllowedPath(sourceName, link) {
  const allowlist = ENGLISH_PATH_ALLOWLIST[sourceName];
  if (!allowlist) return true;
  try {
    const first = new URL(link).pathname.split("/").filter(Boolean)[0];
    return allowlist.includes(first);
  } catch {
    return true;
  }
}

/** Extract {headline, link} pairs from a Google News (or plain) sitemap. */
function parseArticles(xml, sourceName) {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  const articles = [];
  for (const block of blocks) {
    const locMatch = block.match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i);
    if (!locMatch) continue;
    const link = decodeEntities(locMatch[1].trim());

    const titleMatch = block.match(
      /<[\w-]+:title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/[\w-]+:title>/i
    );
    const headline = titleMatch
      ? decodeEntities(titleMatch[1].trim())
      : fallbackHeadlineFromUrl(link);

    if (headline && link && !looksNonEnglish(headline) && isAllowedPath(sourceName, link)) {
      articles.push({ headline, link });
    }
  }
  return articles;
}

// Section -> default topic category, for sources whose whole beat is one
// topic (a general-news wire like BBC or NYT covers everything, so it gets
// no prior and is classified purely by keyword instead).
const SECTION_PRIOR = {
  Tech: "Technology",
  Science: "Science",
  Health: "Health",
  Sports: "Sports",
};

// Cheap, approximate keyword classifier — good enough for a first-pass spot
// check; Groq cleans up real grouping/ranking later. The category with the
// MOST keyword hits wins (see categorize); ties fall back to the order below.
// Single words get automatic singular/plural matching (word-boundary regex);
// phrases with a space are matched as-is. This avoids naive substring bugs
// (e.g. "app" incorrectly matching inside "happy", or "who" matching almost
// every headline).
const KEYWORD_TERMS = {
  Health: [
    "vaccine", "hospital", "fda", "outbreak", "disease", "virus", "diet",
    "surgeon", "patient", "cdc", "cancer", "mental health",
  ],
  Science: [
    "study", "researcher", "nasa", "climate", "space", "discovery",
    "physics", "biology", "asteroid", "telescope", "fossil",
  ],
  Technology: [
    "app", "ai", "chip", "software", "iphone", "startup", "cybersecurity",
    "google", "meta", "robot", "chatbot", "smartphone", "microsoft",
    "openai", "artificial intelligence",
    // Gaming/consumer electronics — otherwise "game" alone tags these as Sports
    // (e.g. a PlayStation story). These give Technology the stronger signal.
    "playstation", "xbox", "nintendo", "console", "gaming", "video game",
  ],
  "Arts & Entertainment": [
    "movie", "film", "album", "actor", "actress", "box office", "celebrity",
    "tv series", "television", "music", "hollywood", "streaming", "concert",
    "grammy", "oscar",
  ],
  Sports: [
    "match", "championship", "coach", "tournament", "league", "score",
    "game", "player", "world cup", "olympic", "nba", "nfl", "mlb", "fifa",
    "homer", "pitching", "inning", "roster", "playoff", "standing",
    "quarterback", "touchdown", "bullpen", "contract extension",
    "goalkeeper", "referee", "marathon", "medal",
  ],
  Business: [
    "market", "stock", "earning", "inflation", "tariff", "merger", "ipo",
    "bank", "economy", "trade deal", "share", "ceo", "revenue", "investor",
  ],
  Politics: [
    "election", "president", "senate", "congress", "minister", "parliament",
    "war", "policy", "vote", "government", "white house", "kremlin",
    "prime minister", "lawmaker",
    // Prominent, relatively stable hard-news actors/terms so political
    // headlines are recognized on their own merits instead of defaulting or
    // being hijacked by a single stray keyword (e.g. a "World Cup" mention in
    // a multi-story roundup). Keyword-count classification (below) means these
    // add signal without over-claiming borderline cases.
    "trump", "biden", "putin", "zelensky", "netanyahu", "russia", "russian",
    "ukraine", "kyiv", "moscow", "gaza", "israel", "israeli", "hamas", "nato",
    "sanction", "immigration", "border", "court", "supreme court", "diplomat",
    "protest", "ceasefire", "airstrike", "military", "troops", "tariff",
  ],
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompile once: multi-word phrases match verbatim (with word boundaries);
// single words get an optional "s"/"es" suffix so plurals match too.
const KEYWORDS = Object.fromEntries(
  Object.entries(KEYWORD_TERMS).map(([category, terms]) => [
    category,
    terms.map((term) =>
      term.includes(" ")
        ? new RegExp(`\\b${escapeRegex(term)}\\b`, "i")
        : new RegExp(`\\b${escapeRegex(term)}(?:es|s)?\\b`, "i")
    ),
  ])
);

// Pick the category with the most keyword hits (so one incidental keyword
// can't outweigh several on-topic ones); ties resolve to whichever category
// comes first in KEYWORDS. With zero hits, fall back to the source's section
// prior, then to Politics as the general hard-news catch-all.
function categorize(headline, section) {
  let best = null;
  let bestCount = 0;
  for (const [category, patterns] of Object.entries(KEYWORDS)) {
    let count = 0;
    for (const re of patterns) if (re.test(headline)) count++;
    if (count > bestCount) {
      bestCount = count;
      best = category;
    }
  }
  return best || SECTION_PRIOR[section] || "Politics";
}

async function pool(items, size, worker) {
  const out = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: size }, run));
  return out;
}

async function fetchSource(source) {
  const url = resolveUrl(source.url);
  const result = await fetchText(url);
  if (!result.ok) {
    console.log(`  FAIL  ${source.name} (${result.status})`);
    return { source, articles: [], error: result.status };
  }
  const parsed = parseArticles(result.text, source.name).slice(0, MAX_PER_SOURCE);
  console.log(`  OK    ${source.name} — ${parsed.length} articles`);
  return { source, articles: parsed };
}

(async () => {
  console.log(`Fetching headlines from ${SOURCES.length} sources...\n`);
  const results = await pool(SOURCES, 8, fetchSource);

  const fetchedAt = new Date().toISOString();
  const headlines = [];
  for (const { source, articles } of results) {
    for (const { headline, link } of articles) {
      headlines.push({
        headline,
        link,
        source: source.name,
        region: source.region,
        category: categorize(headline, source.section),
        fetchedAt,
      });
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(headlines, null, 2));

  const failed = results.filter((r) => r.error).length;
  console.log(
    `\nDone. ${headlines.length} headlines from ${SOURCES.length - failed}/${SOURCES.length} sources. Wrote ${path.relative(__dirname, OUTPUT_FILE)}`
  );
})();
