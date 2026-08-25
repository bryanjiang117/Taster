import { describe, expect, it } from "vitest";
import { quantityToMl } from "./quantity";
import { recipeFromExtractJson } from "./llm-parse";
import { buildRepresentativeRecipe } from "./representative";
import { weightedTasteFromIngredients } from "./concentration";
import { roundTaste } from "./taste";

describe("quantity conversion", () => {
  it("converts kitchen units to milliliters", () => {
    expect(quantityToMl(1, "tbsp")).toBe(15);
    expect(quantityToMl(2, "tsp")).toBe(10);
    expect(quantityToMl(1, "cup")).toBe(240);
  });

  it("sizes count units by the food, not a flat 15 ml piece", () => {
    expect(quantityToMl(5, "piece", "chicken")).toBeGreaterThan(800);
    expect(quantityToMl(1, "piece", "onion")).toBeGreaterThan(80);
    expect(quantityToMl(1, "tbsp", "brown sugar")).toBe(15);
    expect(quantityToMl(7, "piece", "chili pepper")).toBeLessThan(150);
  });

  it("treats unknown count-like units on bulk foods as pieces", () => {
    expect(quantityToMl(1, "leg quarter", "chicken")).toBeGreaterThan(150);
    expect(quantityToMl(1, "whole", "chicken")).toBeGreaterThan(1000);
  });

  it("does not apply whole-food piece sizes to a different grocery that contains that word", () => {
    expect(quantityToMl(1, "piece", "fish")).toBe(120);
    expect(quantityToMl(1, "piece", "lime")).toBe(120);
    expect(quantityToMl(1, "piece", "chicken")).toBe(250);
    expect(quantityToMl(1, "piece", "onion")).toBe(120);

    expect(quantityToMl(1, "piece", "fish sauce")).toBe(15);
    expect(quantityToMl(1, "piece", "shrimp paste")).toBe(15);
    expect(quantityToMl(1, "piece", "fish ball")).toBe(15);
    expect(quantityToMl(1, "piece", "kaffir lime leaf")).toBe(15);
    expect(quantityToMl(5, "piece", "kaffir lime leaf")).toBe(75);
    expect(quantityToMl(1, "piece", "lemon zest")).toBe(15);
    expect(quantityToMl(1, "piece", "chicken stock")).toBe(15);
    expect(quantityToMl(1, "piece", "onion powder")).toBe(15);

    expect(quantityToMl(1, "piece", "chicken breast")).toBe(250);
    expect(quantityToMl(1, "piece", "salmon fillet")).toBe(120);
    expect(quantityToMl(1, "piece", "pork chop")).toBe(200);
    expect(quantityToMl(1, "piece", "green onion")).toBe(20);
    expect(quantityToMl(1, "piece", "chili pepper")).toBe(15);
  });
});

