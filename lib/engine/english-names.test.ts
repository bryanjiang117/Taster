import { describe, expect, it } from "vitest";
import { applyEnglishNames, isLatinIngredientName } from "./english-names";

describe("english ingredient names", () => {
  it("treats CJK names as not Latin", () => {
    expect(isLatinIngredientName("花椒")).toBe(false);
    expect(isLatinIngredientName("soy sauce")).toBe(true);
  });

  it("rewrites recipe ingredients using an English map", () => {
    const recipes = applyEnglishNames(
      [{ ingredients: [{ name: "花椒", volumeMl: 5 }, { name: "酱油", volumeMl: 15 }] }],
      { 花椒: "sichuan pepper" },
    );
    expect(recipes[0]?.ingredients.map((i) => i.name)).toEqual([
      "sichuan pepper",
      "soy sauce",
    ]);
  });

  it("splits only when the LLM map lists multiple singular names", () => {
    const recipes = applyEnglishNames(
      [{ ingredients: [{ name: "papaya and carrot", volumeMl: 200 }] }],
      { "papaya and carrot": "papaya, carrot" },
    );
    expect(recipes[0]?.ingredients).toEqual([
      { name: "papaya", volumeMl: 100 },
      { name: "carrot", volumeMl: 100 },
    ]);
  });

  it("does not split a combined line until the LLM maps it", () => {
    const recipes = applyEnglishNames(
      [{ ingredients: [{ name: "papaya and carrot", volumeMl: 200 }] }],
      {},
    );
    expect(recipes[0]?.ingredients).toEqual([
      { name: "papaya and carrot", volumeMl: 200 },
    ]);
  });

  it("does not split a single sauce whose name contains spaces", () => {
    const recipes = applyEnglishNames(
      [{ ingredients: [{ name: "fish sauce", volumeMl: 30 }] }],
      {},
    );
    expect(recipes[0]?.ingredients).toEqual([{ name: "fish sauce", volumeMl: 30 }]);
  });
});
