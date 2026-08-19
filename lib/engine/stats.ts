import { createClient, type Client } from "@libsql/client";

export type TasteStats = {
  readTasteCount(): Promise<number>;
  incrementTasteCount(): Promise<number>;
};

const TASTE_COUNT_KEY = "taste_count";

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
)`;

const SEED = {
  sql: "INSERT OR IGNORE INTO stats (key, value) VALUES (?, 0)",
  args: [TASTE_COUNT_KEY],
};

const MISSING_URL = "TURSO_DATABASE_URL is not set.";

export function createLibsqlStats(client: Client): TasteStats {
  let ready: Promise<void> | undefined;

  const ensureTable = () => {
    ready ??= client
      .execute(CREATE_TABLE)
      .then(() => client.execute(SEED))
      .then(() => undefined);
    return ready;
  };

  return {
    async readTasteCount() {
      await ensureTable();
      const result = await client.execute({
        sql: "SELECT value FROM stats WHERE key = ?",
        args: [TASTE_COUNT_KEY],
      });
      return Number(result.rows[0]?.["value"] ?? 0);
    },

    async incrementTasteCount() {
      await ensureTable();
      const result = await client.execute({
        sql: "UPDATE stats SET value = value + 1 WHERE key = ? RETURNING value",
        args: [TASTE_COUNT_KEY],
      });
      return Number(result.rows[0]?.["value"] ?? 0);
    },
  };
}

export function statsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TasteStats | undefined {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!url) return undefined;
  return createLibsqlStats(createClient({ url, authToken }));
}

function requireStats(env: NodeJS.ProcessEnv): TasteStats {
  const stats = statsFromEnv(env);
  if (!stats) throw new Error(MISSING_URL);
  return stats;
}

export async function readProductionTasteCount(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return requireStats(env).readTasteCount();
}

export async function incrementProductionTasteCount(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return requireStats(env).incrementTasteCount();
}
