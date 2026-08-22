# Taste engine (for agents)

## Output shape

Scores are 0–10 on: sweet, sour, salty, spicy, umami, bitter.

## Dish mix (implemented)

Mix is recipe-relative loudness, then a **per-ingredient** blend of **linear `share×loud`** (traces) and **punch `loud×share^(1/p)`** (p=5). Peer blend: quieted end is `score × (score/peak)^⅓`, full score as `max(score/peak, score/avg) → 1` (smoothstep from ~0.42; no hard 85% cliff). Each ingredient’s punch weight uses only its bowl share (loudness smoothstep ~4→7, share midpoint ≈1.5%) times an intensity smoothstep (~5.25→10). Dimension crowding does not change that term — a spoon of ketchup sweet ≈7 lands ~2, not leaf-like; salt/sugar/chili ≈10 still season a bowl. Sum ingredients, then linear gain (1.75×). Cap at strongest in-ingredient leaf.

**Spicy is chili heat** (capsaicin). Ginger, garlic, mustard, and Sichuan peppercorn are 0 spicy. Black pepper as a leaf is ≈ 0.2 (freshly cracked ≈ 0.5 via Gemini `mix.scale`); a spoon of it stays near 0. Spicy mixes like every other dimension (relative loudness + per-ingredient linear/punch blend).

`pipeline.ts` does:

1. Resolve each in-ingredient (cache → chemistry leaf → Gemini estimate if labs miss that exact name → nested recipe)
2. `attributeRecipeTaste` / `combineRecipeTaste` → intensity/scale, recipe-relative loudness, per-ingredient linear/punch blend (p=5, intensity ~5.25→10), linear gain (1.75×), plus per-dimension ingredient contribution points
3. `applySolubleRetention` if cooking liquid was discarded
4. Cap is inside combine: no dimension exceeds the strongest in-ingredient
5. If any representative `in` primary seasoner is `quantityAmbiguous` (missing / to taste / as needed / season with — salt, sugar/honey, lemon/lime/vinegar, chili, MSG), Gemini `adjustAmbiguousSeasoning` may raise those dish dimensions (never below engine). Flagged seasoners take the contribution uplift (Gemini allocates when several share a dim). Other dims untouched.
6. `roundTaste`, and align/round contribution points to that vector (UI lists every positive contributor at 2 decimals with a 0.01 floor so tiny shares still show; tips show 5 then “Show more”)

Bland dishes stay low when their notes are traces vs the recipe peak. High seasonings punch through volume. Pure ingredient queries skip mix and return the catalog vector (contribution tip is that one ingredient at the full score).

Hovering a dish score in the UI opens the same style of tip as ingredients: ingredient name and `+points` toward that 0–10. Attribution is each in-ingredient’s blended points (its own linear/punch mix), scaled so all positives sum to the final capped score.

## Ingredient resolution

`MAX_RESOLUTION_DEPTH = 3` (`lib/engine/types.ts`).

Order for a name used as an ingredient:

1. `IngredientStore` (Turso via `loadProductionStore`, or a test snapshot / injected store). This hit always wins, including when classify said “dish” and when Reuse cache is off.
2. Chemistry leaf if **any** trusted source has a Gemini-confirmed hit and quantified taste chemistry. Search FAO/INFOODS (origin-matched Excel dump first), UmamiDB, Phenol-Explorer, Dr. Duke, FooDB, then USDA. USDA tries Foundation / SR Legacy, then Branded Foods when those are empty — a branded row is valid only when Gemini says the product *is* that grocery item. One Gemini `confirmFoodShortlists` call sees every source’s top titles and returns an index or null per source. Heuristics never accept a row. Juice/paste/oil names fall back to the flavoring food, not the carrier. UmamiDB wins free glutamate/IMP/GMP; Phenol-Explorer wins polyphenol bitters (not spicy); Dr. Duke wins pungents (ppm midpoint); FAO then USDA then FooDB fill remaining classes. MSG is glutamate+sodium, not a nested recipe. `draftTasteFromCompounds` mixes sugars, acids, sodium, free glutamate×nucleotides, bitters, and chili heat (capsaicin + a trace of piperine). Gingerol, allicin, mustard oil, and sanshool are not spicy. Potassium, vitamin C, and hydrolyzed amino-acid totals are not taste. Nutrient sodium is only a salty proxy (not always culinary salt); Gemini may lower salty when a mouthful is not salt-tasting. **Acid-process foods** (kimchi, sauerkraut, pickles, yogurt, vinegar, and other fermented/pickled names) require organic-acid evidence to finish as a leaf — a sodium-only USDA row is incomplete and falls through. Gemini `calibrateLeafTaste` is a sanity check: it must flag implausible lab proxies (elemental sodium ≠ salty taste) and return a mouthful, using the parent dish so chili in 辣子鸡 is hot chili, not American sweet chili. Never invent salty/bitter from nothing. Never invent chili heat for ginger/garlic/mustard/Sichuan peppercorn; chili-named foods may add heat when the lab row was sweet/bell pepper. A 10 is the most intense culinary form; lemon/lime fruit ≈ 9 sour, juice ≈ 9.5; lactic-fermented vegetables ≈ 7–8 sour. Canonicalize uses the dish cuisine: chili in som tam is the hot pepper, not sweet chili sauce; ambiguous generics become the cuisine-typical grocery even when the catalog only has the dictionary form (Chinese dish + sausage / 香肠 → chinese sausage or lap cheong, not plain sausage). Prefer short English when standard; a well-known romanized native name is fine when English is awkward. Already-specific names stay themselves. Do not collapse distinct grocery names (thai chili ≠ chili; soft shell crab ≠ crab; chinese sausage ≠ sausage).
3. If chemistry has no confirmed hit for that exact name (or the hit is incomplete for an acid-process food), Gemini `estimateLeafTaste` returns a mouthful vector. Persist `source: "llm"` (confidence 0.30). Still not a dish profile.
4. Full recipe search (same collect as a top-level dish). Persist the mix as an ingredient. Skip that name if search fails. Cycle: skip names already on the tasting stack.

