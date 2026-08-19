import { readFileSync } from "node:fs";
import path from "node:path";
import type { CompoundAmount } from "./chemistry";
import type { FoodHit } from "./usda";

export type DumpFood = {
  name: string;
  region?: string;
  part?: string;
  compounds: CompoundAmount[];
};

export type TasteDump = {
  byName: Record<string, string>;
  byId: Record<string, DumpFood>;
};

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
  "oil",
]);

function dumpKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchQueries(name: string): string[] {
  const query = dumpKey(name);
  if (!query) return [];
  const stripped = query
    .split(" ")
    .filter((token) => !PREP_WORDS.has(token))
    .join(" ");
  return stripped && stripped !== query ? [query, stripped] : [query];
}

const PREPARED_DISH =
  /\b(con carne|home recipe|in recipe|takeaway|preemball|pr emball|microwavable|with beans|canned|powder|cakes|curry|alfredo|entree|dinner|bowl)\b/;

function matchScore(query: string, name: string): number {
  if (name === query) return 1000;
  const qTokens = query.split(" ").filter(Boolean);
  const nTokens = name.split(" ").filter(Boolean);
  if (!qTokens.length || !nTokens.length) return 0;

  if (qTokens.length >= 2) {
    if (qTokens.every((token) => nTokens.includes(token))) return 500 - name.length;
    return 0;
  }

  const token = qTokens[0]!;
  if (nTokens.length === 1 && nTokens[0] === token) return 1000;
  if (nTokens[0] === token && !PREPARED_DISH.test(name)) return 850 - name.length;
  if (nTokens.length === 2 && nTokens[1] === token) return 750 - name.length;
  return 0;
}

const REGION_ALIASES: Record<string, string[]> = {
  "western africa": [
    "nigeria",
    "ghana",
    "senegal",
    "benin",
    "togo",
    "mali",
    "ivory coast",
    "cote divoire",
    "yoruba",
    "africa",
  ],
  ethiopia: ["ethiopia", "eritrea", "africa"],
  mexico: ["mexico", "mexican"],
  japan: ["japan", "japanese"],
  kenya: ["kenya", "kenyan", "africa"],
  france: ["france", "french"],
  denmark: ["denmark", "danish"],
};

function originBonus(
  food: DumpFood,
  origin?: { culture?: string; country?: string },
): number {
  if (!food.region || !origin) return 0;
  const region = food.region.toLowerCase();
  const hay = `${origin.culture ?? ""} ${origin.country ?? ""}`.toLowerCase();
  if (!hay.trim()) return 0;
  if (hay.includes(region) || region.split(" ").some((part) => hay.includes(part) && part.length > 3)) {
    return 80;
  }
  const aliases = REGION_ALIASES[region] ?? [];
  if (aliases.some((alias) => hay.includes(alias))) return 80;
  return 0;
}

export class DumpClient {
  private cached: TasteDump | null = null;

  constructor(private readonly dumpPath: string) {}

  private resolvedPath(): string {
    return path.isAbsolute(this.dumpPath)
      ? this.dumpPath
      : path.join(process.cwd(), this.dumpPath);
  }

  private load(): TasteDump {
    if (this.cached) return this.cached;
    try {
      this.cached = JSON.parse(readFileSync(this.resolvedPath(), "utf8")) as TasteDump;
    } catch {
      this.cached = { byName: {}, byId: {} };
    }
    return this.cached;
  }

  candidates(
    name: string,
    origin?: { culture?: string; country?: string },
    limit = 5,
  ): FoodHit[] {
    const dump = this.load();
    const ranked: Array<{ score: number; id: string; name: string }> = [];
    const seen = new Set<string>();
    for (const query of searchQueries(name)) {
      for (const [rawName, id] of Object.entries(dump.byName)) {
        if (seen.has(id)) continue;
        const food = dump.byId[id];
        if (!food?.compounds.length) continue;
        const nameScore = matchScore(query, dumpKey(rawName));
        if (nameScore <= 0) continue;
        const score = nameScore + originBonus(food, origin);
        seen.add(id);
        ranked.push({ score, id, name: food.name });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit).map((row) => ({ id: row.id, name: row.name }));
  }

  compounds(id: string): CompoundAmount[] {
    if (!id) return [];
    return this.load().byId[id]?.compounds ?? [];
  }
}
