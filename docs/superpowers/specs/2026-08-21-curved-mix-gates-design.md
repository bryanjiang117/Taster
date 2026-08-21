# Curved mix gates (no hard cliffs)

Hard thresholds in dish mix created score cliffs. Replace them with smoothsteps; keep punch-share ramping as already curved.

## Changes

### Relative loudness (was: peer if ratio ≥ 0.85)

- Quieted end: `score × (score/peak)^⅓`
- Peer weight: smoothstep of `max(score/peak, score/avg)` from `RECIPE_PEER_LOW` (≈0.42) to 1
- Blend: `quieted × (1 − peer) + score × peer`
- Peak notes stay full; mid notes rise continuously (no jump at 85%)

### Seasoning loudness for punch share (was: count share only if loud ≥ 7)

- `seasoningLoudWeight(loud)`: smoothstep from 4 → 7
- `seasoningShare += share × weight`
- Mid-loud pastes (≈5–6) partially count toward punch; traces still do not

### Unchanged

- Punch weight vs share (smoothstep around 1.5% midpoint)
- `MIX_P_NORM = 5`, `MIX_GAIN = 1.75`
- Cap at strongest in-ingredient

## Tests / docs

`lib/engine/combine.test.ts`; `AGENTS.md`, `docs/ai/taste-engine.md`, `docs/ai/architecture.md`, `.cursor/rules/taste-engine.mdc`.
