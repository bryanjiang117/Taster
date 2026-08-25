import { clampTaste, emptyTaste, TASTE_LEAF_MAX } from "./taste";
import { TASTE_DIMENSIONS, type TasteDimension, type TasteProfile } from "./types";

export type CompositionData = {
  sodiumMgPer100g?: number;
  sugarGPer100g?: number;
  pH?: number;
  glutamateMgPer100g?: number;
  scoville?: number;
  sweetIndex?: number;
  sourIndex?: number;
  saltyIndex?: number;
  spicyIndex?: number;
  umamiIndex?: number;
  bitterIndex?: number;
};

/**
 * Amount that maps to ~6.3/10 on the 1-exp curve.
 * Everyday foods land like a mouthful; concentrates saturate at 10.
 */
export const COMPOSITION_TASTE_TAU = {
  sweet: 7.5, // g sugar / 100g
  salty: 900, // mg sodium / 100g
  umami: 450, // mg glutamate / 100g
} as const;

const INDEX_KEY = {
  sweet: "sweetIndex",
  sour: "sourIndex",
  salty: "saltyIndex",
  spicy: "spicyIndex",
  umami: "umamiIndex",
  bitter: "bitterIndex",
} as const satisfies Record<TasteDimension, keyof CompositionData>;

function perceptualFromAmount(amount: number, tau: number): number {
  if (amount <= 0 || tau <= 0) return 0;
  return 10 * (1 - Math.exp(-amount / tau));
}

function sourFromPh(pH: number): number {
  const sourPhNeutral = 5.5;
  const sourPhMax = 2.3;
  if (pH >= sourPhNeutral) return 0;
  return ((sourPhNeutral - pH) / (sourPhNeutral - sourPhMax)) * 10;
}

function spicyFromScoville(scoville: number): number {
  const num = Math.log10(1 + scoville);
  const den = Math.log10(1 + 1_000_000);
  return (num / den) * 10;
}

export function tasteFromComposition(data: CompositionData): TasteProfile {
  const taste = emptyTaste();

  if (data.sugarGPer100g != null) {
    taste.sweet = perceptualFromAmount(data.sugarGPer100g, COMPOSITION_TASTE_TAU.sweet);
  }
  if (data.pH != null) {
    taste.sour = sourFromPh(data.pH);
  }
  if (data.sodiumMgPer100g != null) {
    taste.salty =
      data.sodiumMgPer100g >= 30000
        ? TASTE_LEAF_MAX
        : perceptualFromAmount(data.sodiumMgPer100g, COMPOSITION_TASTE_TAU.salty);
  }
  if (data.scoville != null) {
    taste.spicy = spicyFromScoville(data.scoville);
  }
  if (data.glutamateMgPer100g != null) {
    taste.umami = perceptualFromAmount(data.glutamateMgPer100g, COMPOSITION_TASTE_TAU.umami);
  }

  for (const dim of TASTE_DIMENSIONS) {
    const index = data[INDEX_KEY[dim]];
    if (typeof index === "number") taste[dim] = index;
  }

  return clampTaste(taste, TASTE_LEAF_MAX);
}