describe("dish-aware vague amounts", () => {
  it("keeps a pinch of salt tiny, never a 15 ml piece default", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "chicken", amount: 500, unit: "g" },
          { name: "water", amount: 500, unit: "ml" },
          { name: "salt", amount: 1, unit: "pinch" },
        ],
      },
      "https://example.com/soup",
    );
    const salt = recipe?.ingredients.find((i) => i.name === "salt");
    expect(salt?.volumeMl).toBeLessThan(2);
    expect(salt?.volumeMl).toBeGreaterThan(0.1);
  });

  it("does not treat missing salt quantity as 1 piece (15 ml)", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "potato", amount: 400, unit: "g" },
          { name: "butter", amount: 30, unit: "g" },
          { name: "salt" },
        ],
      },
      "https://example.com/mash",
    );
    const salt = recipe?.ingredients.find((i) => i.name === "salt");
    expect(salt?.volumeMl).toBeLessThan(8);
    expect(salt?.volumeMl).toBeGreaterThan(0.2);
  });

  it("does not treat 5 kaffir lime leaves as 5 limes", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "kaffir lime leaf", amount: 5, unit: "piece" },
        ],
      },
      "https://example.com/curry",
    );
    const leaf = recipe?.ingredients.find((i) => i.name === "kaffir lime leaf");
    expect(leaf?.volumeMl).toBe(75);
  });

  it("does not treat missing fish sauce as a 120 ml fish fillet", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "lime juice", amount: 1, unit: "tbsp" },
          { name: "fish sauce" },
        ],
      },
      "https://example.com/yam",
    );
    const fish = recipe?.ingredients.find((i) => i.name === "fish sauce");
    expect(fish?.volumeMl).toBeLessThan(30);
    expect(fish?.volumeMl).toBeGreaterThan(5);
  });

  it("does not average omitted fish sauce with real tablespoons into ~68 ml", () => {
    const specified = {
      ingredients: [
        { name: "rice", amount: 400, unit: "g" },
        { name: "fish sauce", amount: 1, unit: "tbsp" },
      ],
    };
    const omitted = {
      ingredients: [
        { name: "rice", amount: 400, unit: "g" },
        { name: "fish sauce" },
      ],
    };
    const recipes = [
      recipeFromExtractJson(specified, "https://example.com/a")!,
      recipeFromExtractJson(specified, "https://example.com/b")!,
      recipeFromExtractJson(omitted, "https://example.com/c")!,
      recipeFromExtractJson(omitted, "https://example.com/d")!,
    ];
    const { ingredients } = buildRepresentativeRecipe(recipes, 430);
    const fish = ingredients.find((i) => i.name === "fish sauce");
    expect(fish?.volumeMl).toBeLessThan(25);
    expect(fish?.volumeMl).toBeGreaterThan(10);
  });

  it("rejects piece on seasoning names (LLM stand-in for pinch/to taste)", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "beef", amount: 300, unit: "g" },
          { name: "salt", amount: 1, unit: "piece" },
          { name: "black pepper", amount: 1, unit: "piece" },
        ],
      },
      "https://example.com/steak",
    );
    const salt = recipe?.ingredients.find((i) => i.name === "salt");
    const pepper = recipe?.ingredients.find((i) => i.name === "black pepper");
    expect(salt?.volumeMl).toBeLessThan(3);
    expect(pepper?.volumeMl).toBeLessThan(2);
  });

  it("scales a pinch up for a large pot and down for a small dish", () => {
    const large = recipeFromExtractJson(
      {
        ingredients: [
          { name: "water", amount: 2000, unit: "ml" },
          { name: "chicken", amount: 800, unit: "g" },
          { name: "salt", amount: 1, unit: "pinch" },
        ],
      },
      "https://example.com/big-soup",
    );
    const small = recipeFromExtractJson(
      {
        ingredients: [
          { name: "egg", amount: 1, unit: "piece" },
          { name: "salt", amount: 1, unit: "pinch" },
        ],
      },
      "https://example.com/egg",
    );
    const largeSalt = large?.ingredients.find((i) => i.name === "salt")?.volumeMl ?? 0;
    const smallSalt = small?.ingredients.find((i) => i.name === "salt")?.volumeMl ?? 0;
    expect(largeSalt).toBeGreaterThan(smallSalt);
    expect(largeSalt).toBeLessThan(3);
    expect(smallSalt).toBeGreaterThan(0.05);
  });
});

describe("jerk-like volume shares", () => {
  it("does not let a spoon of sugar dominate chicken pieces", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "chicken", amount: 5, unit: "piece" },
            { name: "green onion", amount: 7, unit: "piece" },
            { name: "chili pepper", amount: 7, unit: "piece" },
            { name: "brown sugar", amount: 1, unit: "tbsp" },
            { name: "soy sauce", amount: 2, unit: "tbsp" },
            { name: "salt", amount: 1, unit: "tbsp" },
          ],
        },
        "https://example.com/jerk-a",
      )!,
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "chicken", amount: 1, unit: "whole" },
            { name: "green onion", amount: 4, unit: "piece" },
            { name: "brown sugar", amount: 2, unit: "tbsp" },
            { name: "soy sauce", amount: 2, unit: "tbsp" },
            { name: "garlic", amount: 6, unit: "clove" },
          ],
        },
        "https://example.com/jerk-b",
      )!,
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "chicken", amount: 4, unit: "piece" },
            { name: "brown sugar", amount: 1, unit: "tbsp" },
            { name: "allspice", amount: 2, unit: "tsp" },
            { name: "soy sauce", amount: 1, unit: "tbsp" },
          ],
        },
        "https://example.com/jerk-c",
      )!,
    ];

    const { ingredients, finalVolumeMl } = buildRepresentativeRecipe(recipes, 1000);
    const tastes: Record<string, { sweet: number }> = {
      chicken: { sweet: 0 },
      "green onion": { sweet: 1 },
      "chili pepper": { sweet: 0 },
      "brown sugar": { sweet: 10 },
      "soy sauce": { sweet: 1 },
      salt: { sweet: 0 },
      garlic: { sweet: 0.5 },
      allspice: { sweet: 0.5 },
    };
    const scored = weightedTasteFromIngredients(
      ingredients.map((item) => ({
        volumeMl: item.volumeMl,
        taste: {
          sweet: tastes[item.name]?.sweet ?? 0,
          sour: 0,
          salty: 0,
          spicy: 0,
          umami: 0,
          bitter: 0,
        },
      })),
      finalVolumeMl,
    );
    const sweet = roundTaste(scored).sweet;
    expect(sweet).toBeLessThan(4);
  });
});
