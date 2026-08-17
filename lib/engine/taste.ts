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

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(10, Math.max(0, value));
}

export function clampTaste(taste: TasteProfile): TasteProfile {
  const out = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = clampScore(taste[dim] ?? 0);
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

/** Raw concentration (typically 0.05–0.8) that maps to ~6.3/10. Smaller = louder dish scores. */
export const TASTE_SCALE_TAU = 0.8;

/** Sweet reads a bit hotter than salt/umami at the same dissolved share; quiet it slightly. */
export const TASTE_SCALE_TAU_BY_DIM: Partial<Record<keyof TasteProfile, number>> = {
  sweet: 1.05,
};

export function toPerceptualScore(raw: number, tau = TASTE_SCALE_TAU): number {
  if (raw <= 0 || tau <= 0) return 0;
  return clampScore(10 * (1 - Math.exp(-raw / tau)));
}

export function toPerceptualTaste(taste: TasteProfile, tau = TASTE_SCALE_TAU): TasteProfile {
  const out = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = toPerceptualScore(
      taste[dim] ?? 0,
      TASTE_SCALE_TAU_BY_DIM[dim] ?? tau,
    );
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
    const ratio = Math.min(1, score / peak);
    out[dim] = score * (1 - (1 - ratio) ** power);
  }
  return out;
}

/** Replace any dimension the overlay actually set. Used when chemistry and mouthful taste both arrive. */
export function overlayTaste(
  base: TasteProfile,
  overlay?: Partial<TasteProfile>,
): TasteProfile {
  if (!overlay) return clampTaste(base);
  const out = clampTaste(base);
  for (const dim of TASTE_DIMENSIONS) {
    const value = overlay[dim];
    if (value != null) out[dim] = clampScore(value);
  }
  return out;
}

export function roundTaste(taste: TasteProfile, digits = 1): TasteProfile {
  const out = emptyTaste();
  const p = 10 ** digits;
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = Math.round(clampScore(taste[dim]) * p) / p;
  }
  return out;
}
