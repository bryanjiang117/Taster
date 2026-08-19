import type { CompoundAmount } from "./chemistry";
import type { FoodHit } from "./usda";
import { DumpClient } from "./dump";
import { findCompound } from "./compounds";

export const UMAMI_DUMP_PATH = "lib/engine/testdata/umami-taste.json";

const UMAMI_IDS = new Set(["glutamate", "imp", "gmp", "amp"]);

export type UmamiRow = {
  name?: string;
  amount?: number;
};

export function compoundsFromUmamiRows(rows: UmamiRow[]): CompoundAmount[] {
  const out: CompoundAmount[] = [];
  for (const row of rows) {
    if (row.amount == null || row.amount <= 0) continue;
    const def = findCompound(row.name ?? "");
    if (!def || !UMAMI_IDS.has(def.id)) continue;
    out.push({ id: def.id, amount: row.amount });
  }
  return out;
}

export interface UmamiClient {
  candidates(name: string): Promise<FoodHit[]>;
  compounds(id: string): Promise<CompoundAmount[]>;
}

export class UmamiDumpClient implements UmamiClient {
  private readonly dump: DumpClient;
  constructor(dumpPath = UMAMI_DUMP_PATH) {
    this.dump = new DumpClient(dumpPath);
  }
  async candidates(name: string): Promise<FoodHit[]> {
    return this.dump.candidates(name);
  }
  async compounds(id: string): Promise<CompoundAmount[]> {
    return this.dump.compounds(id);
  }
}

export const emptyUmamiClient: UmamiClient = {
  candidates: async () => [],
  compounds: async () => [],
};
