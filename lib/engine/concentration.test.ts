import { describe, expect, it } from "vitest";
import { effectiveFlavor, weightedTasteFromIngredients } from "./concentration";

describe("effective concentration", () => {
  it("scales intrinsic taste by ingredient share of final volume", () => {
    expect(effectiveFlavor(9, 10, 100)).toBeCloseTo(0.9);
    expect(effectiveFlavor(9, 10, 200)).toBeCloseTo(0.45);
  });

  it("treats missing or zero final volume as no contribution", () => {
    expect(effectiveFlavor(9, 10, 0)).toBe(0);
  });

  it("weights ingredient tastes by post-process concentration, not raw mass", () => {
    const profile = weightedTasteFromIngredients(
      [
        {
          name: "fish sauce",
          volumeMl: 15,
          taste: { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 8, bitter: 0 },
        },
        {
          name: "water",
          volumeMl: 485,
          taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
        },
      ],
      500,
    );

    expect(profile.salty).toBeCloseTo(9 * (15 / 500));
    expect(profile.umami).toBeCloseTo(8 * (15 / 500));
    expect(profile.sweet).toBeCloseTo(1 * (15 / 500));
  });

  it("concentrates flavor when final volume shrinks from reduction", () => {
    const ingredients = [
      {
        name: "soy sauce",
        volumeMl: 30,
        taste: { sweet: 1, sour: 0.5, salty: 9, spicy: 0, umami: 8, bitter: 0 },
      },
    ];
    const before = weightedTasteFromIngredients(ingredients, 300);
    const after = weightedTasteFromIngredients(ingredients, 100);
    expect(after.salty).toBeCloseTo(before.salty * 3);
  });
});
