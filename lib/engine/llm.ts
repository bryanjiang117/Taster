import { GoogleGenAI } from "@google/genai";
import {
  parseJsonText,
  recipeFromExtractJson,
  type RecipeExtractJson,
} from "./llm-parse";
import type { SearchMode } from "./dish-cache";
import { FAST_MODEL, needsSmartIngredient, shouldEscalateOrigin, SMART_MODEL } from "./models";
import type { SearchHit } from "./search";
import type { DishOrigin, Recipe, TasteDimension, TasteProfile } from "./types";
import { TASTE_DIMENSIONS } from "./types";
import type { SourcePicks, SourceShortlist } from "./identity";
import type { ScoreContributions } from "./combine";
import type { AmbiguousSeasoningAdjustment } from "./ambiguous-seasoning";
import type { IngredientStore } from "./store";

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

/** Known-good catalog rows passed into leaf calibrate/estimate for relative ranking. */
export type LeafCatalogAnchor = {
  name: string;
  taste: TasteProfile;
};

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
  /** Sanity-check a chemistry draft; code ignores dimensions without evidence, except chili heat on chili-named foods. */
  calibrateLeafTaste?(
    name: string,
    draft: TasteProfile,
    evidence?: Record<TasteDimension, boolean>,
    context?: CulinaryContext,
    catalogAnchors?: LeafCatalogAnchor[],
  ): Promise<Partial<TasteProfile> | undefined>;
  /** Mouthful 0–10 when no chemistry source matched this exact grocery name. */
  estimateLeafTaste?(
    name: string,
    context?: CulinaryContext,
    catalogAnchors?: LeafCatalogAnchor[],
  ): Promise<TasteProfile | undefined>;
  /**
   * After mix: set dish totals for dimensions driven by ambiguous primary
   * seasoners (to taste / as needed / missing amount), and allocate uplift
   * to those ingredients' contribution tips.
   */
  adjustAmbiguousSeasoning?(
    input: AmbiguousSeasoningAdjustRequest,
  ): Promise<AmbiguousSeasoningAdjustment | undefined>;
  /** Unused by the pipeline. Allowed on test stubs. */
  lookupIngredient?(name: string): Promise<unknown>;
}

export type AmbiguousSeasoningAdjustRequest = {
  context: CulinaryContext;
  engineTaste: TasteProfile;
  contributions: ScoreContributions;
  flagged: Array<{
    name: string;
    dimension: TasteDimension;
    leafScore: number;
    currentPoints: number;
  }>;
};

export function classifyTasteInputPrompt(query: string): string {
  return `Classify this taste-profile query.
Be optimistic: prefer "dish" or "ingredient" over "reject" whenever the query could plausibly be food. 
Allow minor spelling errors, especially for romanizations.
- "dish": a prepared food or drink people cook or order (pad thai, ceviche, latte, chocolate cake). Prefer a dish, including if it's uncommon or regional.
- "ingredient": a singular grocery food or cooking ingredient (lime, salt, chicken breast, fish sauce).
If the same word is both a grocery and a dish people cook or order (spaghetti, ramen, pizza, salad), classify as "dish".
Reject only clear brands, product SKUs, random/gibberish keyboard mash, sentences, URLs, and obvious non-food. Do not reject because a name is unfamiliar, slangy — food reading wins.
For ingredient, return a short singular English grocery name in "name".
For reject, give a short "reason".
QUERY: ${JSON.stringify(query)}`;
}

