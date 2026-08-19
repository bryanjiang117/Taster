import { findCompound, type CompoundClass } from "./compounds";
import type { CompoundAmount } from "./chemistry";
import type { FoodHit } from "./usda";
import { DumpClient } from "./dump";

export type PhenolRow = {
  name?: string;
  amount?: number;
  unit?: string;
};

const POLYPHENOL_CLASSES = new Set<CompoundClass>(["tannin", "naringin", "limonoid"]);

export const PHENOL_DUMP_PATH = "lib/engine/testdata/phenol-taste.json";

export function compoundsFromPhenolRows(rows: PhenolRow[]): CompoundAmount[] {
  const out: CompoundAmount[] = [];
  for (const row of rows) {
    if (row.amount == null || row.amount <= 0) continue;
    const def = findCompound(cleanPhenolName(row.name ?? ""));
    if (!def || !POLYPHENOL_CLASSES.has(def.class)) continue;
    out.push({ id: def.id, amount: row.amount });
  }
  return out;
}

function cleanPhenolName(name: string): string {
  return name.replace(/^\([+-]\)-/, "").replace(/^[+-]-/, "").trim();
}

export interface PhenolClient {
  candidates(name: string): Promise<FoodHit[]>;
  compounds(id: string): Promise<CompoundAmount[]>;
}

export class PhenolDumpClient implements PhenolClient {
  private readonly dump: DumpClient;
  constructor(dumpPath = PHENOL_DUMP_PATH) {
    this.dump = new DumpClient(dumpPath);
  }
  async candidates(name: string): Promise<FoodHit[]> {
    return this.dump.candidates(name);
  }
  async compounds(id: string): Promise<CompoundAmount[]> {
    return this.dump.compounds(id);
  }
}

export const emptyPhenolClient: PhenolClient = {
  candidates: async () => [],
  compounds: async () => [],
};
