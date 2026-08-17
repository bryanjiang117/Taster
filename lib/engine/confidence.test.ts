import { describe, expect, it } from "vitest";
import { dishConfidence, sourceConfidence } from "./confidence";

describe("confidence", () => {
  it("ranks measured composition highest", () => {
    expect(sourceConfidence("measured")).toBeGreaterThan(sourceConfidence("nutrition"));
    expect(sourceConfidence("nutrition")).toBeGreaterThan(sourceConfidence("recipe"));
    expect(sourceConfidence("recipe")).toBeGreaterThan(sourceConfidence("llm"));
  });

  it("averages ingredient confidence weighted by contribution", () => {
    const score = dishConfidence([
      { confidence: 0.9, contribution: 8 },
      { confidence: 0.4, contribution: 2 },
    ]);
    expect(score).toBeCloseTo(0.8);
  });

  it("is higher when recipes agree and lower when they clash", () => {
    const parts = [{ confidence: 1, contribution: 1 }];
    const consistent = dishConfidence(parts, { flavorInconsistency: 0 });
    const mixed = dishConfidence(parts, { flavorInconsistency: 0.5 });
    const clashing = dishConfidence(parts, { flavorInconsistency: 1 });
    expect(consistent).toBeGreaterThan(mixed);
    expect(mixed).toBeGreaterThan(clashing);
  });
});
