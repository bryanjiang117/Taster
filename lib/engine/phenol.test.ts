import { describe, expect, it } from "vitest";
import { compoundsFromPhenolRows } from "./phenol";

describe("compoundsFromPhenolRows", () => {
  it("maps polyphenols onto bitter mixer ids, not spicy", () => {
    const amounts = compoundsFromPhenolRows([
      { name: "(-)-Epicatechin", amount: 80, unit: "mg/100g" },
      { name: "Naringin", amount: 40, unit: "mg/100g" },
      { name: "Capsaicin", amount: 12, unit: "mg/100g" },
    ]);
    expect(amounts).toEqual([
      { id: "tannin", amount: 80 },
      { id: "naringin", amount: 40 },
    ]);
  });
});
