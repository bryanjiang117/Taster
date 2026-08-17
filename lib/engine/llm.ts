import { GoogleGenAI } from "@google/genai";
import {
  lookupFromModelJson,
  parseJsonText,
  recipeFromExtractJson,
  type IngredientLookupJson,
  type RecipeExtractJson,
} from "./llm-parse";
import type { SearchMode } from "./dish-cache";
import { FAST_MODEL, needsSmartIngredient, shouldEscalateOrigin, SMART_MODEL } from "./models";
import type { UnknownLookup } from "./resolve";
import type { SearchHit } from "./search";
import type { DishOrigin, Recipe } from "./types";

export type IdentifyDishOptions = {
  searchMode?: SearchMode;
};

/** Dish identity plus cuisine, so naming can use culinary context not dictionary English. */
export type CulinaryContext = {
  dish: string;
  nativeName: string;
  culture?: string;
  country?: string;
  language?: string;
};

export type TasteInputClassification =
  | { kind: "dish" }
  | { kind: "ingredient"; name: string }
  | { kind: "reject"; reason: string };

export interface LlmClient {
  /** Gate: prepared dish, singular ingredient, or reject (brands / gibberish). */
  classifyTasteInput?(query: string): Promise<TasteInputClassification>;
  identifyDish(dish: string, options?: IdentifyDishOptions): Promise<DishOrigin>;
  matchDish?(
    query: string,
    candidates: Array<{ canonicalName: string; aliases: string[] }>,
  ): Promise<string | null>;
  extractRecipe(
    pageText: string,
    sourceUrl: string,
    target?: CulinaryContext,
  ): Promise<Recipe | null>;
  extractRecipeFromUrl?(sourceUrl: string, target?: CulinaryContext): Promise<Recipe | null>;
  canonicalizeIngredientNames?(
    names: string[],
    catalog?: string[],
    context?: CulinaryContext,
  ): Promise<Record<string, string>>;
  lookupIngredient(name: string): Promise<UnknownLookup>;
}

export function classifyTasteInputPrompt(query: string): string {
  return `Classify this taste-profile query.
Accept only:
- "dish": a prepared food or drink people cook or order (pad thai, ceviche, latte, chocolate cake).
- "ingredient": a singular grocery food or cooking ingredient (lime, salt, chicken breast, fish sauce).
Reject brands, product SKUs, random/gibberish text, sentences, URLs, and non-food.
For ingredient, return a short singular English grocery name in "name".
For reject, give a short "reason".
QUERY: ${JSON.stringify(query)}`;
}

export function culinaryContextFromOrigin(origin: DishOrigin): CulinaryContext {
  return {
    dish: origin.dish,
    nativeName: origin.nativeName,
    culture: origin.culture,
    country: origin.country,
    language: origin.language,
  };
}

export function culinaryContextLine(context?: CulinaryContext): string {
  if (!context?.dish) return "";
  const native = context.nativeName ? ` (native: ${context.nativeName})` : "";
  const cuisine = [context.culture, context.country].filter(Boolean).join(", ");
  const language = context.language ? ` Language: ${context.language}.` : "";
  return `DISH: ${context.dish}${native}.${cuisine ? ` Cuisine: ${cuisine}.` : ""}${language}
Name ingredients using this dish's culinary context, not dictionary English. Regional false friends must map to the food actually used in this cuisine (Latin American Spanish "limón" in ceviche is lime, not lemon). If the catalog has both a dictionary match and the cuisine's food, prefer the cuisine's food when the source name is ambiguous.`;
}

export function canonicalizeIngredientNamesPrompt(
  names: string[],
  catalog: string[],
  context?: CulinaryContext,
): string {
  const contextLine = culinaryContextLine(context);
  return `Normalize each extracted ingredient.
${contextLine}
Each mapping's "to" must be one singular short English grocery name, or a comma-separated list if the extracted line is multiple foods.
If it is the same food as an item in CATALOG, copy that catalog string exactly (cut, packing, and marketing copy do not make a new food). Prefer the most specific catalog match.
If it is a new food, invent a short singular grocery name.
Keep distinct foods distinct (green papaya ≠ papaya, juice ≠ the vegetable, chicken breast ≠ chicken, lime ≠ lemon).
JSON {"mappings":[{"from":"...","to":"..."}]}
NAMES: ${JSON.stringify(names)}
CATALOG: ${JSON.stringify(catalog)}`;
}

