import { describe, expect, it } from "vitest";
import { createDishRecord, type CachedDish } from "./dish-cache";
import { DishStore } from "./dish-store";
import type { LlmClient } from "./llm";
import { profileDish } from "./pipeline";
import type { PageClient, SearchClient } from "./search";
import { IngredientStore } from "./store";
import type { TasteProfile } from "./taste";
import type { Recipe } from "./types";

const snapshotTaste: TasteProfile = {
  sweet: 0,
  sour: 0,
  salty: 1,
  spicy: 0,
  umami: 2,
  bitter: 0,
};

function cachedMapo() {
  return createDishRecord("mapo tofu", ["麻婆豆腐"], {
    origin: {
      dish: "mapo tofu",
      country: "China",
      culture: "Sichuan",
      nativeName: "麻婆豆腐",
      language: "Chinese",
      languageCode: "zh",
      searchQueries: ["麻婆豆腐 食谱"],
    },
    taste: snapshotTaste,
    confidence: 0.8,
    recipesAnalyzed: 3,
    representative: {
      ingredients: [
        { name: "tofu", volumeMl: 200, occurrence: { used: 3, total: 3 } },
      ],
      finalVolumeMl: 400,
    },
    provenance: [],
    ingredients: [
      {
        name: "tofu",
        used: 3,
        total: 3,
        pending: false,
        flavors: [],
        out: false,
        recipes: [],
      },
    ],
  });
}

const recipe: Recipe = {
  title: "mapo tofu",
  url: "https://example.com/mapo",
  ingredients: [
    { name: "tofu", volumeMl: 200 },
    { name: "water", volumeMl: 200 },
  ],
};

function searchPages(): SearchClient {
  return {
    search: async () => [{ title: "mapo tofu", url: recipe.url!, snippet: "tofu" }],
  };
}

function pages(): PageClient {
  return { fetchText: async (url) => `recipe page ${url}` };
}

function llm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    identifyDish: async (dish) => ({
      dish,
      country: "China",
      culture: "Sichuan",
      nativeName: "麻婆豆腐",
      language: "Chinese",
      languageCode: "zh",
      searchQueries: ["麻婆豆腐 食谱"],
    }),
    extractRecipe: async (_text, url) => (url === recipe.url ? recipe : null),
    lookupIngredient: async () => ({
      kind: "llm",
      taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
    }),
    ...overrides,
  };
}

const ingredients = new IngredientStore([
  {
    ingredient: "tofu",
    taste: { sweet: 0, sour: 0, salty: 1, spicy: 0, umami: 2, bitter: 0 },
    derivedFrom: [],
    processing: [],
    confidence: 0.9,
    source: "measured",
  },
  {
    ingredient: "water",
    taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
    derivedFrom: [],
    processing: [],
    confidence: 0.95,
    source: "measured",
  },
]);

describe("profileDish dish cache", () => {
  it("returns the stored snapshot when useCache is on and the query matches", async () => {
    const dishStore = new DishStore([cachedMapo()]);
    const persisted: CachedDish[] = [];
    let searched = 0;
    const result = await profileDish("麻婆豆腐", {
      llm: llm({
        identifyDish: async () => {
          throw new Error("should not identify origin on a cache hit");
        },
        matchDish: async () => "mapo tofu",
      }),
      search: {
        search: async () => {
          searched += 1;
          return [];
        },
      },
      pages: pages(),
      store: ingredients,
      dishStore,
      useCache: true,
      persistDish: (record) => {
        persisted.push(record);
      },
    });

    expect(searched).toBe(0);
    expect(result.fromCache).toBe(true);
    expect(result.taste).toEqual(snapshotTaste);
    expect(result.timesTasted).toBe(2);
    expect(result.representative.ingredients[0]?.name).toBe("tofu");
    expect(persisted[0]?.timesTasted).toBe(2);
    expect(persisted[0]?.sampleCount).toBe(1);
  });

  it("still runs the pipeline when useCache is off and folds the new sample", async () => {
    const dishStore = new DishStore([cachedMapo()]);
    const persisted: CachedDish[] = [];
    const result = await profileDish("mapo tofu", {
      llm: llm({ matchDish: async () => "mapo tofu" }),
      search: searchPages(),
      pages: pages(),
      store: ingredients,
      dishStore,
      useCache: false,
      persistDish: (record) => {
        persisted.push(record);
      },
    });

    expect(result.fromCache).toBeFalsy();
    expect(result.timesTasted).toBe(2);
    expect(persisted[0]?.sampleCount).toBe(2);
    expect(persisted[0]?.timesTasted).toBe(2);
  });

  it("tastes a query with stray punctuation under the cleaned name", async () => {
    const identified: string[] = [];
    const persisted: CachedDish[] = [];
    const result = await profileDish("mapo tofu]", {
      llm: llm({
        classifyTasteInput: async () => ({ kind: "dish" }),
        identifyDish: async (dish) => {
          identified.push(dish);
          return {
            dish,
            country: "China",
            culture: "Sichuan",
            nativeName: "麻婆豆腐",
            language: "Chinese",
            languageCode: "zh",
            searchQueries: ["麻婆豆腐 食谱"],
          };
        },
      }),
      search: searchPages(),
      pages: pages(),
      store: ingredients,
      dishStore: new DishStore(),
      persistDish: (record) => {
        persisted.push(record);
      },
    });

    expect(identified).toEqual(["mapo tofu"]);
    expect(result.dish).toBe("mapo tofu");
    expect(result.origin.dish).toBe("mapo tofu");
    expect(persisted[0]?.canonicalName).toBe("mapo tofu");
    expect(persisted[0]?.aliases.join(" ")).not.toMatch(/]/);
  });

  it("passes typed search mode into origin identification", async () => {
    const modes: string[] = [];
    await profileDish("mapo tofu", {
      llm: llm({
        identifyDish: async (dish, options) => {
          modes.push(options?.searchMode ?? "native");
          return {
            dish,
            country: "China",
            culture: "Sichuan",
            nativeName: "麻婆豆腐",
            language: "Chinese",
            languageCode: "zh",
            searchQueries: ["mapo tofu recipe"],
          };
        },
      }),
      search: searchPages(),
      pages: pages(),
      store: ingredients,
      searchMode: "typed",
    });
    expect(modes).toEqual(["typed"]);
  });
});
