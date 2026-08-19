import { capTaste, ceilingTaste, clampTaste, emptyTaste, scaleTaste } from "./taste";
import { TASTE_DIMENSIONS, type IngredientMix, type TasteProfile } from "./types";

export type MixIngredient = {
  volumeMl: number;
  taste: TasteProfile;
  role?: "in" | "out";
  mix?: IngredientMix;
};

type TasteDimension = (typeof TASTE_DIMENSIONS)[number];

export type RecipeTasteStats = { peak: number; avg: number };

function scaledTaste(taste: TasteProfile, scale?: Partial<TasteProfile>): TasteProfile {
  if (!scale) return taste;
  const out = { ...taste };
  for (const dim of TASTE_DIMENSIONS) {
    const factor = scale[dim];
    if (factor == null) continue;
    out[dim] = (taste[dim] ?? 0) * factor;
  }
  return out;
}

/** Volume-weighted mean of each ingredient's peak taste; peak is the recipe's loudest note. */
export function recipeTasteStats(
  ingredients: Array<{ volumeMl: number; taste: TasteProfile }>,
): RecipeTasteStats {
  let peak = 0;
  let weighted = 0;
  let mass = 0;
  for (const item of ingredients) {
    if (item.volumeMl <= 0) continue;
    let ingPeak = 0;
    for (const dim of TASTE_DIMENSIONS) {
      const score = item.taste[dim] ?? 0;
      if (score <= 0) continue;
      peak = Math.max(peak, score);
      ingPeak = Math.max(ingPeak, score);
    }
    if (ingPeak <= 0) continue;
    weighted += item.volumeMl * ingPeak;
    mass += item.volumeMl;
  }
  return { peak, avg: mass > 0 ? weighted / mass : 0 };
}

/** Near peers stay linear; traces vs the recipe peak quiet (milder than score²/peak). */
export const RECIPE_PEER_RATIO = 0.85;

export function relativeLoudness(
  score: number,
  stats: RecipeTasteStats,
): number {
  if (score <= 0 || stats.peak <= 0) return 0;
  const toPeak = score / stats.peak;
  const toAvg = stats.avg > 0 ? score / stats.avg : toPeak;
  if (toPeak >= RECIPE_PEER_RATIO || toAvg >= RECIPE_PEER_RATIO) return score;
  return score * Math.sqrt(toPeak);
}

/** Volume punch-through for seasonings in a large bowl (milder than 4.75). */
export const MIX_P_NORM = 4;

/** Linear boost after mix (~5 raw → ~8). */
export const MIX_GAIN = 1.75;

/** Loud notes (≥ this score) covering ≥ this dish share use p-norm punch-through. */
export const SEASONING_LOUD = 7;
export const SEASONING_SHARE = 0.025;

export function applyMixGain(score: number): number {
  if (score <= 0) return 0;
  return score * MIX_GAIN;
}

function dimensionLoudness(
  score: number,
  dim: TasteDimension,
  stats: RecipeTasteStats,
): number {
  // Chili heat should not get quieted just because salt/sugar peak the recipe.
  if (dim === "spicy") return score;
  return relativeLoudness(score, stats);
}

function pNormDimension(
  ingredients: Array<{ volumeMl: number; taste: TasteProfile }>,
  finalVolumeMl: number,
  dim: TasteDimension,
  p: number,
  stats: RecipeTasteStats,
): number {
  let linearAcc = 0;
  let punchAcc = 0;
  let seasoningShare = 0;
  for (const item of ingredients) {
    const share = item.volumeMl / finalVolumeMl;
    const loud = dimensionLoudness(item.taste[dim] ?? 0, dim, stats);
    if (share <= 0 || loud <= 0) continue;
    linearAcc += share * loud;
    punchAcc += share * loud ** p;
    if (loud >= SEASONING_LOUD) seasoningShare += share;
  }
  if (linearAcc <= 0 && punchAcc <= 0) return 0;
  // Spicy always punches through volume; other dims stay linear for tiny loud notes.
  if (dim === "spicy") return applyMixGain(punchAcc ** (1 / p));
  const linear = applyMixGain(linearAcc);
  if (seasoningShare < SEASONING_SHARE || punchAcc <= 0) return linear;
  return applyMixGain(punchAcc ** (1 / p));
}

/** Relative loudness × p-norm × linear gain. */
export function combineRecipeTaste(
  ingredients: MixIngredient[],
  finalVolumeMl: number,
): TasteProfile {
  const inside = ingredients.filter((item) => item.role !== "out");
  if (!inside.length || finalVolumeMl <= 0) return emptyTaste();

  const weighted = inside.map((item) => ({
    volumeMl: item.volumeMl * (item.mix?.intensity ?? 1),
    taste: scaledTaste(item.taste, item.mix?.scale),
  }));

  const stats = recipeTasteStats(weighted);
  const mixed = emptyTaste();
  for (const dim of TASTE_DIMENSIONS) {
    mixed[dim] = pNormDimension(weighted, finalVolumeMl, dim, MIX_P_NORM, stats);
  }
  const ceiling = ceilingTaste(weighted.map((item) => item.taste));
  return clampTaste(capTaste(mixed, ceiling));
}

export function applyIntensity(taste: TasteProfile, intensity: number): TasteProfile {
  return scaleTaste(taste, intensity);
}
