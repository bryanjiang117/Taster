import {
  acidProcessFood,
  applyCalibration,
  draftTasteFromCompounds,
  hasChemistryEvidence,
  mergeCompoundLayers,
  type CompoundAmount,
} from "./chemistry";
import { sourceConfidence } from "./confidence";
import type { CompoundClass } from "./compounds";
import { findCompound } from "./compounds";
import type { DukeClient } from "./duke";
import type { FctClient } from "./fct";
import type { FoodbClient } from "./foodb";
import {
  pickConfirmedHits,
  type ChemistrySourceId,
  type SourcePicks,
  type SourceShortlist,
} from "./identity";
import { normalizeIngredientName } from "./normalize";
import type { PhenolClient } from "./phenol";
import { IngredientStore } from "./store";
import { clampTaste, TASTE_LEAF_MAX } from "./taste";
import type { ResolvedIngredient, TasteDimension, TasteProfile } from "./types";
import type { UmamiClient } from "./umamidb";
import type { FoodHit, UsdaClient } from "./usda";

export type LeafDeps = {
  store: IngredientStore;
  usda: UsdaClient;
  foodb: FoodbClient;
  fct?: FctClient;
  umami?: UmamiClient;
  phenol?: PhenolClient;
  duke?: DukeClient;
  origin?: { culture?: string; country?: string };
  confirmFoodShortlists?: (
    query: string,
    shortlists: SourceShortlist[],
  ) => Promise<SourcePicks>;
  calibrateLeaf?: (
    name: string,
    draft: TasteProfile,
    evidence: Record<TasteDimension, boolean>,
  ) => Promise<Partial<TasteProfile> | undefined>;
};

const PURE_COMPOUNDS: Record<string, { amounts: CompoundAmount[]; label: string }> = {
  msg: {
    label: "monosodium glutamate",
    amounts: [
      { id: "glutamate", amount: 78_000 },
      { id: "sodium", amount: 12_300 },
    ],
  },
  "monosodium glutamate": {
    label: "monosodium glutamate",
    amounts: [
      { id: "glutamate", amount: 78_000 },
      { id: "sodium", amount: 12_300 },
    ],
  },
};

const UMAMI_CLASSES = new Set<CompoundClass>(["glutamate", "nucleotide"]);
const PHENOL_CLASSES = new Set<CompoundClass>(["tannin", "naringin", "limonoid"]);
const DUKE_CLASSES = new Set<CompoundClass>([
  "capsaicinoid",
  "piperine",
  "gingerol",
  "isothiocyanate",
  "allicin",
  "sanshool",
  "alkaloid_bitter",
  "quinine",
  "glucosinolate",
  "tannin",
  "limonoid",
  "naringin",
]);

export async function tryChemistryLeaf(
  name: string,
  deps: LeafDeps,
): Promise<ResolvedIngredient | null> {
  const canonical = normalizeIngredientName(name);
  const cached = deps.store.get(canonical);
  if (cached) return cached;

  const pure = PURE_COMPOUNDS[canonical];
  if (pure) {
    return finishLeaf(canonical, pure.amounts, [pure.label], deps);
  }

  const shortlists = await collectShortlists(canonical, deps);
  if (!shortlists.length) return null;

  const picks = deps.confirmFoodShortlists
    ? await deps.confirmFoodShortlists(canonical, shortlists)
    : defaultPicks(shortlists);
  const confirmed = pickConfirmedHits(shortlists, picks);
  const confirmedSources = Object.keys(confirmed) as ChemistrySourceId[];
  if (!confirmedSources.length) return null;

  const amounts = await collectLayeredCompounds(confirmed, deps);
  if (!amounts.length) return null;
  const derivedFrom = confirmedSources
    .map((source) => confirmed[source]?.name)
    .filter(Boolean) as string[];
  return finishLeaf(
    canonical,
    amounts,
    derivedFrom,
    deps,
    confirmedSources.length > 1 ? "measured" : "nutrition",
    confirmedSources,
  );
}

