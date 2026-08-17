const ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  tsp: 5,
  teaspoon: 5,
  tbsp: 15,
  tablespoon: 15,
  cup: 240,
  cups: 240,
  pint: 473,
  quart: 946,
  gallon: 3785,
  oz: 30,
  ounce: 30,
  fl: 30,
  "fl oz": 30,
  lb: 454,
  pound: 454,
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  clove: 5,
  cloves: 5,
  pinch: 0.3,
  pinches: 0.3,
  dash: 0.6,
  handful: 30,
  piece: 15,
  pieces: 15,
  slice: 10,
  slices: 10,
  can: 400,
  bunch: 60,
};

/** Explicit volume/mass units — never reinterpret as a food count. */
const MEASURED_UNITS = new Set(Object.keys(ML).filter((u) => u !== "piece" && u !== "pieces"));

const COUNT_UNITS = new Set(["piece", "pieces", "whole", "each", "unit", "units"]);

type PieceRule = { match: RegExp; ml: number };

/** Typical edible volume for one count of a food (leg, breast, onion, …). */
const PIECE_RULES: PieceRule[] = [
  { match: /\b(whole\s+)?(chicken|turkey|duck)\b/, ml: 250 },
  { match: /\b(beef|pork|lamb|veal|steak|chop|ribs?)\b/, ml: 200 },
  { match: /\b(fish|salmon|cod|tuna|shrimp|prawn|fillet)\b/, ml: 120 },
  { match: /\b(green\s+onion|spring\s+onion|scallion)\b/, ml: 20 },
  { match: /\b(onion|potato|tomato|apple|orange|lemon|lime)\b/, ml: 120 },
  { match: /\begg\b/, ml: 50 },
  { match: /\b(chili|chilli|pepper|habanero|jalape[nñ]o|scotch\s*bonnet)\b/, ml: 15 },
  { match: /\bgarlic\b/, ml: 5 },
  { match: /\b(carrot|celery|shallot)\b/, ml: 60 },
];

const WHOLE_BIRD_ML = 1600;

function normalizeUnit(unit: string): string {
  return unit.toLowerCase().replace(/\./g, "").trim();
}

function pieceVolumeMl(ingredientName: string, unitKey: string): number {
  const name = ingredientName.toLowerCase();
  if (
    (unitKey === "whole" || /\bwhole\b/.test(unitKey)) &&
    /\b(chicken|turkey|duck)\b/.test(name)
  ) {
    return WHOLE_BIRD_ML;
  }
  for (const rule of PIECE_RULES) {
    if (rule.match.test(name)) return rule.ml;
  }
  return ML.piece ?? 15;
}

function isCountLikeUnit(unitKey: string): boolean {
  if (!unitKey || COUNT_UNITS.has(unitKey)) return true;
  if (MEASURED_UNITS.has(unitKey)) return false;
  // "leg quarter", "breast", "thighs" — count nouns the LLM invents
  return !/^(fl oz|fluid ounce|fluid ounces)$/.test(unitKey);
}

export function quantityToMl(
  amount: number,
  unit: string,
  ingredientName = "",
): number {
  const key = normalizeUnit(unit);
  if (key === "fl oz" || key === "fluid ounce" || key === "fluid ounces") {
    return amount * 30;
  }

  if (key === "piece" || key === "pieces") {
    return amount * pieceVolumeMl(ingredientName, key);
  }

  const known = ML[key];
  if (known != null) return amount * known;

  if (ingredientName && isCountLikeUnit(key)) {
    return amount * pieceVolumeMl(ingredientName, key);
  }

  return amount;
}
