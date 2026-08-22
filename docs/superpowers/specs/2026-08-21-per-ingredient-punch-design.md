# Per-ingredient punch (ignore dimension crowding)

Joint p-norm mix rewarded empty dimensions: a spoon of ketchup (sweet ≈7) collapsed toward leaf score (~6) while the same spoon of worcestershire lost umami mix mass to bulk beef.

## Rule

For each ingredient × dimension:

1. `loud` = recipe-relative loudness (unchanged)
2. `linear = share × loud`
3. `punch = loud × share^(1/p)` (`MIX_P_NORM = 5`)
4. `w = seasoningPunchWeight(share × seasoningLoudWeight(loud)) × punchIntensityWeight(loud)`
5. `points = linear×(1−w) + punch×w`

Sum points → `MIX_GAIN` (1.75×) → cap at strongest in-ingredient.

Punch weight uses **only that ingredient’s bowl share and loudness**. Other contributors on the same dimension do not boost or shrink the term.

## Intensity gate

`punchIntensityWeight`: smoothstep **5.25 → 10**. Mid notes (ketchup ≈7) get partial punch (~2 sweet for a spoon in tartare-scale). Peak forms (salt/sugar/chili ≈10) still fully season a bland bowl.

## Unchanged

Relative loudness peer blend, seasoning loud/share smoothsteps, `MIX_P_NORM`, `MIX_GAIN`, prep intensity/scale, ceiling cap, contribution finalize.

## Tests / docs

`lib/engine/combine.test.ts`; `AGENTS.md`, `docs/ai/taste-engine.md`, `docs/ai/architecture.md`, `.cursor/rules/taste-engine.mdc`.
