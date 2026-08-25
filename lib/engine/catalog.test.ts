import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLibsqlCatalog,
  loadIngredientStore,
  loadProductionStore,
  persistProductionLearned,
} from "./catalog";
import type { ResolvedIngredient } from "./types";

const salt: ResolvedIngredient = {
  ingredient: "salt",
  taste: { sweet: 0, sour: 0, salty: 12, spicy: 0, umami: 0, bitter: 0 },
  derivedFrom: [],
  processing: [],
  confidence: 0.95,
  source: "measured",
};

const kaffir: ResolvedIngredient = {
  ingredient: "kaffir lime leaf",
  taste: { sweet: 0, sour: 2, salty: 0, spicy: 0, umami: 0, bitter: 3 },
  derivedFrom: [],
  processing: [],
  confidence: 0.3,
  source: "llm",
  reasoning: "citrus leaf",
};

async function tempDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "taster-libsql-"));
  const client = createClient({ url: `file:${path.join(dir, "ingredients.db")}` });
  return { client, catalog: createLibsqlCatalog(client) };
}

describe("libsql ingredient catalog", () => {
  const clients: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const client of clients) client.close();
    clients.length = 0;
  });

  it("inserts new ingredients and loads them back", async () => {
    const { client, catalog } = await tempDb();
    clients.push(client);

    const added = await catalog.insertNew([kaffir]);
    expect(added).toBe(1);
    expect(await catalog.loadAll()).toEqual([
      { ...kaffir, ingredient: "kaffir lime leaf" },
    ]);
  });

  it("does not overwrite an existing catalog row", async () => {
    const { client, catalog } = await tempDb();
    clients.push(client);

    await catalog.insertNew([kaffir]);
    const added = await catalog.insertNew([
      {
        ...kaffir,
        source: "measured",
        confidence: 0.95,
        taste: { ...kaffir.taste, bitter: 9 },
      },
    ]);

    expect(added).toBe(0);
    const [row] = await catalog.loadAll();
    expect(row?.confidence).toBe(0.3);
    expect(row?.taste.bitter).toBe(3);
  });
});

describe("loadIngredientStore", () => {
  it("loads the catalog into the store with no JSON seed", async () => {
    const db = await tempDb();
    await db.catalog.insertNew([salt, kaffir]);

    const store = await loadIngredientStore(db.catalog);
    db.client.close();

    expect(store.get("salt")).toEqual(salt);
    expect(store.get("kaffir lime leaf")?.source).toBe("llm");
  });
});

describe("production catalog env", () => {
  it("writes learned ingredients to TURSO_DATABASE_URL so the next load sees them", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "taster-turso-env-"));
    const env = { TURSO_DATABASE_URL: `file:${path.join(dir, "catalog.db")}` };

    const invented: ResolvedIngredient = {
      ...kaffir,
      ingredient: "zz taster catalog fenugreek husk",
    };
    expect(await persistProductionLearned([invented], env)).toBe(1);

    const store = await loadProductionStore(env);
    expect(store.get("zz taster catalog fenugreek husk")?.source).toBe("llm");
    expect(store.get("salt")).toBeUndefined();
  });

  it("requires TURSO_DATABASE_URL", async () => {
    await expect(loadProductionStore({})).rejects.toThrow(/TURSO_DATABASE_URL/);
    await expect(persistProductionLearned([kaffir], {})).rejects.toThrow(
      /TURSO_DATABASE_URL/,
    );
  });
});
