import { clampTaste, emptyTaste } from "./taste";
import type { TasteProfile } from "./types";

export type CompositionData = {
  sodiumMgPer100g?: number;
  sugarGPer100g?: number;
  pH?: number;
  glutamateMgPer100g?: number;
  scoville?: number;
  bitterIndex?: number;
};

export function tasteFromComposition(data: CompositionData): TasteProfile {
  const taste = emptyTaste();

  if (data.sodiumMgPer100g != null) {
    taste.salty = (data.sodiumMgPer100g / 4000) * 10;
  }
  if (data.sugarGPer100g != null) {
    taste.sweet = (data.sugarGPer100g / 80) * 10;
  }
  if (data.pH != null) {
    // Typical foods sit at pH 5–6.5 without tasting sour. Map only below that.
    const sourPhNeutral = 5.5;
    const sourPhMax = 2.3;
    taste.sour =
      data.pH >= sourPhNeutral
        ? 0
        : ((sourPhNeutral - data.pH) / (sourPhNeutral - sourPhMax)) * 10;
  }
  if (data.glutamateMgPer100g != null) {
    taste.umami = (data.glutamateMgPer100g / 1500) * 10;
  }
  if (data.scoville != null) {
    const num = Math.log10(1 + data.scoville);
    const den = Math.log10(1 + 1_000_000);
    taste.spicy = (num / den) * 10;
  }
  if (data.bitterIndex != null) {
    taste.bitter = data.bitterIndex;
  }

  return clampTaste(taste);
}