function preferTargetDishLine(context?: CulinaryContext): string {
  if (!context?.dish) return "";
  return `Prefer ${context.dish} if several dishes appear. Romanized spellings of the same dish still count. Extract the recipe; do not return empty ingredients just because the title spelling differs.`;
}

export function recipeExtractPrompt(
  pageText: string,
  sourceUrl: string,
  context?: CulinaryContext,
): string {
  return `Extract a cooking recipe from this page text. If it is not a recipe, return {"ingredients":[]}.
${culinaryContextLine(context)}
${preferTargetDishLine(context)}
Convert quantities to numeric amount + unit. If a quantity is missing, still include the ingredient with name only.
Write each ingredient as exactly one singular English grocery food. Never list two foods in one ingredient.
For each ingredient set role to "in" or "out":
- "in" = mixed, cooked, marinated, or otherwise incorporated into the dish as served from the pot/pan/plate.
- "out" = side, garnish, dip, "for serving", lemon wedges on the side, bread, packaging, or anything not meant to flavor the cooked dish itself.
When unsure, use "in".
Estimate cooking process volume effects in ml (negative for evaporation/discard/absorption).
SOURCE: ${sourceUrl}
TEXT: ${pageText.slice(0, 9000)}`;
}

export function recipeExtractFromUrlPrompt(
  sourceUrl: string,
  context?: CulinaryContext,
): string {
  return `Read this recipe URL and extract the recipe. If it is not a recipe, return {"ingredients":[]}.
${culinaryContextLine(context)}
${preferTargetDishLine(context)}
Convert quantities to numeric amount + unit (tsp, tbsp, cup, ml, g, clove, pinch, piece). If a quantity is missing, still include the ingredient with name only.
Write each ingredient as exactly one singular English grocery food (soy sauce, tofu, green papaya). Never list two foods in one ingredient.
For each ingredient set role to "in" or "out":
- "in" = mixed, cooked, marinated, or otherwise incorporated into the dish as served from the pot/pan/plate.
- "out" = side, garnish, dip, "for serving", lemon wedges on the side, bread, packaging, or anything not meant to flavor the cooked dish itself.
When unsure, use "in".
Also list cookingSteps and estimate volume-changing processes (evaporation, absorption, expansion, discard, reduction, etc.) with volumeDeltaMl (negative when volume is lost).
URL: ${sourceUrl}`;
}

export function ingredientLookupPrompt(name: string): string {
  return `Resolve culinary ingredient "${name}".
Prefer composition data (sodium, sugar, pH, glutamate, scoville).
Only include pH when the food is perceptibly acidic (citrus, vinegar, tomato, yogurt). Typical spice/meat/vegetable pH 5–6.5 is not sour — omit pH then.
If unavailable, decompose into typical recipe parts with volumeMl totaling 100.
Last resort: estimate taste 0-10 on sweet,sour,salty,spicy,umami,bitter.
Use culinary common sense. 10 is the everyday ceiling, not a theoretical lab acid: 10 sour = lemon or lime (juice), 10 salty = table salt, 10 sweet = sugar, 10 spicy = habanero-class heat, 10 umami = fish sauce. Do not hedge — if it tastes like the reference, score 10. Lemon and lime are not 8 or 9. Milder acids (tomato, yogurt, tamarind pulp) sit lower. Rice vinegar is milder than lemon; distilled vinegar can match it.
Do not output a finished dish taste profile.`;
}

export const SYSTEM =
  "You extract structured culinary data as JSON. Never invent a dish's final taste scores. Search native-language recipes for authentic versions, or the user's typed language for internationalized versions, as the task specifies. Prefer measurable composition or ingredient decomposition over guessing taste numbers.";

export function geminiJsonRequest(
  model: string,
  input: string,
  schema: Record<string, unknown>,
  tools?: Array<{ type: "google_search" } | { type: "url_context" }>,
) {
  return {
    model,
    input,
    system_instruction: SYSTEM,
    stream: false as const,
    response_format: {
      type: "text" as const,
      mime_type: "application/json",
      schema,
    },
    ...(tools ? { tools } : {}),
  };
}

const ORIGIN_SCHEMA = {
  type: "object",
  properties: {
    country: { type: "string" },
    culture: { type: "string" },
    nativeName: { type: "string" },
    language: { type: "string" },
    languageCode: { type: "string" },
    searchQueries: { type: "array", items: { type: "string" } },
  },
  required: [
    "country",
    "culture",
    "nativeName",
    "language",
    "languageCode",
    "searchQueries",
  ],
};

