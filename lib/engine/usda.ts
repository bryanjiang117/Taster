import { findCompound } from "./compounds";
import type { CompoundAmount } from "./chemistry";

export type FoodHit = {
  id: string;
  name: string;
  dataType?: string;
};

export type UsdaNutrient = {
  number?: string | number;
  name?: string;
  amount?: number;
  unit?: string;
};

export interface UsdaClient {
  search(name: string): Promise<FoodHit | null>;
  candidates?(name: string): Promise<FoodHit[]>;
  compounds(id: string): Promise<CompoundAmount[]>;
  /** Branded fallback when Foundation/SR rows omit sugars (e.g. oyster sauce). */
  supplementSugarsFromBranded?(
    query: string,
    amounts: CompoundAmount[],
  ): Promise<CompoundAmount[]>;
}

const NUTRIENT_TO_COMPOUND: Record<string, string> = {
  "210": "sucrose",
  "211": "glucose",
  "212": "fructose",
  "213": "lactose",
  "214": "maltose",
  "307": "sodium",
  "262": "caffeine",
};

const NAME_TO_COMPOUND: Array<[RegExp, string]> = [
  [/^sodium\b/i, "sodium"],
  [/^sucrose$/i, "sucrose"],
  [/^glucose$/i, "glucose"],
  [/^fructose$/i, "fructose"],
  [/^lactose$/i, "lactose"],
  [/^maltose$/i, "maltose"],
  [/^caffeine$/i, "caffeine"],
  [/^citric acid$/i, "citric_acid"],
  [/^malic acid$/i, "malic_acid"],
  [/^acetic acid$/i, "acetic_acid"],
  [/^lactic acid$/i, "lactic_acid"],
];

const PREP_WORDS = new Set([
  "juice",
  "paste",
  "puree",
  "pulp",
  "concentrate",
  "powder",
  "grated",
  "minced",
  "chopped",
  "sliced",
  "fresh",
  "raw",
  "dried",
  "canned",
  "bottled",
  "unsweetened",
  "sweetened",
  "ground",
  "whole",
  "crushed",
  "peeled",
  "leaf",
  "leaves",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "with",
  "in",
  "for",
  "to",
  "from",
  "than",
  "without",
  "added",
]);

export type UsdaSearchHit = {
  fdcId?: number;
  description?: string;
  dataType?: string;
};

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function requiredTokens(query: string): string[] {
  const tokens = tokenize(query).filter((token) => !STOP_WORDS.has(token));
  const content = tokens.filter((token) => !PREP_WORDS.has(token));
  return content.length ? content : tokens;
}

function hasToken(haystack: string[], needle: string): boolean {
  if (haystack.includes(needle)) return true;
  if (haystack.includes(`${needle}s`)) return true;
  if (needle.endsWith("s") && haystack.includes(needle.slice(0, -1))) return true;
  if (
    needle.length >= 4 &&
    haystack.some(
      (token) =>
        token.startsWith(needle) ||
        (needle.startsWith(token) && token.length >= 4),
    )
  ) {
    return true;
  }
  return false;
}

function descriptionScore(query: string, food: UsdaSearchHit): number {
  const desc = food.description ?? "";
  const d = desc.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  if (/foundation/i.test(food.dataType ?? "")) score += 8;
  if (/sr legacy/i.test(food.dataType ?? "")) score += 4;
  if (/\braw\b/.test(d)) score += 40;
  if (/\bfresh\b/.test(d)) score += 10;
  if (
    /\b(candy|candies|beverage|drink|soda|novelty|smoothie|yogurt|nectar)\b/.test(d) &&
    !/\b(candy|drink|soda|nectar|yogurt|smoothie)\b/.test(q)
  ) {
    score -= 120;
  }
  if (
    /\b(kimchi|sauerkraut|salted|pickled|fermented)\b/.test(d) &&
    !/\b(kimchi|sauerkraut|salted|pickled|fermented)\b/.test(q)
  ) {
    score -= 80;
  }
  if (
    /\b(powder|canned|products|concentrate)\b/.test(d) &&
    !/\b(powder|canned|paste|concentrate)\b/.test(q)
  ) {
    score -= 35;
  }
  const needed = requiredTokens(query);
  const first = tokenize(desc)[0];
  if (first && needed[0] && hasToken([first], needed[0])) score += 25;
  score -= Math.max(0, tokenize(desc).length - needed.length);
  return score;
}

const BRANDED_MEAL =
  /\b(entree|entrée|dinner|meal|bowl|alfredo|macaroni|pizza|lasagna|casserole|frozen meal)\b/i;

function isBrandedMeal(description: string): boolean {
  return BRANDED_MEAL.test(description);
}

