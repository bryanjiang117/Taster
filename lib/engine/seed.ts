import { readFileSync } from "node:fs";
import path from "node:path";
import { IngredientStore } from "./store";
import type { ResolvedIngredient } from "./types";

/** Offline snapshot for unit tests. Production loads Turso only. */
export const SEED_PATH = path.join(
  process.cwd(),
  "lib/engine/testdata/ingredients.json",
);

export function loadSeedRecords(seedPath = SEED_PATH): ResolvedIngredient[] {
  return JSON.parse(readFileSync(seedPath, "utf8")) as ResolvedIngredient[];
}

export function loadSeedStore(seedPath = SEED_PATH): IngredientStore {
  return new IngredientStore(loadSeedRecords(seedPath));
}
