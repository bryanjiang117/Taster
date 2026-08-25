import { TASTE_DIMENSIONS, type TasteProfile } from "./types";

export { TASTE_DIMENSIONS, type TasteProfile };

export function emptyTaste(): TasteProfile {
  return {
    sweet: 0,
    sour: 0,
    salty: 0,
    spicy: 0,
    umami: 0,
    bitter: 0,
  };
}

/** Dish / UI display ceiling. */
export const TASTE_DISPLAY_MAX = 10;
/** Leaf ceiling — table salt sits above the usual 0–10 mouthful scale. */
export const TASTE_LEAF_MAX = 12;

export function clampScore(
  value: number,
  max: number = TASTE_DISPLAY_MAX,
): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

export function clampTaste(
  taste: TasteProfile,
  max: number = TASTE_DISPLAY_MAX,
): TasteProfile {
  const out = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = clampScore(taste[dim] ?? 0, max);
  }
  return out;
}

export function mergeTastes(tastes: TasteProfile[]): TasteProfile {
  const out = emptyTaste();
  for (const taste of tastes) {
    for (const dim of TASTE_DIMENSIONS) {
      out[dim] += taste[dim] ?? 0;
    }
  }
  return clampTaste(out);
}

export function scaleTaste(taste: TasteProfile, factor: number): TasteProfile {
  const out = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = (taste[dim] ?? 0) * factor;
  }
  return out;
}

export function ceilingTaste(tastes: TasteProfile[]): TasteProfile {
  const out = emptyTaste();
  for (const taste of tastes) {
    for (const dim of TASTE_DIMENSIONS) {
      out[dim] = Math.max(out[dim], taste[dim] ?? 0);
    }
  }
  return out;
}

export function capTaste(taste: TasteProfile, ceiling: TasteProfile): TasteProfile {
  const out = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = Math.min(taste[dim] ?? 0, ceiling[dim] ?? 0);
  }
  return out;
}

/** Higher = gentler. 2 leaves a 6 next to a 7 almost untouched and sends a 2 toward 1. */
export const TASTE_POLARIZE_POWER = 2;

/** Only trace flavors (≤ this) are quieted vs the peak; real mid scores stay put. */
export const TASTE_POLARIZE_TRACE_MAX = 2;

export function polarizeTaste(
  taste: TasteProfile,
  power = TASTE_POLARIZE_POWER,
): TasteProfile {
  if (power <= 0) return clampTaste(taste);
  let peak = 0;
  for (const dim of TASTE_DIMENSIONS) {
    peak = Math.max(peak, taste[dim] ?? 0);
  }
  if (peak <= 0) return emptyTaste();
  const out = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    const score = taste[dim] ?? 0;
    if (score <= 0) continue;
    if (score > TASTE_POLARIZE_TRACE_MAX) {
      out[dim] = score;
      continue;
    }
    const ratio = Math.min(1, score / peak);
    out[dim] = score * (1 - (1 - ratio) ** power);
  }
  return out;
}

/** Replace mouthful taste dimensions that the model actually rated (> 0). Zeros mean "unspecified", not "not salty"; use *Index for an explicit 0. */
export function overlayTaste(
  base: TasteProfile,
  overlay?: Partial<TasteProfile>,
): TasteProfile {
  if (!overlay) return clampTaste(base, TASTE_LEAF_MAX);
  const out = clampTaste(base, TASTE_LEAF_MAX);
  for (const dim of TASTE_DIMENSIONS) {
    const value = overlay[dim];
    if (value != null && value > 0) out[dim] = clampScore(value, TASTE_LEAF_MAX);
  }
  return out;
}

export function roundTaste(
  taste: TasteProfile,
  digits = 1,
  max: number = TASTE_DISPLAY_MAX,
): TasteProfile {
  const out = emptyTaste();
  const p = 10 ** digits;
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = Math.round(clampScore(taste[dim], max) * p) / p;
  }
  return out;
}
