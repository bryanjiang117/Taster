import { normalizeIngredientName } from "./normalize";
import { TASTE_DIMENSIONS } from "./types";
import type {
  IngredientMix,
  IngredientQuantity,
  Recipe,
  RepresentativeIngredient,
  TasteProfile,
} from "./types";
import { tastingVolumeMl } from "./volume";

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
  const listed = recipe.ingredients
    .filter(isInDish)
    .reduce((total, item) => total + item.volumeMl, 0);
  const stay = recipe.ingredients
    .filter(isInDish)
    .reduce((total, item) => total + tastingVolumeMl(item), 0);
  const frac = listed > 0 ? stay / listed : 1;
  if (recipe.finalVolumeMl && recipe.finalVolumeMl > 0) {
    return Math.max(1, recipe.finalVolumeMl * frac);
  }
  return stay || 1;
}

type NameAcc = {
  shares: number[];
  intensities: number[];
  scales: Partial<TasteProfile>[];
};

function medianMix(acc: NameAcc): IngredientMix | undefined {
  const intensity = acc.intensities.length ? median(acc.intensities) : 1;
  const hasIntensity = intensity !== 1;
  const scale: Partial<TasteProfile> = {};
  let hasScale = false;
  for (const dim of TASTE_DIMENSIONS) {
    const values = acc.scales
      .map((row) => row[dim])
      .filter((value): value is number => value != null);
    if (!values.length) continue;
    scale[dim] = median(values);
    hasScale = true;
  }
  if (!hasIntensity && !hasScale) return undefined;
  return {
    intensity: hasIntensity ? intensity : undefined,
    scale: hasScale ? scale : undefined,
  };
}

export function buildRepresentativeRecipe(
  recipes: Recipe[],
  targetFinalVolumeMl: number,
): { ingredients: RepresentativeIngredient[]; finalVolumeMl: number } {
  const total = recipes.length;
  const byName = new Map<string, NameAcc>();

  for (const recipe of recipes) {
    const volume = recipeVolume(recipe);
    const seen = new Set<string>();
    for (const ingredient of recipe.ingredients) {
      if (!isInDish(ingredient)) continue;
      const name = normalizeIngredientName(ingredient.name);
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const share = tastingVolumeMl(ingredient) / volume;
      const list = byName.get(name) ?? { shares: [], intensities: [], scales: [] };
      list.shares.push(share);
      list.intensities.push(ingredient.mix?.intensity ?? 1);
      if (ingredient.mix?.scale) list.scales.push(ingredient.mix.scale);
      byName.set(name, list);
    }
  }

  const maxUsed = Math.max(0, ...[...byName.values()].map((acc) => acc.shares.length));
  const threshold = [...byName.values()].some((acc) => acc.shares.length / total >= 0.5)
    ? 0.5
    : maxUsed / total;

  const ingredients: RepresentativeIngredient[] = [];
  for (const [name, acc] of byName) {
    const used = acc.shares.length;
    if (used / total < threshold) continue;
    ingredients.push({
      name,
      volumeMl: median(acc.shares) * targetFinalVolumeMl,
      occurrence: { used, total },
      mix: medianMix(acc),
    });
  }

  ingredients.sort(
    (a, b) => b.volumeMl - a.volumeMl || b.occurrence.used - a.occurrence.used,
  );
  return { ingredients, finalVolumeMl: targetFinalVolumeMl };
}
