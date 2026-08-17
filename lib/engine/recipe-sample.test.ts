import { describe, expect, it } from "vitest";
import {
  flavorInconsistency,
  MIN_RECIPES,
  MAX_RECIPES,
  recipesNeeded,
} from "./recipe-sample";
import type { TasteProfile } from "./types";

const bland: TasteProfile = {
  sweet: 0,
  sour: 0,
  salty: 0,
  spicy: 0,
  umami: 0,
  bitter: 0,
};

const saltyHot: TasteProfile = {
  sweet: 0,
  sour: 0,
  salty: 9,
  spicy: 8,
  umami: 7,
  bitter: 0,
};

const sweetMild: TasteProfile = {
  sweet: 8,
  sour: 1,
  salty: 1,
  spicy: 0,
  umami: 1,
  bitter: 0,
};

describe("recipe sample size", () => {
  it("asks for 3 recipes when flavors match and 7 when they clash", () => {
    expect(MIN_RECIPES).toBe(3);
    expect(MAX_RECIPES).toBe(7);
    expect(recipesNeeded(0)).toBe(3);
    expect(recipesNeeded(1)).toBe(7);
  });

  it("treats identical profiles as consistent", () => {
    expect(flavorInconsistency([saltyHot, saltyHot, saltyHot])).toBe(0);
    expect(recipesNeeded(flavorInconsistency([saltyHot, saltyHot, saltyHot]))).toBe(3);
  });

  it("asks for more recipes when profiles disagree", () => {
    const inconsistency = flavorInconsistency([saltyHot, sweetMild, bland]);
    expect(inconsistency).toBeGreaterThan(0.4);
    expect(recipesNeeded(inconsistency)).toBeGreaterThan(3);
  });
});
