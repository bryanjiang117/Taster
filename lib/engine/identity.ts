import type { FoodHit } from "./usda";

export const CHEMISTRY_SOURCES = [
  "umami",
  "phenol",
  "duke",
  "foodb",
  "fct",
  "usda",
] as const;

export type ChemistrySourceId = (typeof CHEMISTRY_SOURCES)[number];

export const CHEMISTRY_SOURCE_LABELS: Record<ChemistrySourceId, string> = {
  umami: "UmamiDB",
  phenol: "Phenol-Explorer",
  duke: "Dr. Duke",
  foodb: "FooDB",
  fct: "FAO/INFOODS",
  usda: "USDA",
};

export type SourceShortlist = {
  source: ChemistrySourceId;
  hits: FoodHit[];
};

export type SourcePicks = Partial<Record<ChemistrySourceId, number | null>>;

export function pickConfirmedHits(
  shortlists: SourceShortlist[],
  picks: SourcePicks,
): Partial<Record<ChemistrySourceId, FoodHit>> {
  const out: Partial<Record<ChemistrySourceId, FoodHit>> = {};
  for (const list of shortlists) {
    const index = picks[list.source];
    if (index == null || !Number.isInteger(index)) continue;
    const hit = list.hits[index];
    if (hit) out[list.source] = hit;
  }
  return out;
}
