import { GoogleGenAI } from "@google/genai";
import {
  parseJsonText,
  recipeFromExtractJson,
  type RecipeExtractJson,
} from "./llm-parse";
import type { SearchMode } from "./dish-cache";
import { FAST_MODEL, needsSmartIngredient, shouldEscalateOrigin, SMART_MODEL } from "./models";
import type { SearchHit } from "./search";
import type { DishOrigin, Recipe, TasteProfile } from "./types";
import type { SourcePicks, SourceShortlist } from "./identity";

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
  /** Grocery/pantry staple vs something that needs its own recipe. */
  isCommonIngredient?(name: string): Promise<boolean>;
  /** Pick the matching shortlist index per chemistry source, or null. */
  confirmFoodShortlists?(
    query: string,
    shortlists: SourceShortlist[],
    context?: CulinaryContext,
  ): Promise<SourcePicks>;
  /** Adjust a chemistry draft; code ignores dimensions without evidence. */
  calibrateLeafTaste?(
    name: string,
    draft: TasteProfile,
  ): Promise<Partial<TasteProfile> | undefined>;
  /** Mouthful 0–10 when no chemistry source matched this exact grocery name. */
  estimateLeafTaste?(name: string): Promise<TasteProfile | undefined>;
  /** Unused by the pipeline. Allowed on test stubs. */
  lookupIngredient?(name: string): Promise<unknown>;
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
If it is the same food as an item in CATALOG, copy that catalog string exactly (cut, packing, and marketing copy do not make a new food). Do not upgrade a generic name to a different product just because the catalog is more specific (chili in som tam or mapo tofu is the hot pepper, never sweet chili sauce).
If it is a new food, invent a short singular English grocery name that preserves heat, fermentation, and form (thai chili, chili oil, fermented black bean, chili bean paste, msg).
Keep distinct foods distinct (green papaya ≠ papaya, juice ≠ the vegetable, chicken breast ≠ chicken, lime ≠ lemon, chili ≠ sweet chili, chili oil ≠ canola oil, chili bean paste ≠ chili with beans).
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
Convert quantities to numeric amount + unit (tsp, tbsp, cup, ml, g, lb, clove, pinch, piece). Prefer g or lb for meat and other large solids; use piece only for countable items. If a quantity is missing, still include the ingredient with name only.
Write each ingredient as exactly one singular English grocery food. Never list two foods in one ingredient.
For each ingredient set role to "in" or "out":
- "in" = mixed, cooked, marinated, or otherwise incorporated into the dish as served from the pot/pan/plate.
- "out" = side, garnish, dip, "for serving", lemon wedges on the side, bread, packaging, or anything not meant to flavor the cooked dish itself.
When unsure, use "in".
For each "in" ingredient, use culinary common sense about how THIS recipe treats it (bloomed in oil, drained, charred, fermented, reduced, crushed, raw, freshly cracked, etc.). Return mix.intensity (1 = the amount already implies the strength, 0 = none of it tastes in the bowl, >1 if concentrated into the dish) and mix.scale per-dimension multipliers only when prep changes that dimension. Freshly cracked black pepper is still not chili: scale spicy so the 0.2 leaf becomes ≈ 0.5. Do not output the dish's final 0-10 taste vector.
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
Convert quantities to numeric amount + unit (tsp, tbsp, cup, ml, g, lb, clove, pinch, piece). Prefer g or lb for meat and other large solids; use piece only for countable items. If a quantity is missing, still include the ingredient with name only.
Write each ingredient as exactly one singular English grocery food (soy sauce, tofu, green papaya). Never list two foods in one ingredient.
For each ingredient set role to "in" or "out":
- "in" = mixed, cooked, marinated, or otherwise incorporated into the dish as served from the pot/pan/plate.
- "out" = side, garnish, dip, "for serving", lemon wedges on the side, bread, packaging, or anything not meant to flavor the cooked dish itself.
When unsure, use "in".
For each "in" ingredient, use culinary common sense about how THIS recipe treats it (bloomed in oil, drained, charred, fermented, reduced, crushed, raw, freshly cracked, etc.). Return mix.intensity (1 = the amount already implies the strength, 0 = none of it tastes in the bowl, >1 if concentrated into the dish) and mix.scale per-dimension multipliers only when prep changes that dimension. Freshly cracked black pepper is still not chili: scale spicy so the 0.2 leaf becomes ≈ 0.5. Do not output the dish's final 0-10 taste vector.
Also list cookingSteps and estimate volume-changing processes (evaporation, absorption, expansion, discard, reduction, etc.) with volumeDeltaMl (negative when volume is lost).
URL: ${sourceUrl}`;
}

export function confirmFoodShortlistsPrompt(
  query: string,
  shortlists: SourceShortlist[],
  context?: CulinaryContext,
): string {
  const contextLine = culinaryContextLine(context);
  const lists = shortlists
    .map((list) => {
      const rows = list.hits
        .map((hit, index) => `  ${index}. ${JSON.stringify(hit.name)}`)
        .join("\n");
      return `${list.source}:\n${rows || "  (none)"}`;
    })
    .join("\n");
  return `For grocery ingredient ${JSON.stringify(query)}, pick the matching row in each database shortlist, or null.
