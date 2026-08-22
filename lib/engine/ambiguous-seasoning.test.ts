import { describe, expect, it } from "vitest";
import {
  applyAmbiguousSeasoningAdjustment,
  primarySeasonerDimension,
  type AmbiguousSeasoningAdjustment,
} from "./ambiguous-seasoning";
import { recipeFromExtractJson } from "./llm-parse";
import { buildRepresentativeRecipe } from "./representative";
import { emptyTaste } from "./taste";
import type { ScoreContributions } from "./combine";

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

  it("does not flag black pepper to taste (not a primary seasoner)", () => {
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
    ).toBeFalsy();
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

describe("applyAmbiguousSeasoningAdjustment", () => {
  const emptyContrib = (): ScoreContributions => ({
    sweet: [],
    sour: [],
    salty: [],
    spicy: [],
    umami: [],
    bitter: [],
  });

  it("raises a flagged dim and adds uplift to the seasoner's contribution", () => {
    const taste = { ...emptyTaste(), salty: 2.5 };
    const contributions = emptyContrib();
    contributions.salty = [
      { name: "soy sauce", points: 2.0 },
      { name: "salt", points: 0.5 },
    ];
    const adjustment: AmbiguousSeasoningAdjustment = {
      adjustments: [
        {
          dimension: "salty",
          target: 5,
          contributions: [{ ingredient: "salt", points: 2.5 }],
        },
      ],
    };
    const result = applyAmbiguousSeasoningAdjustment({
      taste,
      contributions,
      flagged: [{ name: "salt", dimension: "salty" }],
      adjustment,
    });
    expect(result.taste.salty).toBe(5);
    expect(result.contributions.salty.find((r) => r.name === "salt")?.points).toBe(3);
    expect(result.contributions.salty.find((r) => r.name === "soy sauce")?.points).toBe(2);
  });

  it("never lowers below the engine score", () => {
    const taste = { ...emptyTaste(), salty: 4 };
    const contributions = emptyContrib();
    contributions.salty = [{ name: "salt", points: 4 }];
    const result = applyAmbiguousSeasoningAdjustment({
      taste,
      contributions,
      flagged: [{ name: "salt", dimension: "salty" }],
      adjustment: {
        adjustments: [
          {
            dimension: "salty",
            target: 2,
            contributions: [{ ingredient: "salt", points: 0 }],
          },
        ],
      },
    });
    expect(result.taste.salty).toBe(4);
    expect(result.contributions.salty[0]?.points).toBe(4);
  });

  it("splits uplift across multiple flagged seasoners on one dim", () => {
    const taste = { ...emptyTaste(), sour: 3 };
    const contributions = emptyContrib();
    contributions.sour = [
      { name: "tomato", points: 2 },
      { name: "lemon juice", points: 0.5 },
      { name: "vinegar", points: 0.5 },
    ];
    const result = applyAmbiguousSeasoningAdjustment({
      taste,
      contributions,
      flagged: [
        { name: "lemon juice", dimension: "sour" },
        { name: "vinegar", dimension: "sour" },
      ],
      adjustment: {
        adjustments: [
          {
            dimension: "sour",
            target: 6,
            contributions: [
              { ingredient: "lemon juice", points: 2 },
              { ingredient: "vinegar", points: 1 },
            ],
          },
        ],
      },
    });
    expect(result.taste.sour).toBe(6);
    expect(result.contributions.sour.find((r) => r.name === "lemon juice")?.points).toBe(
      2.5,
    );
    expect(result.contributions.sour.find((r) => r.name === "vinegar")?.points).toBe(1.5);
    expect(result.contributions.sour.find((r) => r.name === "tomato")?.points).toBe(2);
  });

  it("ignores unflagged dimensions from the model", () => {
    const taste = { ...emptyTaste(), salty: 2, sweet: 1 };
    const contributions = emptyContrib();
    contributions.salty = [{ name: "salt", points: 2 }];
    contributions.sweet = [{ name: "onion", points: 1 }];
    const result = applyAmbiguousSeasoningAdjustment({
      taste,
      contributions,
      flagged: [{ name: "salt", dimension: "salty" }],
      adjustment: {
        adjustments: [
          {
            dimension: "salty",
            target: 4,
            contributions: [{ ingredient: "salt", points: 2 }],
          },
          {
            dimension: "sweet",
            target: 8,
            contributions: [{ ingredient: "onion", points: 7 }],
          },
        ],
      },
    });
    expect(result.taste.salty).toBe(4);
    expect(result.taste.sweet).toBe(1);
  });
});
