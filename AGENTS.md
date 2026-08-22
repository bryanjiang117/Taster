# Taster

Agents: read this file first, then `docs/ai/architecture.md` and `docs/ai/taste-engine.md`.

## What this is

Given a dish or singular ingredient, Taster builds a taste profile. Dishes search native-language recipes, resolve each ingredient (chemistry leaf, Gemini estimate if labs miss, or nested recipe), and return a **deterministic** 0–10 profile (sweet, sour, salty, spicy, umami, bitter) plus confidence. Brands and gibberish are rejected up front.

The LLM must not invent the dish’s final numeric scores, except the narrow post-mix path for dimensions flagged from ambiguous primary-seasoner amounts (“to taste”). Gemini is the research/parser layer (Search grounding + HTML parse, URL context if needed + JSON, leaf calibration, ambiguous-seasoning adjustment). Scoring is done in `lib/engine/`. When no chemistry source matches a grocery name, Gemini may estimate that ingredient’s mouthful vector (`source: "llm"`).

## Run

```bash
cp .env.example .env   # GEMINI_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, USDA_API_KEY
npm install
npm test
npm run dev            # http://localhost:3000
```

Restart the dev server after changing `.env`. Never commit `.env`. The live catalog is Turso database `taster` (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` required). `turso db show taster --url` and `turso db tokens create taster`. Same URL and token locally and in production.

## Invariants

- Dish scores mix in `combineRecipeTaste`: recipe-relative loudness (blend from quieted `score × (score/peak)^⅓` up to full score as ratio→1; no 85% cliff), then **per-ingredient** blend of linear `share×loud` and punch `loud×share^(1/p)` (p=5). Punch weight = share smoothstep (midpoint ≈1.5%, loudness ~4→7) × intensity smoothstep (~5.25→10). Crowding on a dimension does not change an ingredient’s punch term; mid notes (ketchup ≈7) stay partial, peak forms (salt/sugar/chili ≈10) still season a bowl. Sum → linear gain (1.75×). Cap at strongest in-ingredient leaf. Bland food stays low. Pure ingredients return the catalog 0–10 vector (no dilution). Spicy is chili heat only: ginger/garlic/mustard/Sichuan peppercorn = 0, black pepper ≈ 0.2, freshly cracked ≈ 0.5 via `mix.scale`, Thai chili = 10. A 10 is the most intense culinary form (salt, sugar, Thai chili); lemon/lime fruit ≈ 9 sour, juice ≈ 9.5.
- After mix, if any **primary seasoner** (salt→salty, sugar/honey→sweet, lemon/lime/vinegar→sour, chili→spicy, MSG→umami) had a clearly ambiguous amount (missing / “to taste” / “as needed” / “season with” — not pinch/dash), Gemini `adjustAmbiguousSeasoning` may raise that dimension’s dish total (never below the engine score). The flagged seasoner(s) absorb the uplift in contribution tips; multiple flags on one dim get per-ingredient points from Gemini. Non-flagged dims stay engine-only. LLM failure keeps the engine vector.
- Classify input first (dish / ingredient / reject). Reject brands and random text. If the name is both a grocery and a cooked dish (spaghetti), classify as dish and run the dish pipeline even if that name is already in the ingredient catalog. **Ingredient Turso wins** only when classify says ingredient (and when resolving names inside a recipe). Reuse cache only gates the **dish** average for what the user typed.
- Unknown names: try chemistry (FAO/INFOODS first, then UmamiDB / Phenol-Explorer / Dr. Duke / FooDB / USDA). One Gemini shortlist check must confirm the food against the dish (chili in 辣子鸡 is hot chili, not sweet chili sauce). Deterministic compound mixer, then Gemini may calibrate dimensions that have evidence (and chili heat on chili-named foods when labs hit sweet pepper). Acid-process foods (fermented/pickled/yogurt/vinegar-class names) need organic-acid evidence — sodium-only lab rows are incomplete and fall through. If no source matched that **exact** grocery name (or the leaf is incomplete), Gemini `estimateLeafTaste` scores a mouthful (`source: "llm"`, low confidence). Do not collapse names (thai chili ≠ chili; soft shell crab ≠ crab). If estimate is missing or fails, run the same full recipe search and persist the mix as an **ingredient**. Nested recipe-ingredients get that same search. Existing catalog rows are never overwritten (`INSERT OR IGNORE`).
- Translate ingredient names to English (or a well-known romanized native name when English is awkward) before scoring or showing them in the UI. Gemini `canonicalizeIngredientNames` takes the extracted names, the ingredient catalog, and the dish's culinary origin. Ambiguous generics must become the cuisine-typical grocery even when the catalog only has the dictionary form (Chinese dish + 香肠 / sausage → chinese sausage or lap cheong, not plain sausage). Already-specific names stay themselves (italian sausage stays italian sausage). Never collapse process forms into a catalog parent (kimchi ≠ cabbage; pickle ≠ cucumber). A grocery named in the dish title must stay itself. Recipe extract also returns prep mix knobs (`mix.intensity` / `mix.scale` / optional `mix.why`) using culinary common sense — no prep enum in code. `mix.intensity` is how much of the listed amount contributes to the final served dish. When intensity ≠ 1, `mix.why` is a 1–2 word label (marinade, evaporated, absorbed) shown on the ingredient hover as `contributes: N% · why`. Drained frying oil, pasta water, blanching water, and evaporated/absorbed cooking water are intensity 0 and do not dilute the dish. Code also zeroes bulk neutral fry oil and evaporated/absorbed water (with a small floor for stock/broth/wine) when extract omits intensity.
- Prefer several recipes; start with 3 and fetch up to 7 when those 3 disagree on flavor. Recipe collection stops at 45s (`COLLECT_TIME_LIMIT_MS`) and scores whatever was found (even 1–2). Confidence falls when recipes disagree.
- Recipe extract tags each ingredient `in` (cooked into the dish) or `out` (side/serving). Only `in` affects scores. Out-only items stay in the ingredient list quieter and appear as an “Often served with” list under the scores, with primary flavors.
- Search in the dish’s origin language for the form `identifyDish` resolved (popular when the query is bare; exact when a style/region is named). **Typed language** mode searches in whatever language the user typed (internationalized). Both write to the same dish cache row.
- Shared dish cache in Turso `dishes`: LLM match → reuse stored average when that setting is on; otherwise run the pipeline and fold into the running mean unless the 6-D Euclidean distance is > 4. Cache hits still increment `timesTasted`. Nested recipe tastes do not read or write `dishes`.
- Global taste count in Turso `stats` (`taste_count`): +1 on every successful profile the user gets back (dish, ingredient, cache hit). Rejects, errors, and Stop do not count. Shown at the top as **Total tastings**; ticks up when `done` arrives.
- When changing scoring math, update tests in `lib/engine/*.test.ts` first.
- Keep the UI to: dish name in, profile out, plus the two mode toggles and Stop while tasting. Do not add extra screens unless asked.

## Layout

- `lib/engine/` — taste engine (pure + injectable I/O)
- `lib/engine/chemistry.ts` — compound mixer
- `lib/engine/fct.ts` / `umamidb.ts` / `phenol.ts` / `duke.ts` / `usda.ts` / `foodb.ts` — FAO/INFOODS dumps, UmamiDB, Phenol-Explorer, Dr. Duke, USDA FoodData Central, FooDB
- `lib/engine/leaf.ts` — chemistry leaf scoring
- `lib/engine/combine.ts` — recipe mix (loudness, per-ingredient punch, prep, cap)
- `lib/engine/ambiguous-seasoning.ts` — flag primary seasoners with ambiguous amounts; post-mix Gemini dim adjustment
- `lib/engine/catalog.ts` — Turso ingredient load/persist
- `lib/engine/dish-catalog.ts` — Turso dish cache
- `lib/engine/stats.ts` — Turso global taste count
- `lib/engine/testdata/ingredients.json` — offline snapshot for unit tests only
- `lib/engine/testdata/foodb-taste.json` — FooDB 2020 public dump, taste compounds only
- `lib/engine/testdata/fct-taste.json` / `umami-taste.json` / `phenol-taste.json` / `duke-taste.json` — derived taste extracts (FAO/INFOODS + Japan + CIQUAL; UIC umami snapshot; Phenol-Explorer polyphenols; Dr. Duke ppm). Rebuild with `scripts/extract-*-taste.py`; do not commit raw Excel.
- `app/` — Next.js UI, 5-line SSE progress log, ingredient + score hover tips, `POST /api/profile`, `GET /api/stats`
- `docs/ai/` — longer design notes for agents (catalog details in `architecture.md`)
