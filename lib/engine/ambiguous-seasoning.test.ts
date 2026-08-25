import { describe, expect, it } from "vitest";
import { primarySeasonerDimension } from "./ambiguous-seasoning";
import { recipeFromExtractJson } from "./llm-parse";
import { buildRepresentativeRecipe } from "./representative";

describe("primarySeasonerDimension", () => {
  it("maps salt, sugar, lemon, chili, msg to their dims", () => {
    expect(primarySeasonerDimension("salt")).toBe("salty");
    expect(primarySeasonerDimension("kosher salt")).toBe("salty");
    expect(primarySeasonerDimension("brown sugar")).toBe("sweet");
    expect(primarySeasonerDimension("honey")).toBe("sweet");
    expect(primarySeasonerDimension("lemon juice")).toBe("sour");
    expect(primarySeasonerDimension("rice vinegar")).toBe("sour");
    expect(primarySeasonerDimension("thai chili")).toBe("spicy");
    expect(primarySeasonerDimension("msg")).toBe("umami");
  });

  it("does not treat black pepper, soy, or bulk foods as primary seasoners", () => {
    expect(primarySeasonerDimension("black pepper")).toBeNull();
    expect(primarySeasonerDimension("soy sauce")).toBeNull();
    expect(primarySeasonerDimension("chicken")).toBeNull();
  });
});

describe("quantityAmbiguous flag at extract", () => {
  it("flags salt with missing amount or to taste", () => {
    const missing = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "salt" },
        ],
      },
      "https://example.com/a",
    );
    expect(missing?.ingredients.find((i) => i.name === "salt")?.quantityAmbiguous).toBe(
      true,
    );

    const toTaste = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "salt", unit: "to taste" },
        ],
      },
      "https://example.com/b",
    );
    expect(toTaste?.ingredients.find((i) => i.name === "salt")?.quantityAmbiguous).toBe(
      true,
    );
  });

  it("does not flag a measured pinch or tbsp of salt", () => {
    const pinch = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "salt", amount: 1, unit: "pinch" },
        ],
      },
      "https://example.com/c",
    );
    expect(pinch?.ingredients.find((i) => i.name === "salt")?.quantityAmbiguous).toBeFalsy();

    const tbsp = recipeFromExtractJson(
      {
        ingredients: [
          { name: "rice", amount: 400, unit: "g" },
          { name: "salt", amount: 1, unit: "tbsp" },
        ],
      },
      "https://example.com/d",
    );
    expect(tbsp?.ingredients.find((i) => i.name === "salt")?.quantityAmbiguous).toBeFalsy();
  });

  it("flags black pepper to taste like any omitted amount", () => {
    const recipe = recipeFromExtractJson(
      {
        ingredients: [
          { name: "steak", amount: 300, unit: "g" },
          { name: "black pepper", unit: "to taste" },
        ],
      },
      "https://example.com/e",
    );
    expect(
      recipe?.ingredients.find((i) => i.name === "black pepper")?.quantityAmbiguous,
    ).toBe(true);
  });

  it("ORs the flag onto the representative ingredient", () => {
    const recipes = [
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "salt", amount: 1, unit: "tsp" },
          ],
        },
        "https://example.com/r1",
      )!,
      recipeFromExtractJson(
        {
          ingredients: [
            { name: "rice", amount: 400, unit: "g" },
            { name: "salt" },
          ],
        },
        "https://example.com/r2",
      )!,
    ];
    const { ingredients } = buildRepresentativeRecipe(recipes, 1000);
    expect(ingredients.find((i) => i.name === "salt")?.quantityAmbiguous).toBe(true);
  });
});