export function identifyDishPrompt(
  dish: string,
  options?: IdentifyDishOptions,
): string {
  const typed = options?.searchMode === "typed";
  const disambiguate = `First resolve which form of the dish the user most likely means.
- If the query is a bare or generic dish name with no style or regional qualifier, pick the form most people who type that name usually mean (restaurant / tourist / widely cooked popular form). Example: "paella" → popular salty seafood paella, not paella Valenciana.
- If the query names a specific style, region, or variant, honor that form exactly. Example: "paella valenciana" → traditional Valencian paella, not seafood.
- Romanizations and native-script names of the same dish are the same food, not different variants.
Then return country, culture, nativeName for that resolved form in the origin language (e.g. Mapo tofu → 麻婆豆腐), language, languageCode, and 3 web queries aimed at that form.`;
  if (typed) {
    return `Identify the culinary origin of "${dish}".
${disambiguate}
Return 3 web queries in the SAME language and script the user typed.
These queries should find the internationalized / diaspora recipes for the resolved form as commonly cooked from recipes in that language.
Each query MUST include the user's dish name plus a recipe word in that language (e.g. recipe, recette, receta).
Use at least one unquoted query. You may include one quoted exact-name query.
Do not switch the queries into the origin language unless the user already typed in that language.
Do not use generic cuisine queries.`;
  }
  return `Identify the culinary origin of "${dish}".
${disambiguate}
Return 3 native-language web queries for the resolved form.
Each query MUST include the native dish name plus a recipe word.
Use at least one unquoted query so search can match title variants, e.g. 麻婆豆腐 食谱, 麻婆豆腐 做法.
You may also include one quoted exact-name query.
Do not use generic cuisine queries (川菜, 家常菜, Chinese food).
Search in the origin language for the resolved form (popular when bare; exact when specified) — not a rarer traditional sibling the user did not name.`;
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
Name ingredients using this dish's culinary context, not dictionary English. Regional false friends must map to the food actually used in this cuisine (Latin American Spanish "limón" in ceviche is lime, not lemon). Ambiguous generics must become the cuisine-typical grocery even when a dictionary/catalog generic exists: Chinese / Cantonese / Sichuan sausage, 香肠, or 腊肠 → chinese sausage or lap cheong, never plain sausage. Prefer a short English grocery name when one is standard; if English is awkward or uncommon, a well-known romanized native name is fine. If the catalog has both a dictionary match and the cuisine's food, prefer the cuisine's food when the source name is ambiguous.
Typical food: this ingredient is for THAT dish. Pick and score the food the cuisine actually uses, not US supermarket false friends. Chili / chili pepper in a spicy Chinese, Thai, Sichuan, Mexican, or similar dish is the hot chili (dried 干辣椒, Thai bird's eye), never American sweet chili sauce and never bell or sweet pepper. If a shortlist row is sweet pepper or sweet chili sauce and the dish is spicy-chili cookery, reject that row.`;
}

export function canonicalizeIngredientNamesPrompt(
  names: string[],
  catalog: string[],
  context?: CulinaryContext,
): string {
  const contextLine = culinaryContextLine(context);
  return `Normalize each extracted ingredient.
${contextLine}
Each mapping's "to" must be one singular short English grocery name (or a well-known romanized native name when English is awkward), or a comma-separated list if the extracted line is multiple foods.
If the source name is culturally ambiguous in this dish's cuisine, emit the cuisine-typical grocery name even when CATALOG only has the dictionary generic (香肠 / sausage in Cantonese clay pot rice → chinese sausage or lap cheong, not sausage; chili in som tam or mapo tofu is the hot pepper, never sweet chili sauce). Prefer an exact cuisine-specific catalog string when it exists; otherwise invent that short singular name. Do not invent a cuisine form when the source is already specific the other way (italian sausage or bratwurst in a Chinese dish stays itself).
If it is the same food as an item in CATALOG, copy that catalog string exactly (cut, packing, and marketing copy do not make a new food).
If it is a new food, invent a short singular English grocery name (or romanized native) that preserves heat, fermentation, form, and cuisine (thai chili, chili oil, fermented black bean, chili bean paste, chinese sausage, lap cheong, msg).
Keep distinct foods distinct (green papaya ≠ papaya, juice ≠ the vegetable, chicken breast ≠ chicken, lime ≠ lemon, chili ≠ sweet chili, chili oil ≠ canola oil, chili bean paste ≠ chili with beans, chinese sausage ≠ sausage).
Process forms are not the base food — never collapse them into a catalog parent just because the parent is listed (kimchi ≠ cabbage, sauerkraut ≠ cabbage, pickle ≠ cucumber, yogurt ≠ milk, bacon ≠ pork, dried shrimp ≠ shrimp).
If the dish name or native title names a grocery food, that namesake must stay itself when it appears in NAMES (kimchi in kimchi fried rice stays kimchi, not cabbage; lemon in lemon chicken stays lemon).
JSON {"mappings":[{"from":"...","to":"..."}]}
NAMES: ${JSON.stringify(names)}
CATALOG: ${JSON.stringify(catalog)}`;
}

function preferTargetDishLine(context?: CulinaryContext): string {
  if (!context?.dish) return "";
  return `If this page is a recipe for a different dish than ${context.dish}, return {"ingredients":[]} and put the page's real title in "title" — never rename the page to the target dish. If several recipes appear, prefer the one for ${context.dish}. Romanized spellings of the same dish still count. Do not return empty ingredients just because the title spelling differs.`;
}

export function recipeExtractPrompt(
  pageText: string,
  sourceUrl: string,
  context?: CulinaryContext,
): string {
  return `Extract a cooking recipe from this page text. If it is not a recipe, return {"ingredients":[]}.
${culinaryContextLine(context)}
${preferTargetDishLine(context)}
Convert quantities to numeric amount + unit (tsp, tbsp, cup, ml, g, lb, clove, pinch, dash, piece). Prefer g or lb for meat and other large solids; use piece only for countable foods (onion, chicken piece), never for salt/pepper/spices. Keep vague kitchen wording as pinch/dash (a pinch of salt → amount 1 unit pinch — not tbsp, not piece, not 15 ml). For "to taste" / "season with" / missing amount on a seasoning, omit amount and unit so code can size it from the dish — or give a measured guess that fits THIS recipe size. If a quantity is missing on a bulk food, still include the ingredient with name only.
Write each ingredient as exactly one singular English grocery food. Never list two foods in one ingredient.
For each ingredient set role to "in" or "out":
- "in" = mixed, cooked, marinated, or otherwise incorporated into the dish as served from the pot/pan/plate.
- "out" = side, garnish, dip, "for serving", lemon wedges on the side, bread, packaging, or anything not meant to flavor the cooked dish itself.
When unsure, use "in".
For each "in" ingredient, use culinary common sense about how THIS recipe treats it (bloomed in oil, drained, charred, fermented, reduced, crushed, raw, freshly cracked, evaporated, absorbed into rice/grain, etc.). mix.intensity is the fraction of the listed amount that contributes to the final served dish (1 = listed amount is in the product as-is, 0 = none of it remains in what you eat, >1 if concentrated into the dish). Also return mix.scale per-dimension multipliers only when prep changes that dimension. When intensity is not 1 (or role is "out"), also set mix.why to one or two short words (marinade, evaporated, absorbed, drained, concentrated, on the side). Water or stock that cooks into rice/paella/risotto/pasta and evaporates or is absorbed must be intensity 0 for plain water, or a low residual for flavored stock/broth/wine so its taste still contributes — never leave evaporated cooking water at intensity 1 or it will dilute the dish. Deep-fry / frying oil that is drained, pasta water, and blanching water are intensity 0. A spoon of stir-fry oil or chili oil that is eaten stays 1. Soup or stew broth that is served as liquid stays near 1. Freshly cracked black pepper is still not chili: scale spicy so the 0.2 leaf becomes ≈ 0.5. Do not output the dish's final 0-10 taste vector.
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
Convert quantities to numeric amount + unit (tsp, tbsp, cup, ml, g, lb, clove, pinch, dash, piece). Prefer g or lb for meat and other large solids; use piece only for countable foods (onion, chicken piece), never for salt/pepper/spices. Keep vague kitchen wording as pinch/dash (a pinch of salt → amount 1 unit pinch — not tbsp, not piece, not 15 ml). For "to taste" / "season with" / missing amount on a seasoning, omit amount and unit so code can size it from the dish — or give a measured guess that fits THIS recipe size. If a quantity is missing on a bulk food, still include the ingredient with name only.
Write each ingredient as exactly one singular English grocery food (soy sauce, tofu, green papaya). Never list two foods in one ingredient.
For each ingredient set role to "in" or "out":
- "in" = mixed, cooked, marinated, or otherwise incorporated into the dish as served from the pot/pan/plate.
- "out" = side, garnish, dip, "for serving", lemon wedges on the side, bread, packaging, or anything not meant to flavor the cooked dish itself.
When unsure, use "in".
For each "in" ingredient, use culinary common sense about how THIS recipe treats it (bloomed in oil, drained, charred, fermented, reduced, crushed, raw, freshly cracked, evaporated, absorbed into rice/grain, etc.). mix.intensity is the fraction of the listed amount that contributes to the final served dish (1 = listed amount is in the product as-is, 0 = none of it remains in what you eat, >1 if concentrated into the dish). Also return mix.scale per-dimension multipliers only when prep changes that dimension. When intensity is not 1 (or role is "out"), also set mix.why to one or two short words (marinade, evaporated, absorbed, drained, concentrated, on the side). Water or stock that cooks into rice/paella/risotto/pasta and evaporates or is absorbed must be intensity 0 for plain water, or a low residual for flavored stock/broth/wine so its taste still contributes — never leave evaporated cooking water at intensity 1 or it will dilute the dish. Deep-fry / frying oil that is drained, pasta water, and blanching water are intensity 0. A spoon of stir-fry oil or chili oil that is eaten stays 1. Soup or stew broth that is served as liquid stays near 1. Freshly cracked black pepper is still not chili: scale spicy so the 0.2 leaf becomes ≈ 0.5. Do not output the dish's final 0-10 taste vector.
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
  "A 10 is the most intense culinary form of that taste: 10 salty = table salt; 10 sweet = sugar or brown sugar (crystalline); 10 spicy = thai chili or habanero; 10 umami = fish sauce; 10 bitter = unsweetened espresso. Do not hand out 10s because a food is iconic — a spoon of a 10 seasons a whole bowl. Rank relative intensity carefully: raise or lower a draft only when a cook would immediately reject the number; prefer small corrections when the ballpark is right. Honey ≈ 9–10 sweet; orange ≈ 7–8 sweet; mirin / sweet cooking sake ≈ 5–7 sweet (noticeably sweet, far below crystalline sugar — never score mirin at or above brown sugar or table sugar on sweet); onion ≈ 0–1 sweet. Lemon or lime fruit ≈ 9 sour; lemon or lime juice ≈ 9.5 (not 10). Lactic-fermented vegetables (kimchi, sauerkraut, pickles) are clearly sour ≈ 7–8; yogurt / kefir milder ≈ 4–5; vinegar ≈ 9. Juice, paste, and extract score higher than the whole food (juice ≠ fruit; paste ≠ the vegetable). parmesan ≈ 7–8 salty; soy sauce / fish sauce / oyster sauce / miso ≈ 8.5–10 salty. black pepper ≈ 0.2 spicy (freshly cracked ≈ 0.5). Spicy is chili heat only (capsaicin): ginger, garlic, onion, mustard, horseradish, wasabi, and Sichuan peppercorn are 0 spicy. Black pepper is not chili — 0.2 is the ceiling unless freshly cracked (~0.5). Salty is how salty a mouthful tastes, not milligrams of sodium on a nutrient label. Sodium bicarbonate and other non-salt sodium compounds still show up as 'sodium' in the draft. Functional pantry chemicals (leaveners, thickeners, starches, oils, additives) stay near 0 salty even if the draft is 9–10. Salt, soy, fish sauce, ham, and cheese stay high. Salty and umami are different: a sauce can be both very salty and very umami. Do not lower salty to 'make room' for umami or because the food tastes savory/balanced.";

/** Fixed grocery names used as leaf score scale references when present in the store. */
export const LEAF_CATALOG_ANCHOR_NAMES = [
  "sugar",
  "brown sugar",
  "honey",
  "mirin",
  "orange",
  "onion",
  "salt",
  "soy sauce",
  "fish sauce",
  "parmesan",
  "vinegar",
  "thai chili",
] as const;

export function leafCatalogAnchors(
  store: IngredientStore,
): LeafCatalogAnchor[] {
  const anchors: LeafCatalogAnchor[] = [];
  for (const name of LEAF_CATALOG_ANCHOR_NAMES) {
    const row = store.get(name);
    if (!row) continue;
    anchors.push({ name: row.ingredient, taste: row.taste });
  }
  return anchors;
}

function catalogAnchorsLine(anchors?: LeafCatalogAnchor[]): string {
  if (!anchors?.length) return "";
  return `CATALOG ANCHORS (known-good mouthful vectors — rank THIS ingredient relative to these; do not outrank crystalline sugar/brown sugar on sweet with a diluted cooking wine or syrup): ${JSON.stringify(anchors)}
`;
}

export function calibrateLeafPrompt(
  name: string,
  draft: TasteProfile,
  evidence?: Record<TasteDimension, boolean>,
  context?: CulinaryContext,
  catalogAnchors?: LeafCatalogAnchor[],
): string {
  const contextLine = culinaryContextLine(context);
  return `SANITY-CHECK this chemistry draft for a mouthful of "${name}". The draft is a lab proxy, not a tasting. It is often wrong. Your job is to catch misses a cook would catch immediately.
${contextLine}
${labProxyLine(evidence)}
A high salty draft means a table listed elemental sodium (bicarbonate, aluminum salts, and table salt all look the same). If this food is not something you would call salty, salty is implausible — you MUST change it. The same for every dimension: if the number would surprise a cook, list it in implausible and fix taste. Copying an absurd draft is a failed check.
You may change a dimension only when the draft already has signal there (lab compounds), except sour, umami, and chili heat on chili-named foods: nutrient tables often omit acids/glutamate, and USDA often hits sweet/bell pepper for "chili pepper". You may add those when they define this ingredient in THIS dish. You should lower a draft dimension when the lab proxy does not match taste. Do not invent salty/bitter/sweet-as-sugar from nothing, and do not invent chili heat for pungent foods that are not chilies. Potassium and hydrolyzed amino acids are not salt or umami. Bland vegetables stay near 0 (a trace of sweet is ok). Score the named form: citrus juice is more sour than the whole fruit. A paste of a sour fruit stays that fruit, not a tomato sauce. Hot chili peppers (Thai bird's eye, cayenne, habanero, Chinese 干辣椒) are very spicy; sweet chili sauce is sweet; bell pepper is not chili. If this named chili is going into a spicy dish and the draft is sweet with no heat, the lab row is the wrong food — fix spicy high and sweet low. Raw seafood (squid, crab, shrimp, fish) has moderate umami from nucleotides even when tables only show sodium — calibrate roughly 2–4 umami for plain raw seafood, not 6+. Ginger is pungent, not chili-spicy — spicy stays 0. Garlic, mustard, and Sichuan peppercorn are also 0 spicy. MSG is high umami. Chili oil is chili heat, not canola oil.
${LEAF_ANCHORS}
${catalogAnchorsLine(catalogAnchors)}Return implausible (dimensions that fail a cook's sniff test) and taste 0-10. Do not output a finished dish profile.
DRAFT: ${JSON.stringify(draft)}`;
}

function labProxyLine(evidence?: Record<TasteDimension, boolean>): string {
  if (!evidence) return "";
  const hits = TASTE_DIMENSIONS.filter((dim) => evidence[dim]);
  if (!hits.length) return "LAB HITS: none of the 6 tastes had a compound hit.";
  const note =
    evidence.salty
      ? " salty is from milligrams of sodium, not from tasting salt."
      : "";
  return `LAB HITS (proxies only): ${hits.join(", ")}.${note}`;
}

export function estimateLeafPrompt(
  name: string,
  context?: CulinaryContext,
  catalogAnchors?: LeafCatalogAnchor[],
): string {
  const contextLine = culinaryContextLine(context);
  return `Estimate a mouthful of grocery ingredient ${JSON.stringify(name)}. No lab table matched this exact name.
${contextLine}
Score THIS food, not a parent category or a dish that uses it (thai chili ≠ chili; chili ≠ sweet chili sauce; soft shell crab ≠ crab cakes or fried batter; chicken breast ≠ chicken). Score the named form: juice and paste are stronger than the whole food. Use the dish's typical chili if the name is generic chili pepper.
Bland vegetables stay near 0 (a trace of sweet is ok). Hot chili peppers are very spicy. Ginger, garlic, mustard, horseradish, wasabi, and Sichuan peppercorn are 0 spicy. Soy, fish sauce, oyster sauce, and miso are very salty (8.5–10). Functional pantry chemicals (leaveners, thickeners, starches, oils) are not salty even if they contain sodium. Raw seafood has moderate umami (~2–4), not high. MSG is high umami. Chili oil is chili heat, not canola oil.
${LEAF_ANCHORS}
${catalogAnchorsLine(catalogAnchors)}Return taste 0-10 for this ingredient alone. Do not output a finished dish profile.
INGREDIENT: ${JSON.stringify(name)}`;
}

export const SYSTEM =
  "You extract structured culinary data as JSON. Never invent a dish's final taste scores, except when asked to adjust dimensions flagged from ambiguous primary-seasoner amounts (to taste / as needed / missing). Search native-language recipes for authentic versions, or the user's typed language for internationalized versions, as the task specifies. Leaf ingredient scores start from measured compounds; you may calibrate perception, and may estimate a grocery mouthful only when no lab source matched that exact name.";

export function adjustAmbiguousSeasoningPrompt(
  input: AmbiguousSeasoningAdjustRequest,
): string {
  const contextLine = culinaryContextLine(input.context);
  return `Adjust ONLY the flagged dish taste dimensions. Recipes listed these primary seasoners with ambiguous amounts (to taste / as needed / missing), so the engine's volume guess under- or over-states how seasoned THIS dish should taste.
${contextLine}
ENGINE TASTE (0-10, do not change unflagged dimensions): ${JSON.stringify(input.engineTaste)}
CURRENT CONTRIBUTORS (points toward each dimension): ${JSON.stringify(input.contributions)}
FLAGGED SEASONERS (only these may receive uplift): ${JSON.stringify(input.flagged)}

For each flagged dimension:
- Set target to how strong that taste should be for THIS dish as typically eaten (cuisine + form). Anchors: 0 = none, 5 = clearly present, 8 = bold, 10 = extreme.
- target must be >= the engine score for that dimension (you are adding seasoning, not removing it).
- Allocate contributions[] points across the flagged ingredients for that dimension. Those points are the uplift from the engine total to target; they must sum to (target - engine). Check that the uplift size is plausible for those seasoners given their leaf scores and what other ingredients already contribute — do not dump a huge salty jump on a pinch-scale salt line if soy/fish sauce already carry the dish, and do not leave a characteristically seasoned dish near the engine under-estimate when salt/sugar/acid/chili/MSG was "to taste".
Return adjustments only for flagged dimensions. Omit everything else.`;
}

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
              why: { type: "string" },
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

const TASTE_VECTOR_SCHEMA = {
  type: "object",
  properties: {
    sweet: { type: "number" },
    sour: { type: "number" },
    salty: { type: "number" },
    spicy: { type: "number" },
    umami: { type: "number" },
    bitter: { type: "number" },
  },
};

const CALIBRATE_SCHEMA = {
  type: "object",
  properties: {
    implausible: {
      type: "array",
      items: {
        type: "string",
        enum: ["sweet", "sour", "salty", "spicy", "umami", "bitter"],
      },
    },
    taste: TASTE_VECTOR_SCHEMA,
  },
  required: ["implausible", "taste"],
};

const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    taste: TASTE_VECTOR_SCHEMA,
  },
  required: ["taste"],
};

const ADJUST_AMBIGUOUS_SCHEMA = {
  type: "object",
  properties: {
    adjustments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            enum: ["sweet", "sour", "salty", "spicy", "umami", "bitter"],
          },
          target: { type: "number" },
          contributions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ingredient: { type: "string" },
                points: { type: "number" },
              },
              required: ["ingredient", "points"],
            },
          },
        },
        required: ["dimension", "target", "contributions"],
      },
    },
  },
  required: ["adjustments"],
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
    const prompt = identifyDishPrompt(dish, options);
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
    evidence?: Record<TasteDimension, boolean>,
    context?: CulinaryContext,
    catalogAnchors?: LeafCatalogAnchor[],
  ): Promise<Partial<TasteProfile> | undefined> {
    const model = needsSmartIngredient(name) ? SMART_MODEL : FAST_MODEL;
    const data = await this.json<{ taste?: TasteProfile }>(
      model,
      calibrateLeafPrompt(name, draft, evidence, context, catalogAnchors),
      CALIBRATE_SCHEMA,
    );
    return data.taste;
  }

  async estimateLeafTaste(
    name: string,
    context?: CulinaryContext,
    catalogAnchors?: LeafCatalogAnchor[],
  ): Promise<TasteProfile | undefined> {
    const model = needsSmartIngredient(name) ? SMART_MODEL : FAST_MODEL;
    const data = await this.json<{ taste?: TasteProfile }>(
      model,
      estimateLeafPrompt(name, context, catalogAnchors),
      ESTIMATE_SCHEMA,
    );
    return data.taste;
  }

  async adjustAmbiguousSeasoning(
    input: AmbiguousSeasoningAdjustRequest,
  ): Promise<AmbiguousSeasoningAdjustment | undefined> {
    if (!input.flagged.length) return undefined;
    const data = await this.json<AmbiguousSeasoningAdjustment>(
      SMART_MODEL,
      adjustAmbiguousSeasoningPrompt(input),
      ADJUST_AMBIGUOUS_SCHEMA,
    );
    return data;
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
