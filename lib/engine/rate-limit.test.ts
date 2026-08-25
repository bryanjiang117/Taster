import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLibsqlRateLimit,
  shouldRateLimit,
  tryStartProductionTaste,
  visitorFromRequest,
} from "./rate-limit";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function tempLimiter() {
  const dir = await mkdtemp(path.join(tmpdir(), "taster-rate-"));
  const client = createClient({
    url: `file:${path.join(dir, "rate.db")}`,
    timeout: 5_000,
  });
  return { client, limiter: createLibsqlRateLimit(client) };
}

async function starts(
  limiter: ReturnType<typeof createLibsqlRateLimit>,
  visitor: string,
  nowMs: number,
  n: number,
) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(await limiter.tryStart(visitor, nowMs));
  }
  return results;
}

describe("shouldRateLimit", () => {
  it("is off locally and on preview, on only in production", () => {
    expect(shouldRateLimit({})).toBe(false);
    expect(shouldRateLimit({ NODE_ENV: "production" })).toBe(false);
    expect(shouldRateLimit({ VERCEL_ENV: "development" })).toBe(false);
    expect(shouldRateLimit({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldRateLimit({ VERCEL_ENV: "production" })).toBe(true);
  });
});

describe("visitorFromRequest", () => {
  it("uses the first forwarded address and is stable", () => {
    const a = visitorFromRequest(
      new Request("https://taster.local/api/profile", {
        headers: { "x-forwarded-for": "1.1.1.1, 8.8.8.8" },
      }),
    );
    const b = visitorFromRequest(
      new Request("https://taster.local/api/profile", {
        headers: { "x-forwarded-for": "1.1.1.1" },
      }),
    );
    const other = visitorFromRequest(
      new Request("https://taster.local/api/profile", {
        headers: { "x-forwarded-for": "8.8.8.8" },
      }),
    );
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).not.toBe("1.1.1.1");
  });

  it("falls back to a shared unknown visitor when no address is present", () => {
    const a = visitorFromRequest(new Request("https://taster.local/api/profile"));
    const b = visitorFromRequest(new Request("https://taster.local/api/profile"));
    expect(a).toBe(b);
  });
});

describe("libsql taste rate limit", () => {
  const clients: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const client of clients) client.close();
    clients.length = 0;
  });

  it("allows 5 starts in a minute and blocks the 6th", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    const ok = await starts(limiter, "alice", 0, 5);
    const blocked = await limiter.tryStart("alice", 0);

    expect(ok.every((result) => result.ok)).toBe(true);
    expect(blocked).toEqual({
      ok: false,
      error: "Too many tastes this minute. Try again in a moment.",
    });
  });

  it("starts a fresh minute bucket when the clock ticks over", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    await starts(limiter, "alice", 0, 5);
    expect(await limiter.tryStart("alice", MINUTE)).toEqual({ ok: true });
  });

  it("blocks a 16th start in the same hour even across minutes", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    await starts(limiter, "alice", 0, 5);
    await starts(limiter, "alice", MINUTE, 5);
    await starts(limiter, "alice", MINUTE * 2, 5);
    const blocked = await limiter.tryStart("alice", MINUTE * 3);

    expect(blocked).toEqual({
      ok: false,
      error: "Too many tastes this hour. Try again later.",
    });
  });

  it("blocks a 26th start in the same day even across hours", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    await starts(limiter, "alice", 0, 5);
    await starts(limiter, "alice", MINUTE, 5);
    await starts(limiter, "alice", MINUTE * 2, 5);
    await starts(limiter, "alice", HOUR, 5);
    await starts(limiter, "alice", HOUR + MINUTE, 5);
    const blocked = await limiter.tryStart("alice", HOUR * 2);

    expect(blocked).toEqual({
      ok: false,
      error: "Too many tastes today. Try again later.",
    });
  });

  it("does not count a blocked start toward a larger window", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    await starts(limiter, "alice", 0, 5);
    expect((await limiter.tryStart("alice", 0)).ok).toBe(false);
    await starts(limiter, "alice", MINUTE, 5);
    expect((await limiter.tryStart("alice", MINUTE)).ok).toBe(false);
    const thirdMinute = await starts(limiter, "alice", MINUTE * 2, 5);

    expect(thirdMinute.every((result) => result.ok)).toBe(true);
  });

  it("tracks visitors separately", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    await starts(limiter, "alice", 0, 5);
    expect(await limiter.tryStart("bob", 0)).toEqual({ ok: true });
  });

  it("resets the day bucket after a day", async () => {
    const { client, limiter } = await tempLimiter();
    clients.push(client);

    await starts(limiter, "alice", 0, 5);
    await starts(limiter, "alice", MINUTE, 5);
    await starts(limiter, "alice", MINUTE * 2, 5);
    await starts(limiter, "alice", HOUR, 5);
    await starts(limiter, "alice", HOUR + MINUTE, 5);
    expect(await limiter.tryStart("alice", DAY)).toEqual({ ok: true });
  });
});

describe("production taste rate limit env", () => {
  it("lets local requests through without Turso", async () => {
    const result = await tryStartProductionTaste(
      new Request("https://taster.local/api/profile"),
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  it("requires TURSO_DATABASE_URL in production", async () => {
    await expect(
      tryStartProductionTaste(new Request("https://taster.local/api/profile"), {
        VERCEL_ENV: "production",
      }),
    ).rejects.toThrow(/TURSO_DATABASE_URL/);
  });

  it("enforces the limit in production", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "taster-rate-env-"));
    const env = {
      VERCEL_ENV: "production",
      TURSO_DATABASE_URL: `file:${path.join(dir, "rate.db")}`,
    };
    const request = new Request("https://taster.local/api/profile", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });

    for (let i = 0; i < 5; i++) {
      expect(await tryStartProductionTaste(request, env)).toEqual({ ok: true });
    }
    expect(await tryStartProductionTaste(request, env)).toEqual({
      ok: false,
      error: "Too many tastes this minute. Try again in a moment.",
    });
  });
});
