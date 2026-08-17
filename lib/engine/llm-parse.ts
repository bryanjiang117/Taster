import type { CompositionData } from "./composition";
import { quantityToMl } from "./quantity";
import type { UnknownLookup } from "./resolve";
import type { IngredientRole, ProcessEffect, Recipe, TasteProfile } from "./types";

export type IngredientLookupJson = {
  strategy?: "composition" | "decomposition" | "llm";
  composition?: CompositionData;
  parts?: Array<{ name: string; volumeMl: number }>;
  taste?: TasteProfile;
  processing?: string[];
  reasoning?: string;
};

export type RecipeExtractJson = {
  title?: string;
  ingredients?: Array<{
    name: string;
    amount?: number;
    unit?: string;
    role?: string;
  }>;
  processes?: ProcessEffect[];
  cookingSteps?: string[];
};

export function parseIngredientRole(role: string | undefined): IngredientRole {
  return role?.trim().toLowerCase() === "out" ? "out" : "in";
}

const EMPTY_TASTE: TasteProfile = {
  sweet: 0,
  sour: 0,
  salty: 0,
  spicy: 0,
  umami: 0,
  bitter: 0,
};

export function lookupFromModelJson(data: IngredientLookupJson): UnknownLookup {
  if (data.strategy === "composition" && data.composition) {
    return {
      kind: "composition",
      composition: data.composition,
      processing: data.processing,
    };
  }
  if (data.strategy === "decomposition" && data.parts?.length) {
    return {
      kind: "decomposition",
      parts: data.parts,
      processing: data.processing,
    };
  }
  return {
    kind: "llm",
    taste: data.taste ?? EMPTY_TASTE,
    processing: data.processing,
    reasoning: data.reasoning,
  };
}

export function recipeFromExtractJson(
  data: RecipeExtractJson,
  sourceUrl: string,
): Recipe | null {
  const ingredients = (data.ingredients ?? [])
    .filter((item) => item.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      volumeMl: quantityToMl(
        item.amount || 1,
        item.unit || "piece",
        item.name.trim(),
      ),
      role: parseIngredientRole(item.role),
    }));
  if (!ingredients.length) return null;
  return {
    title: data.title,
    url: sourceUrl,
    ingredients,
    processes: data.processes ?? [],
  };
}

export function parseJsonText<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as T;
}
