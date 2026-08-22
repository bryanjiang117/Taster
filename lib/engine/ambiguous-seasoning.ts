import type { ScoreContribution, ScoreContributions } from "./combine";
import type { TasteDimension, TasteProfile } from "./types";
import { TASTE_DIMENSIONS } from "./types";

const SALT =
  /\b(kosher\s+salt|sea\s+salt|table\s+salt|salt|sal|sel|塩|盐)\b/i;
const SWEETENER =
  /\b(brown\s+sugar|white\s+sugar|cane\s+sugar|palm\s+sugar|coconut\s+sugar|powdered\s+sugar|castor\s+sugar|sugar|honey|maple\s+syrup|molasses|agave|jaggery|糖|砂糖|蜂蜜)\b/i;
const ACID =
  /\b(lemon\s+juice|lime\s+juice|lemon|lime|yuzu|vinegar|rice\s+vinegar|apple\s+cider\s+vinegar|balsamic|citric\s+acid|柠檬|檸檬|ライム|醋|酢)\b/i;
/** Chili heat seasoners — not black pepper / Sichuan peppercorn. */
const CHILI =
  /\b(thai\s+chili|bird(?:'s)?\s*eye\s+chili|birdseye\s+chili|chili\s+pepper|chilli\s+pepper|hot\s+chili|dried\s+chili|chili\s+flakes?|chilli\s+flakes?|red\s+pepper\s+flakes?|cayenne|habanero|jalape[nñ]o|scotch\s*bonnet|gochugaru|chili|chilli|辣椒|干辣椒|朝天椒)\b/i;
const UMAMI_BOOSTER = /\b(msg|monosodium\s+glutamate|味の素|味精)\b/i;

/** Primary seasoner → the one dish dimension it is meant to drive. */
export function primarySeasonerDimension(name: string): TasteDimension | null {
  const n = name.trim();
  if (!n) return null;
  if (SALT.test(n)) return "salty";
  if (SWEETENER.test(n)) return "sweet";
  if (ACID.test(n)) return "sour";
  if (CHILI.test(n)) return "spicy";
  if (UMAMI_BOOSTER.test(n)) return "umami";
  return null;
}

export type FlaggedAmbiguousSeasoner = {
  name: string;
  dimension: TasteDimension;
};

export type AmbiguousSeasoningAdjustment = {
  adjustments: Array<{
    dimension: TasteDimension;
    target: number;
    contributions: Array<{ ingredient: string; points: number }>;
  }>;
};

function clamp01to10(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(10, Math.max(0, value));
}

function addPoints(
  parts: ScoreContribution[],
  name: string,
  delta: number,
): ScoreContribution[] {
  if (delta === 0) return parts;
  const next = parts.map((row) => ({ ...row }));
  const existing = next.find((row) => row.name === name);
  if (existing) existing.points += delta;
  else next.push({ name, points: delta });
  return next;
}

/**
 * Raise flagged dish dimensions to Gemini targets (never below engine).
 * Uplift is assigned to the flagged seasoners' contribution tips.
 */
export function applyAmbiguousSeasoningAdjustment(input: {
  taste: TasteProfile;
  contributions: ScoreContributions;
  flagged: FlaggedAmbiguousSeasoner[];
  adjustment: AmbiguousSeasoningAdjustment | null | undefined;
}): { taste: TasteProfile; contributions: ScoreContributions } {
  const flaggedByDim = new Map<TasteDimension, Set<string>>();
  for (const row of input.flagged) {
    const set = flaggedByDim.get(row.dimension) ?? new Set();
    set.add(row.name);
    flaggedByDim.set(row.dimension, set);
  }
  if (!flaggedByDim.size || !input.adjustment?.adjustments?.length) {
    return { taste: input.taste, contributions: input.contributions };
  }

  const taste = { ...input.taste };
  const contributions: ScoreContributions = {
    sweet: [...input.contributions.sweet],
    sour: [...input.contributions.sour],
    salty: [...input.contributions.salty],
    spicy: [...input.contributions.spicy],
    umami: [...input.contributions.umami],
    bitter: [...input.contributions.bitter],
  };

  for (const adj of input.adjustment.adjustments) {
    if (!TASTE_DIMENSIONS.includes(adj.dimension)) continue;
    const allowed = flaggedByDim.get(adj.dimension);
    if (!allowed?.size) continue;

    const engine = taste[adj.dimension] ?? 0;
    const target = Math.max(engine, clamp01to10(adj.target));
    const uplift = target - engine;
    taste[adj.dimension] = target;
    if (uplift <= 0) continue;

    const raw = (adj.contributions ?? []).filter(
      (row) => row.ingredient && allowed.has(row.ingredient),
    );
    const positive = raw
      .map((row) => ({
        ingredient: row.ingredient,
        points: Math.max(0, row.points),
      }))
      .filter((row) => row.points > 0);

    let weights = positive;
    if (!weights.length) {
      // Equal split when the model omitted a usable allocation.
      weights = [...allowed].map((ingredient) => ({
        ingredient,
        points: 1,
      }));
    }
    const weightSum = weights.reduce((sum, row) => sum + row.points, 0);
    if (weightSum <= 0) continue;

    for (const row of weights) {
      const delta = (row.points / weightSum) * uplift;
      contributions[adj.dimension] = addPoints(
        contributions[adj.dimension],
        row.ingredient,
        delta,
      );
    }
  }

  return { taste, contributions };
}
