import { describe, expect, it } from "vitest";
import { quantityToMl } from "./quantity";

describe("quantity conversion", () => {
  it("converts kitchen units to milliliters", () => {
    expect(quantityToMl(1, "tbsp")).toBe(15);
    expect(quantityToMl(2, "tsp")).toBe(10);
    expect(quantityToMl(1, "cup")).toBe(240);
  });
});
