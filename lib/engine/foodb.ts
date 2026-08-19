import { readFileSync } from "node:fs";
import path from "node:path";
import { findCompound } from "./compounds";
import type { CompoundAmount } from "./chemistry";
import type { FoodHit } from "./usda";

export type FoodbContent = {
  name?: string;
  origContent?: number | string;
  origUnit?: string;
  standardContent?: number | string;
};

export interface FoodbClient {
  search(name: string): Promise<FoodHit | null>;
  candidates?(name: string): Promise<FoodHit[]>;
  compounds(id: string): Promise<CompoundAmount[]>;
}

export const FOODB_DUMP_PATH = path.join(
  process.cwd(),
  "lib/engine/testdata/foodb-taste.json",
);

type DumpFood = {
  name: string;
  compounds: CompoundAmount[];
};

type FoodbDump = {
  byName: Record<string, string>;
  byId: Record<string, DumpFood>;
};

export function compoundsFromFoodbContents(rows: FoodbContent[]): CompoundAmount[] {
  const out: CompoundAmount[] = [];
  for (const row of rows) {
    const amount = parseFoodbAmount(row);
    if (amount == null || amount <= 0) continue;
    const def = findCompound(row.name ?? "");
    if (!def) continue;
    out.push({ id: def.id, amount });
  }
  return out;
}

function parseFoodbAmount(row: FoodbContent): number | null {
  const raw = row.origContent ?? row.standardContent;
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (row.origUnit ?? "").toLowerCase().replace(/\s+/g, "");
  if (unit.includes("g/100") && !unit.startsWith("mg")) return value * 1000;
  if (unit.includes("ug") || unit.includes("µg")) return value / 1000;
  return value;
}

const PREP_WORDS = new Set([
  "juice",
  "paste",
  "puree",
  "pulp",
  "concentrate",
  "powder",
  "grated",
  "minced",
  "chopped",
  "sliced",
  "fresh",
  "raw",
  "dried",
  "canned",
  "bottled",
  "unsweetened",
  "sweetened",
  "ground",
  "whole",
  "crushed",
  "peeled",
  "leaf",
  "leaves",
  "greater",
  "lesser",
  "oil",
]);

const NON_TASTE_IDS = new Set([
  "potassium",
  "ascorbic_acid",
  "glutamic_acid_bound",
  "aspartate",
]);

function searchQueries(name: string): string[] {
  const query = dumpKey(name);
  if (!query) return [];
  const stripped = query
    .split(" ")
    .filter((token) => !PREP_WORDS.has(token))
    .join(" ");
  return stripped && stripped !== query ? [query, stripped] : [query];
}

function usefulCount(compounds: CompoundAmount[]): number {
  return compounds.filter((row) => !NON_TASTE_IDS.has(row.id)).length;
}

function dumpKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_MODIFIERS = new Set([
  "black",
  "white",
  "red",
  "green",
  "yellow",
  "pink",
  "hot",
  "dried",
  "fresh",
  "wild",
  "common",
  "garden",
  "persian",
  "greater",
  "lesser",
]);

function matchScore(query: string, name: string): number {
  if (name === query) return 1000;
  if (name.startsWith(`${query} `)) return 800 - name.length;
  if (name.endsWith(` ${query}`)) return 700 - name.length;
  if (name.includes(` ${query} `)) return 600 - name.length;
  const qTokens = query.split(" ");
  const nTokens = name.split(" ");
  if (qTokens.every((token) => nTokens.includes(token))) return 500 - name.length;
  const last = qTokens[qTokens.length - 1];
  const dropped = qTokens.slice(0, -1);
  if (
    qTokens.length >= 2 &&
    nTokens[0] === last &&
    dropped.every((token) => NAME_MODIFIERS.has(token))
  ) {
    return 400 - name.length;
  }
  return 0;
}

let cachedDump: FoodbDump | null = null;

function loadDump(dumpPath: string): FoodbDump {
  if (dumpPath === FOODB_DUMP_PATH && cachedDump) return cachedDump;
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as FoodbDump;
  if (dumpPath === FOODB_DUMP_PATH) cachedDump = dump;
  return dump;
}

function rankDumpHits(
  dump: FoodbDump,
  query: string,
): Array<{ score: number; useful: number; id: string; name: string }> {
  const close: Array<{ score: number; useful: number; id: string; name: string }> =
    [];
  const fuzzy: Array<{ score: number; useful: number; id: string; name: string }> =
    [];
  for (const [rawName, id] of Object.entries(dump.byName)) {
    const food = dump.byId[id];
    if (!food?.compounds.length) continue;
    const score = matchScore(query, dumpKey(rawName));
    if (score <= 0) continue;
    const row = { score, useful: usefulCount(food.compounds), id, name: food.name };
    if (score >= 700) close.push(row);
    else fuzzy.push(row);
  }
  close.sort((a, b) => b.useful - a.useful || b.score - a.score);
  fuzzy.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: Array<{ score: number; useful: number; id: string; name: string }> = [];
  for (const row of [...close, ...fuzzy]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export class FoodbDumpClient implements FoodbClient {
  constructor(private readonly dumpPath = FOODB_DUMP_PATH) {}

  async search(name: string): Promise<FoodHit | null> {
    const hits = await this.candidates(name);
    return hits[0] ?? null;
  }

  async candidates(name: string): Promise<FoodHit[]> {
    const dump = loadDump(this.dumpPath);
    const ranked: Array<{ score: number; useful: number; id: string; name: string }> =
      [];
    const seen = new Set<string>();
    for (const [index, query] of searchQueries(name).entries()) {
      for (const hit of rankDumpHits(dump, query)) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        ranked.push({ ...hit, score: hit.score - index * 40 });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, 5).map((hit) => ({ id: hit.id, name: hit.name }));
  }

  async compounds(id: string): Promise<CompoundAmount[]> {
    if (!id) return [];
    const food = loadDump(this.dumpPath).byId[id];
    return food?.compounds ?? [];
  }
}

export const emptyFoodbClient: FoodbClient = {
  search: async () => null,
  candidates: async () => [],
  compounds: async () => [],
};