${contextLine}
The title must be that ingredient (or the flavoring food inside a condiment: chili for chili oil). Accept a branded product only when it IS that ingredient (Kikkoman Soy Sauce for soy sauce). Reject keyword collisions, carrier foods, meals that merely contain the item, flavored variants unless the query is that variant, and the wrong plant part (chili oil ≠ canola oil or oil palm; chili bean paste ≠ canned chili with beans; wasabi soy ≠ soy sauce; chicken alfredo ≠ chicken).
Return JSON {"picks":{"usda":0,"foodb":null}} using 0-based indexes. Example: if usda row 1 is Chili oil, return "usda": 1.
QUERY: ${JSON.stringify(query)}
SHORTLISTS:
${lists}`;
}

export function isCommonIngredientPrompt(name: string): string {
  return `Is "${name}" a common grocery / pantry / recipe ingredient people buy as-is (carrot, salt, soy sauce, doubanjiang, black pepper, beef), not a prepared dish that needs its own recipe (pho, sofrito, homemade dashi)?
JSON {"common": true or false}`;
}

const LEAF_ANCHORS =
  "A 10 is the most intense culinary form of that taste: 10 salty = table salt; 10 sweet = sugar; 10 spicy = thai chili or habanero; 10 umami = fish sauce; 10 bitter = unsweetened espresso. Do not hand out 10s because a food is iconic — a spoon of a 10 seasons a whole bowl. Lemon or lime fruit ≈ 9 sour; lemon or lime juice ≈ 9.5 (not 10). Juice, paste, and extract score higher than the whole food (juice ≠ fruit; paste ≠ the vegetable). orange ≈ 7–8 sweet; onion ≈ 0–1 sweet; parmesan ≈ 7–8 salty; soy sauce / fish sauce / oyster sauce / miso ≈ 8.5–10 salty. black pepper ≈ 0.2 spicy (freshly cracked ≈ 0.5). Spicy is chili heat only (capsaicin): ginger, garlic, onion, mustard, horseradish, wasabi, and Sichuan peppercorn are 0 spicy. Black pepper is not chili — 0.2 is the ceiling unless freshly cracked (~0.5). Salty and umami are different: a sauce can be both very salty and very umami. Do not lower salty to 'make room' for umami or because the food tastes savory/balanced.";

export function calibrateLeafPrompt(name: string, draft: TasteProfile): string {
  return `Calibrate this chemistry draft for a mouthful of "${name}".
