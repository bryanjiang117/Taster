# Architecture (for agents)

Taster is a Next.js App Router app. All culinary logic lives in `lib/engine` so it can be unit-tested without the network.

```
input
  → Flash-Lite classify: dish | ingredient | reject (brands / gibberish)
  → reject: user-facing error (no search)
  → ingredient Turso hit (only if classified as ingredient; Reuse cache ignored):
        return intrinsic 0–10 vector
  → else try chemistry leaf (FAO/INFOODS + UmamiDB + Phenol-Explorer + Dr. Duke + FooDB + USDA → one Gemini identity check → compound mixer → Gemini calibrate)
        persist INSERT OR IGNORE; return if evidence exists
  → else Gemini estimate a mouthful for that exact grocery name (`source: "llm"`)
  → else dish / nested recipe:
        top-level dish only: optional Flash-Lite match against Turso `dishes`
        if Reuse cache is on and matched: return stored average + last snapshot; timesTasted += 1
        else Gemini Flash-Lite: origin + search queries (native = authentic, typed language = internationalized)
        Google Search grounding + HTML search in parallel (stop once 3 titled hits exist)
        fetch page HTML in parallel → parse JSON if the page text is trusted (JSON-LD or long body); URL Context only after a 2xx fetch when HTML is too thin
        rewrite each ingredient to a singular grocery name using dish cuisine/language
        each extract tags role in|out and prep mix knobs; only `in` scores
        each unique name: ingredient cache → chemistry leaf → Gemini estimate if labs miss that exact name → nested full recipe search (same search stack)
        combineRecipeTaste (loudness except spicy, linear or p=4, gain 1.75×) → cap at strongest in-ingredient
        nested mixes persist as ingredients, not dishes
        top-level dish: upsert Turso `dishes` (running mean unless Euclidean outlier > 4; timesTasted always += 1)
        successful profile: stats.taste_count += 1 (global, all users)
```

Dish mix: recipe-relative loudness for non-spicy (peer scores pass; weak vs peak → `score × √(score/peak)`), then smooth blend of linear volume×score and p-norm punch-through (p=4; weight ramps with loud seasoning share, midpoint ≈2.5%), linear gain (1.75×). Spicy skips relative loudness and always p-norms. Stats use each ingredient's peak taste for the volume-weighted average.

Hard cases (ambiguous origin, fermented/compound ingredients, leaf calibration) retry on `gemini-3.6-flash`. Model IDs live in `lib/engine/models.ts` (`FAST_MODEL` / `SMART_MODEL`).

## Boundaries

| Unit | Path | Depends on | Does not do |
|------|------|------------|-------------|
| Taste math | `taste.ts`, `concentration.ts`, `volume.ts`, `combine.ts`, `chemistry.ts` | nothing I/O | no LLM, no HTTP |
| Recipe merge | `representative.ts` | name normalize | no scoring |
| Ingredient cache | `store.ts`, `catalog.ts` | Turso (`TURSO_DATABASE_URL`) | no Gemini |
| Dish cache | `dish-cache.ts`, `dish-store.ts`, `dish-catalog.ts` | Turso `dishes`; LLM match only | no score invention |
| Taste count | `stats.ts` | Turso `stats` | no scoring |
| Leaf chemistry | `leaf.ts`, `fct.ts`, `umamidb.ts`, `phenol.ts`, `duke.ts`, `usda.ts`, `foodb.ts` | FAO dumps / USDA / FooDB + one Gemini identity shortlist | no dish mix |
| Pipeline | `pipeline.ts` | `LlmClient`, `SearchClient`, `PageClient`, `onProgress` | no Gemini SDK types |
| Adapters | `llm.ts`, `search.ts` | Gemini (`@google/genai`), DuckDuckGo/cheerio fallback | no score formulas |
| API | `app/api/profile/route.ts`, `app/api/stats/route.ts` | pipeline + SSE progress events + global taste count | no extra scoring rules |
| UI | `app/page.tsx`, `app/progress-log.tsx` | `/api/profile` stream | no scoring |

`POST /api/profile` body: `{ dish, useCache?, typedLanguage? }`. SSE stream of `{type:"step"}`, `{type:"ingredients"}` (running tally from fetched recipes, or the cached snapshot on a hit), then `{type:"done", result, totalTastes?}` or `{type:"error"}`. Result may include `timesTasted` and `fromCache`. `totalTastes` is the site-wide counter after this successful run. `GET /api/stats` returns `{ totalTastes }` for the landing-page number. The counter increments only when the API is about to emit `done` (dish, ingredient, or cache hit). Rejects, errors, and Stop do not increment. If the increment fails, the profile still streams; `totalTastes` is omitted. `maxDuration` is 600s (Vercel); the route also emits SSE comment keepalives every 15s so HTTP/1.1 proxies do not drop the connection during long silent Gemini ingredient lookups. If the stream closes without `done`/`error` (platform kill or idle drop), `readProgressStream` returns `"incomplete"` and the UI shows a timeout error instead of leaving a frozen running log step. The UI shows a 5-line scrolling log, two On/Off modes (reuse cache, typed-language search), a live ingredient list, a **Stop** button while a taste is in flight, and a global **Total tastings** count at the top of the page. Stop aborts the fetch and cancels the SSE reader immediately (`lib/ui/progress-stream.ts`); waiting only on `reader.read()` does not stop. The API then cancels the pipeline (`AbortSignal` on `profileDish`, page fetches, and DuckDuckGo search) via stream `cancel`, `request.signal`, or a failed enqueue, and does not persist the dish profile for that run. Newly resolved ingredient vectors are written to Turso as soon as each one is learned (`INSERT OR IGNORE`), so a mid-run timeout still keeps clove/star anise/etc. that finished before the cut-off. Each extract also prints to the **server** console (`[taster] used|other-dish|too-few|empty` plus title, URL, and ingredient list) so empty-recipe failures can be debugged without extra UI.

