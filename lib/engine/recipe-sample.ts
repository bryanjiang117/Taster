import { combineRecipeTaste } from "./combine";
import { normalizeIngredientName } from "./normalize";
import { emptyTaste, TASTE_DIMENSIONS, type TasteProfile } from "./taste";
import type { IngredientStore } from "./store";
import type { Recipe } from "./types";

export const MIN_RECIPES = 3;
export const MAX_RECIPES = 7;
export const MIN_EXTRACT_INGREDIENTS = 2;

/** Mean pairwise L2 of 0–10 taste vectors, scaled so ~10 is “very inconsistent”. */
export function flavorInconsistency(profiles: TasteProfile[]): number {
  if (profiles.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      total += distance(profiles[i]!, profiles[j]!);
      pairs += 1;
    }
  }
  return Math.min(1, total / pairs / 10);
}

export function recipesNeeded(inconsistency: number): number {
  const t = Math.min(1, Math.max(0, inconsistency));
  return Math.round(MIN_RECIPES + (MAX_RECIPES - MIN_RECIPES) * t);
}

export function tasteOfRecipe(recipe: Recipe, store: IngredientStore): TasteProfile {
  const ingredients = recipe.ingredients
    .filter((item) => item.role !== "out")
    .map((item) => ({
      volumeMl: item.volumeMl,
      taste: store.get(normalizeIngredientName(item.name))?.taste ?? emptyTaste(),
      mix: item.mix,
    }));
  const listed = ingredients.reduce((sum, item) => sum + item.volumeMl, 0) || 1;
  const volume =
    recipe.finalVolumeMl && recipe.finalVolumeMl > 0
      ? recipe.finalVolumeMl
      : listed;
  return combineRecipeTaste(ingredients, volume);
}

function distance(a: TasteProfile, b: TasteProfile): number {
  let sum = 0;
  for (const dim of TASTE_DIMENSIONS) {
    const d = (a[dim] ?? 0) - (b[dim] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
