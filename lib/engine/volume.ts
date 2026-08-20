import type { IngredientMix, IngredientQuantity, ProcessEffect } from "./types";

export type VolumeResult = {
  finalVolumeMl: number;
  concentrationMultiplier: number;
  solubleRetention: number;
};

/** Volume that remains in the tasting. Intensity 0 (drained fry oil, pasta water) is 0. */
export function tastingVolumeMl(item: {
  volumeMl: number;
  role?: IngredientQuantity["role"];
  mix?: IngredientMix;
}): number {
  if (item.role === "out") return 0;
  const intensity = item.mix?.intensity ?? 1;
  const stay = Math.min(Math.max(intensity, 0), 1);
  return Math.max(0, item.volumeMl * stay);
}

export function tastingShareVolume(
  items: Array<{ volumeMl: number; role?: IngredientQuantity["role"]; mix?: IngredientMix }>,
  listedVolumeMl: number,
): number {
  const listed = items.reduce((sum, item) => sum + (item.role === "out" ? 0 : item.volumeMl), 0);
  const stay = items.reduce((sum, item) => sum + tastingVolumeMl(item), 0);
  if (listed <= 0) return Math.max(1, listedVolumeMl);
  return Math.max(1, listedVolumeMl * (stay / listed));
}

export function applyProcessEffects(
  startingVolumeMl: number,
  effects: ProcessEffect[],
): VolumeResult {
  let volume = startingVolumeMl;
  let solubleRetention = 1;

  for (const effect of effects) {
    if (effect.volumeDeltaMl) {
      volume += effect.volumeDeltaMl;
    }
    if (effect.type === "discard" && effect.discardedSolubleFraction) {
      solubleRetention *= 1 - effect.discardedSolubleFraction;
    }
    if (effect.type === "drying" && !effect.volumeDeltaMl) {
      volume *= 0.35;
    }
  }

  volume = Math.max(1, volume);
  const start = Math.max(1, startingVolumeMl);

  return {
    finalVolumeMl: volume,
    concentrationMultiplier: start / volume,
    solubleRetention,
  };
}

export function estimateFinalVolume(
  ingredients: IngredientQuantity[],
  effects: ProcessEffect[],
): number {
  const starting = ingredients.reduce((sum, item) => sum + tastingVolumeMl(item), 0);
  return applyProcessEffects(starting || 1, effects).finalVolumeMl;
}
