import { describe, expect, it } from "vitest";
import { compoundsFromInfoods } from "./fct";

describe("compoundsFromInfoods", () => {
  it("maps INFOODS tagnames onto mixer ids and skips non-taste nutrients", () => {
    const amounts = compoundsFromInfoods([
      { tag: "NA", amount: 5493, unit: "mg" },
      { tag: "SUCS", amount: 3.2, unit: "g" },
      { tag: "CITAC", amount: 480, unit: "mg" },
      { tag: "K", amount: 2000, unit: "mg" },
      { tag: "VITC", amount: 40, unit: "mg" },
      { tag: "GLU", amount: 1.9, unit: "g" },
    ]);
    const byId = Object.fromEntries(amounts.map((row) => [row.id, row.amount]));
    expect(byId.sodium).toBe(5493);
    expect(byId.sucrose).toBe(3.2);
    expect(byId.citric_acid).toBe(480);
    expect(byId.potassium).toBeUndefined();
    expect(byId.glutamic_acid_bound).toBeUndefined();
  });

  it("uses total sugar only when specific sugars are missing", () => {
    const onlyTotal = compoundsFromInfoods([{ tag: "SUGAR", amount: 9, unit: "g" }]);
    expect(onlyTotal).toEqual([{ id: "sucrose", amount: 9 }]);
    const specific = compoundsFromInfoods([
      { tag: "SUGAR", amount: 9, unit: "g" },
      { tag: "FRUS", amount: 4, unit: "g" },
    ]);
    expect(specific.map((row) => row.id).sort()).toEqual(["fructose"]);
  });
});
