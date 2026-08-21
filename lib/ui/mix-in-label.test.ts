import { describe, expect, it } from "vitest";
import type { FoundIngredient } from "@/lib/engine/found-ingredients";
import { formatMixInLabel } from "./mix-in-label";

function item(partial: Partial<FoundIngredient>): FoundIngredient {
  return {
    name: "oil",
    used: 1,
    total: 1,
    pending: false,
    flavors: [],
    out: false,
    recipes: [],
    ...partial,
  };
}

describe("formatMixInLabel", () => {
  it("hides the line when the ingredient fully contributes", () => {
    expect(formatMixInLabel(item({ mixIntensity: 1 }))).toBeNull();
    expect(formatMixInLabel(item({}))).toBeNull();
  });

  it("shows percent and why for partial, evaporated, concentrated, and sides", () => {
    expect(
      formatMixInLabel(item({ mixIntensity: 0.4, mixWhy: "marinade" })),
    ).toBe("contributes: 40% · marinade");
    expect(
      formatMixInLabel(item({ mixIntensity: 0, mixWhy: "evaporated" })),
    ).toBe("contributes: 0% · evaporated");
    expect(
      formatMixInLabel(item({ mixIntensity: 1.5, mixWhy: "concentrated" })),
    ).toBe("contributes: 150% · concentrated");
    expect(formatMixInLabel(item({ name: "lemon", out: true }))).toBe(
      "contributes: 0% · on the side",
    );
  });

  it("falls back to a short why when extract omitted it", () => {
    expect(formatMixInLabel(item({ mixIntensity: 0 }))).toBe(
      "contributes: 0% · evaporated",
    );
    expect(formatMixInLabel(item({ mixIntensity: 1.5 }))).toBe(
      "contributes: 150% · concentrated",
    );
    expect(formatMixInLabel(item({ mixIntensity: 0.4 }))).toBe(
      "contributes: 40%",
    );
  });
});
