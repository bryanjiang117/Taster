import { describe, expect, it } from "vitest";
import { applyProcessingToTaste } from "./processing";

describe("processing modifiers", () => {
  it("increases umami for fermentation", () => {
    const base = { sweet: 1, sour: 0, salty: 5, spicy: 0, umami: 4, bitter: 0 };
    const fermented = applyProcessingToTaste(base, ["fermentation"]);
    expect(fermented.umami).toBeGreaterThan(base.umami);
  });

  it("increases bitterness and umami for roasting", () => {
    const base = { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 2, bitter: 1 };
    const roasted = applyProcessingToTaste(base, ["roasting"]);
    expect(roasted.bitter).toBeGreaterThan(base.bitter);
    expect(roasted.umami).toBeGreaterThan(base.umami);
  });

  it("increases sourness for pickling", () => {
    const base = { sweet: 0, sour: 3, salty: 4, spicy: 0, umami: 0, bitter: 0 };
    const pickled = applyProcessingToTaste(base, ["pickling"]);
    expect(pickled.sour).toBeGreaterThan(base.sour);
  });

  it("reduces bitterness for boiling (leaching)", () => {
    const base = { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 6 };
    const boiled = applyProcessingToTaste(base, ["boiling"]);
    expect(boiled.bitter).toBeLessThan(base.bitter);
  });
});
