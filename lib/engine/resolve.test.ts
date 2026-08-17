import { describe, expect, it } from "vitest";
import { IngredientStore } from "./store";
import { resolveIngredient } from "./resolve";
import type { TasteProfile } from "./types";

const soy: TasteProfile = {
  sweet: 1,
  sour: 0.5,
  salty: 9,
  spicy: 0,
  umami: 8,
  bitter: 0,
};

describe("ingredient resolution", () => {
  it("returns cached known ingredients without calling the resolver", async () => {
    const store = new IngredientStore();
    store.put({
      ingredient: "soy sauce",
      taste: soy,
      derivedFrom: ["soybeans", "wheat", "salt", "water"],
      processing: ["fermentation"],
      confidence: 0.91,
      source: "measured",
    });

    let called = 0;
    const result = await resolveIngredient("soy sauce", {
      store,
      maxDepth: 3,
      lookupUnknown: async () => {
        called += 1;
        throw new Error("should not be called");
      },
    });

    expect(called).toBe(0);
    expect(result.taste.salty).toBe(9);
    expect(result.confidence).toBe(0.91);
  });

  it("decomposes unknown ingredients and combines child profiles", async () => {
    const store = new IngredientStore();
    store.put({
      ingredient: "soy sauce",
      taste: soy,
      derivedFrom: [],
      processing: [],
      confidence: 0.9,
      source: "measured",
    });
    store.put({
      ingredient: "sugar",
      taste: { sweet: 10, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
      derivedFrom: [],
      processing: [],
      confidence: 0.95,
      source: "measured",
    });
    store.put({
      ingredient: "mirin",
      taste: { sweet: 7, sour: 1, salty: 1, spicy: 0, umami: 2, bitter: 0 },
      derivedFrom: [],
      processing: [],
      confidence: 0.8,
      source: "nutrition",
    });

    const result = await resolveIngredient("teriyaki sauce", {
      store,
      maxDepth: 3,
      lookupUnknown: async (name) => {
        if (name === "teriyaki sauce") {
          return {
            kind: "decomposition",
            parts: [
              { name: "soy sauce", volumeMl: 60 },
              { name: "mirin", volumeMl: 20 },
              { name: "sugar", volumeMl: 20 },
            ],
            processing: ["reduction"],
          };
        }
        return { kind: "llm", taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 } };
      },
    });

    expect(result.derivedFrom).toEqual(["soy sauce", "mirin", "sugar"]);
    expect(result.taste.salty).toBeGreaterThan(4);
    expect(result.taste.sweet).toBeGreaterThan(2);
    expect(store.get("teriyaki sauce")).toBeDefined();
  });

  it("stops recursion at max depth and falls back to llm estimate", async () => {
    const store = new IngredientStore();
    const result = await resolveIngredient("xo sauce", {
      store,
      maxDepth: 0,
      lookupUnknown: async () => ({
        kind: "llm",
        taste: { sweet: 2, sour: 1, salty: 6, spicy: 5, umami: 7, bitter: 0 },
      }),
    });
    expect(result.source).toBe("llm");
    expect(result.taste.umami).toBe(7);
  });
});
