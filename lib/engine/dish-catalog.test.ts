import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDishRecord } from "./dish-cache";
import {
  createLibsqlDishCatalog,
  loadDishStore,
  loadProductionDishStore,
  persistProductionDish,
} from "./dish-catalog";
import type { TasteProfile } from "./taste";

const taste: TasteProfile = {
  sweet: 2,
  sour: 1,
  salty: 6,
  spicy: 7,
  umami: 8,
  bitter: 0,
};

function sampleRecord(name = "mapo tofu") {
  return createDishRecord(name, ["麻婆豆腐"], {
    origin: {
      dish: name,
      country: "China",
      culture: "Sichuan",
      nativeName: "麻婆豆腐",
      language: "Chinese",
      languageCode: "zh",
      searchQueries: ["麻婆豆腐 食谱"],
    },
    taste,
    confidence: 0.7,
    recipesAnalyzed: 3,
    representative: { ingredients: [], finalVolumeMl: 400 },
    provenance: [],
    ingredients: [],
  });
}

async function tempDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "taster-dishes-"));
  const client = createClient({ url: `file:${path.join(dir, "dishes.db")}` });
  return { client, catalog: createLibsqlDishCatalog(client) };
}

describe("libsql dish catalog", () => {
  const clients: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const client of clients) client.close();
    clients.length = 0;
  });

  it("upserts a dish and loads it back", async () => {
    const { client, catalog } = await tempDb();
    clients.push(client);
    const record = sampleRecord();
    await catalog.upsert(record);
    expect(await catalog.loadAll()).toEqual([record]);
  });

  it("overwrites the same canonical name on upsert", async () => {
    const { client, catalog } = await tempDb();
    clients.push(client);
    const first = sampleRecord();
    await catalog.upsert(first);
    const next = { ...first, timesTasted: 4, sampleCount: 3 };
    await catalog.upsert(next);
    const [row] = await catalog.loadAll();
    expect(row?.timesTasted).toBe(4);
    expect(row?.sampleCount).toBe(3);
  });
});

describe("production dish catalog env", () => {
  it("writes dishes to TURSO_DATABASE_URL so the next load sees them", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "taster-dish-env-"));
    const env = {
      ...process.env,
      TURSO_DATABASE_URL: `file:${path.join(dir, "catalog.db")}`,
    };
    const record = sampleRecord("dan dan noodles");
    expect(await persistProductionDish(record, env)).toBe(1);
    const store = await loadProductionDishStore(env);
    expect(store.get("dan dan noodles")?.timesTasted).toBe(1);
  });

  it("requires TURSO_DATABASE_URL", async () => {
    const env = { ...process.env, TURSO_DATABASE_URL: "" };
    await expect(loadProductionDishStore(env)).rejects.toThrow(/TURSO_DATABASE_URL/);
    await expect(persistProductionDish(sampleRecord(), env)).rejects.toThrow(
      /TURSO_DATABASE_URL/,
    );
  });
});

describe("loadDishStore", () => {
  it("indexes dishes by canonical name", async () => {
    const db = await tempDb();
    await db.catalog.upsert(sampleRecord());
    const store = await loadDishStore(db.catalog);
    db.client.close();
    expect(store.get("mapo tofu")?.aliases).toContain("麻婆豆腐");
  });
});
