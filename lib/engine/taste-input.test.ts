import { describe, expect, it, vi } from "vitest";
import { profileDish } from "./pipeline";
import type { LlmClient } from "./llm";
import type { PageClient, SearchClient } from "./search";
import { IngredientStore } from "./store";
import type { TasteProfile } from "./types";

const limeTaste: TasteProfile = {
  sweet: 1,
  sour: 9,
  salty: 0,
  spicy: 0,
  umami: 0,
  bitter: 1,
};

function silentSearch(): SearchClient {
  return {
    search: async () => {
      throw new Error("search should not run");
    },
  };
}

function silentPages(): PageClient {
  return {
    fetchText: async () => {
      throw new Error("page fetch should not run");
    },
  };
}

describe("taste input classification", () => {
  it("rejects brands and random strings before searching", async () => {
    const identifyDish = vi.fn(async () => {
      throw new Error("identifyDish should not run");
    });
    const llm: LlmClient = {
      classifyTasteInput: async () => ({
        kind: "reject",
        reason: "not a dish or ingredient",
      }),
      identifyDish,
      extractRecipe: async () => null,
      lookupIngredient: async () => ({ kind: "llm", taste: limeTaste }),
    };

    await expect(
      profileDish("asdfqwer", {
        llm,
        search: silentSearch(),
        pages: silentPages(),
        store: new IngredientStore([]),
      }),
    ).rejects.toThrow(/dish or ingredient/i);
    expect(identifyDish).not.toHaveBeenCalled();
  });

  it("profiles a catalog ingredient without recipe search and logs the path", async () => {
    const lookupIngredient = vi.fn(async () => ({
      kind: "llm" as const,
      taste: limeTaste,
    }));
    const search = vi.fn(async () => {
      throw new Error("search should not run");
    });
    const llm: LlmClient = {
      classifyTasteInput: async () => ({ kind: "ingredient", name: "lime" }),
      identifyDish: async () => {
        throw new Error("identifyDish should not run");
      },
      extractRecipe: async () => null,
      lookupIngredient,
    };
    const store = new IngredientStore([
      {
        ingredient: "lime",
        taste: limeTaste,
        derivedFrom: [],
        processing: [],
        confidence: 0.9,
        source: "measured",
      },
    ]);
    const events: string[] = [];

    const result = await profileDish("lime", {
      llm,
      search: { search },
      pages: silentPages(),
      store,
      onProgress: (event) => {
        if (event.type === "step") events.push(event.message);
      },
    });

    expect(search).not.toHaveBeenCalled();
    expect(lookupIngredient).not.toHaveBeenCalled();
    expect(result.recipesAnalyzed).toBe(0);
    expect(result.fromCache).toBe(true);
    expect(result.taste.sour).toBe(9);
    expect(result.representative.ingredients).toEqual([
      expect.objectContaining({ name: "lime", volumeMl: 100 }),
    ]);
    expect(events.some((m) => /ingredient/i.test(m))).toBe(true);
    expect(events.some((m) => /catalog|cached taste/i.test(m))).toBe(true);
  });

  it("resolves an unknown ingredient via lookup and persists it", async () => {
    const persistLearned = vi.fn(async () => 1);
    const llm: LlmClient = {
      classifyTasteInput: async () => ({ kind: "ingredient", name: "yuzu" }),
      identifyDish: async () => {
        throw new Error("identifyDish should not run");
      },
      extractRecipe: async () => null,
      lookupIngredient: async () => ({
        kind: "llm",
        taste: { ...limeTaste, sour: 8 },
      }),
    };
    const events: string[] = [];

    const result = await profileDish("yuzu", {
      llm,
      search: silentSearch(),
      pages: silentPages(),
      store: new IngredientStore([]),
      persistLearned,
      onProgress: (event) => {
        if (event.type === "step") events.push(event.message);
      },
    });

    expect(result.recipesAnalyzed).toBe(0);
    expect(result.fromCache).toBe(false);
    expect(result.taste.sour).toBe(8);
    expect(persistLearned).toHaveBeenCalled();
    expect(events.some((m) => /resolving|unknown ingredient/i.test(m))).toBe(true);
    expect(events.some((m) => /saving|catalog/i.test(m))).toBe(true);
  });
});
