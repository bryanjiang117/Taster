import { emptyTaste, clampTaste } from "./taste";
import type { TasteProfile } from "./types";

export function effectiveFlavor(
  intrinsicTasteStrength: number,
  ingredientVolume: number,
  finalDishVolume: number,
): number {
  if (finalDishVolume <= 0) return 0;
  return intrinsicTasteStrength * (ingredientVolume / finalDishVolume);
}

export function weightedTasteFromIngredients(
  ingredients: Array<{ name?: string; volumeMl: number; taste: TasteProfile }>,
  finalVolumeMl: number,
): TasteProfile {
  const out = emptyTaste();
  if (finalVolumeMl <= 0) return out;

  for (const ingredient of ingredients) {
    const share = ingredient.volumeMl / finalVolumeMl;
    for (const dim of Object.keys(out) as Array<keyof TasteProfile>) {
      out[dim] += (ingredient.taste[dim] ?? 0) * share;
    }
  }

  return clampTaste(out);
}
