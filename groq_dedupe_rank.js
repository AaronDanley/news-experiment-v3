// Takes the raw, tagged headlines in data/headlines.json and uses Groq (a free,
// hosted, OpenAI-compatible AI API) to (A) merge duplicate coverage of the same
// story across sources, then (B) rank the resulting unique stories by
// newsworthiness. Writes the result to data/ranked_stories.json.
//
// Zero dependencies — uses Node's built-in fetch (Node 18+).
//
// Setup:  export GROQ_API_KEY="your_key"   (never commit / hard-code the key)
// Run:    node groq_dedupe_rank.js
//
// Pass A runs per-category. Big categories (Politics can be ~1000 headlines)
// are deduped in chunks and then the chunk representatives are merged again
// ("map-reduce"), so every individual Groq call stays small and inside the
// free-tier rate limits.

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "data");
const INPUT_FILE = path.join(DATA_DIR, "headlines.json");
const OUTPUT_FILE = path.join(DATA_DIR, "ranked_stories.json");

const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const API_KEY = process.env.GROQ_API_KEY;

// Small/fast model for the bulk grouping work (high daily token allowance);
// a slightly stronger model for the single final ranking call.
const MODEL_DEDUPE = "llama-3.1-8b-instant";
const MODEL_RANK = "llama-3.3-70b-versatile";

// Headlines per Pass-A Groq call. Kept modest to stay well under the free-tier
// per-minute token limit; the map-reduce merges across chunks afterward.
const CHUNK_SIZE = 40;

// Most-newsworthy stories to hand to the model for Pass B ranking. Anything
// beyond this is appended afterward, ordered by how many outlets carried it.
const RANK_LIMIT = 80;

// Cap on Groq refine sweeps per category. Each sweep re-sorts similar stories
// adjacent and merges within chunks; two sweeps catches most items that fell on
// a chunk boundary the first time, while keeping the token cost bounded.
const MAX_GROQ_PASSES = 2;

// Minimum gap between Groq calls (free tier is a few requests/tokens per
// minute). Sequential + this throttle + backoff keeps us inside the limits.
const THROTTLE_MS = 1200;

// Free-tier tokens-per-minute cap for the dedupe model is 6000; stay under it
// with headroom so no single request/window is rejected (413/429).
const TPM_BUDGET = 5500;

// Optional cap on how many (newest) headlines per category to process. Defaults
// to unlimited; set e.g. MAX_PER_CATEGORY=15 for a fast, cheap test run.
const MAX_PER_CATEGORY = Number(process.env.MAX_PER_CATEGORY) || Infinity;

const CATEGORY_ORDER = [
  "Breaking News",
  "Politics",
  "Business",
  "Technology",
  "Arts & Entertainment",
  "Sports",
  "Science",
  "Health",
  "General",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCallAt = 0;

// Rolling record of token usage over the last 60s, so we can pace requests
// under the free-tier per-minute limit instead of blindly hitting it.
const tokenWindow = []; // { at: ms, tokens: number }

function windowTokens() {
  const cutoff = Date.now() - 60000;
  while (tokenWindow.length && tokenWindow[0].at < cutoff) tokenWindow.shift();
  return tokenWindow.reduce((sum, e) => sum + e.tokens, 0);
}

// Rough pre-send estimate (~4 chars/token) plus output headroom, used only to
// decide whether to wait; the actual usage from the response is recorded after.
function estimateTokens(messages) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4) + 600;
}

/**
 * Single Groq chat call in JSON mode, with throttling and retry/backoff on
 * rate-limit (429) and transient server (5xx) responses. Returns the parsed
 * JSON object from the model's reply. On a non-retryable JSON-generation
 * failure (the small model occasionally can't finish a valid document) it
 * returns {} so one bad chunk degrades to "no merges" instead of aborting the
 * whole run.
 */
