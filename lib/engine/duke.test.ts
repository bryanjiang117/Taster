import { describe, expect, it } from "vitest";
import { compoundsFromDukeRows } from "./duke";

describe("compoundsFromDukeRows", () => {
  it("maps a ppm range to mg/100g using the midpoint", () => {
    const amounts = compoundsFromDukeRows([
      { name: "PIPERINE", lowPpm: 20_000, highPpm: 90_000, part: "Fruit" },
      { name: "BITTER", part: "Leaf" },
    ]);
    expect(amounts).toEqual([{ id: "piperine", amount: 5500 }]);
  });

  it("skips rows with no quantified ppm", () => {
    expect(compoundsFromDukeRows([{ name: "CAPSAICIN", part: "Fruit" }])).toEqual(
      [],
    );
  });
});
