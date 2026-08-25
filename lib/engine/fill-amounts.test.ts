import { describe, expect, it } from "vitest";
import { recipeFromExtractJson } from "./llm-parse";
import { applyMissingAmountEstimates } from "./fill-amounts";
import { estimateMissingAmountsPrompt } from "./llm";

describe("quantityAmbiguous at extract", () => {
  it("flags any omitted amount, not only primary seasoners", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "fish sauce" },
          { name: "salt" },
        ],
      },
      "https://example.com/yam",
    );
    expect(
      recipe?.ingredients.find((i) => i.name === "fish sauce")?.quantityAmbiguous,
    ).toBe(true);
    expect(recipe?.ingredients.find((i) => i.name === "salt")?.quantityAmbiguous).toBe(
      true,
    );
    expect(recipe?.ingredients.find((i) => i.name === "rice")?.quantityAmbiguous).toBeFalsy();
  });

  it("does not flag a measured tablespoon", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "fish sauce", amount: 1, unit: "tbsp" },
        ],
      },
      "https://example.com/yam",
    );
    expect(
      recipe?.ingredients.find((i) => i.name === "fish sauce")?.quantityAmbiguous,
    ).toBeFalsy();
  });
});

describe("applyMissingAmountEstimates", () => {
  it("fills omitted fish sauce from a sibling tablespoon, not a 120 ml fillet", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce", amount: 1, unit: "tbsp" },
          ],
        },
        "https://example.com/a",
      )!,
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce" },
          ],
        },
        "https://example.com/b",
      )!,
    ];
    const filled = applyMissingAmountEstimates(recipes, [
      { recipeIndex: 1, ingredient: "fish sauce", amount: 1, unit: "tbsp" },
    ]);
    const fish = filled[1]?.ingredients.find((i) => i.name === "fish sauce");
    expect(fish?.quantityAmbiguous).toBeFalsy();
    expect(fish?.volumeMl).toBe(15);
  });

  it("uses the estimate when every recipe omitted the amount", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "pork", amount: 200, unit: "g" },
            { name: "fish sauce" },
          ],
        },
        "https://example.com/a",
      )!,
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 350, unit: "g" },
            { name: "pork", amount: 180, unit: "g" },
            { name: "fish sauce" },
          ],
        },
        "https://example.com/b",
      )!,
    ];
    const filled = applyMissingAmountEstimates(recipes, [
      { recipeIndex: 0, ingredient: "fish sauce", amount: 1, unit: "tbsp" },
      { recipeIndex: 1, ingredient: "fish sauce", amount: 1, unit: "tbsp" },
    ]);
    expect(filled[0]?.ingredients.find((i) => i.name === "fish sauce")?.volumeMl).toBe(
      15,
    );
    expect(filled[1]?.ingredients.find((i) => i.name === "fish sauce")?.volumeMl).toBe(
      15,
    );
  });

  it("clamps a crazy estimate toward sibling measured amounts", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce", amount: 1, unit: "tbsp" },
          ],
        },
        "https://example.com/a",
      )!,
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce" },
          ],
        },
        "https://example.com/b",
      )!,
    ];
    const filled = applyMissingAmountEstimates(recipes, [
      { recipeIndex: 1, ingredient: "fish sauce", amount: 1, unit: "cup" },
    ]);
    const fish = filled[1]?.ingredients.find((i) => i.name === "fish sauce");
    expect(fish?.volumeMl).toBeLessThan(70);
    expect(fish?.volumeMl).toBeGreaterThan(10);
  });

  it("leaves code fallback volumes when there are no estimates", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce" },
          ],
        },
        "https://example.com/a",
      )!,
    ];
    const before =
      recipes[0]?.ingredients.find((i) => i.name === "fish sauce")?.volumeMl;
    const filled = applyMissingAmountEstimates(recipes, []);
    expect(
      filled[0]?.ingredients.find((i) => i.name === "fish sauce")?.volumeMl,
    ).toBe(before);
    expect(
      filled[0]?.ingredients.find((i) => i.name === "fish sauce")?.quantityAmbiguous,
    ).toBe(true);
  });
});

describe("estimateMissingAmountsPrompt", () => {
  it("shows sibling measured amounts and UNKNOWN lines, plus dish cuisine", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          title: "A",
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce", amount: 1, unit: "tbsp" },
          ],
        },
        "https://example.com/a",
      )!,
      recipeFromExtractJson(
        {
          title: "B",
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "fish sauce" },
          ],
        },
        "https://example.com/b",
      )!,
    ];
    const prompt = estimateMissingAmountsPrompt({
      context: {
        dish: "nam khao tod",
        nativeName: "ยำแหนมข้าวทอด",
        culture: "Thai",
        country: "Thailand",
        language: "Thai",
      },
      recipes,
    });
    expect(prompt).toContain("nam khao tod");
    expect(prompt).toContain("Thai");
    expect(prompt).toMatch(/UNKNOWN|unknown/);
    expect(prompt.toLowerCase()).toContain("fish sauce");
    expect(prompt.toLowerCase()).toMatch(/tbsp|tablespoon/);
    expect(prompt.toLowerCase()).toMatch(/no recipe measured|every recipe omitted|none of the recipes/);
  });
});
