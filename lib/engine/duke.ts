import { findCompound } from "./compounds";
import type { CompoundAmount } from "./chemistry";
import type { FoodHit } from "./usda";
import { DumpClient } from "./dump";

export type DukeRow = {
  name?: string;
  lowPpm?: number;
  highPpm?: number;
  part?: string;
};

export const DUKE_DUMP_PATH = "lib/engine/testdata/duke-taste.json";

/** 1 ppm = 1 mg/kg = 0.1 mg/100g. Use the midpoint of the reported range. */
export function compoundsFromDukeRows(rows: DukeRow[]): CompoundAmount[] {
  const out: CompoundAmount[] = [];
  for (const row of rows) {
    const ppm = dukeMidpointPpm(row.lowPpm, row.highPpm);
    if (ppm == null) continue;
    const def = findCompound(row.name ?? "");
    if (!def) continue;
    out.push({ id: def.id, amount: ppm / 10 });
  }
  return out;
}

export function dukeMidpointPpm(
  low?: number,
  high?: number,
): number | null {
  const values = [low, high].filter((n): n is number => n != null && n > 0);
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export interface DukeClient {
  candidates(name: string): Promise<FoodHit[]>;
  compounds(id: string): Promise<CompoundAmount[]>;
}

export class DukeDumpClient implements DukeClient {
  private readonly dump: DumpClient;
  constructor(dumpPath = DUKE_DUMP_PATH) {
    this.dump = new DumpClient(dumpPath);
  }
  async candidates(name: string): Promise<FoodHit[]> {
    return this.dump.candidates(name);
  }
  async compounds(id: string): Promise<CompoundAmount[]> {
    return this.dump.compounds(id);
  }
}

export const emptyDukeClient: DukeClient = {
  candidates: async () => [],
  compounds: async () => [],
};
