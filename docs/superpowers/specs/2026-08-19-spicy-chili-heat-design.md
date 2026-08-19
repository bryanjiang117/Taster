# Spicy is chili heat

Spicy on the 0–10 profile means chili heat, not generic pungency. Black pepper is a footnote. Thai chili is the ceiling. A little of that ceiling still makes a dish hot.

## Leaves

| Food | Spicy |
|---|---|
| Ground black pepper | ≈ 0.2 |
| Freshly cracked black pepper | ≈ 0.5 |
| Thai chili / habanero | 10 |

Retune piperine `tau` in `compounds.ts` so Dr. Duke *Piper nigrum* fruit (~7750 mg/100g) drafts ≈ 0.2. Do not add a second catalog row for cracked pepper. Gemini extract already has `mix.scale`; when the recipe says freshly cracked / cracked, it may raise that ingredient’s spicy scale so 0.2 becomes ≈ 0.5. No prep enum.

Capsaicin stays as-is unless Thai chili stops scoring 10. Ginger, garlic, and other non-chili pungents are not retuned in this change.

Gemini anchors: `10 spicy = thai chili or habanero`; `black pepper ≈ 0.2`; freshly cracked ≈ 0.5. Offline snapshot `lib/engine/testdata/ingredients.json` black pepper spicy 2.5 → 0.2. Live Turso rows are `INSERT OR IGNORE` and will not update; deleting `black pepper` is out of scope.

Pure ingredient queries still return the catalog vector with no mix.

## Dish mix

Sweet, sour, salty, umami, and bitter stay volume-linear:

`score = Σ (taste × mix.scale) × (volume × intensity / finalVolume)`

Spicy uses a p-norm with **p = 8**, after the same intensity and scale, still ignoring `role: "out"`:

`spicy = (Σ shareᵢ × spicyᵢ⁸)¹/⁸`

`shareᵢ = volumeᵢ × intensityᵢ / finalVolume` (not renormalized to 1). Then cap each dimension at the strongest in-ingredient and clamp 0–10, as today.

Worked examples (no cap bind):

| Bowl | Dish spicy |
|---|---|
| 2% Thai chili (10) | ~6.2 |
| 10% Thai chili | ~7.5 |
| 2% black pepper (0.2) | ~0.12 |
| 2% cracked pepper (0.5) | ~0.3 |

Two chilies add in p-space: 1% + 1% of a 10 equals 2% of a 10. A pinch of pepper next to chili does not move the dish.

## Not in scope

- Perceptual loudness on any dimension except this spicy p-norm
- Changing chili chemistry amounts or collapsing `thai chili` into `chili`
- Rewriting live Turso ingredient rows
- UI changes

## Tests and docs

Tests first in `lib/engine/combine.test.ts` (p-norm, pepper stays quiet, chili punches through, cap still holds). Update `chemistry.test.ts` / `seed.test.ts` for pepper ≈ 0.2, `llm-prompt.test.ts` anchors, and som tam `pipeline.test.ts` so dish spicy is clearly hot (not merely > 0.5).

Same change: `docs/ai/taste-engine.md`, `docs/ai/architecture.md`, `AGENTS.md`, `.cursor/rules/taste-engine.mdc`.