function rankUsdaFoods(
  query: string,
  foods: UsdaSearchHit[],
  branded = false,
): UsdaSearchHit[] {
  const needed = requiredTokens(query);
  if (!needed.length) return [];
  const scored: Array<{ score: number; food: UsdaSearchHit }> = [];
  for (const food of foods) {
    const desc = food.description ?? "";
    if (branded && isBrandedMeal(desc)) continue;
    const descTokens = tokenize(desc);
    if (!needed.every((token) => hasToken(descTokens, token))) continue;
    scored.push({ score: descriptionScore(query, food), food });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((row) => row.food);
}

export function usdaFoundationIsThin(
  query: string,
  foods: UsdaSearchHit[],
): boolean {
  return rankUsdaFoods(query, foods).length === 0;
}

/** Ranked USDA shortlist. Branded rows are used only when Foundation/SR is empty. */
export function pickUsdaFoods(
  query: string,
  foundation: UsdaSearchHit[],
  branded: UsdaSearchHit[] = [],
  limit = 5,
): UsdaSearchHit[] {
  const core = rankUsdaFoods(query, foundation);
  if (core.length) return core.slice(0, limit);
  return rankUsdaFoods(query, branded, true).slice(0, limit);
}

/** Pick the USDA food whose name is actually the query, not a keyword collision. */
export function pickUsdaFood(
  query: string,
  foods: UsdaSearchHit[],
): UsdaSearchHit | undefined {
  return pickUsdaFoods(query, foods)[0];
}

const SPECIFIC_SUGARS = new Set(["sucrose", "glucose", "fructose", "lactose", "maltose"]);

export function hasMappedSugar(amounts: CompoundAmount[]): boolean {
  return amounts.some((row) => SPECIFIC_SUGARS.has(row.id));
}

export function mergeSugarSupplement(
  amounts: CompoundAmount[],
  supplement: CompoundAmount[],
): CompoundAmount[] {
  if (hasMappedSugar(amounts)) return amounts;
  const sugar = supplement.find((row) => SPECIFIC_SUGARS.has(row.id));
  return sugar ? [...amounts, sugar] : amounts;
}

export function compoundsFromUsdaNutrients(nutrients: UsdaNutrient[]): CompoundAmount[] {
  const mapped: CompoundAmount[] = [];
  let totalSugars: number | undefined;

  for (const nutrient of nutrients) {
    if (nutrient.amount == null || nutrient.amount <= 0) continue;
    const number = String(nutrient.number ?? "").replace(/^0+/, "");
    if (number === "269") {
      totalSugars = toGrams(nutrient.amount, nutrient.unit);
      continue;
    }
    const id =
      NUTRIENT_TO_COMPOUND[number] ??
      NAME_TO_COMPOUND.find(([pattern]) => pattern.test(nutrient.name ?? ""))?.[1];
    if (!id) continue;
    mapped.push({
      id,
      amount: scaleUsdaAmount(id, nutrient.amount, nutrient.unit),
    });
  }

  const hasSpecificSugar = mapped.some((row) => SPECIFIC_SUGARS.has(row.id));
  if (!hasSpecificSugar && totalSugars && totalSugars > 0) {
    mapped.push({ id: "sucrose", amount: totalSugars });
  }

  return mapped;
}

function toGrams(amount: number, unit?: string): number {
  const u = (unit ?? "g").toLowerCase();
  if (u.startsWith("mg")) return amount / 1000;
  return amount;
}

function scaleUsdaAmount(id: string, amount: number, unit?: string): number {
  const def = findCompound(id);
  const u = (unit ?? "").toLowerCase();
  if (!def) return amount;
  if (def.unit === "mg_per_100g") {
    if (u.startsWith("g") && !u.startsWith("mg")) return amount * 1000;
    return amount;
  }
  if (u.startsWith("mg")) return amount / 1000;
  return amount;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class UsdaFdcClient implements UsdaClient {
  constructor(
    private readonly apiKey = process.env.USDA_API_KEY ?? "",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async search(name: string): Promise<FoodHit | null> {
    const hits = await this.candidates(name);
    return hits[0] ?? null;
  }

  async candidates(name: string): Promise<FoodHit[]> {
    if (!this.apiKey || !name.trim()) return [];
    const foundation = await this.searchDataTypes(name, ["Foundation", "SR Legacy"]);
    const branded = usdaFoundationIsThin(name, foundation)
      ? await this.searchDataTypes(name, ["Branded"])
      : [];
    return pickUsdaFoods(name, foundation, branded).flatMap((food) =>
      food.fdcId
        ? [
            {
              id: String(food.fdcId),
              name: food.description ?? name,
              dataType: food.dataType,
            },
          ]
        : [],
    );
  }

  private async searchDataTypes(
    name: string,
    dataType: string[],
  ): Promise<UsdaSearchHit[]> {
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("api_key", this.apiKey);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: name.trim(),
        pageSize: 25,
        dataType,
      }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { foods?: UsdaSearchHit[] };
    return data.foods ?? [];
  }

  async compounds(id: string): Promise<CompoundAmount[]> {
    return compoundsFromUsdaNutrients(await this.fetchNutrients(id));
  }

  async supplementSugarsFromBranded(
    query: string,
    amounts: CompoundAmount[],
  ): Promise<CompoundAmount[]> {
    if (hasMappedSugar(amounts) || !this.apiKey || !query.trim()) return amounts;
    const branded = await this.searchDataTypes(query, ["Branded"]);
    for (const food of pickUsdaFoods(query, [], branded)) {
      if (!food.fdcId) continue;
      const extra = await this.compounds(String(food.fdcId));
      const merged = mergeSugarSupplement(amounts, extra);
      if (merged.length > amounts.length) return merged;
    }
    return amounts;
  }

  private async fetchNutrients(id: string): Promise<UsdaNutrient[]> {
    if (!this.apiKey || !id) return [];
    const url = new URL(`https://api.nal.usda.gov/fdc/v1/food/${id}`);
    url.searchParams.set("api_key", this.apiKey);
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) return [];
    const data = (await response.json()) as {
      foodNutrients?: Array<{
        amount?: number;
        nutrient?: { number?: string | number; name?: string; unitName?: string };
      }>;
    };
    return (data.foodNutrients ?? []).map((row) => ({
      number: row.nutrient?.number,
      name: row.nutrient?.name,
      amount: row.amount,
      unit: row.nutrient?.unitName,
    }));
  }
}

export const emptyUsdaClient: UsdaClient = {
  search: async () => null,
  candidates: async () => [],
  compounds: async () => [],
  supplementSugarsFromBranded: async (_, amounts) => amounts,
};
