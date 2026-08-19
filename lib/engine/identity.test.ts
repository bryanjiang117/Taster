import { describe, expect, it } from "vitest";
import { pickConfirmedHits } from "./identity";

describe("pickConfirmedHits", () => {
  it("keeps the Gemini-chosen row per source and drops nulls", () => {
    const chosen = pickConfirmedHits(
      [
        {
          source: "usda",
          hits: [
            { id: "1", name: "Beverages, fruit juice drink, greater than 3% juice" },
            { id: "2", name: "Galangal, raw" },
          ],
        },
        {
          source: "foodb",
          hits: [
            { id: "a", name: "Ginger" },
            { id: "b", name: "Greater galangal" },
          ],
        },
        { source: "fct", hits: [{ id: "k", name: "Kenya: galangal" }] },
      ],
      { usda: 1, foodb: 1, fct: null },
    );
    expect(chosen.usda?.name).toBe("Galangal, raw");
    expect(chosen.foodb?.name).toBe("Greater galangal");
    expect(chosen.fct).toBeUndefined();
  });

  it("returns nothing when every candidate is a collision", () => {
    const chosen = pickConfirmedHits(
      [
        {
          source: "usda",
          hits: [
            { id: "1", name: "Oil, canola" },
            { id: "2", name: "Chili with beans, canned" },
          ],
        },
        { source: "foodb", hits: [{ id: "3", name: "Oil palm" }] },
      ],
      { usda: null, foodb: null },
    );
    expect(chosen).toEqual({});
  });

  it("ignores out-of-range picks instead of inventing a hit", () => {
    const chosen = pickConfirmedHits(
      [{ source: "usda", hits: [{ id: "1", name: "Soy sauce" }] }],
      { usda: 4 },
    );
    expect(chosen.usda).toBeUndefined();
  });
});
