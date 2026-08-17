import { normalizeIngredientName } from "./normalize";
import type { Recipe } from "./types";

export function isLatinIngredientName(name: string): boolean {
  const cleaned = normalizeIngredientName(name);
  return cleaned.length > 0 && /^[\p{Script=Latin}\p{N}\s-]+$/u.test(cleaned);
}

export function applyEnglishNames(
  recipes: Recipe[],
  map: Record<string, string>,
): Recipe[] {
  return recipes.map((recipe) => ({
    ...recipe,
    ingredients: recipe.ingredients.flatMap((ingredient) => {
      const mapped =
        map[ingredient.name] ??
        map[normalizeIngredientName(ingredient.name)] ??
        ingredient.name;
      const parts = splitMappedNames(mapped);
      const volumeMl = ingredient.volumeMl / parts.length;
      return parts.map((part) => ({
        ...ingredient,
        name: normalizeIngredientName(part) || part,
        volumeMl,
      }));
    }),
  }));
}

/** LLM `to` fields may list several singular foods, comma-separated. */
export function splitMappedNames(name: string): string[] {
  const parts = name
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [name.trim()].filter(Boolean);
}

export function uniqueIngredientNames(recipes: Recipe[]): string[] {
  const names = new Set<string>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const name = ingredient.name.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}
