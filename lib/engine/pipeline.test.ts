import { describe, expect, it } from "vitest";
import { profileDish } from "./pipeline";
import { loadSeedStore } from "./seed";
import { IngredientStore } from "./store";
import type { LlmClient } from "./llm";
import type { PageClient, SearchClient } from "./search";
import type { Recipe, TasteProfile } from "./types";

const soy: TasteProfile = {
  sweet: 1,
  sour: 0.5,
  salty: 9,
  spicy: 0,
  umami: 8,
  bitter: 0,
};

describe("profileDish pipeline", () => {
  it("combines several recipes into a deterministic taste profile", async () => {
    const recipes: Recipe[] = [
      {
        url: "https://example.com/a",
        ingredients: [
          { name: "lime", volumeMl: 30 },
          { name: "fish sauce", volumeMl: 30 },
          { name: "chili", volumeMl: 10 },
          { name: "palm sugar", volumeMl: 15 },
          { name: "water", volumeMl: 15 },
        ],
        processes: [{ type: "evaporation", volumeDeltaMl: -10 }],
      },
      {
        url: "https://example.com/b",
        ingredients: [
          { name: "lime", volumeMl: 40 },
          { name: "fish sauce", volumeMl: 20 },
          { name: "chili", volumeMl: 8 },
          { name: "palm sugar", volumeMl: 20 },
          { name: "water", volumeMl: 12 },
        ],
        processes: [{ type: "evaporation", volumeDeltaMl: -8 }],
      },
      {
        url: "https://example.com/c",
        ingredients: [
          { name: "lime", volumeMl: 20 },
          { name: "fish sauce", volumeMl: 25 },
          { name: "chili", volumeMl: 12 },
          { name: "palm sugar", volumeMl: 10 },
          { name: "water", volumeMl: 20 },
        ],
        processes: [{ type: "evaporation", volumeDeltaMl: -12 }],
      },
    ];

    const llm: LlmClient = {
      identifyDish: async (dish) => ({
        dish,
        country: "Thailand",
        culture: "Thai",
        nativeName: "ส้มตำ",
        language: "Thai",
        languageCode: "th",
        searchQueries: ["ส้มตำ สูตร"],
      }),
      extractRecipe: async (_text, url) =>
        recipes.find((recipe) => recipe.url === url) ?? null,
      lookupIngredient: async () => ({ kind: "llm", taste: soy }),
    };

    const search: SearchClient = {
      search: async () =>
        recipes.map((recipe) => ({
          title: "ส้มตำ",
          url: recipe.url!,
          snippet: "lime fish sauce chili",
        })),
    };

    const pages: PageClient = {
      fetchText: async (url) => `recipe page ${url}`,
    };

    const store = new IngredientStore([
      {
        ingredient: "lime",
        taste: { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 },
        derivedFrom: [],
        processing: [],
        confidence: 0.9,
        source: "measured",
      },
      {
        ingredient: "fish sauce",
        taste: { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 },
        derivedFrom: [],
        processing: [],
        confidence: 0.9,
        source: "measured",
      },
      {
        ingredient: "chili",
        taste: { sweet: 1, sour: 1, salty: 0, spicy: 8, umami: 1, bitter: 0.5 },
        derivedFrom: [],
        processing: [],
        confidence: 0.8,
        source: "nutrition",
      },
      {
        ingredient: "palm sugar",
        taste: { sweet: 9, sour: 0, salty: 0, spicy: 0, umami: 1, bitter: 0.5 },
        derivedFrom: [],
        processing: [],
        confidence: 0.85,
        source: "nutrition",
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

    const events: Array<{ message: string; status?: string }> = [];
    const ingredientSnapshots: string[][] = [];
    const result = await profileDish("som tam", {
      llm,
      search,
      pages,
      store,
      onProgress: (event) => {
        if (event.type === "step") events.push(event);
        if (event.type === "ingredients") {
          ingredientSnapshots.push(event.items.map((item) => item.name));
        }
      },
    });

    expect(result.origin.nativeName).toBe("ส้มตำ");
    expect(result.recipesAnalyzed).toBe(3);
    expect(result.taste.sour).toBeGreaterThan(result.taste.bitter);
    expect(result.taste.bitter).toBeLessThanOrEqual(1);
    expect(result.taste.salty).toBeGreaterThan(1);
    expect(result.taste.spicy).toBeGreaterThan(0.5);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.representative.ingredients.map((i) => i.name)).toEqual(
      expect.arrayContaining(["lime", "fish sauce", "chili", "palm sugar"]),
    );
    expect(events.some((e) => e.message.includes("Identifying culinary origin"))).toBe(
      true,
    );
    expect(events.some((e) => e.message.includes("Searching the web"))).toBe(true);
    expect(events.some((e) => e.message.includes("Loading cached taste vector"))).toBe(
      true,
    );
    expect(events.some((e) => e.message.includes("effective concentration"))).toBe(
      true,
    );
    expect(ingredientSnapshots.length).toBeGreaterThan(0);
    expect(ingredientSnapshots[0]).toEqual(
      expect.arrayContaining(["lime", "fish sauce"]),
    );
  });

  it("stops without persisting when the abort signal fires", async () => {
    const controller = new AbortController();
    let persisted = 0;
    const pending = profileDish("som tam", {
      llm: {
        identifyDish: () => new Promise(() => {}),
        extractRecipe: async () => null,
        lookupIngredient: async () => ({ kind: "llm", taste: soy }),
      },
      search: { search: async () => [] },
      pages: { fetchText: async () => "" },
      persistLearned: async () => {
        persisted += 1;
      },
      persistDish: async () => {
        persisted += 1;
      },
      store: new IngredientStore([]),
      signal: controller.signal,
    });
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(persisted).toBe(0);
  });

  it("translates leftover native names and tastes ingredients that miss the 50% cut", async () => {
    const lookedUp: string[] = [];
    const snapshots: Array<Array<{ name: string; pending: boolean }>> = [];
    const persisted: string[] = [];
    await profileDish("mapo tofu", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "China",
          culture: "Sichuan",
          nativeName: "麻婆豆腐",
          language: "Chinese",
          languageCode: "zh",
          searchQueries: ["麻婆豆腐 食谱"],
        }),
        extractRecipe: async () => null,
        extractRecipeFromUrl: async (url) => ({
          url,
          ingredients: [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "花椒", volumeMl: 8 },
          ],
        }),
        canonicalizeIngredientNames: async (names) => {
          const map: Record<string, string> = {};
          for (const name of names) {
            map[name] = name === "花椒" ? "sichuan pepper" : name;
          }
          return map;
        },
        lookupIngredient: async (name) => {
          lookedUp.push(name);
          return {
            kind: "llm",
            taste: { sweet: 0, sour: 0, salty: 0, spicy: 6, umami: 2, bitter: 2 },
          };
        },
      },
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-2", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
      persistLearned: async (learned) => {
        persisted.push(...learned.map((item) => item.ingredient));
      },
      onProgress: (event) => {
        if (event.type === "ingredients") {
          snapshots.push(event.items.map((item) => ({ name: item.name, pending: item.pending })));
        }
      },
    });

    const last = snapshots.at(-1) ?? [];
    expect(last.map((item) => item.name)).toContain("sichuan pepper");
    expect(last.map((item) => item.name)).not.toContain("花椒");
    expect(last.find((item) => item.name === "sichuan pepper")?.pending).toBe(false);
    expect(lookedUp).toContain("sichuan pepper");
    expect(persisted).toContain("sichuan pepper");
    expect(persisted).not.toContain("soy sauce");
  });

  it("rewrites garbled English names and splits combined produce lines", async () => {
    const lookedUp: string[] = [];
    const canonicalized: string[][] = [];
    const catalogs: string[][] = [];
    const result = await profileDish("som tam", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "Thailand",
          culture: "Thai",
          nativeName: "ส้มตำ",
          language: "Thai",
          languageCode: "th",
          searchQueries: ["ส้มตำ สูตร"],
        }),
        extractRecipe: async (_text, url) => ({
          url,
          ingredients: [
            { name: "papaya and carrot", volumeMl: 200 },
            { name: "all purpose flower crispy frying flour", volumeMl: 20 },
            { name: "lime", volumeMl: 30 },
            { name: "fish sauce", volumeMl: 25 },
          ],
        }),
        canonicalizeIngredientNames: async (names, catalog) => {
          canonicalized.push(names);
          catalogs.push(catalog ?? []);
          return {
            "papaya and carrot": "papaya, carrot",
            "all purpose flower crispy frying flour": "all-purpose flour",
          };
        },
        lookupIngredient: async (name) => {
          lookedUp.push(name);
          return { kind: "llm", taste: soy };
        },
      },
      search: {
        search: async () => [
          { title: "ส้มตำ", url: "https://example.com/tam-1", snippet: "" },
          { title: "ส้มตำ", url: "https://example.com/tam-2", snippet: "" },
          { title: "ส้มตำ", url: "https://example.com/tam-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "recipe page with json-ld" },
      store: new IngredientStore([
        {
          ingredient: "lime",
          taste: { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "fish sauce",
          taste: { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "papaya",
          taste: { sweet: 4, sour: 1, salty: 0, spicy: 0, umami: 0, bitter: 0 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "carrot",
          taste: { sweet: 4, sour: 0, salty: 0, spicy: 0, umami: 1, bitter: 0 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "all purpose flour",
          taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
      ]),
    });

    expect(canonicalized.flat()).toEqual(
      expect.arrayContaining([
        "papaya and carrot",
        "all purpose flower crispy frying flour",
      ]),
    );
    expect(catalogs.flat()).toEqual(
      expect.arrayContaining(["papaya", "carrot", "all purpose flour"]),
    );
    const names = result.representative.ingredients.map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining(["papaya", "carrot", "all purpose flour"]));
    expect(names).not.toContain("papaya and carrot");
    expect(names).not.toContain("all purpose flower crispy frying flour");
    expect(lookedUp).not.toContain("papaya and carrot");
    expect(lookedUp).not.toContain("all purpose flower crispy frying flour");
  });

  it("passes dish origin when canonicalizing ingredient names", async () => {
    const contexts: unknown[] = [];
    await profileDish("ceviche", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "Peru",
          culture: "Peruvian",
          nativeName: "ceviche",
          language: "Spanish",
          languageCode: "es",
          searchQueries: ["ceviche receta"],
        }),
        extractRecipe: async (_text, url) => ({
          url,
          title: "ceviche",
          ingredients: [
            { name: "limón", volumeMl: 40 },
            { name: "fish", volumeMl: 200 },
            { name: "onion", volumeMl: 40 },
            { name: "salt", volumeMl: 3 },
          ],
        }),
        canonicalizeIngredientNames: async (_names, _catalog, context) => {
          contexts.push(context);
          return { limón: "lime" };
        },
        lookupIngredient: async () => ({ kind: "llm", taste: soy }),
      },
      search: {
        search: async () => [
          { title: "ceviche", url: "https://example.com/cev-1", snippet: "" },
          { title: "ceviche", url: "https://example.com/cev-2", snippet: "" },
          { title: "ceviche", url: "https://example.com/cev-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "recipe page with json-ld" },
      store: new IngredientStore([
        {
          ingredient: "lime",
          taste: { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "fish",
          taste: { sweet: 0, sour: 0, salty: 1, spicy: 0, umami: 4, bitter: 0 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "onion",
          taste: { sweet: 2, sour: 0, salty: 0, spicy: 0, umami: 1, bitter: 0 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "salt",
          taste: { sweet: 0, sour: 0, salty: 10, spicy: 0, umami: 0, bitter: 0 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
      ]),
    });

    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts[0]).toMatchObject({
      dish: "ceviche",
      culture: "Peruvian",
      country: "Peru",
      language: "Spanish",
    });
  });

  it("uses the LLM to map cut forms onto existing catalog names", async () => {
    const lookedUp: string[] = [];
    const matched: Array<{ names: string[]; known: string[] }> = [];
    const papaya = {
      ingredient: "green papaya",
      taste: { sweet: 1, sour: 2, salty: 0, spicy: 0, umami: 0, bitter: 1 },
      derivedFrom: [],
      processing: [],
      confidence: 0.9,
      source: "measured" as const,
    };
    const carrot = {
      ingredient: "carrot",
      taste: { sweet: 4, sour: 0, salty: 0, spicy: 0, umami: 1, bitter: 0 },
      derivedFrom: [],
      processing: [],
      confidence: 0.9,
      source: "measured" as const,
    };
    const result = await profileDish("som tam", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "Thailand",
          culture: "Thai",
          nativeName: "ส้มตำ",
          language: "Thai",
          languageCode: "th",
          searchQueries: ["ส้มตำ สูตร"],
        }),
        extractRecipe: async (_text, url) => ({
          url,
          ingredients: [
            { name: "green papaya strip", volumeMl: 200 },
            { name: "carrot strip", volumeMl: 40 },
            { name: "lime", volumeMl: 30 },
            { name: "fish sauce", volumeMl: 25 },
          ],
        }),
        canonicalizeIngredientNames: async (names, catalog) => {
          matched.push({ names, known: catalog ?? [] });
          return {
            "green papaya strip": "green papaya",
            "carrot strip": "carrot",
          };
        },
        lookupIngredient: async (name) => {
          lookedUp.push(name);
          return { kind: "llm", taste: soy };
        },
      },
      search: {
        search: async () => [
          { title: "ส้มตำ", url: "https://example.com/tam-1", snippet: "" },
          { title: "ส้มตำ", url: "https://example.com/tam-2", snippet: "" },
          { title: "ส้มตำ", url: "https://example.com/tam-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "recipe page with json-ld" },
      store: new IngredientStore([
        papaya,
        carrot,
        {
          ingredient: "lime",
          taste: { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "fish sauce",
          taste: { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
      ]),
    });

    expect(matched.length).toBeGreaterThan(0);
    expect(matched.some((row) => row.names.includes("green papaya strip"))).toBe(true);
    expect(matched.some((row) => row.known.includes("green papaya"))).toBe(true);
    expect(result.representative.ingredients.map((item) => item.name)).toEqual(
      expect.arrayContaining(["green papaya", "carrot"]),
    );
    expect(result.representative.ingredients.map((item) => item.name)).not.toContain(
      "green papaya strip",
    );
    expect(result.representative.ingredients.map((item) => item.name)).not.toContain(
      "carrot strip",
    );
    expect(lookedUp).not.toContain("green papaya strip");
    expect(lookedUp).not.toContain("carrot strip");
  });

  it("reads recipe URLs via URL context when fetched HTML is not a usable recipe", async () => {
    let fetched = 0;
    const recipe = {
      url: "https://example.com/a",
      ingredients: [
        { name: "lime", volumeMl: 30 },
        { name: "fish sauce", volumeMl: 30 },
        { name: "chili", volumeMl: 10 },
        { name: "palm sugar", volumeMl: 15 },
      ],
    };

    const result = await profileDish("som tam", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "Thailand",
          culture: "Thai",
          nativeName: "ส้มตำ",
          language: "Thai",
          languageCode: "th",
          searchQueries: ["ส้มตำ สูตร"],
        }),
        extractRecipe: async () => null,
        extractRecipeFromUrl: async (url) => ({ ...recipe, url }),
        lookupIngredient: async () => ({ kind: "llm", taste: soy }),
      },
        search: {
        search: async () => [
          { title: "ส้มตำ", url: "https://example.com/a", snippet: "lime" },
          { title: "ส้มตำ", url: "https://example.com/b", snippet: "lime" },
          { title: "ส้มตำ", url: "https://example.com/c", snippet: "lime" },
        ],
      },
      pages: {
        fetchText: async () => {
          fetched += 1;
          return "not a recipe";
        },
      },
      store: new IngredientStore([
        {
          ingredient: "lime",
          taste: { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "fish sauce",
          taste: { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 },
          derivedFrom: [],
          processing: [],
          confidence: 0.9,
          source: "measured",
        },
        {
          ingredient: "chili",
          taste: { sweet: 1, sour: 1, salty: 0, spicy: 8, umami: 1, bitter: 0.5 },
          derivedFrom: [],
          processing: [],
          confidence: 0.8,
          source: "nutrition",
        },
        {
          ingredient: "palm sugar",
          taste: { sweet: 9, sour: 0, salty: 0, spicy: 0, umami: 1, bitter: 0.5 },
          derivedFrom: [],
          processing: [],
          confidence: 0.85,
          source: "nutrition",
        },
      ]),
    });

    expect(fetched).toBe(3);
    expect(result.recipesAnalyzed).toBe(3);
  });

  it("ignores other Chinese recipes mixed into mapo tofu search hits", async () => {
    const extracted: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "China",
          culture: "Sichuan",
          nativeName: "麻婆豆腐",
          language: "Chinese",
          languageCode: "zh",
          searchQueries: ["麻婆豆腐 食谱"],
        }),
        extractRecipe: async () => null,
        extractRecipeFromUrl: async (url) => {
          extracted.push(url);
          return {
            title: "麻婆豆腐",
            url,
            ingredients: [
              { name: "酱油", volumeMl: 30 },
              { name: "豆腐", volumeMl: 300 },
              { name: "猪肉", volumeMl: 100 },
              { name: "辣椒", volumeMl: 20 },
            ],
          };
        },
        lookupIngredient: async () => ({
          kind: "llm",
          taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
        }),
      },
        search: {
        search: async () => [
          { title: "鱼香茄子", url: "https://example.com/eggplant", snippet: "garlic eggplant" },
          { title: "煲仔饭 Claypot rice", url: "https://example.com/claypot", snippet: "" },
          { title: "Yam mini pancakes", url: "https://example.com/pancakes", snippet: "芋头" },
          { title: "麻婆豆腐的做法", url: "https://example.com/mapo-1", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-2", snippet: "" },
          { title: "正宗麻婆豆腐", url: "https://example.com/mapo-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });

    expect(extracted).toEqual([
      "https://example.com/mapo-1",
      "https://example.com/mapo-2",
      "https://example.com/mapo-3",
    ]);
    expect(result.recipesAnalyzed).toBe(3);
  });

  it("scores native-language recipes instead of returning an all-zero profile", async () => {
    const result = await profileDish("mapo tofu", {
      llm: {
        identifyDish: async (dish) => ({
          dish,
          country: "China",
          culture: "Sichuan",
          nativeName: "麻婆豆腐",
          language: "Chinese",
          languageCode: "zh",
          searchQueries: ["麻婆豆腐 食谱"],
        }),
        extractRecipe: async () => null,
        extractRecipeFromUrl: async (url) => ({
          url,
          ingredients: [
            { name: "酱油", volumeMl: 30 },
            { name: "豆腐", volumeMl: 300 },
            { name: "猪肉", volumeMl: 100 },
            { name: "辣椒", volumeMl: 20 },
          ],
        }),
        lookupIngredient: async () => ({
          kind: "llm",
          taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
        }),
      },
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-2", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });

    expect(result.taste.salty).toBeGreaterThan(0);
    expect(result.taste.umami).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.representative.ingredients.map((i) => i.name)).toEqual(
      expect.arrayContaining(["soy sauce", "tofu", "pork", "chili"]),
    );
  });

  it("does not claim the dish is missing when pages were found but extraction failed", async () => {
    await expect(
      profileDish("mapo tofu", {
        llm: {
          identifyDish: async (dish) => ({
            dish,
            country: "China",
            culture: "Sichuan",
            nativeName: "麻婆豆腐",
            language: "Chinese",
            languageCode: "zh",
            searchQueries: ["麻婆豆腐 食谱"],
          }),
          extractRecipe: async () => null,
          extractRecipeFromUrl: async () => null,
          lookupIngredient: async () => ({ kind: "llm", taste: soy }),
        },
        search: {
          search: async () => [
            { title: "麻婆豆腐", url: "https://example.com/mapo", snippet: "" },
          ],
        },
        pages: { fetchText: async () => "not a recipe" },
        store: loadSeedStore(),
      }),
    ).rejects.toThrow(/Found 1 pages.*none produced a usable recipe/i);
  });

  it("accepts a recipe with two named ingredients", async () => {
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) =>
        mapoRecipe(url, [
          { name: "tofu", volumeMl: 300 },
          { name: "soy sauce", volumeMl: 30 },
        ]),
      ),
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
      recipeLimit: 1,
    });
    expect(result.recipesAnalyzed).toBe(1);
    expect(result.representative.ingredients.map((i) => i.name)).toEqual(
      expect.arrayContaining(["tofu", "soy sauce"]),
    );
  });

  it("falls back to URL context when HTML extract only finds one ingredient", async () => {
    const result = await profileDish("mapo tofu", {
      llm: {
        ...mapoLlm(() => mapoRecipe("https://unused", [{ name: "tofu", volumeMl: 300 }])),
        extractRecipe: async (_text, url) => ({
          title: "麻婆豆腐",
          url,
          ingredients: [{ name: "tofu", volumeMl: 300 }],
        }),
        extractRecipeFromUrl: async (url) =>
          mapoRecipe(url, [
            { name: "tofu", volumeMl: 300 },
            { name: "soy sauce", volumeMl: 30 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
      },
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
        ],
      },
      pages: { fetchText: async () => longPageText() },
      store: loadSeedStore(),
      recipeLimit: 1,
    });
    expect(result.representative.ingredients.map((i) => i.name)).toEqual(
      expect.arrayContaining(["tofu", "soy sauce", "pork", "chili"]),
    );
  });

  it("parses fetched page HTML and skips URL context when that is enough", async () => {
    const fromUrl: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: {
        ...mapoLlm((url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
        ),
        extractRecipe: async (_text, url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
        extractRecipeFromUrl: async (url) => {
          fromUrl.push(url);
          return mapoRecipe(url, [{ name: "tofu", volumeMl: 300 }]);
        },
      },
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
        ],
      },
      pages: { fetchText: async () => longPageText() },
      store: loadSeedStore(),
      recipeLimit: 1,
    });
    expect(fromUrl).toEqual([]);
    expect(result.representative.ingredients.map((i) => i.name)).toEqual(
      expect.arrayContaining(["tofu", "soy sauce", "pork", "chili"]),
    );
  });

  it("stores the redirected recipe URL so ingredient links open the real page", async () => {
    const grounding =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const links: Array<{ title: string; url: string }> = [];
    await profileDish("mapo tofu", {
      llm: {
        ...mapoLlm((url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
        ),
        extractRecipe: async (_text, url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
      },
      search: {
        search: async () => [{ title: "麻婆豆腐", url: grounding, snippet: "" }],
      },
      pages: {
        fetchText: async () => ({
          text: longPageText(),
          url: "https://www.xiachufang.com/recipe/mapo",
        }),
      },
      store: loadSeedStore(),
      recipeLimit: 1,
      onProgress: (event) => {
        if (event.type === "ingredients") {
          const tofu = event.items.find((item) => item.name === "tofu");
          if (tofu) links.splice(0, links.length, ...tofu.recipes);
        }
      },
    });
    expect(links).toEqual([
      { title: "麻婆豆腐", url: "https://www.xiachufang.com/recipe/mapo" },
    ]);
  });

  it("does not treat a JavaScript shell as a recipe when URL context is available", async () => {
    const fromUrl: string[] = [];
    const parsed: string[] = [];
    await profileDish("mapo tofu", {
      llm: {
        ...mapoLlm((url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
        ),
        extractRecipe: async (_text, url) => {
          parsed.push(url);
          return mapoRecipe(url, [
            { name: "invented sugar", volumeMl: 80 },
            { name: "invented cream", volumeMl: 120 },
          ]);
        },
        extractRecipeFromUrl: async (url) => {
          fromUrl.push(url);
          return mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]);
        },
      },
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "Enable JavaScript to view this recipe." },
      store: loadSeedStore(),
      recipeLimit: 1,
    });
    expect(parsed).toEqual([]);
    expect(fromUrl).toEqual(["https://example.com/mapo-1"]);
  });

  it("does not count a page that failed to load even if URL context returns a recipe", async () => {
    const fromUrl: string[] = [];
    const links: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: {
        ...mapoLlm((url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
        ),
        extractRecipe: async (_text, url) =>
          mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]),
        extractRecipeFromUrl: async (url) => {
          fromUrl.push(url);
          return mapoRecipe(url, [
            { name: "soy sauce", volumeMl: 30 },
            { name: "tofu", volumeMl: 300 },
            { name: "pork", volumeMl: 100 },
            { name: "chili", volumeMl: 20 },
          ]);
        },
      },
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://wtable.co.kr/recipes/1064", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
        ],
      },
      pages: {
        fetchText: async (url) => {
          if (url.includes("wtable")) {
            return {
              text: "우리의식탁 | 요리를 스타일하다 error 500",
              url: "https://wtable.co.kr/recipes/1064",
              status: 500,
            };
          }
          return { text: longPageText(), url, status: 200 };
        },
      },
      store: loadSeedStore(),
      recipeLimit: 1,
      onProgress: (event) => {
        if (event.type === "ingredients") {
          for (const item of event.items) {
            links.push(...item.recipes.map((recipe) => recipe.url));
          }
        }
      },
    });
    expect(fromUrl).not.toContain("https://wtable.co.kr/recipes/1064");
    expect(result.recipesAnalyzed).toBe(1);
    expect(links.some((url) => url.includes("wtable"))).toBe(false);
    expect(links).toContain("https://example.com/mapo-1");
  });

  it("does not keep searching once three titled recipe pages are in hand", async () => {
    const queries: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) =>
        mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]),
      ),
      search: {
        search: async (query) => {
          queries.push(query);
          return [1, 2, 3].map((n) => ({
            title: "麻婆豆腐",
            url: `https://example.com/mapo-${n}`,
            snippet: "",
          }));
        },
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(queries).toHaveLength(1);
    expect(result.recipesAnalyzed).toBe(3);
  });

  it("uses extra search queries when the origin query only finds one page", async () => {
    const queries: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) =>
        mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]),
      ),
      search: {
        search: async (query) => {
          queries.push(query);
          if (query.includes("做法") || /recipe/i.test(query)) {
            return [
              { title: "麻婆豆腐", url: "https://example.com/mapo-2", snippet: "" },
              { title: "麻婆豆腐", url: "https://example.com/mapo-3", snippet: "" },
            ];
          }
          return [{ title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" }];
        },
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(queries.length).toBeGreaterThan(1);
    expect(result.recipesAnalyzed).toBe(3);
  });

  it("extracts untitled recipe URLs when too few titles mention the dish", async () => {
    const extracted: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) => {
        extracted.push(url);
        if (url.includes("eggplant")) {
          return {
            title: "鱼香茄子",
            url,
            ingredients: [
              { name: "eggplant", volumeMl: 200 },
              { name: "garlic", volumeMl: 20 },
              { name: "pork", volumeMl: 40 },
            ],
          };
        }
        return mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]);
      }),
      search: {
        search: async () => [
          { title: "麻婆豆腐的做法", url: "https://example.com/mapo-1", snippet: "" },
          { title: "家庭菜谱", url: "https://example.com/generic-2", snippet: "" },
          { title: "今日のレシピ", url: "https://example.com/generic-3", snippet: "" },
          { title: "鱼香茄子", url: "https://example.com/eggplant", snippet: "garlic eggplant" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(result.recipesAnalyzed).toBe(3);
    expect(extracted).toEqual([
      "https://example.com/mapo-1",
      "https://example.com/generic-2",
      "https://example.com/generic-3",
    ]);
  });

  it("scores whatever recipes were found when search cannot reach 3", async () => {
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) =>
        mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]),
      ),
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(result.recipesAnalyzed).toBe(1);
    expect(result.taste.salty).toBeGreaterThan(0);
  });

  it("reads several recipe URLs at the same time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm(async (url) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        return mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]);
      }),
      search: {
        search: async () =>
          [1, 2, 3].map((n) => ({
            title: "麻婆豆腐",
            url: `https://example.com/mapo-${n}`,
            snippet: "",
          })),
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(maxInFlight).toBe(3);
    expect(result.recipesAnalyzed).toBe(3);
  });

  it("stops collecting recipes after the time limit and scores what it already has", async () => {
    const extracted: string[] = [];
    let now = 0;
    const result = await profileDish("mapo tofu", {
      now: () => now,
      timeLimitMs: 30_000,
      llm: mapoLlm((url) => {
        extracted.push(url);
        now += 20_000;
        return mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]);
      }),
      search: {
        search: async () =>
          [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            title: "麻婆豆腐",
            url: `https://example.com/mapo-${n}`,
            snippet: "",
          })),
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(extracted).toEqual([
      "https://example.com/mapo-1",
      "https://example.com/mapo-2",
      "https://example.com/mapo-3",
    ]);
    expect(result.recipesAnalyzed).toBe(3);
    expect(result.taste.salty).toBeGreaterThan(0);
  });

  it("keeps extracting until 3 recipes even when early pages fail", async () => {
    const extracted: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) => {
        extracted.push(url);
        if (url.includes("fail")) return mapoRecipe(url, [{ name: "salt", volumeMl: 1 }]);
        return mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]);
      }),
      search: {
        search: async () => [
          { title: "麻婆豆腐", url: "https://example.com/fail-1", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/fail-2", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-1", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-2", snippet: "" },
          { title: "麻婆豆腐", url: "https://example.com/mapo-3", snippet: "" },
        ],
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(result.recipesAnalyzed).toBe(3);
    expect(extracted).toEqual([
      "https://example.com/fail-1",
      "https://example.com/fail-2",
      "https://example.com/mapo-1",
      "https://example.com/mapo-2",
      "https://example.com/mapo-3",
    ]);
  });

  it("stops at 3 recipes when the first three taste the same", async () => {
    const extracted: string[] = [];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) => {
        extracted.push(url);
        return mapoRecipe(url, [
          { name: "soy sauce", volumeMl: 30 },
          { name: "tofu", volumeMl: 300 },
          { name: "pork", volumeMl: 100 },
          { name: "chili", volumeMl: 20 },
        ]);
      }),
      search: {
        search: async () =>
          [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            title: "麻婆豆腐",
            url: `https://example.com/mapo-${n}`,
            snippet: "",
          })),
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(extracted).toHaveLength(3);
    expect(result.recipesAnalyzed).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("fetches more than 3 recipes when the first three disagree, and lowers confidence", async () => {
    const extracted: string[] = [];
    const variants = [
      [
        { name: "soy sauce", volumeMl: 80 },
        { name: "tofu", volumeMl: 100 },
        { name: "pork", volumeMl: 40 },
      ],
      [
        { name: "sugar", volumeMl: 80 },
        { name: "tofu", volumeMl: 100 },
        { name: "coconut milk", volumeMl: 120 },
      ],
      [
        { name: "lime", volumeMl: 60 },
        { name: "chili", volumeMl: 50 },
        { name: "vinegar", volumeMl: 40 },
      ],
    ];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) => {
        extracted.push(url);
        const index = Number(url.split("-").at(-1) ?? "1") - 1;
        return mapoRecipe(url, variants[Math.min(index, variants.length - 1)]!);
      }),
      search: {
        search: async () =>
          [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            title: "麻婆豆腐",
            url: `https://example.com/mapo-${n}`,
            snippet: "",
          })),
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(result.recipesAnalyzed).toBeGreaterThan(3);
    expect(result.recipesAnalyzed).toBeLessThanOrEqual(7);
    expect(extracted.length).toBe(result.recipesAnalyzed);
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("searches for more pages when the first three recipes disagree", async () => {
    const queries: string[] = [];
    const variants = [
      [
        { name: "soy sauce", volumeMl: 80 },
        { name: "tofu", volumeMl: 100 },
        { name: "pork", volumeMl: 40 },
      ],
      [
        { name: "sugar", volumeMl: 80 },
        { name: "tofu", volumeMl: 100 },
        { name: "coconut milk", volumeMl: 120 },
      ],
      [
        { name: "lime", volumeMl: 60 },
        { name: "chili", volumeMl: 50 },
        { name: "vinegar", volumeMl: 40 },
      ],
    ];
    const result = await profileDish("mapo tofu", {
      llm: mapoLlm((url) => {
        const index = Number(url.split("-").at(-1) ?? "1") - 1;
        return mapoRecipe(url, variants[Math.min(index, variants.length - 1)]!);
      }),
      search: {
        search: async (query) => {
          queries.push(query);
          if (queries.length === 1) {
            return [1, 2, 3].map((n) => ({
              title: "麻婆豆腐",
              url: `https://example.com/mapo-${n}`,
              snippet: "",
            }));
          }
          return [4, 5, 6, 7].map((n) => ({
            title: "麻婆豆腐",
            url: `https://example.com/mapo-${n}`,
            snippet: "",
          }));
        },
      },
      pages: { fetchText: async () => "" },
      store: loadSeedStore(),
    });
    expect(queries.length).toBeGreaterThan(1);
    expect(result.recipesAnalyzed).toBeGreaterThan(3);
  });
});

function longPageText(): string {
  return "tofu soy sauce pork chili garlic ginger ".repeat(40);
}

function mapoRecipe(
  url: string,
  ingredients: Array<{ name: string; volumeMl: number }>,
) {
  return { title: "麻婆豆腐", url, ingredients };
}

function mapoLlm(
  extract: (url: string) =>
    | {
        title: string;
        url: string;
        ingredients: Array<{ name: string; volumeMl: number }>;
      }
    | Promise<{
        title: string;
        url: string;
        ingredients: Array<{ name: string; volumeMl: number }>;
      }>,
): LlmClient {
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
    extractRecipe: async () => null,
    extractRecipeFromUrl: async (url) => extract(url),
    lookupIngredient: async () => ({
      kind: "llm",
      taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
    }),
  };
}
