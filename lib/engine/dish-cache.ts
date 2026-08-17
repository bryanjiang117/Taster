import type { FoundIngredient } from "./found-ingredients";
import { emptyTaste, TASTE_DIMENSIONS, type TasteProfile } from "./taste";
import type { DishOrigin, ResolvedIngredient } from "./types";

export const DISH_OUTLIER_DISTANCE = 4;

export type SearchMode = "native" | "typed";

export type DishSnapshot = {
  origin: DishOrigin;
  taste: TasteProfile;
  confidence: number;
  recipesAnalyzed: number;
  representative: {
    ingredients: Array<{
      name: string;
      volumeMl: number;
      occurrence: { used: number; total: number };
    }>;
    finalVolumeMl: number;
  };
  provenance: ResolvedIngredient[];
  ingredients: FoundIngredient[];
  footnote?: string | null;
};

export type CachedDish = {
  canonicalName: string;
  aliases: string[];
  taste: TasteProfile;
  sampleCount: number;
  timesTasted: number;
  outlierCount: number;
  snapshot: DishSnapshot;
  updatedAt: string;
};

export type DishVisit =
  | { kind: "hit"; alias?: string }
  | { kind: "sample"; taste: TasteProfile; snapshot: DishSnapshot; alias?: string };

export function tasteDistance(a: TasteProfile, b: TasteProfile): number {
  let sum = 0;
  for (const dim of TASTE_DIMENSIONS) {
    const diff = (a[dim] ?? 0) - (b[dim] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function createDishRecord(
  canonicalName: string,
  aliases: string[],
  snapshot: DishSnapshot,
  now = () => new Date().toISOString(),
): CachedDish {
  return {
    canonicalName,
    aliases: uniqueAliases([canonicalName, ...aliases]),
    taste: snapshot.taste,
    sampleCount: 1,
    timesTasted: 1,
    outlierCount: 0,
    snapshot,
    updatedAt: now(),
  };
}

export function applyDishVisit(
  record: CachedDish,
  visit: DishVisit,
  now = () => new Date().toISOString(),
): CachedDish {
  const alias = visit.alias;
  const aliases = alias ? uniqueAliases([...record.aliases, alias]) : record.aliases;
  const timesTasted = record.timesTasted + 1;

  if (visit.kind === "hit") {
    return { ...record, aliases, timesTasted, updatedAt: now() };
  }

  const distance = tasteDistance(record.taste, visit.taste);
  if (distance > DISH_OUTLIER_DISTANCE) {
    return {
      ...record,
      aliases,
      timesTasted,
      outlierCount: record.outlierCount + 1,
      updatedAt: now(),
    };
  }

  return {
    ...record,
    aliases,
    timesTasted,
    sampleCount: record.sampleCount + 1,
    taste: runningMean(record.taste, record.sampleCount, visit.taste),
    snapshot: visit.snapshot,
    updatedAt: now(),
  };
}

function runningMean(
  current: TasteProfile,
  sampleCount: number,
  incoming: TasteProfile,
): TasteProfile {
  const next = emptyTaste();
  const n = sampleCount + 1;
  for (const dim of TASTE_DIMENSIONS) {
    next[dim] = ((current[dim] ?? 0) * sampleCount + (incoming[dim] ?? 0)) / n;
  }
  return next;
}

function uniqueAliases(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
