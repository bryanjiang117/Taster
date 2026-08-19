import { describe, expect, it } from "vitest";
import { formatIngredientProvenance } from "./ingredient-provenance";

describe("formatIngredientProvenance", () => {
  it("names chemistry databases for measured leaves", () => {
    expect(
      formatIngredientProvenance({
        source: "measured",
        measuredFrom: ["fct", "usda"],
        confidence: 0.95,
      }),
    ).toBe("Measured · FAO/INFOODS, USDA · 95%");
  });

  it("names a single database for nutrition leaves", () => {
    expect(
      formatIngredientProvenance({
        source: "nutrition",
        measuredFrom: ["duke"],
        confidence: 0.8,
      }),
    ).toBe("Measured · Dr. Duke · 80%");
  });

  it("falls back to the catalog for cached measured rows", () => {
    expect(
      formatIngredientProvenance({
        source: "measured",
        confidence: 0.95,
      }),
    ).toBe("Measured · Taster catalog · 95%");
  });

  it("describes recipe and llm sources", () => {
    expect(
      formatIngredientProvenance({
        source: "recipe",
        reasoning: "Tasted from 3 recipes",
        confidence: 0.55,
      }),
    ).toBe("From recipes · 3 recipes · 55%");

    expect(
      formatIngredientProvenance({
        source: "llm",
        confidence: 0.3,
      }),
    ).toBe("Estimated · Gemini · 30%");
  });
});
