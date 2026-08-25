import { findCompound, type CompoundDef } from "./compounds";
import {
  clampScore,
  clampTaste,
  emptyTaste,
  TASTE_DISPLAY_MAX,
  TASTE_LEAF_MAX,
} from "./taste";
import { TASTE_DIMENSIONS, type TasteDimension, type TasteProfile } from "./types";

export type CompoundAmount = {
  id: string;
  amount: number;
};

export type ChemistryDraft = {
  taste: TasteProfile;
  evidence: Record<TasteDimension, boolean>;
  /** True when any recognized compound was present, including non-chili pungents. */
  measured: boolean;
};

/** Pure NaCl is ~38700 mg Na / 100g — above the usual mouthful 0–10 scale. */
const TABLE_SALT_SODIUM_MG = 30000;

function saturatingScore(amount: number, tau: number): number {
  if (amount <= 0 || tau <= 0) return 0;
  return clampScore(TASTE_DISPLAY_MAX * (1 - Math.exp(-amount / tau)));
}

function emptyEvidence(): Record<TasteDimension, boolean> {
  return {
    sweet: false,
    sour: false,
    salty: false,
    spicy: false,
    umami: false,
    bitter: false,
  };
}

/**
 * Deterministic mouthful 0–10 from quantified compounds.
 * Tiny amounts stay tiny scores (no detection-threshold clip).
 * Potassium, vitamin C, and hydrolyzed amino-acid totals are not taste.
 * Nutrient sodium is a salty *proxy* (NaCl and other sodium salts look the same).
 */
const NON_TASTE_IDS = new Set([
  "potassium",
  "ascorbic_acid",
  "glutamic_acid_bound",
  "aspartate",
]);

/** Pungent, not chili heat. Mapped for identity; never spicy. */
const NON_CHILI_PUNGENT_IDS = new Set([
  "gingerol",
  "allicin",
  "allyl_isothiocyanate",
  "hydroxy_alpha_sanshool",
]);

export function draftTasteFromCompounds(amounts: CompoundAmount[]): ChemistryDraft {
  const taste = emptyTaste();
  const evidence = emptyEvidence();
  const resolved: Array<{ def: CompoundDef; amount: number }> = [];

  for (const row of amounts) {
    if (!(row.amount > 0)) continue;
    const def = findCompound(row.id);
    if (!def || NON_TASTE_IDS.has(def.id)) continue;
    resolved.push({ def, amount: row.amount });
    if (!NON_CHILI_PUNGENT_IDS.has(def.id)) evidence[def.dimension] = true;
  }

  const sucroseEq = sumClass(resolved, "sugar");
  if (sucroseEq > 0) taste.sweet = saturatingScore(sucroseEq, 7.5);

  const acidEq = sumClass(resolved, "acid");
  if (acidEq > 0) taste.sour = saturatingScore(acidEq, 2500);

  const sodiumEq = sumClass(resolved, "sodium");
  if (sodiumEq > 0) {
    taste.salty =
      sodiumEq >= TABLE_SALT_SODIUM_MG
        ? TASTE_LEAF_MAX
        : saturatingScore(sodiumEq, 900);
  }

  const glutamateEq =
    sumClass(resolved, "glutamate") + sumClass(resolved, "glutamate_bound");
  const nucleotideEq = sumClass(resolved, "nucleotide");
  if (glutamateEq > 0 || nucleotideEq > 0) {
    evidence.umami = true;
    const synergistic =
      glutamateEq * (1 + nucleotideEq / 50) + nucleotideEq * 0.4;
    taste.umami = saturatingScore(synergistic, 450);
  }

  taste.spicy = mixIndependent(resolved, ["capsaicinoid", "piperine"]);
  taste.bitter = mixIndependent(resolved, [
    "alkaloid_bitter",
    "quinine",
    "glucosinolate",
    "tannin",
    "limonoid",
    "naringin",
  ]);

  if (sucroseEq > 0) {
    const suppress = 1 / (1 + 0.04 * sucroseEq);
    taste.bitter *= suppress;
    taste.sour *= 1 / (1 + 0.025 * sucroseEq);
  }

  for (const dim of TASTE_DIMENSIONS) {
    if (taste[dim] <= 0) evidence[dim] = evidence[dim] && taste[dim] > 0;
  }

  return {
    taste: clampTaste(taste, TASTE_LEAF_MAX),
    evidence,
    measured: resolved.length > 0,
  };
}