const MATCH_DISH_SCHEMA = {
  type: "object",
  properties: {
    canonicalName: { type: "string" },
  },
  required: ["canonicalName"],
};

const CLASSIFY_TASTE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["dish", "ingredient", "reject"] },
    name: { type: "string" },
    reason: { type: "string" },
  },
  required: ["kind"],
};

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["results"],
};

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
          role: { type: "string", enum: ["in", "out"] },
        },
        required: ["name", "role"],
      },
    },
    cookingSteps: { type: "array", items: { type: "string" } },
    processes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          volumeDeltaMl: { type: "number" },
          discardedSolubleFraction: { type: "number" },
        },
        required: ["type"],
      },
    },
  },
  required: ["ingredients"],
};

const NAME_SCHEMA = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
    },
  },
  required: ["mappings"],
};

const INGREDIENT_SCHEMA = {
  type: "object",
  properties: {
    strategy: { type: "string" },
    composition: {
      type: "object",
      properties: {
        sodiumMgPer100g: { type: "number" },
        sugarGPer100g: { type: "number" },
        pH: { type: "number" },
        glutamateMgPer100g: { type: "number" },
        scoville: { type: "number" },
        bitterIndex: { type: "number" },
      },
    },
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          volumeMl: { type: "number" },
        },
        required: ["name", "volumeMl"],
      },
    },
    taste: {
      type: "object",
      properties: {
        sweet: { type: "number" },
        sour: { type: "number" },
        salty: { type: "number" },
        spicy: { type: "number" },
        umami: { type: "number" },
        bitter: { type: "number" },
      },
    },
    processing: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: ["strategy"],
};

export class GeminiLlm implements LlmClient {
  private client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async classifyTasteInput(query: string): Promise<TasteInputClassification> {
    const data = await this.json<{
      kind: string;
      name?: string;
      reason?: string;
    }>(FAST_MODEL, classifyTasteInputPrompt(query), CLASSIFY_TASTE_INPUT_SCHEMA);
    const kind = data.kind?.trim().toLowerCase();
    if (kind === "ingredient") {
      const name = data.name?.trim() || query.trim();
      return { kind: "ingredient", name };
    }
    if (kind === "reject") {
      return {
        kind: "reject",
        reason: data.reason?.trim() || "not a dish or ingredient",
      };
    }
    return { kind: "dish" };
  }

  async identifyDish(dish: string, options?: IdentifyDishOptions): Promise<DishOrigin> {
    const typed = options?.searchMode === "typed";
    const prompt = typed
      ? `Identify the culinary origin of "${dish}".
Return country, culture, nativeName in the origin language (e.g. Mapo tofu → 麻婆豆腐), language, languageCode, and 3 web queries in the SAME language and script the user typed.
These queries should find the internationalized / diaspora version of the dish as commonly cooked from recipes in that language, not necessarily the most authentic home-country version.
Each query MUST include the user's dish name plus a recipe word in that language (e.g. recipe, recette, receta).
Use at least one unquoted query. You may include one quoted exact-name query.
Do not switch the queries into the origin language unless the user already typed in that language.
Do not use generic cuisine queries.`
      : `Identify the culinary origin of "${dish}".
Return country, culture, nativeName in the origin language (e.g. Mapo tofu → 麻婆豆腐), language, languageCode, and 3 native-language web queries.
Each query MUST include the native dish name plus a recipe word.
Use at least one unquoted query so search can match title variants, e.g. 麻婆豆腐 食谱, 麻婆豆腐 做法.
You may also include one quoted exact-name query.
Do not use generic cuisine queries (川菜, 家常菜, Chinese food). Goal: authentic home-country recipes.`;
    let data = await this.json<Omit<DishOrigin, "dish">>(FAST_MODEL, prompt, ORIGIN_SCHEMA);
    const origin = { dish, ...data };
    if (shouldEscalateOrigin(origin)) {
      data = await this.json<Omit<DishOrigin, "dish">>(SMART_MODEL, prompt, ORIGIN_SCHEMA);
      return { dish, ...data };
    }
    return origin;
  }

