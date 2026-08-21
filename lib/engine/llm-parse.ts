import type { CompositionData } from "./composition";
import { resolveRecipeVolumes } from "./quantity";
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
    mix?: {
      intensity?: number;
      scale?: Partial<TasteProfile>;
      why?: string;
    };
  }>;
  processes?: ProcessEffect[];
  cookingSteps?: string[];
};

export function parseIngredientRole(role: string | undefined): IngredientRole {
  return role?.trim().toLowerCase() === "out" ? "out" : "in";
}

function clampMixFactor(value: number | undefined, fallback: number): number {
  if (value == null || Number.isNaN(value)) return fallback;
  return Math.min(3, Math.max(0, value));
}

/** Keep at most two words for hover labels (marinade, cooking liquid). */
export function parseMixWhy(why: string | undefined): string | undefined {
  if (why == null || typeof why !== "string") return undefined;
  const words = why
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return undefined;
  return words.join(" ");
}

export function parseIngredientMix(
  mix:
    | { intensity?: number; scale?: Partial<TasteProfile>; why?: string }
    | undefined,
): { intensity?: number; scale?: Partial<TasteProfile>; why?: string } | undefined {
  if (!mix || typeof mix !== "object") return undefined;
  const scale = mix.scale
    ? {
        sweet: mix.scale.sweet != null ? clampMixFactor(mix.scale.sweet, 1) : undefined,
        sour: mix.scale.sour != null ? clampMixFactor(mix.scale.sour, 1) : undefined,
        salty: mix.scale.salty != null ? clampMixFactor(mix.scale.salty, 1) : undefined,
        spicy: mix.scale.spicy != null ? clampMixFactor(mix.scale.spicy, 1) : undefined,
        umami: mix.scale.umami != null ? clampMixFactor(mix.scale.umami, 1) : undefined,
        bitter: mix.scale.bitter != null ? clampMixFactor(mix.scale.bitter, 1) : undefined,
      }
    : undefined;
  const hasScale = Boolean(scale && Object.values(scale).some((value) => value != null));
  const why = parseMixWhy(mix.why);
  const intensity =
    mix.intensity != null ? clampMixFactor(mix.intensity, 1) : undefined;
  if (intensity == null && !hasScale && !why) return undefined;
  const parsed: {
    intensity?: number;
    scale?: Partial<TasteProfile>;
    why?: string;
  } = {};
  if (intensity != null) parsed.intensity = intensity;
  if (hasScale) parsed.scale = scale;
  if (why) parsed.why = why;
  return parsed;
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
  const raw = (data.ingredients ?? [])
    .filter((item) => item.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      amount: item.amount,
      unit: item.unit,
      role: parseIngredientRole(item.role),
      mix: parseIngredientMix(item.mix),
    }));
  if (!raw.length) return null;
  const volumes = resolveRecipeVolumes(raw);
  return {
    title: data.title,
    url: sourceUrl,
    ingredients: raw.map((item, index) => ({
      name: item.name,
      volumeMl: volumes[index]!,
      role: item.role,
      mix: item.mix,
    })),
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
