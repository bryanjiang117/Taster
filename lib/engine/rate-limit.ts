import { createHash } from "node:crypto";
import { createClient, type Client } from "@libsql/client";

export type RateLimitResult = { ok: true } | { ok: false; error: string };

export type TasteRateLimit = {
  tryStart(visitor: string, nowMs?: number): Promise<RateLimitResult>;
};

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS rate_limits (
  visitor TEXT NOT NULL,
  window TEXT NOT NULL,
  start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (visitor, window)
)`;

const MISSING_URL = "TURSO_DATABASE_URL is not set.";

const WINDOWS = [
  {
    name: "minute",
    durationMs: 60_000,
    max: 5,
    error: "Too many tastes this minute. Try again in a moment.",
  },
  {
    name: "hour",
    durationMs: 3_600_000,
    max: 15,
    error: "Too many tastes this hour. Try again later.",
  },
  {
    name: "day",
    durationMs: 86_400_000,
    max: 25,
    error: "Too many tastes today. Try again later.",
  },
] as const;

export function shouldRateLimit(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.VERCEL_ENV === "production";
}

export function visitorFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

export function createLibsqlRateLimit(client: Client): TasteRateLimit {
  let ready: Promise<void> | undefined;

  const ensureTable = () => {
    ready ??= client.execute(CREATE_TABLE).then(() => undefined);
    return ready;
  };

  return {
    async tryStart(visitor, nowMs = Date.now()) {
      await ensureTable();
      const tx = await client.transaction("write");
      try {
        for (const window of WINDOWS) {
          const start = Math.floor(nowMs / window.durationMs) * window.durationMs;
          const result = await tx.execute({
            sql: "SELECT start, count FROM rate_limits WHERE visitor = ? AND window = ?",
            args: [visitor, window.name],
          });
          const row = result.rows[0];
          const count =
            row && Number(row["start"]) === start ? Number(row["count"]) : 0;
          if (count >= window.max) {
            await tx.rollback();
            return { ok: false, error: window.error };
          }
        }

        for (const window of WINDOWS) {
          const start = Math.floor(nowMs / window.durationMs) * window.durationMs;
          await tx.execute({
            sql: `INSERT INTO rate_limits (visitor, window, start, count)
                  VALUES (?, ?, ?, 1)
                  ON CONFLICT(visitor, window) DO UPDATE SET
                    count = CASE
                      WHEN rate_limits.start = excluded.start THEN rate_limits.count + 1
                      ELSE 1
                    END,
                    start = excluded.start`,
            args: [visitor, window.name, start],
          });
        }

        await tx.commit();
        return { ok: true };
      } finally {
        tx.close();
      }
    },
  };
}

export function rateLimitFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TasteRateLimit | undefined {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!url) return undefined;
  return createLibsqlRateLimit(createClient({ url, authToken }));
}

function requireRateLimit(env: NodeJS.ProcessEnv): TasteRateLimit {
  const limiter = rateLimitFromEnv(env);
  if (!limiter) throw new Error(MISSING_URL);
  return limiter;
}

export async function tryStartProductionTaste(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RateLimitResult> {
  if (!shouldRateLimit(env)) return { ok: true };
  return requireRateLimit(env).tryStart(visitorFromRequest(request));
}
