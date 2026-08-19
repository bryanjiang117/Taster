import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLibsqlStats,
  incrementProductionTasteCount,
  readProductionTasteCount,
} from "./stats";

async function tempDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "taster-stats-"));
  const client = createClient({ url: `file:${path.join(dir, "stats.db")}` });
  return { client, stats: createLibsqlStats(client) };
}

describe("libsql taste stats", () => {
  const clients: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const client of clients) client.close();
    clients.length = 0;
  });

  it("reads zero before anyone has tasted", async () => {
    const { client, stats } = await tempDb();
    clients.push(client);

    expect(await stats.readTasteCount()).toBe(0);
  });

  it("increments atomically and returns the new total", async () => {
    const { client, stats } = await tempDb();
    clients.push(client);

    expect(await stats.incrementTasteCount()).toBe(1);
    expect(await stats.incrementTasteCount()).toBe(2);
    expect(await stats.readTasteCount()).toBe(2);
  });
});

describe("production taste stats env", () => {
  it("persists the count on TURSO_DATABASE_URL so the next read sees it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "taster-stats-env-"));
    const env = { TURSO_DATABASE_URL: `file:${path.join(dir, "stats.db")}` };

    expect(await readProductionTasteCount(env)).toBe(0);
    expect(await incrementProductionTasteCount(env)).toBe(1);
    expect(await readProductionTasteCount(env)).toBe(1);
  });

  it("requires TURSO_DATABASE_URL", async () => {
    await expect(readProductionTasteCount({})).rejects.toThrow(/TURSO_DATABASE_URL/);
    await expect(incrementProductionTasteCount({})).rejects.toThrow(
      /TURSO_DATABASE_URL/,
    );
  });
});
