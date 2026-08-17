# Taster

Agents: read this file first, then `docs/ai/architecture.md` and `docs/ai/taste-engine.md`.

## What this is

Given a dish or singular ingredient, Taster builds a taste profile. Dishes search native-language recipes, build a representative recipe, resolve ingredients to taste vectors, and return a **deterministic** 0–10 profile (sweet, sour, salty, spicy, umami, bitter) plus confidence. Ingredients skip recipe search and use the ingredient catalog (resolve on miss). Brands and gibberish are rejected up front.

The LLM must not invent the final numeric scores. Gemini is the research/parser layer (Search grounding + HTML parse, URL context if needed + JSON). Scoring is done in `lib/engine/`.

## Run

```bash
cp .env.example .env   # GEMINI_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
npm install
npm test
npm run dev            # http://localhost:3000
```

Restart the dev server after changing `.env`. Never commit `.env`. The live catalog is Turso database `taster` (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` required). `turso db show taster --url` and `turso db tokens create taster`. Same URL and token locally and in production.

## Invariants

- Final UI scores for dishes are **perceptual**, not raw concentration. Pipeline: `weightedTasteFromIngredients` → `toPerceptualTaste` (`TASTE_SCALE_TAU` in `lib/engine/taste.ts`) → `capTaste` at the strongest ingredient on each dimension. Smaller tau = louder. A dish cannot score more bitter/sour/etc. than its most bitter/sour ingredient. Pure ingredients return the catalog intrinsic 0–10 vector (no dilution).
- Classify input first (dish / ingredient / reject). Reject brands and random text. Ingredients never touch the dish cache; they always use `IngredientStore` (resolve → persist on miss) with progress logs.
- Unknown ingredients: cache → composition → decomposition (max depth 3) → LLM estimate. New vectors go to Turso (`INSERT OR IGNORE` on normalized name). Existing catalog rows are never overwritten. Each request reloads Turso into `IngredientStore`. Lemon and lime are the sour ceiling (10). LLM ingredient guesses use those everyday anchors instead of hedging.
- Translate ingredient names to English before scoring or showing them in the UI. Gemini `canonicalizeIngredientNames` takes the extracted names, the ingredient catalog, and the dish's culinary origin (cuisine, country, language). It returns singular grocery names, reusing a catalog row when it is the same food, and must prefer the cuisine's food over a dictionary false friend (e.g. ceviche `limón` → lime).
- Prefer several recipes; start with 3 and fetch up to 7 when those 3 disagree on flavor. Recipe collection stops at 30s (`COLLECT_TIME_LIMIT_MS`) and scores whatever was found (even 1–2). Confidence falls when recipes disagree.
- Recipe extract tags each ingredient `in` (cooked into the dish) or `out` (side/serving). Only `in` affects scores. Out-only items stay in the ingredient list quieter and appear in a short footnote with primary flavors.
- Search in the dish’s origin language (authentic). **Typed language** mode searches in whatever language the user typed (internationalized). Both write to the same dish cache row.
- Shared dish cache in Turso `dishes`: LLM match → reuse stored average when that setting is on; otherwise run the pipeline and fold into the running mean unless the 6-D Euclidean distance is > 4. Cache hits still increment `timesTasted`.
- When changing scoring math, update tests in `lib/engine/*.test.ts` first.
- Keep the UI to: dish name in, profile out, plus the two mode toggles and Stop while tasting. Do not add extra screens unless asked.

## Layout

- `lib/engine/` — taste engine (pure + injectable I/O)
- `lib/engine/catalog.ts` — Turso ingredient load/persist (`loadProductionStore`, `persistProductionLearned`)
- `lib/engine/dish-catalog.ts` — Turso dish cache (`loadProductionDishStore`, `persistProductionDish`)
- `lib/engine/testdata/ingredients.json` — offline snapshot for unit tests only
- `app/` — Next.js UI, 5-line SSE progress log, and `POST /api/profile`
- `docs/ai/` — longer design notes for agents (catalog details in `architecture.md`)
