# Architecture (for agents)

Taster is a Next.js App Router app. All culinary logic lives in `lib/engine` so it can be unit-tested without the network.

```
input
  → Flash-Lite classify: dish | ingredient | reject (brands / gibberish)
  → reject: user-facing error (no search)
  → ingredient: IngredientStore hit or resolve (composition → LLM); persist learned; return intrinsic 0–10 vector (no recipe search, no dishes write)
  → dish:
    → optional Flash-Lite match against Turso `dishes` (aliases / native / romanization)
    → if Reuse cache is on and matched: return stored average + last snapshot; timesTasted += 1
    → else Gemini Flash-Lite: origin + search queries (native = authentic, typed language = internationalized)
    → Google Search grounding + HTML search in parallel (stop once 3 titled hits exist)
    → fetch page HTML in parallel → parse JSON if the page text is trusted (JSON-LD or long body); URL Context only after a 2xx fetch when HTML is too thin, using the post-redirect page URL (not the Gemini grounding redirect); skip 4xx/5xx URLs; drop extracts whose native-script title is a different dish even if the search hit matched
    → rewrite each ingredient to a singular grocery name using dish cuisine/language (not dictionary English) and map onto the ingredient catalog
    → each extract tags ingredient role in|out (side/serving = out); resolve all names for flavors
    → representative recipe (≥50% of in-dish appearances, median volume share; out-only never scored)
    → apply cooking volume effects
    → raw = intrinsic × (ingredient_volume / final_volume)   // often < 1
    → toPerceptualTaste(raw) via TASTE_SCALE_TAU (sweet slightly quieter via TASTE_SCALE_TAU_BY_DIM)
    → cap each dimension at the strongest ingredient in the mix
    → round 0–10 + confidence; footnote for out-only accompaniments
    → upsert Turso `dishes` (running mean unless Euclidean outlier > 4; timesTasted always += 1)
```

Do **not** return the raw concentration as the UI score for dishes. `pipeline.ts` already calls `toPerceptualTaste` after `weightedTasteFromIngredients`. Tune loudness with `TASTE_SCALE_TAU` in `lib/engine/taste.ts` (smaller = stronger), not by asking the LLM for scores. Pure ingredient queries skip dilution and return the catalog intrinsic vector (already 0–10).

Hard cases (ambiguous origin, fermented/compound ingredients, LLM-only fallback) retry on `gemini-3.6-flash`. Model IDs live in `lib/engine/models.ts` (`FAST_MODEL` / `SMART_MODEL`).

## Boundaries

| Unit | Path | Depends on | Does not do |
|------|------|------------|-------------|
| Taste math | `taste.ts`, `concentration.ts`, `volume.ts`, `processing.ts`, `composition.ts` | nothing I/O | no LLM, no HTTP |
| Recipe merge | `representative.ts` | name normalize | no scoring |
| Ingredient cache | `store.ts`, `catalog.ts` | Turso (`TURSO_DATABASE_URL`) | no Gemini |
| Dish cache | `dish-cache.ts`, `dish-store.ts`, `dish-catalog.ts` | Turso `dishes`; LLM match only | no score invention |
| Resolver | `resolve.ts` | store + lookup callback | no HTTP of its own |
| Pipeline | `pipeline.ts` | `LlmClient`, `SearchClient`, `PageClient`, `onProgress` | no Gemini SDK types |
| Adapters | `llm.ts`, `search.ts` | Gemini (`@google/genai`), DuckDuckGo/cheerio fallback | no score formulas |
| API | `app/api/profile/route.ts` | pipeline + SSE progress events | no extra business rules |
| UI | `app/page.tsx`, `app/progress-log.tsx` | `/api/profile` stream | no scoring |

`POST /api/profile` body: `{ dish, useCache?, typedLanguage? }`. SSE stream of `{type:"step"}`, `{type:"ingredients"}` (running tally from fetched recipes, or the cached snapshot on a hit), then `{type:"done", result}` or `{type:"error"}`. Result may include `timesTasted` and `fromCache`. `maxDuration` is 600s (Vercel); the route also emits SSE comment keepalives every 15s so HTTP/1.1 proxies do not drop the connection during long silent Gemini ingredient lookups. If the stream closes without `done`/`error` (platform kill or idle drop), `readProgressStream` returns `"incomplete"` and the UI shows a timeout error instead of leaving a frozen running log step. The UI shows a 5-line scrolling log, two On/Off modes (reuse cache, typed-language search), a live ingredient list, and a **Stop** button while a taste is in flight. Stop aborts the fetch and cancels the SSE reader immediately (`lib/ui/progress-stream.ts`); waiting only on `reader.read()` does not stop. The API then cancels the pipeline (`AbortSignal` on `profileDish`, page fetches, and DuckDuckGo search) via stream `cancel`, `request.signal`, or a failed enqueue, and does not persist the dish profile for that run. Newly resolved ingredient vectors are written to Turso as soon as each one is learned (`INSERT OR IGNORE`), so a mid-run timeout still keeps clove/star anise/etc. that finished before the cut-off. Each extract also prints to the **server** console (`[taster] used|other-dish|too-few|empty` plus title, URL, and ingredient list) so empty-recipe failures can be debugged without extra UI.

Inject fakes in tests. Production wires `GeminiLlm` + `searchWithFallback(GeminiSearch, DuckDuckGoSearch)` (always merge both, in parallel), expands native/English recipe queries, fetches HTML first (keeping JSON-LD), then URL Context if the live page returned 2xx but the HTML extract is too thin. HTTP error pages are skipped and not counted. If the first recipes disagree, search continues until the larger sample is filled or time runs out.

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

Shared permanent cache in the same Turso database, table `dishes` (`INSERT OR REPLACE` JSON). Native-language and typed-language runs share one row per dish. LLM `matchDish` maps the user query onto `canonicalName` + `aliases`.

- **Reuse cache on + hit:** skip recipe search; return running-mean taste plus last accepted snapshot; `timesTasted += 1`.
- **Reuse cache off, or miss:** run the pipeline, then write. Nearby samples (Euclidean distance ≤ 4 on the 0–10 vector) update the running mean and snapshot; farther samples increment `outlierCount` only. Every visit including hits and outliers increments `timesTasted`.
- Tests: `lib/engine/dish-cache.test.ts`, `dish-catalog.test.ts`, `pipeline-cache.test.ts`.

```sql
CREATE TABLE IF NOT EXISTS dishes (
  name TEXT PRIMARY KEY,   -- normalizeIngredientName(canonicalName)
  record TEXT NOT NULL     -- JSON CachedDish
);
```

## Changing scores

1. Write/adjust a failing test under `lib/engine/*.test.ts`.
2. Change only the relevant pure function (`toPerceptualTaste` / `TASTE_SCALE_TAU` for loudness; concentration/volume math for physics).
3. Do not “fix” scores by prompting the LLM.
