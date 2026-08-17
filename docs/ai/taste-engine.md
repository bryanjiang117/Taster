# Taste engine (for agents)

## Output shape

Scores are 0–10 on: sweet, sour, salty, spicy, umami, bitter.

## Perceptual scale (implemented)

Raw concentration is **not** what the UI shows. A spoon of fish sauce in a bowl is `9 × (15 / 500) ≈ 0.3`, which used to display as &lt;1/10.

`pipeline.ts` now does:

1. `weightedTasteFromIngredients` → raw effective concentration
2. `applySolubleRetention`
3. `toPerceptualTaste` in `lib/engine/taste.ts`
4. `capTaste` so no dimension exceeds the strongest ingredient in the mix (perceptual loudness cannot invent more bitter than lime)
5. `roundTaste`

```ts
effective_flavor = intrinsic_taste_strength × (ingredient_volume / final_dish_volume)
score = 10 * (1 - exp(-raw / tau))  // tau = TASTE_SCALE_TAU (0.8); sweet uses 1.05 via TASTE_SCALE_TAU_BY_DIM
score = min(score, max ingredient on that dimension)
```

- **Lower `TASTE_SCALE_TAU`** (e.g. `0.25`) → louder dishes
- **Raise it** (e.g. `0.5`) → milder dishes
- Sweet alone can be tuned via `TASTE_SCALE_TAU_BY_DIM.sweet` (higher = quieter) without moving salt/umami/heat
- Do not skip this step or substitute an LLM score
- Tests: `lib/engine/taste.test.ts` (`toPerceptualScore`)

Dilution and reduction still change `raw` first, so more water still scores lower. Discarded cooking liquid multiplies soluble tastes by `solubleRetention` before the perceptual map.

## Ingredient resolution

`MAX_RESOLUTION_DEPTH = 3` (`lib/engine/types.ts`).

Order:

1. `IngredientStore` (Turso via `loadProductionStore`, or a test snapshot / injected store), names via `normalizeIngredientName` then Gemini `canonicalizeIngredientNames(names, catalog, culinaryContext)`. Extract one singular food per line. The model gets the dish, cuisine, country, and language so it can use culinary context rather than dictionary English (Latin American `limón` in ceviche is lime, not lemon). It rewrites names to short grocery English and maps onto an existing catalog string when it is the same food. Comma-separated `to` values split a combined line. New foods keep the rewritten name and go through composition → decompose → LLM taste as before.
2. Composition mapping in `tasteFromComposition` (sodium→salty, sugar→sweet, pH below 5.5→sour, glutamate→umami, scoville log→spicy). Typical food pH 5–6.5 is not sour.
3. Decomposition: recurse parts, combine by volume, apply `applyProcessingToTaste`.
4. LLM taste estimate (`source: "llm"`, low confidence). The lookup prompt anchors 10 to everyday references (lemon/lime = 10 sour, salt = 10 salty) so the model does not hedge citrus down to 8–9.

Always `store.put` after resolve, and `INSERT OR IGNORE` that vector into Turso immediately (not only at end-of-run). Existing catalog rows are never overwritten. A timed-out taste still keeps ingredients that finished resolving.

## Confidence

`sourceConfidence`: measured 0.95 > nutrition 0.80 > recipe 0.55 > llm 0.30.

Dish confidence is contribution-weighted provenance, then scaled by recipe agreement: `weighted × (0.25 + 0.75 × (1 − flavorInconsistency))`. Full agreement keeps provenance; full clash keeps a 25% floor so the score still reflects measured ingredients. Fetching 3 vs 7 is only how we sample.

## Multiple recipes

`buildRepresentativeRecipe`:

- Normalize names.
- Keep ingredients in ≥ 50% of recipes.
- Recipe extract tags each ingredient `role: "in" | "out"`. Only `in` (cooked/mixed into the dish) counts toward representative occurrence, volume shares, and scoring. Default missing role to `in`.
- If any recipe marks an ingredient `in`, it can score (subject to the ≥50% rule on `in` appearances). Ingredients that are only ever `out` (sides, garnishes, dips, “for serving”) never enter the taste vector; they still appear in the ingredient list (quieter) and in a short footnote with primary flavors (`Often served with lemon · sour`).

A page matches the dish if its **native name** appears, or if a romanized title is the same phrase with ordinary spelling variation (relative edit distance on the compact name). An English extracted title must not veto a page that already has the native name. Do not add per-dish aliases or stopword lists. Off-topic pages from the same cuisine are still dropped.

Aim for 3 on-topic recipes, then up to 7 if they disagree. Search Gemini and DuckDuckGo in parallel and stop once there are enough untried titled hits for the remaining recipe slots (do not keep querying just to fill a pool of 8). Fetch page HTML first and parse it only when the text is substantial or includes JSON-LD (so a JavaScript shell cannot be treated as a recipe). Store the post-redirect page URL on the recipe (Gemini search often returns `vertexaisearch.cloud.google.com/grounding-api-redirect/...` links that do not open in a browser). URL-context is only used when the live fetch returned 2xx but the HTML was too thin (JS shell). A 4xx/5xx or failed fetch drops that URL — do not count Google's cached extract as an analyzed recipe. After the first three recipes, keep searching if flavors disagree and more titled pages are needed. URL reads for a wave run in parallel (batch size = remaining recipes needed). Collection stops at `COLLECT_TIME_LIMIT_MS` (30s) and scores whatever recipes were extracted, even if fewer than 3. In-flight reads started before the limit still finish; no new wave starts after it. Only fail if zero usable recipes. Search uses `expandSearchQueries`. Always merge Gemini + DuckDuckGo hits. If titles omit the dish name, still try those URLs until we have enough recipes or time runs out.
- Quantity = median(volume / recipe_volume) × target final volume.
- Count units (`piece`, `whole`, `leg quarter`, …) convert via `quantityToMl(amount, unit, ingredientName)` in `quantity.ts`. Meats and produce get typical edible volumes (chicken piece ≈ 250 ml, whole bird ≈ 1600 ml); a flat 15 ml/piece made marinades look like pure sugar. Measured units (tsp/tbsp/cup/g/lb) are unchanged.

## Processing multipliers

Fermentation ↑ umami; roasting ↑ bitter/umami; pickling ↑ sour; boiling ↓ bitter (leach); reduction slightly intensifies. Volume change is the main concentration mechanism—do not double-count by also asking the LLM for a final score.

## LLM jobs (only)

Gemini 3.5 Flash-Lite by default: classify input (dish / ingredient / reject), origin, native-language or typed-language search, URL-context recipe parse, ingredient name canonicalize against the catalog, cached-dish matching.

Gemini 3.6 Flash for hard cases: weak origin, sauces/pastes/fermented compounds, or when Flash-Lite returns an LLM-only taste guess.

Never ask either model for the dish’s final taste vector. System prompt in `GeminiLlm` forbids that. Cached dish numbers come from the Turso running mean, not the matcher. Pure ingredient queries skip recipe search and return the ingredient catalog vector (resolve via composition → LLM on miss).
