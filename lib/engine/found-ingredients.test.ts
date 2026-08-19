import { describe, expect, it } from "vitest";
import {
  accompanimentFootnote,
  foundIngredientsFromRecipes,
} from "./found-ingredients";
import { IngredientStore } from "./store";

describe("foundIngredientsFromRecipes", () => {
  it("counts ingredients across recipes and attaches seed taste when known", () => {
    const store = new IngredientStore([
      {
        ingredient: "soy sauce",
        taste: { sweet: 1, sour: 0.5, salty: 9, spicy: 0, umami: 8, bitter: 0 },
        derivedFrom: ["soybeans"],
        processing: ["fermentation"],
        confidence: 0.91,
        source: "measured",
      },
    ]);

    const found = foundIngredientsFromRecipes(
      [
        {
          title: "Mapo tofu",
          url: "https://example.com/mapo",
          ingredients: [{ name: "酱油", volumeMl: 20 }, { name: "tofu", volumeMl: 200 }],
        },
        {
          url: "https://www.kitchen.test/soy",
          ingredients: [{ name: "soy sauce", volumeMl: 15 }],
        },
      ],
      store,
    );

    const soy = found.find((item) => item.name === "soy sauce");
    expect(soy?.used).toBe(2);
    expect(soy?.total).toBe(2);
    expect(soy?.pending).toBe(false);
    expect(soy?.taste?.salty).toBe(9);
    expect(soy?.flavors).toEqual(["salty", "umami"]);

    const tofu = found.find((item) => item.name === "tofu");
    expect(tofu?.pending).toBe(true);
    expect(tofu?.flavors).toEqual([]);
    expect(soy?.recipes).toEqual([
      { title: "Mapo tofu", url: "https://example.com/mapo" },
      { title: "kitchen.test", url: "https://www.kitchen.test/soy" },
    ]);
    expect(tofu?.recipes).toEqual([
      { title: "Mapo tofu", url: "https://example.com/mapo" },
    ]);
    expect(found.map((item) => item.name)).toEqual(["soy sauce", "tofu"]);
  });

  it("sorts by recipe count then median volume", () => {
    const found = foundIngredientsFromRecipes(
      [
        {
          ingredients: [
            { name: "salt", volumeMl: 5 },
            { name: "tofu", volumeMl: 200 },
            { name: "oil", volumeMl: 30 },
          ],
        },
        {
          ingredients: [
            { name: "salt", volumeMl: 5 },
            { name: "tofu", volumeMl: 180 },
          ],
        },
        {
          ingredients: [
            { name: "salt", volumeMl: 5 },
            { name: "oil", volumeMl: 20 },
          ],
        },
      ],
      new IngredientStore([]),
    );

    expect(found.map((item) => item.name)).toEqual(["salt", "tofu", "oil"]);
  });

  it("marks ingredients that never appear in-dish as out", () => {
    const store = new IngredientStore([
      {
        ingredient: "lemon",
        taste: { sweet: 1, sour: 10, salty: 0, spicy: 0, umami: 0, bitter: 1 },
        derivedFrom: [],
        processing: [],
        confidence: 0.9,
        source: "measured",
      },
    ]);
    const found = foundIngredientsFromRecipes(
      [
        {
          ingredients: [
            { name: "shrimp", volumeMl: 300, role: "in" },
            { name: "lemon", volumeMl: 30, role: "out" },
          ],
        },
        {
          ingredients: [
            { name: "shrimp", volumeMl: 280, role: "in" },
            { name: "lemon", volumeMl: 25, role: "out" },
          ],
        },
      ],
      store,
    );
    expect(found.find((item) => item.name === "shrimp")?.out).toBe(false);
    const lemon = found.find((item) => item.name === "lemon");
    expect(lemon?.out).toBe(true);
    expect(lemon?.flavors).toEqual(["sour"]);
  });

  it("does not mark an ingredient out when any recipe uses it in-dish", () => {
    const found = foundIngredientsFromRecipes(
      [
        {
          ingredients: [
            { name: "lemon", volumeMl: 30, role: "out" },
            { name: "shrimp", volumeMl: 300, role: "in" },
          ],
        },
        {
          ingredients: [
            { name: "lemon", volumeMl: 40, role: "in" },
            { name: "shrimp", volumeMl: 280, role: "in" },
          ],
        },
      ],
      new IngredientStore([]),
    );
    expect(found.find((item) => item.name === "lemon")?.out).toBe(false);
  });

  it("shows salty and umami on fish sauce", () => {
    const store = new IngredientStore([
      {
        ingredient: "fish sauce",
        taste: { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 },
        derivedFrom: ["anchovy", "salt"],
        processing: ["fermentation"],
        confidence: 0.9,
        source: "measured",
      },
    ]);
    const found = foundIngredientsFromRecipes(
      [{ ingredients: [{ name: "fish sauce", volumeMl: 15 }] }],
      store,
    );
    expect(found[0]?.flavors).toEqual(["salty", "umami"]);
  });

  it("builds a short footnote with primary flavors for out-only ingredients", () => {
    const store = new IngredientStore([
      {
        ingredient: "lemon",
        taste: { sweet: 1, sour: 10, salty: 0, spicy: 0, umami: 0, bitter: 1 },
        derivedFrom: [],
        processing: [],
        confidence: 0.9,
        source: "measured",
      },
    ]);
    const found = foundIngredientsFromRecipes(
      [
        {
          ingredients: [
            { name: "shrimp", volumeMl: 300, role: "in" },
            { name: "lemon", volumeMl: 30, role: "out" },
          ],
        },
      ],
      store,
    );
    expect(accompanimentFootnote(found)).toBe("Often served with lemon · sour");
  });
});
