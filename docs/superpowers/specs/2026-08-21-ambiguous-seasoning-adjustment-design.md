# Ambiguous primary-seasoner dish adjustment

When a recipe says “salt to taste” (or similar for sugar, lemon/vinegar, chili, MSG), volume estimation alone under-seasons characteristically seasoned dishes. After deterministic mix, Gemini may set the **dish total** for dimensions tied to those ambiguous lines.

## Flag (extract)

Clear ambiguity only: missing amount+unit, or “to taste” / “as needed” / “season with”. Not pinch/dash.

Only **primary seasoners**, mapped to one dimension:

| Class | Dimension |
| --- | --- |
| salt forms | salty |
| culinary sweeteners (sugar, honey, …) | sweet |
| acid seasoners (lemon, lime, vinegar, …) | sour |
| chili heat seasoners | spicy |
| MSG / pure umami boosters | umami |

`quantityAmbiguous` on the recipe line; representative ORs the flag across recipes.

## Adjust (post-mix)

If any flagged seasoner remains on the representative:

1. Engine scores as today.
2. One Gemini call: dish context, engine vector, contributor tips, each flag (name, dim, leaf score, current points).
3. Gemini returns, per flagged dim: `target` total + per-flagged-ingredient `points` (must justify uplift size).
4. Code: `final = max(engine, clamp(target, 0, 10))`; uplift goes to those ingredients’ contributions (scale Gemini’s points to the uplift); other dims untouched.

## Invariants

- Non-flagged dimensions stay engine-only.
- Adjusted totals never go below the pre-adjustment engine score.
- Multiple flagged seasoners on one dim: Gemini allocates per ingredient; code normalizes to the uplift.
- LLM failure / missing method → keep engine scores.
