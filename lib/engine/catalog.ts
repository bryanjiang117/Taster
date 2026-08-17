import { createClient, type Client } from "@libsql/client";
import { IngredientStore } from "./store";
import { normalizeIngredientName } from "./normalize";
import type { ResolvedIngredient } from "./types";

export type IngredientCatalog = {
  loadAll(): Promise<ResolvedIngredient[]>;
  insertNew(rows: ResolvedIngredient[]): Promise<number>;
};

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS ingredients (
  name TEXT PRIMARY KEY,
  record TEXT NOT NULL
)`;

const MISSING_URL = "TURSO_DATABASE_URL is not set.";

export function createLibsqlCatalog(client: Client): IngredientCatalog {
  let ready: Promise<void> | undefined;

  const ensureTable = () => {
    ready ??= client.execute(CREATE_TABLE).then(() => undefined);
    return ready;
  };

  return {
    async loadAll() {
      await ensureTable();
      const result = await client.execute("SELECT record FROM ingredients ORDER BY name");
      return result.rows.map((row) => JSON.parse(String(row["record"])) as ResolvedIngredient);
    },

    async insertNew(rows) {
      await ensureTable();
      let added = 0;
      for (const item of rows) {
        const name = normalizeIngredientName(item.ingredient);
        if (!name) continue;
        const record: ResolvedIngredient = { ...item, ingredient: name };
        const result = await client.execute({
          sql: "INSERT OR IGNORE INTO ingredients (name, record) VALUES (?, ?)",
          args: [name, JSON.stringify(record)],
        });
        added += result.rowsAffected;
      }
      return added;
    },
  };
}

export async function loadIngredientStore(
  catalog: IngredientCatalog,
): Promise<IngredientStore> {
  return new IngredientStore(await catalog.loadAll());
}

export function catalogFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IngredientCatalog | undefined {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!url) return undefined;
  return createLibsqlCatalog(createClient({ url, authToken }));
}

function requireCatalog(env: NodeJS.ProcessEnv): IngredientCatalog {
  const catalog = catalogFromEnv(env);
  if (!catalog) throw new Error(MISSING_URL);
  return catalog;
}

export async function loadProductionStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<IngredientStore> {
  return loadIngredientStore(requireCatalog(env));
}

export async function persistProductionLearned(
  learned: ResolvedIngredient[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return requireCatalog(env).insertNew(learned);
}
