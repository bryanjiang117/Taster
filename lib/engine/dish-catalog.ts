import { createClient, type Client } from "@libsql/client";
import type { CachedDish } from "./dish-cache";
import { DishStore } from "./dish-store";
import { normalizeIngredientName } from "./normalize";

export type DishCatalog = {
  loadAll(): Promise<CachedDish[]>;
  upsert(record: CachedDish): Promise<number>;
};

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS dishes (
  name TEXT PRIMARY KEY,
  record TEXT NOT NULL
)`;

const MISSING_URL = "TURSO_DATABASE_URL is not set.";

export function createLibsqlDishCatalog(client: Client): DishCatalog {
  let ready: Promise<void> | undefined;

  const ensureTable = () => {
    ready ??= client.execute(CREATE_TABLE).then(() => undefined);
    return ready;
  };

  return {
    async loadAll() {
      await ensureTable();
      const result = await client.execute("SELECT record FROM dishes ORDER BY name");
      return result.rows.map((row) => JSON.parse(String(row["record"])) as CachedDish);
    },

    async upsert(record) {
      await ensureTable();
      const name = normalizeIngredientName(record.canonicalName);
      if (!name) return 0;
      const stored: CachedDish = { ...record, canonicalName: name };
      const result = await client.execute({
        sql: "INSERT OR REPLACE INTO dishes (name, record) VALUES (?, ?)",
        args: [name, JSON.stringify(stored)],
      });
      return result.rowsAffected;
    },
  };
}

export async function loadDishStore(catalog: DishCatalog): Promise<DishStore> {
  return new DishStore(await catalog.loadAll());
}

export function dishCatalogFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DishCatalog | undefined {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!url) return undefined;
  return createLibsqlDishCatalog(createClient({ url, authToken }));
}

function requireCatalog(env: NodeJS.ProcessEnv): DishCatalog {
  const catalog = dishCatalogFromEnv(env);
  if (!catalog) throw new Error(MISSING_URL);
  return catalog;
}

export async function loadProductionDishStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DishStore> {
  return loadDishStore(requireCatalog(env));
}

export async function persistProductionDish(
  record: CachedDish,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return requireCatalog(env).upsert(record);
}
