import { findCompound } from "./compounds";
import type { CompoundAmount } from "./chemistry";
import type { FoodHit } from "./usda";
import { DumpClient, type TasteDump } from "./dump";

export type InfoodsNutrient = {
  tag?: string;
  name?: string;
  amount?: number;
  unit?: string;
};

const TAG_TO_COMPOUND: Record<string, string> = {
  NA: "sodium",
  "NA+": "sodium",
  SUCS: "sucrose",
  GLUS: "glucose",
  FRUS: "fructose",
  LACS: "lactose",
  MALS: "maltose",
  CITAC: "citric_acid",
  MALAC: "malic_acid",
  ACEAC: "acetic_acid",
  LACAC: "lactic_acid",
  CAFFN: "caffeine",
};

const TOTAL_SUGAR_TAGS = new Set(["SUGAR", "SUGAR-"]);
const SPECIFIC_SUGARS = new Set(["sucrose", "glucose", "fructose", "lactose", "maltose"]);
const SKIP_TAGS = new Set(["K", "VITC", "GLU", "GLU-", "PROT", "PROCNT"]);

export const FCT_DUMP_PATH = "lib/engine/testdata/fct-taste.json";

export function compoundsFromInfoods(rows: InfoodsNutrient[]): CompoundAmount[] {
  const mapped: CompoundAmount[] = [];
  let totalSugars: number | undefined;
  for (const row of rows) {
    if (row.amount == null || row.amount <= 0) continue;
    const tag = (row.tag ?? "").toUpperCase().replace(/\s+/g, "");
    if (SKIP_TAGS.has(tag)) continue;
    if (TOTAL_SUGAR_TAGS.has(tag)) {
      totalSugars = toGrams(row.amount, row.unit);
      continue;
    }
    const id = TAG_TO_COMPOUND[tag] ?? findCompound(row.name ?? "")?.id;
    if (!id) continue;
    mapped.push({ id, amount: scaleAmount(id, row.amount, row.unit) });
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

function scaleAmount(id: string, amount: number, unit?: string): number {
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

export interface FctClient {
  candidates(name: string, origin?: { culture?: string; country?: string }): Promise<FoodHit[]>;
  compounds(id: string): Promise<CompoundAmount[]>;
}

export class FctDumpClient implements FctClient {
  private readonly dump: DumpClient;
  constructor(dumpPath = FCT_DUMP_PATH) {
    this.dump = new DumpClient(dumpPath);
  }

  async candidates(
    name: string,
    origin?: { culture?: string; country?: string },
  ): Promise<FoodHit[]> {
    return this.dump.candidates(name, origin);
  }

  async compounds(id: string): Promise<CompoundAmount[]> {
    return this.dump.compounds(id);
  }
}

export const emptyFctClient: FctClient = {
  candidates: async () => [],
  compounds: async () => [],
};

export type { TasteDump };