async function callGroq(model, messages, { maxRetries = 5 } = {}) {
  const estimated = estimateTokens(messages);
  for (let attempt = 0; ; attempt++) {
    // Stay under the per-minute token cap: if the trailing 60s of usage plus
    // this request would exceed the budget, wait for the window to free up.
    while (tokenWindow.length && windowTokens() + estimated > TPM_BUDGET) {
      await sleep(Math.max(60000 - (Date.now() - tokenWindow[0].at) + 50, 250));
    }
    const wait = THROTTLE_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: 4000,
          response_format: { type: "json_object" },
        }),
      });
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxRetries) {
        throw new Error(`Groq ${res.status} after ${maxRetries} retries`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** attempt;
      await sleep(backoff);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // The model sometimes can't produce a complete valid JSON document for a
      // given chunk (json_validate_failed / hit max output tokens). That's not
      // fatal — degrade this call to an empty result and carry on.
      if (res.status === 400 && /json_validate_failed|completion tokens/i.test(body)) {
        process.stdout.write("    (warn) a chunk failed JSON generation; keeping it unmerged\n");
        return {};
      }
      throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    tokenWindow.push({ at: Date.now(), tokens: data.usage?.total_tokens ?? estimated });
    const content = data.choices?.[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(content);
    } catch {
      // JSON mode should guarantee valid JSON; if a model ever slips, treat it
      // as an empty result rather than crashing the whole run.
      return {};
    }
  }
}

// --- Cheap local pre-clustering (no AI) -------------------------------------
// The Groq map-reduce alone can't dedupe at free-tier scale: the same story
// carried by a dozen outlets is scattered across dozens of random chunks, so a
// single call rarely sees two versions together (the first full run merged only
// 1018 -> 1003). First collapse near-identical headlines locally by
// significant-word overlap, then let Groq refine the much smaller
// representative set with similar items sorted adjacent.

const STOPWORDS = new Set(
  ("a an the of to in on for and or but with without from by at as is are was " +
   "were be been being it its this that these those he she they them his her " +
   "their you your we our us not no new says say said after over into out up " +
   "down about more most amid how why what when who will would could than then " +
   "off per via vs has have had will").split(" ")
);

