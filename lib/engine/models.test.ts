import { describe, expect, it } from "vitest";
import {
  needsSmartIngredient,
  shouldEscalateOrigin,
  FAST_MODEL,
  SMART_MODEL,
} from "./models";
import { lookupFromModelJson, recipeFromExtractJson } from "./llm-parse";

describe("Gemini model tiers", () => {
  it("uses Flash-Lite as the default fast model and 3.6 Flash as smart", () => {
    expect(FAST_MODEL).toBe("gemini-3.5-flash-lite");
    expect(SMART_MODEL).toBe("gemini-3.6-flash");
  });

  it("sends fermented, compound, and sauce-like ingredients to the smart model", () => {
    expect(needsSmartIngredient("soy sauce")).toBe(true);
    expect(needsSmartIngredient("XO sauce")).toBe(true);
    expect(needsSmartIngredient("doubanjiang")).toBe(true);
    expect(needsSmartIngredient("onion")).toBe(false);
    expect(needsSmartIngredient("water")).toBe(false);
  });

  it("escalates origin when native name or search queries are weak", () => {
    expect(
      shouldEscalateOrigin({
        country: "China",
        nativeName: "麻婆豆腐",
        languageCode: "zh",
        searchQueries: ["麻婆豆腐 食谱", "麻婆豆腐 做法"],
      }),
    ).toBe(false);
    expect(
      shouldEscalateOrigin({
        country: "",
        nativeName: "mapo tofu",
        languageCode: "en",
        searchQueries: ["mapo tofu recipe"],
      }),
    ).toBe(true);
  });
});

describe("Gemini JSON request", () => {
  it("sets response_format without a top-level response_mime_type", async () => {
    const { geminiJsonRequest } = await import("./llm");
    const req = geminiJsonRequest("gemini-3.5-flash-lite", "hello", {
      type: "object",
      properties: { ok: { type: "boolean" } },
    });
    expect(req).not.toHaveProperty("response_mime_type");
    expect(req.response_format.mime_type).toBe("application/json");
    expect(req.response_format.type).toBe("text");
  });
});

describe("Gemini JSON mapping", () => {
  it("prefers composition, then decomposition, then llm taste", () => {
    expect(
      lookupFromModelJson({
        strategy: "composition",
        composition: { sodiumMgPer100g: 5000 },
        processing: ["fermentation"],
      }).kind,
    ).toBe("composition");
    expect(
      lookupFromModelJson({
        strategy: "decomposition",
        parts: [{ name: "soy sauce", volumeMl: 60 }],
      }).kind,
    ).toBe("decomposition");
    expect(
      lookupFromModelJson({
        strategy: "llm",
        taste: { sweet: 1, sour: 0, salty: 2, spicy: 0, umami: 3, bitter: 0 },
      }).kind,
    ).toBe("llm");
  });

  it("keeps a mouthful taste overlay on composition lookups", () => {
    const lookup = lookupFromModelJson({
      strategy: "composition",
      composition: { sugarGPer100g: 9.4 },
      taste: { sweet: 7.5, sour: 3, salty: 0, spicy: 0, umami: 0, bitter: 0 },
    });
    expect(lookup.kind).toBe("composition");
    if (lookup.kind !== "composition") return;
    expect(lookup.taste?.sweet).toBe(7.5);
  });

  it("returns null when a page has no ingredients", () => {
    expect(recipeFromExtractJson({ ingredients: [] }, "https://x.test")).toBeNull();
  });

  it("keeps ingredients that have a name but no amount or unit", () => {
    const recipe = recipeFromExtractJson(
      { ingredients: [{ name: "rice" }, { name: "  " }, { name: "coconut" }] },
      "https://x.test",
    );
    expect(recipe?.ingredients.map((i) => i.name)).toEqual(["rice", "coconut"]);
    expect(recipe?.ingredients.every((i) => i.volumeMl > 0)).toBe(true);
  });

  it("converts extracted amounts into milliliters", () => {
    const recipe = recipeFromExtractJson(
      {
        title: "麻婆豆腐",
        ingredients: [{ name: "tofu", amount: 1, unit: "cup" }],
        processes: [],
        cookingSteps: ["stir-fry"],
      },
      "https://example.com/mapo",
    );
    expect(recipe?.ingredients[0]?.volumeMl).toBe(240);
    expect(recipe?.title).toBe("麻婆豆腐");
  });

  it("keeps in/out ingredient roles and defaults missing role to in", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "shrimp", amount: 500, unit: "g", role: "in" },
          { name: "lemon", amount: 1, unit: "piece", role: "out" },
          { name: "potato", amount: 2, unit: "piece" },
          { name: "bread", role: "side" },
        ],
      },
      "https://example.com/boil",
    );
    expect(recipe?.ingredients.map((i) => [i.name, i.role])).toEqual([
      ["shrimp", "in"],
      ["lemon", "out"],
      ["potato", "in"],
      ["bread", "in"],
    ]);
  });
});
