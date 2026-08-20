import { normalizeIngredientName } from "./normalize";
import type { IngredientMix, IngredientQuantity, Recipe } from "./types";

const BULK_OIL_SHARE = 0.12;

/** Finishing / flavor oils stay in the bowl even when the listed amount is large. */
const FLAVOR_OIL =
  /\b(chili|sesame|truffle|olive|walnut|pumpkin seed|chili crisp|chile)\s+oil\b/;

/** Neutral fry/poach oil that is normally drained — not the served dish. */
const NEUTRAL_OIL =
  /\b(vegetable|canola|peanut|sunflower|corn|grapeseed|rapeseed|neutral|cooking|deep.?fry)\s+oil\b|^oil$/;

export function isBulkNeutralCookingOil(name: string): boolean {
  const n = normalizeIngredientName(name);
  if (!n) return false;
  if (FLAVOR_OIL.test(n)) return false;
  return NEUTRAL_OIL.test(n);
}

/** Infer mix.intensity when extract omitted prep. Bulk drained fry oil → 0. */
export function inferDiscardedCookingMedium(
  ingredient: IngredientQuantity,
  recipeVolumeMl: number,
): IngredientMix | undefined {
  const existing = ingredient.mix;
  if (existing?.intensity === 0) return existing;
  // Respect explicit concentration (>1) or non-default intensity choices.
  if (existing?.intensity != null && existing.intensity !== 1) return existing;

  if (ingredient.role === "out" || recipeVolumeMl <= 0) return existing;

  const share = ingredient.volumeMl / recipeVolumeMl;
  if (share < BULK_OIL_SHARE) return existing;

  if (isBulkNeutralCookingOil(ingredient.name)) {
    return { ...existing, intensity: 0 };
  }

  return existing;
}

function recipeListedVolume(recipe: Recipe): number {
  return (
    recipe.ingredients
      .filter((item) => item.role !== "out")
      .reduce((sum, item) => sum + item.volumeMl, 0) || 1
  );
}

export function applyPrepMixHeuristics(recipes: Recipe[]): Recipe[] {
  return recipes.map((recipe) => {
    const volume = recipeListedVolume(recipe);
    return {
      ...recipe,
      ingredients: recipe.ingredients.map((item) => {
        const mix = inferDiscardedCookingMedium(item, volume);
        return mix ? { ...item, mix } : item;
      }),
    };
  });
}