Always `store.put` after resolve, and `INSERT OR IGNORE` that vector into Turso immediately. Existing catalog rows are never overwritten.

## Confidence

`sourceConfidence`: measured 0.95 > nutrition 0.80 > recipe 0.55 > llm 0.30 (llm is a Gemini mouthful estimate after chemistry miss, or an old catalog row).

Dish confidence is contribution-weighted provenance, then scaled by recipe agreement: `weighted × (0.25 + 0.75 × (1 − flavorInconsistency))`. Full agreement keeps provenance; full clash keeps a 25% floor so the score still reflects measured ingredients. Fetching 3 vs 7 is only how we sample.

## Multiple recipes

`buildRepresentativeRecipe`:

- Normalize names.
- Include every `in` ingredient that appears at least once. Volume share = mean over all recipes, with **0 when a recipe omits it** (so 3-of-3 counts 3×; three 1-of-3 substitutes each count 1× and together match one sauce slot). Prep mix knobs stay median/mode over present recipes only.
- Recipe extract tags each ingredient `role: "in" | "out"`. Only `in` counts toward representative occurrence, volume shares, and scoring. Default missing role to `in`.
- Extract may set `mix.intensity` and `mix.scale` from culinary common sense about prep. Code has no prep enum. `mix.intensity` is the fraction of the listed amount that contributes to the final served dish. Intensity 0 is a bath or liquid that does not stay (drained frying oil, pasta water, blanching water, evaporated/absorbed cooking water); that volume is dropped from tasting shares. Eaten oil (stir-fry, chili oil) stays 1. Soup broth served as liquid stays near 1.
- When intensity ≠ 1 (or role is `out`), extract also sets `mix.why` to one or two short words (`marinade`, `evaporated`, `absorbed`, `drained`, `concentrated`, `on the side`). The ingredient hover shows `contributes: N% · why` only for those non-default cases.
- Code heuristics: bulk neutral fry oil → intensity 0 (`drained`); evaporation/absorption process deltas (or bulk water with rice/grain when processes are missing) zero plain cooking water and leave a small floor for stock/broth/wine so flavor still contributes; process volume deltas are reduced by the liquid already removed via intensity so the bowl is not shrunk twice.
- Ingredients that are only ever `out` (sides, garnishes, dips, “for serving”) never enter the taste vector; they still appear in the ingredient list (quieter) and as an “Often served with” list under the scores, one side per row with its primary flavors.

A page matches when it is a recipe for the dish. **Accept** only on page-grounded evidence: the live URL path and/or the fetched HTML title (`og:title` / `<title>` / `h1`). Soft LLM extract titles must not authorize a recipe — models invent the query dish on wrong URLs. An extracted title that names a *different* dish still **vetoes**. When HTML has no title (captcha / empty shell), the search-hit title is a last-resort signal. Multi-word Latin names need a contiguous phrase (`tres leches`), not scattered tokens.

Aim for 3 on-topic recipes, then up to 7 if they disagree. Search Gemini and DuckDuckGo in parallel and stop once there are enough untried titled hits for the remaining recipe slots. Fetch page HTML first and parse it only when the text is substantial or includes JSON-LD. Store the post-redirect page URL on the recipe. A captcha/human-check redirect still counts as a live 2xx, but do not parse that HTML or store that URL — recover the recipe path from `next=` (or the original search hit) and give that URL to URL Context. URL-context is only used when the live fetch returned 2xx but the HTML was too thin (JS shell). A 4xx/5xx or failed fetch drops that URL. After the first three recipes, keep searching if flavors disagree and more titled pages are needed. Collection stops at `COLLECT_TIME_LIMIT_MS` (45s) and scores whatever recipes were extracted, even if fewer than 3. Only fail if zero usable recipes. Search uses `expandSearchQueries`. Always merge Gemini + DuckDuckGo hits.

- Quantity = mean(volume / recipe_volume across all recipes, 0 if absent) × target final volume.
- Extract amounts convert via `resolveRecipeVolumes` in `quantity.ts` (two-pass): measured/count units first; vague units (`pinch`, `dash`, …) use a kitchen baseline scaled by bulk recipe volume (~0.5×–3× vs a 500 ml reference); missing / “to taste” / `piece` on seasoning names (salt, ground pepper, dried spices) estimate from dish size — never the flat 15 ml `piece` default. Fresh chili peppers stay countable. Primary seasoners with clearly ambiguous amounts also set `quantityAmbiguous` for the post-mix Gemini adjustment.

## LLM jobs (only)

Gemini 3.5 Flash-Lite by default: classify input (dish / ingredient / reject), origin (bare dish names resolve to the popular form people usually mean; specific style/region qualifiers are honored), native-language or typed-language search, URL-context recipe parse, ingredient name canonicalize, common-pantry check, cached-dish matching, leaf calibration, grocery-leaf estimate when labs miss.

Gemini 3.6 Flash for hard cases: weak origin, sauces/pastes/fermented compounds, leaf calibration on those names, and post-mix ambiguous primary-seasoner adjustment (`adjustAmbiguousSeasoning`).

Never ask either model for the full dish taste vector except that flagged-dimension adjustment. System prompt in `GeminiLlm` forbids inventing unflagged dish scores. Cached dish numbers come from the Turso running mean, not the matcher. Pure ingredient queries skip dilution and return the ingredient catalog vector (chemistry, Gemini estimate, or nested recipe on miss).