Inject fakes in tests. Production wires `GeminiLlm` + `searchWithFallback(GeminiSearch, DuckDuckGoSearch)` (always merge both, in parallel), expands native/English recipe queries, fetches HTML first (keeping JSON-LD), then URL Context if the live page returned 2xx but the HTML extract is too thin. HTTP error pages are skipped and not counted. Captcha/human-check redirects keep the original recipe URL for URL Context and ingredient links. If the first recipes disagree, search continues until the larger sample is filled or time runs out. Gemini JSON is parsed in `llm-parse.ts`; if a long `reasoning` string is cut off at the output cap, the parser closes the string and braces so the taste vector still loads. Chemistry leaf searches bundled FAO/INFOODS (WAFCT, BioFoodComp, uPulses, uFiSh, AnFooD), Japan Standard Tables 2023, CIQUAL 2025, UmamiDB, Phenol-Explorer, and Dr. Duke dumps plus USDA (Foundation/SR, then Branded if those are empty) and FooDB. Gemini `confirmFoodShortlists` picks or rejects each source’s top titles in one call. USDA is a no-op in tests unless injected; production uses `USDA_API_KEY` when set. FooDB uses `lib/engine/testdata/foodb-taste.json`. Rebuild the other dumps with `scripts/extract-fct-taste.py`, `extract-phenol-taste.py`, `extract-duke-taste.py`, and `extract-umami-taste.py` (raw Excel stays in `/tmp`, not git). Cite Phenol-Explorer for the polyphenol extract; commercial redistribution of their full database needs their permission. Kenya 2018 Excel and Frida were not bundled (no reachable spreadsheet).

## Ingredient catalog

The live catalog is **Turso only** (database `taster`, table `ingredients`). `POST /api/profile` calls `loadProductionStore` then `persistProductionLearned`. There is no JSON overlay in production.

```
loadProductionStore
  → SELECT record FROM ingredients
  → IngredientStore (Map by normalizeIngredientName)

persistProductionLearned
  → INSERT OR IGNORE INTO ingredients (name, record)
    (called as each unknown ingredient resolves, not only at end-of-run)
```

`TURSO_DATABASE_URL` is required for the app. Existing rows are never overwritten. Tests inject an `IngredientStore` (often `loadSeedStore()` from `lib/engine/testdata/ingredients.json`) so Vitest does not need Turso.

Schema (created on first use):

```sql
CREATE TABLE IF NOT EXISTS ingredients (
  name TEXT PRIMARY KEY,   -- normalizeIngredientName
  record TEXT NOT NULL     -- JSON ResolvedIngredient
);
```

Env: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (see `.env.example`). Restart Next after changing `.env`. Tests: `lib/engine/catalog.test.ts` (in-memory `file:` libSQL). Ingredient catalog only skips Gemini for ingredient *taste vectors*. Dish search is skipped only on a reuse-cache hit.

To correct a vector, update the Turso row (or `INSERT` a new normalized name). Do not add a git JSON seed.

## Dish catalog

Shared permanent cache in the same Turso database, table `dishes` (`INSERT OR REPLACE` JSON). Native-language and typed-language runs share one row per dish. LLM `matchDish` maps the user query onto `canonicalName` + `aliases`. Nested recipe tastes for ingredients never read or write this table.

- **Reuse cache on + hit:** skip recipe search; return running-mean taste plus last accepted snapshot; `timesTasted += 1`.
- **Reuse cache off, or miss:** run the pipeline, then write. Nearby samples (Euclidean distance ≤ 4 on the 0–10 vector) update the running mean and snapshot; farther samples increment `outlierCount` only. Every visit including hits and outliers increments `timesTasted`.
- Tests: `lib/engine/dish-cache.test.ts`, `dish-catalog.test.ts`, `pipeline-cache.test.ts`.

```sql
CREATE TABLE IF NOT EXISTS dishes (
  name TEXT PRIMARY KEY,   -- normalizeIngredientName(canonicalName)
  record TEXT NOT NULL     -- JSON CachedDish
);
```

## Global taste count

Site-wide counter in the same Turso database, table `stats`. Every successful top-level profile (dish, ingredient, or reuse-cache hit) increments `taste_count` once, in `POST /api/profile` right before `done`. Rejects, errors, and Stop do not. Starts at 0; not backfilled from per-dish `timesTasted`. Tests: `lib/engine/stats.test.ts` (in-memory `file:` libSQL).

```sql
CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO stats (key, value) VALUES ('taste_count', 0);
```

## Changing scores

1. Write/adjust a failing test under `lib/engine/*.test.ts`.
2. Change only the relevant pure function (`chemistry.ts` for leaves; `combine.ts` for mix; volume math for physics).
3. Do not “fix” scores by prompting the LLM for a dish vector.
