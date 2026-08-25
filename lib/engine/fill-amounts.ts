import { normalizeIngredientName } from "./normalize";
import { resolveRecipeVolumes, type RawQuantity } from "./quantity";
import type { Recipe } from "./types";

export type MissingAmountEstimate = {
  recipeIndex: number;
  ingredient: string;
  amount: number;
  unit: string;
};

const SIBLING_CLAMP_LO = 0.25;
const SIBLING_CLAMP_HI = 4;

export function recipesHaveMissingAmounts(recipes: Recipe[]): boolean {
  return recipes.some((recipe) =>
    recipe.ingredients.some(
      (item) => item.quantityAmbiguous && item.role !== "out",
    ),
  );
}

export function applyMissingAmountEstimates(
  recipes: Recipe[],
  estimates: MissingAmountEstimate[],
): Recipe[] {
  if (!estimates.length) return recipes;

  const measuredByName = measuredVolumesByName(recipes);
  const next = recipes.map((recipe, recipeIndex) => {
    const fills = estimates.filter((row) => row.recipeIndex === recipeIndex);
    if (!fills.length) return recipe;
    const ingredients = recipe.ingredients.map((item) => {
      if (!item.quantityAmbiguous || item.role === "out") return item;
      const fill = fills.find(
        (row) =>
          normalizeIngredientName(row.ingredient) ===
          normalizeIngredientName(item.name),
      );
      if (!fill || !(fill.amount > 0) || !fill.unit?.trim()) return item;
      return {
        ...item,
        amount: fill.amount,
        unit: fill.unit.trim(),
        quantityAmbiguous: undefined,
      };
    });
    return recomputeRecipeVolumes({ ...recipe, ingredients });
  });

  return clampFilledToSiblings(next, recipes, measuredByName);
}

function measuredVolumesByName(recipes: Recipe[]): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  for (const recipe of recipes) {
    for (const item of recipe.ingredients) {
      if (item.quantityAmbiguous || item.role === "out") continue;
      const name = normalizeIngredientName(item.name);
      if (!name || item.volumeMl <= 0) continue;
      const list = byName.get(name) ?? [];
      list.push(item.volumeMl);
      byName.set(name, list);
    }
  }
  return byName;
}

function clampFilledToSiblings(
  filled: Recipe[],
  original: Recipe[],
  measuredByName: Map<string, number[]>,
): Recipe[] {
  return filled.map((recipe, recipeIndex) => ({
    ...recipe,
    ingredients: recipe.ingredients.map((item, ingredientIndex) => {
      const before = original[recipeIndex]?.ingredients[ingredientIndex];
      if (!before?.quantityAmbiguous || item.quantityAmbiguous) return item;
      const siblings = measuredByName.get(normalizeIngredientName(item.name));
      if (!siblings?.length) return item;
      const mid = median(siblings);
      const volumeMl = Math.min(
        mid * SIBLING_CLAMP_HI,
        Math.max(mid * SIBLING_CLAMP_LO, item.volumeMl),
      );
      return volumeMl === item.volumeMl ? item : { ...item, volumeMl };
    }),
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function recomputeRecipeVolumes(recipe: Recipe): Recipe {
  const raw: RawQuantity[] = recipe.ingredients.map((item) =>
    item.quantityAmbiguous
      ? { name: item.name }
      : { name: item.name, amount: item.amount, unit: item.unit },
  );
  const volumes = resolveRecipeVolumes(raw);
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((item, index) => ({
      ...item,
      volumeMl: volumes[index]!,
    })),
  };
}
