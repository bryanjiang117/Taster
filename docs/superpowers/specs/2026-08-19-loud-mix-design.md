# Loud mix: low scores vanish, high seasonings punch through

Dish mix should feel like cooking. A trace of sweetness in rice should not flavor the bowl. A spoon of salt should. A 10 is rare.

## Mix

After Gemini `mix.intensity` / `mix.scale`, each leaf score uses **tiered loudness** (γ=2.5 below 2.5, γ=2 below 5, γ=1.5 above), then a volume p-norm, then **piecewise gain**:

```
loudness = 10 × (score / 10)^γ
raw = (Σ shareᵢ × loudnessᵢᵖ)¹ᐟᵖ
dish = raw × 1.08   when raw ≤ 5.5
dish = raw × 1.48   when raw > 5.5
```

`p = 4.75` for all dimensions (no separate spicy curve). Gain is **1.35×** up to raw 4.5, then **1.75×** (~5 raw → ~8 on the dish).

Cap each dimension at the strongest in-ingredient mouthful, then clamp 0–10. Pure ingredient queries still skip mix.

Worked examples (15 ml in a 500 ml bowl, no cap bind):

| Leaf | Dish |
|---|---|
| Salt 10 salty | ~4.7 |
| Lemon fruit 9 sour | ~4.3 |
| Lemon juice 9.5 sour | ~4.6 |
| 10% Thai chili 10 spicy | ~10 (capped) |
| 10% chili 8 spicy | ~8.5 |
| Thai chili 10 spicy (spoon in bowl) | ~5.5 |
| Som tam–style mix (lime, fish sauce, chili, palm sugar) | sour/salty/umami ~9 |
| Rice 1 sweet at 97% of the bowl | ~0.03 |
| Black pepper 0.2 spicy | ~0 |

Two spoons of the same 10 add in p-space like one double-share spoon.

## Leaves

Score the named grocery form. Juice, paste, and extract are stronger than the intact food.

| Food | Notes |
|---|---|
| Table salt, sugar, Thai chili / habanero, fish sauce, espresso | 10 — most intense culinary form |
| Lemon / lime fruit | ≈ 9 sour |
| Lemon / lime juice | ≈ 9.5 sour |
| Black pepper | ≈ 0.2 spicy (cracked ≈ 0.5 via `mix.scale`) |

Do not give a 10 because the food is the iconic example of that taste. Offline snapshot lemon/lime 10 → 9, lime juice 10 → 9.5. Live Turso rows are `INSERT OR IGNORE` and are not rewritten.

## Not in scope

- Rewriting live Turso ingredient rows
- UI changes
- Changing chemistry compound amounts except via Gemini calibration guidance

## Tests and docs

Tests first in `lib/engine/combine.test.ts`. Snapshot + prompt anchors in `seed.test.ts` / `llm-prompt.test.ts`. Same change: `docs/ai/taste-engine.md`, `docs/ai/architecture.md`, `AGENTS.md`, `.cursor/rules/taste-engine.mdc`.
