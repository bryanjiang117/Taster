import { primarySeasonerDimension } from "./ambiguous-seasoning";

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
  smidgen: 0.15,
  dash: 0.6,
  dashes: 0.6,
  splash: 3,
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

/** Kitchen-vague units: baseline ml at a ~500 ml reference dish, then scaled. */
const VAGUE_BASELINE_ML: Record<string, number> = {
  pinch: 0.3,
  pinches: 0.3,
  smidgen: 0.15,
  dash: 0.6,
  dashes: 0.6,
  splash: 3,
  handful: 30,
};

const REFERENCE_RECIPE_ML = 500;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;

/** Max share of bulk volume for a seasoning before we clamp LLM over-estimates. */
const MAX_SEASONING_SHARE = 0.012;

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

const SALT_NAME =
  /\b(salt|kosher\s+salt|sea\s+salt|table\s+salt|sal|sel|塩|盐)\b/i;
/** Ground/dried pepper & spices — not fresh chili / bell pepper fruits. */
const PEPPER_SPICE_NAME =
  /\b((?:black|white|ground)\s+pepper|peppercorns?|sichuan\s+pepper(?:corn)?|cayenne|paprika|cumin|coriander|turmeric|cinnamon|nutmeg|allspice|oregano|thyme|rosemary|basil|bay\s+leaf|chili\s+flakes?|chilli\s+flakes?|red\s+pepper\s+flakes?|chili\s+powder|garlic\s+powder|onion\s+powder|花椒|胡椒|胡椒粉)\b/i;
const SEASONING_NAME =
  /\b(salt|kosher\s+salt|sea\s+salt|msg|spice|seasoning|chili\s+powder|garlic\s+powder|onion\s+powder|paprika|cumin|oregano|thyme|rosemary|basil|bay\s+leaf|nutmeg|cinnamon|turmeric|cayenne|allspice|(?:black|white|ground)\s+pepper|peppercorns?|sichuan\s+pepper|chili\s+flakes?|red\s+pepper\s+flakes?|塩|盐|胡椒|花椒)\b/i;

export type RawQuantity = {
  name: string;
  amount?: number;
  unit?: string;
};

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

function isVagueUnit(unitKey: string): boolean {
  return unitKey in VAGUE_BASELINE_ML;
}

export function isSeasoningName(name: string): boolean {
  return SEASONING_NAME.test(name);
}

function isSeasoningGuessCandidate(name: string): boolean {
  return isSeasoningName(name) || primarySeasonerDimension(name) != null;
}

/** Missing / to taste / as needed — not pinch/dash or measured units. */
export function isSeasoningGuessQuantity(item: RawQuantity): boolean {
  return classifyRaw(item).kind === "seasoning-guess";
}

/** Culinary “to taste” share of bulk dish volume. */
function toTasteShare(name: string): number {
  if (SALT_NAME.test(name)) return 0.004;
  if (PEPPER_SPICE_NAME.test(name)) return 0.0008;
  if (isSeasoningName(name)) return 0.0015;
  return 0.002;
}

function dishScale(bulkVolumeMl: number): number {
  const bulk = Math.max(1, bulkVolumeMl);
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, bulk / REFERENCE_RECIPE_ML));
}

function vagueVolumeMl(unitKey: string, amount: number, bulkVolumeMl: number): number {
  const baseline = VAGUE_BASELINE_ML[unitKey] ?? 0.3;
  return amount * baseline * dishScale(bulkVolumeMl);
}

function seasoningEstimateMl(name: string, bulkVolumeMl: number): number {
  const bulk = Math.max(REFERENCE_RECIPE_ML * 0.5, bulkVolumeMl);
  return Math.max(0.15, bulk * toTasteShare(name));
}

function clampSeasoning(name: string, volumeMl: number, bulkVolumeMl: number): number {
  if (!isSeasoningName(name) || bulkVolumeMl <= 0) return volumeMl;
  const max = Math.max(0.3, bulkVolumeMl * MAX_SEASONING_SHARE);
  return Math.min(volumeMl, max);
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

  if (isVagueUnit(key)) {
    return amount * (VAGUE_BASELINE_ML[key] ?? 0.3);
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

type ResolveKind = "measured" | "vague" | "seasoning-guess" | "count-default";

function classifyRaw(item: RawQuantity): {
  kind: ResolveKind;
  amount: number;
  unitKey: string;
} {
  const name = item.name.trim();
  const hasAmount = item.amount != null && !Number.isNaN(item.amount) && item.amount > 0;
  const rawUnit = item.unit?.trim() ?? "";
  const unitKey = rawUnit ? normalizeUnit(rawUnit) : "";

  if (!hasAmount && !unitKey) {
    if (isSeasoningGuessCandidate(name)) return { kind: "seasoning-guess", amount: 1, unitKey: "" };
    return { kind: "count-default", amount: 1, unitKey: "piece" };
  }

  if (!unitKey && hasAmount) {
    // Bare number with no unit — treat seasoning as to-taste, else ml
    if (isSeasoningGuessCandidate(name)) return { kind: "seasoning-guess", amount: item.amount!, unitKey: "" };
    return { kind: "measured", amount: item.amount!, unitKey: "ml" };
  }

  if (
    unitKey === "taste" ||
    unitKey === "to taste" ||
    unitKey === "totaste" ||
    unitKey === "as needed" ||
    unitKey === "asneeded" ||
    unitKey === "season with" ||
    unitKey === "seasonwith"
  ) {
    return { kind: "seasoning-guess", amount: 1, unitKey: "" };
  }

  if (isVagueUnit(unitKey)) {
    return { kind: "vague", amount: hasAmount ? item.amount! : 1, unitKey };
  }

  // "piece" / invented counts on salt/pepper are LLM stand-ins for pinch / to taste
  if (isSeasoningName(name) && isCountLikeUnit(unitKey) && !MEASURED_UNITS.has(unitKey)) {
    return { kind: "vague", amount: hasAmount ? item.amount! : 1, unitKey: "pinch" };
  }

  if (!hasAmount) {
    if (isSeasoningGuessCandidate(name)) return { kind: "seasoning-guess", amount: 1, unitKey: "" };
    return { kind: "count-default", amount: 1, unitKey: unitKey || "piece" };
  }

  return { kind: "measured", amount: item.amount!, unitKey };
}

/**
 * Convert raw extract amounts to ml with dish context.
 * Vague units (pinch/dash) use a kitchen baseline scaled by bulk recipe volume.
 * Missing / piece-on-seasoning never become a flat 15 ml “piece”.
 */
export function resolveRecipeVolumes(items: RawQuantity[]): number[] {
  const classified = items.map((item) => classifyRaw(item));

  const measuredVolumes = classified.map((row, index) => {
    if (row.kind !== "measured" && row.kind !== "count-default") return 0;
    return quantityToMl(row.amount, row.unitKey || "piece", items[index]!.name);
  });

  const bulkVolumeMl =
    measuredVolumes.reduce((sum, v) => sum + v, 0) || REFERENCE_RECIPE_ML;

  return classified.map((row, index) => {
    const name = items[index]!.name;
    let volume: number;
    if (row.kind === "vague") {
      volume = vagueVolumeMl(row.unitKey, row.amount, bulkVolumeMl);
    } else if (row.kind === "seasoning-guess") {
      volume = seasoningEstimateMl(name, bulkVolumeMl);
    } else {
      volume = measuredVolumes[index]!;
    }
    return clampSeasoning(name, volume, bulkVolumeMl);
  });
}