The DRAFT numbers already come from measured compounds (sodium → salty, sugars → sweet, and so on). Your job is a mouthful of THIS ingredient alone, not a finished dish and not a milder version of the food.
You may change a dimension only when the draft already has signal there (lab compounds), except sour and umami: nutrient tables often omit organic acids and free glutamate. You may add those when they define this ingredient and other measured nutrients exist. Do not invent salty/bitter/sweet-as-sugar from nothing, and do not invent chili heat for pungent foods. Potassium and hydrolyzed amino acids are not salt or umami. Bland vegetables stay near 0 (a trace of sweet is ok). Score the named form: citrus juice is more sour than the whole fruit. A paste of a sour fruit stays that fruit, not a tomato sauce. Hot chili peppers (Thai bird's eye, cayenne, habanero) are very spicy; sweet chili sauce is sweet. Raw seafood (squid, crab, shrimp, fish) has moderate umami from nucleotides even when tables only show sodium — calibrate roughly 2–4 umami for plain raw seafood, not 6+. Ginger is pungent, not chili-spicy — spicy stays 0. Garlic, mustard, and Sichuan peppercorn are also 0 spicy. MSG is high umami. Chili oil is chili heat, not canola oil.
If the draft is already high in salty, that is the sodium in a spoon of this food — keep it high unless the named food is actually low-sodium. Fermented sauces (soy, fish sauce, oyster sauce, miso, doubanjiang) taste strongly salty; umami does not replace that salt.
${LEAF_ANCHORS}
Return taste 0-10. Do not output a finished dish profile.
DRAFT: ${JSON.stringify(draft)}`;
}

export function estimateLeafPrompt(name: string): string {
  return `Estimate a mouthful of grocery ingredient ${JSON.stringify(name)}. No lab table matched this exact name.
Score THIS food, not a parent category or a dish that uses it (thai chili ≠ chili; chili ≠ sweet chili sauce; soft shell crab ≠ crab cakes or fried batter; chicken breast ≠ chicken). Score the named form: juice and paste are stronger than the whole food.
Bland vegetables stay near 0 (a trace of sweet is ok). Hot chili peppers are very spicy. Ginger, garlic, mustard, horseradish, wasabi, and Sichuan peppercorn are 0 spicy. Soy, fish sauce, oyster sauce, and miso are very salty (8.5–10). Raw seafood has moderate umami (~2–4), not high. MSG is high umami. Chili oil is chili heat, not canola oil.
${LEAF_ANCHORS}
Return taste 0-10 for this ingredient alone. Do not output a finished dish profile.
INGREDIENT: ${JSON.stringify(name)}`;
}

export const SYSTEM =
  "You extract structured culinary data as JSON. Never invent a dish's final taste scores. Search native-language recipes for authentic versions, or the user's typed language for internationalized versions, as the task specifies. Leaf ingredient scores start from measured compounds; you may calibrate perception, and may estimate a grocery mouthful only when no lab source matched that exact name.";

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
          mix: {
            type: "object",
            properties: {
              intensity: { type: "number" },
              scale: {
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
            },
          },
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

const SHORTLIST_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "object",
      properties: {
        umami: { type: ["integer", "null"] },
        phenol: { type: ["integer", "null"] },
        duke: { type: ["integer", "null"] },
        foodb: { type: ["integer", "null"] },
        fct: { type: ["integer", "null"] },
        usda: { type: ["integer", "null"] },
      },
    },
  },
  required: ["picks"],
};

const COMMON_INGREDIENT_SCHEMA = {
  type: "object",
  properties: {
    common: { type: "boolean" },
  },
  required: ["common"],
};

const CALIBRATE_SCHEMA = {
  type: "object",
  properties: {
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
  },
  required: ["taste"],
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

  async isCommonIngredient(name: string): Promise<boolean> {
    const data = await this.json<{ common: boolean }>(
      FAST_MODEL,
      isCommonIngredientPrompt(name),
      COMMON_INGREDIENT_SCHEMA,
    );
    return Boolean(data.common);
  }

  async confirmFoodShortlists(
    query: string,
    shortlists: SourceShortlist[],
    context?: CulinaryContext,
  ): Promise<SourcePicks> {
    const data = await this.json<{ picks?: SourcePicks }>(
      FAST_MODEL,
      confirmFoodShortlistsPrompt(query, shortlists, context),
      SHORTLIST_SCHEMA,
    );
    return data.picks ?? {};
  }

  async calibrateLeafTaste(
    name: string,
    draft: TasteProfile,
  ): Promise<Partial<TasteProfile> | undefined> {
    const model = needsSmartIngredient(name) ? SMART_MODEL : FAST_MODEL;
    const data = await this.json<{ taste?: TasteProfile }>(
      model,
      calibrateLeafPrompt(name, draft),
      CALIBRATE_SCHEMA,
    );
    return data.taste;
  }

  async estimateLeafTaste(name: string): Promise<TasteProfile | undefined> {
    const model = needsSmartIngredient(name) ? SMART_MODEL : FAST_MODEL;
    const data = await this.json<{ taste?: TasteProfile }>(
      model,
      estimateLeafPrompt(name),
      CALIBRATE_SCHEMA,
    );
    return data.taste;
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