async function collectShortlists(
  name: string,
  deps: LeafDeps,
): Promise<SourceShortlist[]> {
  const [umami, phenol, duke, foodb, fct, usda] = await Promise.all([
    hitsFrom(deps.umami, name),
    hitsFrom(deps.phenol, name),
    hitsFrom(deps.duke, name),
    hitsFrom(deps.foodb, name, deps.origin),
    hitsFrom(deps.fct, name, deps.origin),
    hitsFrom(deps.usda, name),
  ]);
  return (
    [
      { source: "umami", hits: umami },
      { source: "phenol", hits: phenol },
      { source: "duke", hits: duke },
      { source: "foodb", hits: foodb },
      { source: "fct", hits: fct },
      { source: "usda", hits: usda },
    ] as SourceShortlist[]
  ).filter((row) => row.hits.length);
}

function defaultPicks(shortlists: SourceShortlist[]): SourcePicks {
  const picks: SourcePicks = {};
  for (const list of shortlists) picks[list.source] = 0;
  return picks;
}

async function hitsFrom(
  client:
    | { candidates?(name: string, origin?: LeafDeps["origin"]): Promise<FoodHit[]> }
    | { search?(name: string): Promise<FoodHit | null> }
    | undefined,
  name: string,
  origin?: LeafDeps["origin"],
): Promise<FoodHit[]> {
  if (!client) return [];
  if ("candidates" in client && client.candidates) {
    return client.candidates(name, origin);
  }
  if ("search" in client && client.search) {
    const hit = await client.search(name);
    return hit ? [hit] : [];
  }
  return [];
}

async function collectLayeredCompounds(
  confirmed: Partial<Record<ChemistrySourceId, FoodHit>>,
  deps: LeafDeps,
): Promise<CompoundAmount[]> {
  const load = async (
    source: ChemistrySourceId,
    client: { compounds(id: string): Promise<CompoundAmount[]> } | undefined,
  ) => {
    const hit = confirmed[source];
    if (!hit || !client) return [];
    return client.compounds(hit.id);
  };
  const [umami, phenol, duke, foodb, fct, usda] = await Promise.all([
    load("umami", deps.umami),
    load("phenol", deps.phenol),
    load("duke", deps.duke),
    load("foodb", deps.foodb),
    load("fct", deps.fct),
    load("usda", deps.usda),
  ]);
  return mergeCompoundLayers([
    { amounts: filterClasses(umami, UMAMI_CLASSES) },
    { amounts: filterClasses(phenol, PHENOL_CLASSES) },
    { amounts: filterClasses(duke, DUKE_CLASSES) },
    { amounts: fct },
    { amounts: usda },
    { amounts: foodb },
  ]);
}

function filterClasses(
  amounts: CompoundAmount[],
  allowed: Set<CompoundClass>,
): CompoundAmount[] {
  return amounts.filter((row) => {
    const def = findCompound(row.id);
    return Boolean(def && allowed.has(def.class));
  });
}

async function finishLeaf(
  canonical: string,
  amounts: CompoundAmount[],
  derivedFrom: string[],
  deps: LeafDeps,
  source: ResolvedIngredient["source"] = "measured",
  measuredFrom: ChemistrySourceId[] = [],
): Promise<ResolvedIngredient | null> {
  if (deps.usda.supplementSugarsFromBranded) {
    amounts = await deps.usda.supplementSugarsFromBranded(canonical, amounts);
  }
  const draft = draftTasteFromCompounds(amounts);
  if (!hasChemistryEvidence(draft)) return null;
  // Fermented/pickled foods need acid chemistry; sodium-only USDA rows are incomplete.
  if (acidProcessFood(canonical) && !draft.evidence.sour) return null;
  let taste = draft.taste;
  if (deps.calibrateLeaf) {
    const overlay = await deps.calibrateLeaf(
      canonical,
      draft.taste,
      draft.evidence,
    );
    taste = applyCalibration(draft, overlay, canonical);
  }
  return {
    ingredient: canonical,
    taste: clampTaste(taste, TASTE_LEAF_MAX),
    derivedFrom,
    processing: [],
    confidence: sourceConfidence(source),
    source,
    measuredFrom: measuredFrom.length ? measuredFrom : undefined,
    reasoning: "Mapped from measured food compounds",
  };
}
