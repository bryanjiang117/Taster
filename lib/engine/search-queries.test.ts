import { describe, expect, it } from "vitest";
import { expandSearchQueries } from "./search-queries";


describe("expandSearchQueries", () => {
  it("adds unquoted native and English recipe queries so search is not stuck on one quoted phrase", () => {
    const queries = expandSearchQueries({
      dish: "mapo tofu",
      country: "China",
      culture: "Sichuan",
      nativeName: "麻婆豆腐",
      language: "Chinese",
      languageCode: "zh",
      searchQueries: ['"麻婆豆腐" 食谱'],
    });

    expect(queries[0]).toBe('"麻婆豆腐" 食谱');
    expect(queries).toEqual(
      expect.arrayContaining(["麻婆豆腐 食谱", "麻婆豆腐 做法", "mapo tofu recipe"]),
    );
    expect(queries.length).toBeGreaterThan(3);
  });

  it("keeps typed-language queries and does not add native recipe words", () => {
    const queries = expandSearchQueries(
      {
        dish: "mapo tofu",
        country: "China",
        culture: "Sichuan",
        nativeName: "麻婆豆腐",
        language: "Chinese",
        languageCode: "zh",
        searchQueries: ["mapo tofu recipe", "mapo tofu easy"],
      },
      "typed",
    );

    expect(queries).toEqual(
      expect.arrayContaining(["mapo tofu recipe", "mapo tofu easy", "mapo tofu"]),
    );
    expect(queries.some((query) => query.includes("食谱") || query.includes("做法"))).toBe(
      false,
    );
  });
});
