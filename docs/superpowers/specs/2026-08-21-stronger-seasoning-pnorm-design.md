# Stronger seasoning p-norm (soup punch)

In soup/stew bowls, mild broth at large volume share over-contributes on dish scores and contribution tips, while spoon-scale salt/soy/chili under-contribute. Volume shares are physically right; the mix p-norm is too gentle.

## Change

- `MIX_P_NORM`: **4 → 5** in `lib/engine/combine.ts`
- Same path for all six dimensions (linear ↔ p-norm blend, attribution from the same masses)

Higher *p* makes `share × loud^p` favor small loud seasonings over large mild bases in both the punch score and tip ranking when punch weight is engaged.

## Unchanged

- `SEASONING_SHARE` midpoint ≈1.5%, loud band smoothstep ~4→7, `MIX_GAIN` 1.75
- Relative-loudness peer blend
- Flavored-liquid intensity floor / prep heuristics (absorbed stock regime)
- No carrier-vs-flavor-mass split; no broth name special-case

## Limit

If broth is mid-loud on a dimension (e.g. umami ≈4) and is most of the bowl, it can still rank high on that dim’s tips even at *p*=5. This change only strengthens punch mass; it does not reclassify bulk liquid as carrier.

## Tests / docs

Tests first in `lib/engine/combine.test.ts`:

- Update helpers/expectations that bake in `p=4` (punch formula, two-seasonings-in-p-space)
- Soup-scale case: large mild broth + spoon salt/soy → stronger salty (and tip order prefers seasonings when they are the loud peak)
- Keep green: sauce-heavy salad near 9, sugar/oyster in soup bowl, chili-with-peaks, paella salt after water removal, bland food stays low

Docs (p=4 → p=5): `AGENTS.md`, `docs/ai/taste-engine.md`, `docs/ai/architecture.md`, `.cursor/rules/taste-engine.mdc`.
