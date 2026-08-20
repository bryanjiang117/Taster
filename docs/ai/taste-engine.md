# Taste engine (for agents)

## Output shape

Scores are 0–10 on: sweet, sour, salty, spicy, umami, bitter.

## Dish mix (implemented)

Mix is recipe-relative loudness (not applied to **spicy**), then either **linear volume×score** (trace seasonings) or **p-norm punch-through** (loud notes covering ≥2.5% of the dish; spicy always punches). Peer scores (≥85% of peak or avg) pass through unchanged; weaker notes quiet as `score × √(score/peak)`. A trace of sugar stays quiet; a spoon of salt still seasons. Then linear gain (1.75×). Cap at strongest in-ingredient leaf.

**Spicy is chili heat** (capsaicin) and skips relative loudness so doubanjiang/chili mid scores are not crushed by salt or sugar peaks. Ginger, garlic, mustard, and Sichuan peppercorn are 0 spicy. Black pepper as a leaf is ≈ 0.2 (freshly cracked ≈ 0.5 via Gemini `mix.scale`); a spoon of it stays near 0.

`pipeline.ts` does:

1. Resolve each in-ingredient (cache → chemistry leaf → Gemini estimate if labs miss that exact name → nested recipe)
2. `combineRecipeTaste` → intensity/scale, recipe-relative loudness (except spicy), linear or p-norm mix (p=4), linear gain (1.75×)
3. `applySolubleRetention` if cooking liquid was discarded
4. Cap is inside combine: no dimension exceeds the strongest in-ingredient
5. `roundTaste`

Bland dishes stay low when their notes are traces vs the recipe peak. High seasonings punch through volume. Pure ingredient queries skip mix and return the catalog vector.

## Ingredient resolution

`MAX_RESOLUTION_DEPTH = 3` (`lib/engine/types.ts`).

Order for a name used as an ingredient:

1. `IngredientStore` (Turso via `loadProductionStore`, or a test snapshot / injected store). This hit always wins, including when classify said “dish” and when Reuse cache is off.
2. Chemistry leaf if **any** trusted source has a Gemini-confirmed hit and quantified taste chemistry. Search FAO/INFOODS (origin-matched Excel dump first), UmamiDB, Phenol-Explorer, Dr. Duke, FooDB, then USDA. USDA tries Foundation / SR Legacy, then Branded Foods when those are empty — a branded row is valid only when Gemini says the product *is* that grocery item. One Gemini `confirmFoodShortlists` call sees every source’s top titles and returns an index or null per source. Heuristics never accept a row. Juice/paste/oil names fall back to the flavoring food, not the carrier. UmamiDB wins free glutamate/IMP/GMP; Phenol-Explorer wins polyphenol bitters (not spicy); Dr. Duke wins pungents (ppm midpoint); FAO then USDA then FooDB fill remaining classes. MSG is glutamate+sodium, not a nested recipe. `draftTasteFromCompounds` mixes sugars, acids, sodium, free glutamate×nucleotides, bitters, and chili heat (capsaicin + a trace of piperine). Gingerol, allicin, mustard oil, and sanshool are not spicy. Potassium, vitamin C, and hydrolyzed amino-acid totals are not taste. Gemini `calibrateLeafTaste` may change dimensions that have evidence, and may add sour/umami when those lab fields are missing. Never invent salty/bitter/chili heat from nothing. A 10 is the most intense culinary form; lemon/lime fruit ≈ 9 sour, juice ≈ 9.5. Canonicalize uses the dish cuisine: chili in som tam is the hot pepper, not sweet chili sauce. Do not collapse distinct grocery names (thai chili ≠ chili; soft shell crab ≠ crab).
3. If chemistry has no confirmed hit for that exact name, Gemini `estimateLeafTaste` returns a mouthful vector. Persist `source: "llm"` (confidence 0.30). Still not a dish profile.
4. Full recipe search (same collect as a top-level dish). Persist the mix as an ingredient. Skip that name if search fails. Cycle: skip names already on the tasting stack.

Always `store.put` after resolve, and `INSERT OR IGNORE` that vector into Turso immediately. Existing catalog rows are never overwritten.

## Confidence

`sourceConfidence`: measured 0.95 > nutrition 0.80 > recipe 0.55 > llm 0.30 (llm is a Gemini mouthful estimate after chemistry miss, or an old catalog row).

Dish confidence is contribution-weighted provenance, then scaled by recipe agreement: `weighted × (0.25 + 0.75 × (1 − flavorInconsistency))`. Full agreement keeps provenance; full clash keeps a 25% floor so the score still reflects measured ingredients. Fetching 3 vs 7 is only how we sample.

## Multiple recipes

`buildRepresentativeRecipe`:

- Normalize names.
- Keep ingredients in ≥ 50% of recipes.
- Recipe extract tags each ingredient `role: "in" | "out"`. Only `in` counts toward representative occurrence, volume shares, and scoring. Default missing role to `in`.
- Extract may set `mix.intensity` and `mix.scale` from culinary common sense about prep. Code has no prep enum.
- If any recipe marks an ingredient `in`, it can score (subject to the ≥50% rule on `in` appearances). Ingredients that are only ever `out` (sides, garnishes, dips, “for serving”) never enter the taste vector; they still appear in the ingredient list (quieter) and as an “Often served with” list under the scores, one side per row with its primary flavors.

A page matches the dish if its **native name** appears, or if a romanized title is the same phrase with ordinary spelling variation (relative edit distance on the compact name). An English extracted title must not veto a page that already has the native name. A native-script extracted title that names a *different* dish does veto, even if the search hit matched. Do not add per-dish aliases or stopword lists. Off-topic pages from the same cuisine are still dropped.

Aim for 3 on-topic recipes, then up to 7 if they disagree. Search Gemini and DuckDuckGo in parallel and stop once there are enough untried titled hits for the remaining recipe slots. Fetch page HTML first and parse it only when the text is substantial or includes JSON-LD. Store the post-redirect page URL on the recipe. A captcha/human-check redirect still counts as a live 2xx, but do not parse that HTML or store that URL — recover the recipe path from `next=` (or the original search hit) and give that URL to URL Context. URL-context is only used when the live fetch returned 2xx but the HTML was too thin (JS shell). A 4xx/5xx or failed fetch drops that URL. After the first three recipes, keep searching if flavors disagree and more titled pages are needed. Collection stops at `COLLECT_TIME_LIMIT_MS` (30s) and scores whatever recipes were extracted, even if fewer than 3. Only fail if zero usable recipes. Search uses `expandSearchQueries`. Always merge Gemini + DuckDuckGo hits.

- Quantity = median(volume / recipe_volume) × target final volume.
- Count units (`piece`, `whole`, `leg quarter`, …) convert via `quantityToMl(amount, unit, ingredientName)` in `quantity.ts`.

## LLM jobs (only)

Gemini 3.5 Flash-Lite by default: classify input (dish / ingredient / reject), origin, native-language or typed-language search, URL-context recipe parse, ingredient name canonicalize, common-pantry check, cached-dish matching, leaf calibration, grocery-leaf estimate when labs miss.

Gemini 3.6 Flash for hard cases: weak origin, sauces/pastes/fermented compounds, leaf calibration on those names.

Never ask either model for the dish’s final taste vector. System prompt in `GeminiLlm` forbids that. Cached dish numbers come from the Turso running mean, not the matcher. Pure ingredient queries skip dilution and return the ingredient catalog vector (chemistry, Gemini estimate, or nested recipe on miss).
