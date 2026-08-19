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
