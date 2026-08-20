import { describe, expect, it } from "vitest";
import { applyProcessEffects, estimateFinalVolume } from "./volume";

describe("volume and process effects", () => {
  it("sums ingredient volumes as the starting dish volume", () => {
    expect(
      estimateFinalVolume(
        [
          { name: "water", volumeMl: 400 },
          { name: "soy sauce", volumeMl: 20 },
        ],
        [],
      ),
    ).toBe(420);
  });

  it("reduces volume on evaporation", () => {
    const result = applyProcessEffects(500, [
      { type: "evaporation", volumeDeltaMl: -200 },
    ]);
    expect(result.finalVolumeMl).toBe(300);
    expect(result.concentrationMultiplier).toBeCloseTo(500 / 300);
  });

  it("reduces free liquid when solids absorb water", () => {
    const result = applyProcessEffects(400, [
      { type: "absorption", volumeDeltaMl: -150 },
    ]);
    expect(result.finalVolumeMl).toBe(250);
  });

  it("increases volume on expansion (dough, batter)", () => {
    const result = applyProcessEffects(200, [
      { type: "expansion", volumeDeltaMl: 100 },
    ]);
    expect(result.finalVolumeMl).toBe(300);
    expect(result.concentrationMultiplier).toBeCloseTo(200 / 300);
  });

  it("removes soluble flavor when liquid is discarded", () => {
    const result = applyProcessEffects(1000, [
      { type: "discard", volumeDeltaMl: -800, discardedSolubleFraction: 0.4 },
    ]);
    expect(result.finalVolumeMl).toBe(200);
    expect(result.solubleRetention).toBeCloseTo(0.6);
  });

  it("applies effects in order and never goes below 1 ml", () => {
    const volume = estimateFinalVolume([{ name: "stock", volumeMl: 100 }], [
      { type: "evaporation", volumeDeltaMl: -500 },
    ]);
    expect(volume).toBe(1);
  });

  it("does not count drained frying oil toward starting volume", () => {
    expect(
      estimateFinalVolume(
        [
          { name: "chicken", volumeMl: 500 },
          { name: "oil", volumeMl: 300, mix: { intensity: 0 } },
          { name: "salt", volumeMl: 5 },
        ],
        [],
      ),
    ).toBe(505);
  });
});
