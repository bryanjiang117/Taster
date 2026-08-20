import { describe, expect, it } from "vitest";
import {
  applyPrepMixHeuristics,
  inferDiscardedCookingMedium,
  isBulkNeutralCookingOil,
} from "./prep-mix";

describe("prep mix heuristics", () => {
  it("marks bulk vegetable oil as intensity 0", () => {
    const mix = inferDiscardedCookingMedium(
      { name: "vegetable oil", volumeMl: 300, role: "in" },
      820,
    );
    expect(mix?.intensity).toBe(0);
  });

  it("keeps finishing sesame oil at default intensity", () => {
    expect(
      inferDiscardedCookingMedium(
        { name: "sesame oil", volumeMl: 5, role: "in" },
        500,
      )?.intensity,
    ).toBeUndefined();
    expect(isBulkNeutralCookingOil("sesame oil")).toBe(false);
  });

  it("does not override an explicit concentrated oil intensity", () => {
    const mix = inferDiscardedCookingMedium(
      {
        name: "vegetable oil",
        volumeMl: 300,
        role: "in",
        mix: { intensity: 1.5 },
      },
      820,
    );
    expect(mix?.intensity).toBe(1.5);
  });

  it("applies heuristics across recipes before representative build", () => {
    const [recipe] = applyPrepMixHeuristics([
      {
        ingredients: [
          { name: "chicken", volumeMl: 500, role: "in" },
          { name: "vegetable oil", volumeMl: 300, role: "in" },
          { name: "salt", volumeMl: 5, role: "in" },
        ],
      },
    ]);
    expect(recipe.ingredients.find((i) => i.name === "vegetable oil")?.mix?.intensity).toBe(
      0,
    );
  });
});
