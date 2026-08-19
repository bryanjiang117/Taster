# Taste pipeline rewrite

Rebuild tasting so leaves come from chemistry and dishes are mixed from recipes. The UI stays dish-name → 0–10 profile.

## Flow

`profileDish` / `tasteQuery` still serves `POST /api/profile`.

1. Classify: dish, ingredient, or reject (brand / nonsense).
2. **Ingredient cache always wins** for that normalized name, even if classify says dish. The Reuse cache toggle does not apply here.
3. Else try a **chemistry leaf** (USDA + FooDB → compound mixer → Gemini calibrate). Persist `INSERT OR IGNORE`.
4. Else **full recipe search** (same web search as today). Nested non-leaves get that same search. Persist the mix as an **ingredient** row, not a dish row.
5. **Top-level dish only:** Reuse cache on + Turso `dishes` hit → stored average. After a live run, write the dish cache (running mean / outlier rule).

Cycle: skip a name already on the tasting stack. Depth cap as a backstop. Abort: no dish persist; finished ingredient rows still insert.

## Leaf chemistry

Eligible if Gemini says common pantry/recipe ingredient **or** the name is in **both** FooDB and USDA.

USDA: Foundation / SR Legacy over branded meals; sugars, sodium, acids when present. FooDB: quantified compounds from the bundled 2020 public dump (no API key). Common pantry may leaf on USDA alone if FooDB misses. Flavor-tag with no amount → skip that compound.

Mixer (code): sucrose-equivalents, acid types, NaCl-equivalent, glutamate + nucleotide synergy, bitter classes, chemesthetic pungents with very different potencies. Tiny amounts stay tiny scores (no detection-threshold clip). Gemini may calibrate dimensions that have evidence (anchors: lemon/lime 10 sour, salt 10 salty, orange ~7–8 sweet, onion ~0–1 sweet, black pepper ~2–3 spicy, parmesan ~6–7 salty). No evidence → not a leaf. Never `source: "llm"`.

## Recipe mix

Keep current search/parse, representative recipe, in vs out, volume physics.

No dish perceptual map. Mix is `intrinsic × (volume / final) × Gemini prep intensity/scale`, then cap at the strongest in-ingredient. Bland food stays low; seasonings are high because their **leaf** vectors are high.

Gemini extract uses culinary common sense for prep (no prep enum in code). It must not output the dish’s six numbers.

## Keep / drop

Keep: classify, origin, search, URL extract, canonicalize, Turso stores, SSE UI.

Drop: LLM-only ingredient vectors, `toPerceptualTaste` on dishes.
