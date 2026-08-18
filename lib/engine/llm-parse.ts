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
      taste: data.taste,
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
  const candidates = [trimmed];
  const extracted = extractJsonValue(trimmed);
  if (extracted && extracted !== trimmed) candidates.push(extracted);

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
      const repaired = repairTruncatedJson(candidate);
      if (repaired) {
        try {
          return JSON.parse(repaired) as T;
        } catch {
          // try the next candidate
        }
      }
    }
  }
  throw lastError;
}

function extractJsonValue(text: string): string | undefined {
  const startObject = text.indexOf("{");
  const startArray = text.indexOf("[");
  const start =
    startObject < 0
      ? startArray
      : startArray < 0
        ? startObject
        : Math.min(startObject, startArray);
  if (start < 0) return undefined;
  return text.slice(start);
}

/** Close an unterminated string and any open braces/brackets so a truncated Gemini payload can still parse. */
function repairTruncatedJson(text: string): string | undefined {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (const ch of text) {
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  if (!inString && stack.length === 0) return undefined;

  let repaired = text;
  if (escape) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "");
  while (stack.length) repaired += stack.pop();
  return repaired;
}
