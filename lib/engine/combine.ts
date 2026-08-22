import { capTaste, ceilingTaste, clampTaste, emptyTaste, scaleTaste } from "./taste";
import { TASTE_DIMENSIONS, type IngredientMix, type TasteProfile } from "./types";
import { tastingShareVolume } from "./volume";

export type MixIngredient = {
  name?: string;
  volumeMl: number;
  taste: TasteProfile;
  role?: "in" | "out";
  mix?: IngredientMix;
};

export type ScoreContribution = {
  name: string;
  points: number;
};

export type ScoreContributions = Record<
  (typeof TASTE_DIMENSIONS)[number],
  ScoreContribution[]
>;

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

/** Near peers stay nearly linear; weaker notes quiet via a smooth blend (no 85% cliff). */
export const RECIPE_PEER_RATIO = 0.85;
/** Ratio where quieting still fully applies before the peer blend starts. */
export const RECIPE_PEER_LOW = RECIPE_PEER_RATIO * 0.5;
/** Exponent on score/peak for the quieted end of the blend (⅓ is gentler than ½). */
export const RECIPE_LOUDNESS_POWER = 1 / 3;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Hermite smoothstep on [low, high] → 0…1. */
export function smoothunit(value: number, low: number, high: number): number {
  if (high <= low) return value >= high ? 1 : 0;
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

export function relativeLoudness(
  score: number,
  stats: RecipeTasteStats,
): number {
  if (score <= 0 || stats.peak <= 0) return 0;
  const toPeak = score / stats.peak;
  const toAvg = stats.avg > 0 ? score / stats.avg : toPeak;
  const ratio = Math.max(toPeak, toAvg);
  const quieted = score * toPeak ** RECIPE_LOUDNESS_POWER;
  // Full peer by ratio 1; ~RECIPE_PEER_RATIO is already mostly linear (no hard cliff).
  const peer = smoothunit(ratio, RECIPE_PEER_LOW, 1);
  return quieted * (1 - peer) + score * peer;
}

/** Volume punch-through for seasonings in a large bowl (was 4; 5 favors spoon vs broth). */
export const MIX_P_NORM = 5;

/** Linear boost after mix (~5 raw → ~8). */
export const MIX_GAIN = 1.75;

/** Loud notes: full seasoning weight by this score; ramps from SEASONING_LOUD_LOW. */
export const SEASONING_LOUD = 7;
/** Below this loudness, share does not count toward punch-through. */
export const SEASONING_LOUD_LOW = 4;
/** Share midpoint for punch-through (~spoon in a liter of soup; was 2.5%). */
export const SEASONING_SHARE = 0.015;
/** Smoothstep ends: full punch by ~SEASONING_SHARE × 1.12, linear below ~×0.32. */
const PUNCH_SHARE_LOW = SEASONING_SHARE * 0.32;
const PUNCH_SHARE_HIGH = SEASONING_SHARE * 1.12;
/** Mid notes only partially punch; peak culinary forms (≈10) get full intensity. */
export const PUNCH_INTENSITY_LOW = 5.25;
export const PUNCH_INTENSITY_HIGH = 10;

/** 0→1 how much this loudness counts as "seasoning" for punch share. */
export function seasoningLoudWeight(loud: number): number {
  return smoothunit(loud, SEASONING_LOUD_LOW, SEASONING_LOUD);
}

/** Smooth 0→1 weight: traces stay linear, spoon-scale seasonings punch through. */
export function seasoningPunchWeight(seasoningShare: number): number {
  return smoothunit(seasoningShare, PUNCH_SHARE_LOW, PUNCH_SHARE_HIGH);
}

/** 0→1 how hard this loudness may punch (independent of dimension crowding). */
export function punchIntensityWeight(loud: number): number {
  return smoothunit(loud, PUNCH_INTENSITY_LOW, PUNCH_INTENSITY_HIGH);
}

export function applyMixGain(score: number): number {
  if (score <= 0) return 0;
  return score * MIX_GAIN;
}

function emptyContributions(): ScoreContributions {
  return {
    sweet: [],
    sour: [],
    salty: [],
    spicy: [],
    umami: [],
    bitter: [],
  };
}

function rankedContributions(parts: ScoreContribution[]): ScoreContribution[] {
  return parts
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function scaleContributionParts(
  parts: ScoreContribution[],
  factor: number,
): ScoreContribution[] {
  if (factor === 1) return parts;
  if (factor <= 0) return [];
  return parts.map((row) => ({ ...row, points: row.points * factor }));
}

function dimensionAttributed(
  ingredients: Array<{ name: string; volumeMl: number; taste: TasteProfile }>,
  finalVolumeMl: number,
  dim: TasteDimension,
  p: number,
  stats: RecipeTasteStats,
): { score: number; parts: ScoreContribution[] } {
  let raw = 0;
  const parts: ScoreContribution[] = [];

  for (const item of ingredients) {
    const share = item.volumeMl / finalVolumeMl;
    const loud = relativeLoudness(item.taste[dim] ?? 0, stats);
    if (share <= 0 || loud <= 0) continue;
    const linear = share * loud;
    const punch = loud * share ** (1 / p);
    const weight =
      seasoningPunchWeight(share * seasoningLoudWeight(loud)) *
      punchIntensityWeight(loud);
    const points = linear * (1 - weight) + punch * weight;
    if (points <= 0) continue;
    raw += points;
    parts.push({ name: item.name, points: applyMixGain(points) });
  }

  if (raw <= 0) return { score: 0, parts: [] };
  return { score: applyMixGain(raw), parts };
}

function prepareWeighted(
  ingredients: MixIngredient[],
): Array<{ name: string; volumeMl: number; taste: TasteProfile }> {
  return ingredients
    .filter((item) => item.role !== "out")
    .map((item) => ({
      name: item.name?.trim() || "ingredient",
      volumeMl: item.volumeMl * (item.mix?.intensity ?? 1),
      taste: scaledTaste(item.taste, item.mix?.scale),
    }));
}

/** Per-ingredient loudness blend × gain, plus per-dimension ingredient points. */
export function attributeRecipeTaste(
  ingredients: MixIngredient[],
  finalVolumeMl: number,
): { taste: TasteProfile; contributions: ScoreContributions } {
  const inside = ingredients.filter((item) => item.role !== "out");
  if (!inside.length || finalVolumeMl <= 0) {
    return { taste: emptyTaste(), contributions: emptyContributions() };
  }

  const weighted = prepareWeighted(ingredients);
  const stats = recipeTasteStats(weighted);
  const tastingMl = tastingShareVolume(inside, finalVolumeMl);
  const mixed = emptyTaste();
  const rawParts: ScoreContributions = emptyContributions();

  for (const dim of TASTE_DIMENSIONS) {
    const { score, parts } = dimensionAttributed(
      weighted,
      tastingMl,
      dim,
      MIX_P_NORM,
      stats,
    );
    mixed[dim] = score;
    rawParts[dim] = parts;
  }

  const ceiling = ceilingTaste(weighted.map((item) => item.taste));
  const capped = clampTaste(capTaste(mixed, ceiling));
  const contributions = emptyContributions();

  for (const dim of TASTE_DIMENSIONS) {
    const before = mixed[dim] ?? 0;
    const after = capped[dim] ?? 0;
    const factor = before > 0 ? after / before : 0;
    contributions[dim] = rankedContributions(
      scaleContributionParts(rawParts[dim], factor),
    );
  }

  return { taste: capped, contributions };
}

/** Per-ingredient loudness blend × gain. */
export function combineRecipeTaste(
  ingredients: MixIngredient[],
  finalVolumeMl: number,
): TasteProfile {
  return attributeRecipeTaste(ingredients, finalVolumeMl).taste;
}

/** Multiply every contribution by a shared factor (e.g. soluble retention). */
export function scaleScoreContributions(
  contributions: ScoreContributions,
  factor: number,
): ScoreContributions {
  const out = emptyContributions();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = rankedContributions(
      scaleContributionParts(contributions[dim], factor),
    );
  }
  return out;
}

/** Scale contribution points so each dimension sums to the displayed score. */
export function alignScoreContributions(
  contributions: ScoreContributions,
  taste: TasteProfile,
): ScoreContributions {
  const out = emptyContributions();
  for (const dim of TASTE_DIMENSIONS) {
    const target = taste[dim] ?? 0;
    const parts = contributions[dim];
    const sum = parts.reduce((total, row) => total + row.points, 0);
    if (target <= 0 || parts.length === 0) {
      out[dim] = [];
      continue;
    }
    if (sum <= 0) {
      out[dim] = [];
      continue;
    }
    out[dim] = rankedContributions(
      parts.map((row) => ({
        name: row.name,
        points: (row.points / sum) * target,
      })),
    );
  }
  return out;
}

/** Round contribution points for the UI; keep every positive contributor. */
export function roundScoreContributions(
  contributions: ScoreContributions,
  digits = 2,
): ScoreContributions {
  const p = 10 ** digits;
  const floor = 1 / p;
  const out = emptyContributions();
  for (const dim of TASTE_DIMENSIONS) {
    out[dim] = rankedContributions(
      contributions[dim].map((row) => {
        if (row.points <= 0) return { name: row.name, points: 0 };
        const rounded = Math.round(row.points * p) / p;
        return { name: row.name, points: Math.max(rounded, floor) };
      }),
    );
  }
  return out;
}

export function contributionsFromPureTaste(
  name: string,
  taste: TasteProfile,
): ScoreContributions {
  const out = emptyContributions();
  for (const dim of TASTE_DIMENSIONS) {
    const points = taste[dim] ?? 0;
    if (points > 0) out[dim] = [{ name, points }];
  }
  return out;
}

export function applyIntensity(taste: TasteProfile, intensity: number): TasteProfile {
  return scaleTaste(taste, intensity);
}
