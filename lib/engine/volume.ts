import type { IngredientQuantity, ProcessEffect } from "./types";

export type VolumeResult = {
  finalVolumeMl: number;
  concentrationMultiplier: number;
  solubleRetention: number;
};

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
  const starting = ingredients.reduce((sum, item) => sum + item.volumeMl, 0);
  return applyProcessEffects(starting || 1, effects).finalVolumeMl;
}
