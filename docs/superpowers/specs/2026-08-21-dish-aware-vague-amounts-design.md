# Dish-aware vague recipe amounts

Ambiguous extract amounts (`a pinch`, `to taste`, missing unit) were falling through to `amount || 1` + `unit || "piece"` → **15 ml**, so a pinch of salt looked like a tablespoon.

## Approach

Deterministic resolve after extract (no extra LLM call):

1. **Measured / countable** units convert as today (`quantityToMl`).
2. **Vague kitchen units** (`pinch`, `dash`, `smidgen`, `splash`, `handful`) use a fixed baseline, then scale by bulk recipe volume (0.5×–3× vs a 500 ml reference).
3. **Missing / “to taste” / `piece` on seasoning names** (salt, ground pepper, dried spices — not fresh chili peppers) estimate from dish size via a small culinary share (e.g. salt ≈ 0.4% of bulk). Never the flat 15 ml piece default.
4. Soft clamp: seasonings capped at ~1.2% of bulk so LLM tbsp-for-pinch cannot dominate.
5. Extract prompt (same call): keep `pinch`/`dash`; never use `piece` for salt/pepper/spices; omit amount/unit for “to taste” or give a measured guess for *this* recipe.

## Code

- `resolveRecipeVolumes` in `lib/engine/quantity.ts`
- `recipeFromExtractJson` uses it (two-pass: measured bulk, then vague/seasoning)
- Docs: `docs/ai/taste-engine.md`
