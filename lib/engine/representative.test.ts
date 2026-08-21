import { describe, expect, it } from "vitest";
import { buildRepresentativeRecipe } from "./representative";

describe("representative recipe", () => {
  it("includes rare ingredients with occurrence-diluted volume", () => {
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
    expect(names).toContain("cilantro");
    const cilantro = representative.ingredients.find((i) => i.name === "cilantro");
    // present share 15/60 in one of three recipes → mean 0.25/3
    expect(cilantro?.volumeMl).toBeCloseTo((15 / 60 / 3) * 100);
    expect(cilantro?.occurrence).toEqual({ used: 1, total: 3 });
  });

  it("uses mean share including absences as zero", () => {
    const recipes = [
      { ingredients: [{ name: "salt", volumeMl: 10 }], finalVolumeMl: 100 },
      { ingredients: [{ name: "salt", volumeMl: 20 }], finalVolumeMl: 200 },
      { ingredients: [{ name: "salt", volumeMl: 5 }], finalVolumeMl: 50 },
    ];

    const representative = buildRepresentativeRecipe(recipes, 200);
    // each recipe share is 0.1 → mean 0.1 × 200
    expect(representative.ingredients[0].volumeMl).toBeCloseTo(20);
  });

  it("weights mutual substitutes so their volumes sum like one sauce slot", () => {
    const recipes = [
      {
        ingredients: [
          { name: "chicken", volumeMl: 450 },
          { name: "soy sauce", volumeMl: 50 },
        ],
        finalVolumeMl: 500,
      },
      {
        ingredients: [
          { name: "chicken", volumeMl: 450 },
          { name: "fish sauce", volumeMl: 50 },
        ],
        finalVolumeMl: 500,
      },
      {
        ingredients: [
          { name: "chicken", volumeMl: 450 },
          { name: "oyster sauce", volumeMl: 50 },
        ],
        finalVolumeMl: 500,
      },
    ];
    const representative = buildRepresentativeRecipe(recipes, 500);
    const soy = representative.ingredients.find((i) => i.name === "soy sauce");
    const fish = representative.ingredients.find((i) => i.name === "fish sauce");
    const oyster = representative.ingredients.find((i) => i.name === "oyster sauce");
    const chicken = representative.ingredients.find((i) => i.name === "chicken");
    expect(soy?.volumeMl).toBeCloseTo(50 / 3);
    expect(fish?.volumeMl).toBeCloseTo(50 / 3);
    expect(oyster?.volumeMl).toBeCloseTo(50 / 3);
    expect((soy?.volumeMl ?? 0) + (fish?.volumeMl ?? 0) + (oyster?.volumeMl ?? 0)).toBeCloseTo(
      50,
    );
    expect(chicken?.volumeMl).toBeCloseTo(450);
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
    // mean of {0, 40/400, 80/400} → 0.1 → 40ml at target 400
    expect(lemon?.volumeMl).toBeCloseTo(40);
  });

  it("keeps median prep intensity so discarded frying oil does not fill the bowl", () => {
    const recipes = [
      {
        ingredients: [
          { name: "chicken", volumeMl: 500, role: "in" as const },
          { name: "oil", volumeMl: 300, role: "in" as const, mix: { intensity: 0 } },
          { name: "salt", volumeMl: 5, role: "in" as const },
        ],
      },
      {
        ingredients: [
          { name: "chicken", volumeMl: 500, role: "in" as const },
          { name: "oil", volumeMl: 200, role: "in" as const, mix: { intensity: 0 } },
          { name: "salt", volumeMl: 5, role: "in" as const },
        ],
      },
    ];
    const representative = buildRepresentativeRecipe(recipes, 505);
    const oil = representative.ingredients.find((i) => i.name === "oil");
    const salt = representative.ingredients.find((i) => i.name === "salt");
    expect(oil?.mix?.intensity).toBe(0);
    expect(salt?.volumeMl).toBeGreaterThan(4);
    expect(oil?.volumeMl ?? 0).toBeLessThan(1);
  });
});
