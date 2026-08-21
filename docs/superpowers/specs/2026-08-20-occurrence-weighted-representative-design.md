# Occurrence-weighted representative volumes

Multi-recipe scoring should treat each recipe appearance as one share of the average dish. An ingredient in 3 of 3 recipes counts 3×; three mutual substitutes each in 1 of 3 count 1× each and together match one sauce slot. The UI keeps separate ingredient lines (no substitute grouping).

## Problem

`buildRepresentativeRecipe` today:

1. Drops ingredients below a ≥50% occurrence gate (fallback to max frequency if nothing reaches half).
2. Sets volume from the **median share among recipes that list the ingredient**, ignoring absences.

So cilantro in 1 of 3 never scores, and lemon in 2 of 3 is scored like it is in every recipe.

## Change

In `buildRepresentativeRecipe` only:

- Include every `in` ingredient that appears at least once (still exclude `out`-only).
- For each name, volume share = **mean over all recipes**, with **0 when the recipe omits it**.
- `volumeMl = that mean × targetFinalVolumeMl`.
- Keep recording `occurrence: { used, total }` for provenance / UI elsewhere.
- Prep mix knobs stay median/mode over **present** recipes only (intensity, scale, why) — absences do not invent mix metadata.

Equivalent forms when present shares are similar: `mean(share_i)` with zeros ≡ `median(present shares) × (used / total)` for uniform present shares; prefer the explicit mean-with-zeros definition so uneven present amounts stay accurate.

Worked example (target 400 ml):

| Ingredient | Shares across 3 recipes | Mean share | Volume |
|---|---|---|---|
| chicken | 0.5, 0.5, 0.5 | 0.5 | 200 |
| soy sauce | 0.05, 0, 0 | ≈0.0167 | ≈6.7 |
| fish sauce | 0, 0.05, 0 | ≈0.0167 | ≈6.7 |
| oyster sauce | 0, 0, 0.05 | ≈0.0167 | ≈6.7 |

Sauce substitutes sum to ≈5% — one recipe’s sauce mass. Chicken stays full weight.

## Unchanged

- Ingredient list UI (`foundIngredientsFromRecipes`): still lists every name with `used` / `total`; no grouping.
- Resolve-all unique recipe ingredients before scoring.
- `combineRecipeTaste` / loudness / p-norm math.
- Dish cache, confidence agreement scaling, recipe collection counts.

## Tests and docs

Tests first in `lib/engine/representative.test.ts`:

- Drop “≥50% keeps / rare drops” expectations; add substitute case (three 1-of-3 sauces each get ~⅓ of a single-recipe sauce volume).
- Lemon in 2 of 3: mean of `{0, 0.1, 0.2}` → 0.1 → 40 ml at target 400 (not 60).
- Salt in all recipes at equal share: volume unchanged vs today.
- `out`-only still excluded; median prep intensity for drained oil still applies.

Same change: `docs/ai/taste-engine.md`, `AGENTS.md`, `.cursor/rules/taste-engine.mdc` (and `architecture.md` if it restates the ≥50% / median-present rule).