function signature(headline) {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// Two headlines are treated as the same story when their significant-word sets
// overlap at least this much. Conservative on purpose — Groq catches the looser
// paraphrases the local pass leaves behind.
const LOCAL_THRESHOLD = 0.6;

// Don't locally merge on thin/generic headlines: sources without real titles
// fall back to a URL slug that can collapse to a generic string (e.g. "Abc
// News"), which would otherwise merge many unrelated articles into one. Require
// at least this many significant words on both sides before merging.
const MIN_SIG_FOR_MERGE = 3;

// Looser bar used to VERIFY the small model's proposed merges (it legitimately
// catches paraphrases the 0.6 local pass misses, but also over-groups loosely
// related headlines). A group only stays merged if members share at least this
// much significant-word overlap — enough to veto absurd merges without
// discarding real paraphrases.
const AI_VERIFY_THRESHOLD = 0.2;

// Split a model-proposed group so each kept sub-group actually shares
// significant words. Greedy: place each headline with the first sub-group whose
// anchor it overlaps enough, else start a new one. Unrelated items the model
// lumped together (e.g. distinct stock reports sharing only "stock") split back
// out into their own stories.
function verifyGroup(members, stories) {
  if (members.length <= 1) return [members];
  const subs = []; // { anchor: Set<string>, members: number[] }
  for (const idx of members) {
    const sig = signature(stories[idx].headline);
    let placed = false;
    for (const sub of subs) {
      if (jaccard(sig, sub.anchor) >= AI_VERIFY_THRESHOLD) {
        sub.members.push(idx);
        placed = true;
        break;
      }
    }
    if (!placed) subs.push({ anchor: sig, members: [idx] });
  }
  return subs.map((s) => s.members);
}

// Union-find over headlines, comparing only pairs that share a significant word
// (via an inverted index) so it stays fast for ~1000 items.
function localCluster(headlines) {
  const sigs = headlines.map((h) => signature(h.headline));
  const parent = headlines.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const wordIndex = new Map();
  for (let i = 0; i < sigs.length; i++) {
    const compared = new Set();
    if (sigs[i].size >= MIN_SIG_FOR_MERGE) {
      for (const w of sigs[i]) {
        const bucket = wordIndex.get(w);
        if (!bucket) continue;
        for (const j of bucket) {
          if (compared.has(j)) continue;
          compared.add(j);
          if (
            sigs[j].size >= MIN_SIG_FOR_MERGE &&
            jaccard(sigs[i], sigs[j]) >= LOCAL_THRESHOLD
          ) {
            union(i, j);
          }
        }
      }
    }
    for (const w of sigs[i]) {
      if (!wordIndex.has(w)) wordIndex.set(w, []);
      wordIndex.get(w).push(i);
    }
  }

  const clusters = new Map();
  for (let i = 0; i < headlines.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  }

  const stories = [];
  for (const members of clusters.values()) {
    // Representative = longest headline (usually the most complete/specific).
    let rep = members[0];
    for (const i of members) {
      if (headlines[i].headline.length > headlines[rep].headline.length) rep = i;
    }
    const sources = new Set();
    for (const i of members) sources.add(headlines[i].source);
    stories.push({
      headline: headlines[rep].headline,
      link: headlines[rep].link,
      region: headlines[rep].region,
      primarySource: headlines[rep].source,
      sources: [...sources],
    });
  }
  return stories;
}

/**
 * One Groq grouping call over a chunk of stories. Each input story is
 * { headline, link, region, sources: [...] }. Returns a new, shorter list of
 * merged stories, unioning the source lists of grouped members and keeping the
 * longest (most complete) headline as the representative.
 *
 * Uses a flat "label per item" output ({"labels":[g0,g1,...]}) rather than
 * nested member-index arrays: the small dedupe model reliably returns a plain
 * array of integers, but mangles nested arrays (it emitted "013" as a string
 * instead of [0,1,3], which silently defeated all merging in the first run).
 */
async function groupChunk(stories) {
  if (stories.length <= 1) return stories;

  const items = stories.map((s, i) => ({ i, t: s.headline }));

  const result = await callGroq(MODEL_DEDUPE, [
    {
      role: "system",
      content:
        "You are a news wire editor grouping headlines that report the SAME " +
        "underlying real-world event, even when worded differently or from " +
        "different outlets. Headlines about different events must get different " +
        "groups.",
    },
    {
      role: "user",
      content:
        "Assign each headline a group number so headlines about the same story " +
        "share the same number and different stories get different numbers.\n" +
        'Return JSON of the exact form {"labels":[...]} with exactly ' +
        items.length +
        " integers, one per headline in the given order.\n\nHeadlines:\n" +
        JSON.stringify(items),
    },
  ]);

  const labels = Array.isArray(result.labels) ? result.labels : [];
  const groups = new Map();
  let solo = 1_000_000; // unique bucket for any item the model failed to label
  for (let i = 0; i < stories.length; i++) {
    let label = Number.parseInt(labels[i], 10);
    if (!Number.isFinite(label)) label = solo++;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(i);
  }

  // The small model tends to over-group loosely related headlines, so verify
  // each proposed group locally and split any members that don't actually
  // belong together before merging.
  const merged = [];
  for (const members of groups.values()) {
    for (const sub of verifyGroup(members, stories)) {
      let repIdx = sub[0];
      for (const i of sub) {
        if (stories[i].headline.length > stories[repIdx].headline.length) repIdx = i;
      }
      const sources = new Set();
      for (const i of sub) stories[i].sources.forEach((src) => sources.add(src));
      merged.push({
        headline: stories[repIdx].headline,
        link: stories[repIdx].link,
        region: stories[repIdx].region,
        primarySource: stories[repIdx].primarySource,
        sources: [...sources],
      });
    }
  }

  return merged;
}

/**
 * Dedupe one category end-to-end: a cheap local pre-cluster first (does the
 * bulk of the work and co-locates near-duplicates), then Groq refines the
 * smaller representative set in bounded chunks so paraphrases across outlets
 * still merge — without any single call exceeding the token limit.
 */
async function dedupeCategory(name, headlines) {
  let stories = localCluster(headlines);
  process.stdout.write(
    `    ${name}: local ${headlines.length} -> ${stories.length}\n`
  );

  // Sort similar representatives adjacent so each Groq chunk actually contains
  // the paraphrases worth merging.
  const sortBySig = (list) =>
    list
      .map((s) => ({ s, k: [...signature(s.headline)].sort().join(" ") }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map((x) => x.s);

  for (let pass = 1; pass <= MAX_GROQ_PASSES && stories.length > CHUNK_SIZE; pass++) {
    stories = sortBySig(stories);
    const next = [];
    for (let i = 0; i < stories.length; i += CHUNK_SIZE) {
      next.push(...(await groupChunk(stories.slice(i, i + CHUNK_SIZE))));
    }
    process.stdout.write(
      `    ${name}: groq pass ${pass} ${stories.length} -> ${next.length}\n`
    );
    if (next.length >= stories.length) {
      stories = next; // no further merging possible; stop
      break;
    }
    stories = next;
  }

  // Only merge in a single final call when the whole set fits the token limit;
  // never send the entire (possibly large) category at once.
  if (stories.length > 1 && stories.length <= CHUNK_SIZE) {
    stories = await groupChunk(stories);
  }

  return stories.map((s) => ({
    headline: s.headline,
    link: s.link,
    region: s.region,
    primarySource: s.primarySource,
    sources: s.sources,
    category: name,
    totalSources: s.sources.length,
  }));
}

/** Pass B: one call to rank the most-covered stories by newsworthiness. */
async function rankStories(stories) {
  const sorted = [...stories].sort((a, b) => b.totalSources - a.totalSources);
  const head = sorted.slice(0, RANK_LIMIT);
  const tail = sorted.slice(RANK_LIMIT);

  if (head.length > 1) {
    const items = head.map((s, i) => ({
      i,
      t: s.headline,
      c: s.category,
      n: s.totalSources,
    }));

    const result = await callGroq(MODEL_RANK, [
      {
        role: "system",
        content:
          "You are a front-page news editor ranking today's stories by " +
          "newsworthiness for a general audience.",
      },
      {
        role: "user",
        content:
          "Rank these stories from most to least newsworthy. Weight heavily by " +
          '"n" (how many outlets covered it — more outlets means a bigger ' +
          "story dominating the news cycle); use topic prominence and breadth " +
          "of impact to break ties.\n" +
          'Return JSON of the exact form: {"order":[<index>,...]}, listing ' +
          "every index from 0 to " + (items.length - 1) +
          " exactly once, best first.\n\nStories:\n" +
          JSON.stringify(items),
      },
    ]);

    const order = Array.isArray(result.order) ? result.order : [];
    const ranked = [];
    const used = new Set();
    for (const i of order) {
      if (Number.isInteger(i) && i >= 0 && i < head.length && !used.has(i)) {
        used.add(i);
        ranked.push(head[i]);
      }
    }
    for (let i = 0; i < head.length; i++) if (!used.has(i)) ranked.push(head[i]);
    return [...ranked, ...tail];
  }

  return sorted;
}

(async () => {
  if (!API_KEY) {
    console.error(
      "GROQ_API_KEY is not set. Run:  export GROQ_API_KEY=\"your_key\"  then retry."
    );
    process.exit(1);
  }
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`No ${path.relative(__dirname, INPUT_FILE)} — run fetch_headlines.js first.`);
    process.exit(1);
  }

  const headlines = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
  if (!headlines.length) {
    console.error("headlines.json is empty — run fetch_headlines.js first.");
    process.exit(1);
  }

  const byCategory = {};
  for (const h of headlines) (byCategory[h.category] ||= []).push(h);
  if (Number.isFinite(MAX_PER_CATEGORY)) {
    for (const c of Object.keys(byCategory)) {
      byCategory[c] = byCategory[c].slice(0, MAX_PER_CATEGORY);
    }
  }

  console.log(
    `Deduping ${headlines.length} headlines across ${CATEGORY_ORDER.filter((c) => byCategory[c]).length} categories with Groq...\n`
  );

  let allStories = [];
  for (const category of CATEGORY_ORDER) {
    const group = byCategory[category];
    if (!group?.length) continue;
    console.log(`  ${category} (${group.length} headlines)`);
    const stories = await dedupeCategory(category, group);
    console.log(`    -> ${stories.length} unique stories`);
    allStories = allStories.concat(stories);
  }

  console.log(`\nRanking ${allStories.length} unique stories...`);
  const ranked = await rankStories(allStories);

  const output = {
    rankedAt: new Date().toISOString(),
    sourceFetchedAt: headlines[0]?.fetchedAt ?? null,
    totalHeadlines: headlines.length,
    totalStories: ranked.length,
    stories: ranked.map((s, i) => ({
      rank: i + 1,
      headline: s.headline,
      link: s.link,
      category: s.category,
      region: s.region,
      totalSources: s.totalSources,
      primarySource: s.primarySource,
      sources: s.sources,
    })),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(
    `\nDone. ${headlines.length} headlines -> ${ranked.length} ranked stories. ` +
    `Wrote ${path.relative(__dirname, OUTPUT_FILE)}`
  );
})();
