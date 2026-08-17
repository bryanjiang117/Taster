import { describe, expect, it } from "vitest";
import { buildRepresentativeRecipe } from "./representative";

describe("representative recipe", () => {
  it("keeps ingredients used in at least half of recipes", () => {
    const recipes = [
      {
        ingredients: [
          { name: "lime", volumeMl: 30 },
          { name: "fish sauce", volumeMl: 30 },
          { name: "chili", volumeMl: 10 },
        ],
      },
      {
        ingredients: [
          { name: "lime", volumeMl: 40 },
          { name: "fish sauce", volumeMl: 20 },
          { name: "chili", volumeMl: 8 },
        ],
      },
      {
        ingredients: [
          { name: "lime", volumeMl: 20 },
          { name: "fish sauce", volumeMl: 25 },
          { name: "cilantro", volumeMl: 15 },
        ],
      },
    ];

    const representative = buildRepresentativeRecipe(recipes, 100);
    const names = representative.ingredients.map((i) => i.name);

    expect(names).toContain("lime");
    expect(names).toContain("fish sauce");
    expect(names).toContain("chili");
    expect(names).not.toContain("cilantro");
  });

  it("uses median volume-per-final-volume scaled to a common basis", () => {
    const recipes = [
      { ingredients: [{ name: "salt", volumeMl: 10 }], finalVolumeMl: 100 },
      { ingredients: [{ name: "salt", volumeMl: 20 }], finalVolumeMl: 200 },
      { ingredients: [{ name: "salt", volumeMl: 5 }], finalVolumeMl: 50 },
    ];

    const representative = buildRepresentativeRecipe(recipes, 200);
    expect(representative.ingredients[0].volumeMl).toBeCloseTo(20);
  });

  it("records occurrence counts for provenance", () => {
    const recipes = [
      { ingredients: [{ name: "lime", volumeMl: 10 }] },
      { ingredients: [{ name: "lime", volumeMl: 10 }] },
    ];
    const representative = buildRepresentativeRecipe(recipes, 100);
    expect(representative.ingredients[0].occurrence).toEqual({ used: 2, total: 2 });
  });

  it("treats translated names of the same ingredient as one ingredient", () => {
    const recipes = [
      { ingredients: [{ name: "酱油", volumeMl: 20 }, { name: "豆腐", volumeMl: 200 }] },
      { ingredients: [{ name: "生抽", volumeMl: 25 }, { name: "tofu", volumeMl: 180 }] },
      { ingredients: [{ name: "soy sauce", volumeMl: 15 }, { name: "豆腐", volumeMl: 220 }] },
    ];
    const representative = buildRepresentativeRecipe(recipes, 300);
    const names = representative.ingredients.map((i) => i.name);
    expect(names).toContain("soy sauce");
    expect(names).toContain("tofu");
    expect(names).not.toContain("");
    expect(names[0]).toBe("tofu");
  });

  it("excludes ingredients that only appear as out of the dish", () => {
    const recipes = [
      {
        ingredients: [
          { name: "shrimp", volumeMl: 300, role: "in" as const },
          { name: "lemon", volumeMl: 30, role: "out" as const },
        ],
      },
      {
        ingredients: [
          { name: "shrimp", volumeMl: 280, role: "in" as const },
          { name: "lemon", volumeMl: 25, role: "out" as const },
        ],
      },
      {
        ingredients: [
          { name: "shrimp", volumeMl: 320, role: "in" as const },
          { name: "lemon", volumeMl: 20, role: "out" as const },
        ],
      },
    ];
    const representative = buildRepresentativeRecipe(recipes, 400);
    const names = representative.ingredients.map((i) => i.name);
    expect(names).toContain("shrimp");
    expect(names).not.toContain("lemon");
  });

  it("counts only in-dish appearances toward occurrence and volume", () => {
    const recipes = [
      {
        ingredients: [
          { name: "shrimp", volumeMl: 300, role: "in" as const },
          { name: "lemon", volumeMl: 30, role: "out" as const },
        ],
        finalVolumeMl: 400,
      },
      {
        ingredients: [
          { name: "shrimp", volumeMl: 280, role: "in" as const },
          { name: "lemon", volumeMl: 40, role: "in" as const },
        ],
        finalVolumeMl: 400,
      },
      {
        ingredients: [
          { name: "shrimp", volumeMl: 320, role: "in" as const },
          { name: "lemon", volumeMl: 80, role: "in" as const },
        ],
        finalVolumeMl: 400,
      },
    ];
    const representative = buildRepresentativeRecipe(recipes, 400);
    const lemon = representative.ingredients.find((i) => i.name === "lemon");
    expect(lemon?.occurrence).toEqual({ used: 2, total: 3 });
    // median of in-only shares: 40/400 and 80/400 → 0.15 → 60ml at target 400
    expect(lemon?.volumeMl).toBeCloseTo(60);
  });
});