function sumClass(
  rows: Array<{ def: CompoundDef; amount: number }>,
  cls: CompoundDef["class"],
): number {
  let sum = 0;
  for (const row of rows) {
    if (row.def.class !== cls) continue;
    sum += row.amount * row.def.potency;
  }
  return sum;
}

/** Same-dimension classes with different thresholds combine as 1-(1-a)(1-b)… */
function mixIndependent(
  rows: Array<{ def: CompoundDef; amount: number }>,
  classes: CompoundDef["class"][],
): number {
  let remain = 1;
  let any = false;
  for (const cls of classes) {
    const group = rows.filter((row) => row.def.class === cls);
    if (!group.length) continue;
    const amount = group.reduce((sum, row) => sum + row.amount * row.def.potency, 0);
    const tau = group[0]!.def.tau;
    const score = saturatingScore(amount, tau) / 10;
    if (score <= 0) continue;
    any = true;
    remain *= 1 - score;
  }
  return any ? clampScore(10 * (1 - remain)) : 0;
}

export function mergeCompoundAmounts(
  usda: CompoundAmount[],
  foodb: CompoundAmount[],
): CompoundAmount[] {
  return mergeCompoundLayers([{ amounts: usda }, { amounts: foodb }]);
}

/** First layer to claim a compound class keeps it. Later layers may add other classes. */
export function mergeCompoundLayers(
  layers: Array<{ amounts: CompoundAmount[] }>,
): CompoundAmount[] {
  const claimed = new Set<CompoundDef["class"]>();
  const byId = new Map<string, number>();
  for (const layer of layers) {
    const layerClasses = new Set<CompoundDef["class"]>();
    for (const row of layer.amounts) {
      if (!(row.amount > 0)) continue;
      const def = findCompound(row.id);
      if (!def || claimed.has(def.class)) continue;
      layerClasses.add(def.class);
      byId.set(row.id, row.amount);
    }
    for (const cls of layerClasses) claimed.add(cls);
  }
  return [...byId.entries()].map(([id, amount]) => ({ id, amount }));
}

export function hasChemistryEvidence(draft: ChemistryDraft): boolean {
  return draft.measured || TASTE_DIMENSIONS.some((dim) => draft.evidence[dim]);
}

const LAB_GAP_DIMENSIONS = new Set<TasteDimension>(["sour", "umami"]);

/** Generic chili names may add heat when USDA matched sweet/bell pepper. Not black/Sichuan pepper. */
export function chiliHeatFood(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (/\b(black|white|pink|sichuan|szechuan|sansho)\s+pepper/.test(n)) return false;
  return /\b(chil[ei]e?s?|chillies|cayenne|habanero|jalape[nñ]o|gochugaru|gochujang|douban|capsicum|paprika|pepperoncini)\b/.test(
    n,
  );
}

/**
 * Foods whose sourness is defined by fermentation/pickling acids.
 * Nutrient tables often list only sodium/sugars for these — that is not a complete leaf.
 */
export function acidProcessFood(name: string): boolean {
  const n = name.trim().toLowerCase();
  return /\b(kimchi|sauerkraut|pickle|pickled|ferment|yogurt|yoghurt|kefir|skyr|buttermilk|sour\s*cream|vinegar|kvass|curtido|tsukemono|giardiniera|relish)\b/.test(
    n,
  );
}

export function applyCalibration(
  draft: ChemistryDraft,
  overlay: Partial<TasteProfile> | undefined,
  name?: string,
): TasteProfile {
  const out = { ...draft.taste };
  if (!overlay) return clampTaste(out, TASTE_LEAF_MAX);
  const anyEvidence = hasChemistryEvidence(draft);
  for (const dim of TASTE_DIMENSIONS) {
    const value = overlay[dim];
    if (value == null) continue;
    const labGap =
      LAB_GAP_DIMENSIONS.has(dim) || (dim === "spicy" && !!name && chiliHeatFood(name));
    if (!draft.evidence[dim] && !(anyEvidence && labGap)) {
      continue;
    }
    out[dim] = clampScore(value, TASTE_LEAF_MAX);
  }
  return clampTaste(out, TASTE_LEAF_MAX);
}
