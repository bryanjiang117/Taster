import { normalizeIngredientName } from "./normalize";
import type { IngredientQuantity, Recipe, RepresentativeIngredient } from "./types";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function isInDish(ingredient: IngredientQuantity): boolean {
  return ingredient.role !== "out";
}

function recipeVolume(recipe: Recipe): number {
  if (recipe.finalVolumeMl && recipe.finalVolumeMl > 0) return recipe.finalVolumeMl;
  const sum = recipe.ingredients
    .filter(isInDish)
    .reduce((total, item) => total + item.volumeMl, 0);
  return sum || 1;
}

export function buildRepresentativeRecipe(
  recipes: Recipe[],
  targetFinalVolumeMl: number,
): { ingredients: RepresentativeIngredient[]; finalVolumeMl: number } {
  const total = recipes.length;
  const byName = new Map<string, number[]>();

  for (const recipe of recipes) {
    const volume = recipeVolume(recipe);
    const seen = new Set<string>();
    for (const ingredient of recipe.ingredients) {
      if (!isInDish(ingredient)) continue;
      const name = normalizeIngredientName(ingredient.name);
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const share = ingredient.volumeMl / volume;
      const list = byName.get(name) ?? [];
      list.push(share);
      byName.set(name, list);
    }
  }

  const maxUsed = Math.max(0, ...[...byName.values()].map((shares) => shares.length));
  const threshold = [...byName.values()].some((shares) => shares.length / total >= 0.5)
    ? 0.5
    : maxUsed / total;

  const ingredients: RepresentativeIngredient[] = [];
  for (const [name, shares] of byName) {
    const used = shares.length;
    if (used / total < threshold) continue;
    ingredients.push({
      name,
      volumeMl: median(shares) * targetFinalVolumeMl,
      occurrence: { used, total },
    });
  }

  ingredients.sort(
    (a, b) => b.volumeMl - a.volumeMl || b.occurrence.used - a.occurrence.used,
  );
  return { ingredients, finalVolumeMl: targetFinalVolumeMl };
}
