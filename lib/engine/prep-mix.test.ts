import { describe, expect, it } from "vitest";
import { combineRecipeTaste } from "./combine";
import {
  applyPrepMixHeuristics,
  inferCookingLiquidContribution,
  inferDiscardedCookingMedium,
  isBulkNeutralCookingOil,
} from "./prep-mix";
import { buildRepresentativeRecipe } from "./representative";
import { estimateFinalVolume, tastingVolumeMl } from "./volume";

const salt = {
  sweet: 0,
  sour: 0,
  salty: 10,
  spicy: 0,
  umami: 0,
  bitter: 0,
};
const rice = {
  sweet: 0.5,
  sour: 0,
  salty: 0,
  spicy: 0,
  umami: 0.5,
  bitter: 0,
};
const water = {
  sweet: 0,
  sour: 0,
  salty: 0,
  spicy: 0,
  umami: 0,
  bitter: 0,
};
const stock = {
  sweet: 0.5,
  sour: 0.5,
  salty: 4,
  spicy: 0,
  umami: 5,
  bitter: 0,
};

describe("prep mix heuristics", () => {
  it("marks bulk vegetable oil as intensity 0", () => {
    const mix = inferDiscardedCookingMedium(
      { name: "vegetable oil", volumeMl: 300, role: "in" },
      820,
    );
    expect(mix?.intensity).toBe(0);
    expect(mix?.why).toBe("drained");
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
});

describe("cooking liquid contribution", () => {
  it("marks evaporated water as intensity 0 and reconciles process volume", () => {
    const recipe = {
      ingredients: [
        { name: "rice", volumeMl: 300, role: "in" as const },
        { name: "water", volumeMl: 800, role: "in" as const },
        { name: "salt", volumeMl: 5, role: "in" as const },
      ],
      processes: [{ type: "evaporation" as const, volumeDeltaMl: -700 }],
    };
    const mix = inferCookingLiquidContribution(recipe);
    expect(mix.ingredients.find((i) => i.name === "water")?.mix).toMatchObject({
      intensity: 0,
      why: "evaporated",
    });
    const evaporation = mix.processes?.find((p) => p.type === "evaporation");
    expect(evaporation?.volumeDeltaMl ?? 0).toBeGreaterThanOrEqual(-100);
  });

  it("keeps soup water when nothing evaporates or absorbs", () => {
    const recipe = {
      ingredients: [
        { name: "chicken", volumeMl: 200, role: "in" as const },
        { name: "water", volumeMl: 800, role: "in" as const },
        { name: "salt", volumeMl: 5, role: "in" as const },
      ],
      processes: [],
    };
    const mix = inferCookingLiquidContribution(recipe);
    expect(mix.ingredients.find((i) => i.name === "water")?.mix?.intensity).toBeUndefined();
  });

  it("zeros bulk water cooked into rice even without process rows", () => {
    const mix = inferCookingLiquidContribution({
      ingredients: [
        { name: "bomba rice", volumeMl: 300, role: "in" },
        { name: "water", volumeMl: 900, role: "in" },
        { name: "salt", volumeMl: 5, role: "in" },
      ],
    });
    expect(mix.ingredients.find((i) => i.name === "water")?.mix).toMatchObject({
      intensity: 0,
      why: "absorbed",
    });
  });

  it("keeps a flavor floor for stock absorbed into grain", () => {
    const mix = inferCookingLiquidContribution({
      ingredients: [
        { name: "rice", volumeMl: 300, role: "in" },
        { name: "chicken stock", volumeMl: 800, role: "in" },
        { name: "salt", volumeMl: 3, role: "in" },
      ],
      processes: [
        { type: "absorption", volumeDeltaMl: -500 },
        { type: "evaporation", volumeDeltaMl: -250 },
      ],
    });
    const stockMix = mix.ingredients.find((i) => i.name === "chicken stock")?.mix;
    expect(stockMix?.intensity).toBeGreaterThanOrEqual(0.25);
    expect(stockMix?.intensity).toBeLessThan(1);
    expect(stockMix?.why).toMatch(/absorb|evaporat/);
  });

  it("lets salt season paella after prep heuristics remove cooking water volume", () => {
    const [recipe] = applyPrepMixHeuristics([
      {
        ingredients: [
          { name: "rice", volumeMl: 300, role: "in" },
          { name: "water", volumeMl: 900, role: "in" },
          { name: "salt", volumeMl: 8, role: "in" },
        ],
        processes: [{ type: "evaporation", volumeDeltaMl: -800 }],
      },
    ]);
    const starting = recipe.ingredients.reduce(
      (sum, item) => sum + tastingVolumeMl(item),
      0,
    );
    const finalVolumeMl = estimateFinalVolume(
      [{ name: "base", volumeMl: starting }],
      recipe.processes ?? [],
    );
    const { ingredients } = buildRepresentativeRecipe([recipe], finalVolumeMl);
    const mixable = ingredients.map((item) => ({
      volumeMl: item.volumeMl,
      taste:
        item.name === "salt" ? salt : item.name === "rice" ? rice : water,
      role: "in" as const,
      mix: item.mix,
    }));
    const taste = combineRecipeTaste(mixable, finalVolumeMl);
    expect(taste.salty).toBeGreaterThan(2);
    expect(
      ingredients.find((i) => i.name === "water")?.mix?.intensity ?? 1,
    ).toBe(0);
  });

  it("still lets stock flavor punch through after absorption", () => {
    const [recipe] = applyPrepMixHeuristics([
      {
        ingredients: [
          { name: "rice", volumeMl: 300, role: "in" },
          { name: "fish stock", volumeMl: 700, role: "in" },
          { name: "salt", volumeMl: 4, role: "in" },
        ],
        processes: [{ type: "absorption", volumeDeltaMl: -650 }],
      },
    ]);
    const starting = recipe.ingredients.reduce(
      (sum, item) => sum + tastingVolumeMl(item),
      0,
    );
    const finalVolumeMl = estimateFinalVolume(
      [{ name: "base", volumeMl: starting }],
      recipe.processes ?? [],
    );
    const { ingredients } = buildRepresentativeRecipe([recipe], finalVolumeMl);
    const mixable = ingredients.map((item) => ({
      volumeMl: item.volumeMl,
      taste:
        item.name === "salt"
          ? salt
          : item.name === "fish stock"
            ? stock
            : rice,
      role: "in" as const,
      mix: item.mix,
    }));
    const taste = combineRecipeTaste(mixable, finalVolumeMl);
    expect(taste.umami).toBeGreaterThan(0.8);
    expect(taste.salty).toBeGreaterThan(0.8);
  });
});
