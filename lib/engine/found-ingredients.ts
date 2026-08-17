import { normalizeIngredientName } from "./normalize";
import type { IngredientStore } from "./store";
import { TASTE_DIMENSIONS, type TasteProfile } from "./taste";
import type { ConfidenceSource, IngredientQuantity, Recipe } from "./types";

export type FoundRecipeLink = {
  title: string;
  url: string;
};

export type FoundIngredient = {
  name: string;
  used: number;
  total: number;
  pending: boolean;
  flavors: string[];
  /** True when every recipe appearance is a side/serving item (role `out`). */
  out: boolean;
  taste?: TasteProfile;
  source?: ConfidenceSource;
  derivedFrom?: string[];
  processing?: string[];
  confidence?: number;
  recipes: FoundRecipeLink[];
};

export function flavorsFromTaste(taste: TasteProfile, min = 4): string[] {
  return TASTE_DIMENSIONS.filter((dim) => (taste[dim] ?? 0) >= min).sort(
    (a, b) => (taste[b] ?? 0) - (taste[a] ?? 0),
  );
}

function isInDish(ingredient: IngredientQuantity): boolean {
  return ingredient.role !== "out";
}

export function foundIngredientsFromRecipes(
  recipes: Recipe[],
  store: IngredientStore,
): FoundIngredient[] {
  const total = recipes.length;
  const used = new Map<string, number>();
  const inUsed = new Map<string, number>();
  const volumes = new Map<string, number[]>();
  const firstSeen = new Map<string, number>();
  const sources = new Map<string, FoundRecipeLink[]>();
  let nextOrder = 0;

  for (const [index, recipe] of recipes.entries()) {
    const link = recipeLink(recipe, index);
    const seen = new Set<string>();
    const seenIn = new Set<string>();
    for (const ingredient of recipe.ingredients) {
      const name = normalizeIngredientName(ingredient.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (!firstSeen.has(name)) firstSeen.set(name, nextOrder++);
      used.set(name, (used.get(name) ?? 0) + 1);
      const list = volumes.get(name) ?? [];
      list.push(ingredient.volumeMl);
      volumes.set(name, list);
      if (link) {
        const links = sources.get(name) ?? [];
        links.push(link);
        sources.set(name, links);
      }
    }
    for (const ingredient of recipe.ingredients) {
      if (!isInDish(ingredient)) continue;
      const name = normalizeIngredientName(ingredient.name);
      if (!name || seenIn.has(name)) continue;
      seenIn.add(name);
      inUsed.set(name, (inUsed.get(name) ?? 0) + 1);
    }
  }

  const items: FoundIngredient[] = [];
  for (const [name, count] of used) {
    const cached = store.get(name);
    items.push({
      name,
      used: count,
      total,
      pending: !cached,
      flavors: cached ? flavorsFromTaste(cached.taste) : [],
      out: (inUsed.get(name) ?? 0) === 0,
      taste: cached?.taste,
      source: cached?.source,
      derivedFrom: cached?.derivedFrom,
      processing: cached?.processing,
      confidence: cached?.confidence,
      recipes: sources.get(name) ?? [],
    });
  }

  items.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    const byUsed = b.used - a.used;
    if (byUsed !== 0) return byUsed;
    const byAmount = median(volumes.get(b.name) ?? []) - median(volumes.get(a.name) ?? []);
    if (byAmount !== 0) return byAmount;
    return (firstSeen.get(a.name) ?? 0) - (firstSeen.get(b.name) ?? 0);
  });
  return items;
}

/** Short footnote line for side/serving items that never enter the dish. */
export function accompanimentFootnote(items: FoundIngredient[]): string | null {
  const outs = items.filter((item) => item.out);
  if (!outs.length) return null;
  const parts = outs.map((item) => {
    const flavors = item.pending
      ? "tasting…"
      : item.flavors.length
        ? item.flavors.join(" · ")
        : "neutral";
    return `${item.name} · ${flavors}`;
  });
  return `Often served with ${parts.join("; ")}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function recipeLink(recipe: Recipe, index: number): FoundRecipeLink | null {
  if (!recipe.url) return null;
  const title = recipe.title?.trim();
  return { title: title || hostLabel(recipe.url) || `Recipe ${index + 1}`, url: recipe.url };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