  async matchDish(
    query: string,
    candidates: Array<{ canonicalName: string; aliases: string[] }>,
  ): Promise<string | null> {
    if (candidates.length === 0) return null;
    const data = await this.json<{ canonicalName: string | null }>(
      FAST_MODEL,
      `Match this user dish query to one cached dish if it is the same dish (native name, romanization, or alias).
If none match, return {"canonicalName":""}. Do not pick a related or similar dish.
QUERY: ${query}
CANDIDATES: ${JSON.stringify(candidates)}`,
      MATCH_DISH_SCHEMA,
    );
    const name = data.canonicalName?.trim();
    if (!name || name.toLowerCase() === "null") return null;
    const allowed = new Set(
      candidates.map((row) => row.canonicalName.trim().toLowerCase()),
    );
    return allowed.has(name.toLowerCase()) ? name : null;
  }

  async searchRecipePages(query: string): Promise<SearchHit[]> {
    const data = await this.json<{ results: SearchHit[] }>(
      FAST_MODEL,
      `Search Google for recipe pages for THIS exact dish query only.
Return at least 5 and up to 8 unique recipe URLs. Never return only one page.
Titles must be recipes for that dish, not related dishes, roundups, or "you may also like" items from the same cuisine.
Reject collection pages and other recipes even if they share a language or website.
Query: ${query}`,
      SEARCH_SCHEMA,
      [{ type: "google_search" }],
    );
    return (data.results ?? []).filter((hit) => hit.url);
  }

  async extractRecipeFromUrl(
    sourceUrl: string,
    target?: CulinaryContext,
  ): Promise<Recipe | null> {
    const data = await this.json<RecipeExtractJson>(
      FAST_MODEL,
      recipeExtractFromUrlPrompt(sourceUrl, target),
      RECIPE_SCHEMA,
      [{ type: "url_context" }],
    );
    return recipeFromExtractJson(data, sourceUrl);
  }

  async extractRecipe(
    pageText: string,
    sourceUrl: string,
    target?: CulinaryContext,
  ): Promise<Recipe | null> {
    const data = await this.json<RecipeExtractJson>(
      FAST_MODEL,
      recipeExtractPrompt(pageText, sourceUrl, target),
      RECIPE_SCHEMA,
    );
    return recipeFromExtractJson(data, sourceUrl);
  }

  async canonicalizeIngredientNames(
    names: string[],
    catalog: string[] = [],
    context?: CulinaryContext,
  ): Promise<Record<string, string>> {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (unique.length === 0) return {};
    const data = await this.json<{ mappings: Array<{ from: string; to: string }> }>(
      FAST_MODEL,
      canonicalizeIngredientNamesPrompt(unique, catalog, context),
      NAME_SCHEMA,
    );
    return mappingsFromJson(data);
  }

  async lookupIngredient(name: string): Promise<UnknownLookup> {
    const firstModel = needsSmartIngredient(name) ? SMART_MODEL : FAST_MODEL;
    let result = await this.lookupWith(name, firstModel);
    if (result.kind === "llm" && firstModel === FAST_MODEL) {
      result = await this.lookupWith(name, SMART_MODEL);
    }
    return result;
  }

  private async lookupWith(name: string, model: string): Promise<UnknownLookup> {
    const data = await this.json<IngredientLookupJson>(
      model,
      ingredientLookupPrompt(name),
      INGREDIENT_SCHEMA,
    );
    return lookupFromModelJson(data);
  }

  private async json<T>(
    model: string,
    input: string,
    schema: Record<string, unknown>,
    tools?: Array<{ type: "google_search" } | { type: "url_context" }>,
  ): Promise<T> {
    const interaction = await this.client.interactions.create(
      geminiJsonRequest(model, input, schema, tools),
    );
    const text = textFromInteraction(interaction);
    if (!text) throw new Error("Empty Gemini response");
    return parseJsonText<T>(text);
  }
}

function textFromInteraction(interaction: unknown): string {
  if (!interaction || typeof interaction !== "object") return "";
  const record = interaction as {
    output_text?: string;
    outputs?: Array<{ type?: string; text?: string }>;
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (record.output_text) return record.output_text;
  const fromOutputs = (record.outputs ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
  if (fromOutputs.trim()) return fromOutputs.trim();
  return (record.steps ?? [])
    .flatMap((step) => step.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function mappingsFromJson(data: {
  mappings?: Array<{ from: string; to: string }>;
}): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of data.mappings ?? []) {
    if (row.from && row.to) map[row.from] = row.to;
  }
  return map;
}

export class GeminiSearch {
  constructor(private readonly llm: GeminiLlm) {}

  search(query: string): Promise<SearchHit[]> {
    return this.llm.searchRecipePages(query);
  }
}
