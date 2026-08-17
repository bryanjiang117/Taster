import { describe, expect, it } from "vitest";
import {
  DISH_OUTLIER_DISTANCE,
  applyDishVisit,
  createDishRecord,
  tasteDistance,
  type DishSnapshot,
} from "./dish-cache";
import type { TasteProfile } from "./taste";

const mild: TasteProfile = {
  sweet: 2,
  sour: 3,
  salty: 4,
  spicy: 1,
  umami: 5,
  bitter: 0,
};

const close: TasteProfile = {
  sweet: 3,
  sour: 3,
  salty: 4,
  spicy: 1,
  umami: 5,
  bitter: 0,
};

const wild: TasteProfile = {
  sweet: 9,
  sour: 9,
  salty: 9,
  spicy: 9,
  umami: 9,
  bitter: 9,
};

const snapshot = (taste: TasteProfile): DishSnapshot => ({
  origin: {
    dish: "mapo tofu",
    country: "China",
    culture: "Sichuan",
    nativeName: "麻婆豆腐",
    language: "Chinese",
    languageCode: "zh",
    searchQueries: ["麻婆豆腐 食谱"],
  },
  taste,
  confidence: 0.8,
  recipesAnalyzed: 3,
  representative: { ingredients: [], finalVolumeMl: 400 },
  provenance: [],
  ingredients: [],
});

describe("tasteDistance", () => {
  it("is Euclidean over the six 0–10 scores", () => {
    expect(tasteDistance(mild, mild)).toBe(0);
    expect(tasteDistance(mild, close)).toBe(1);
    expect(tasteDistance(mild, wild)).toBeGreaterThan(DISH_OUTLIER_DISTANCE);
  });
});

describe("applyDishVisit", () => {
  it("creates a row from the first pipeline sample", () => {
    const record = createDishRecord("mapo tofu", ["麻婆豆腐"], snapshot(mild));
    expect(record.canonicalName).toBe("mapo tofu");
    expect(record.sampleCount).toBe(1);
    expect(record.timesTasted).toBe(1);
    expect(record.outlierCount).toBe(0);
    expect(record.taste).toEqual(mild);
  });

  it("folds a nearby sample into the running mean and refreshes the snapshot", () => {
    let record = createDishRecord("mapo tofu", ["mapo tofu"], snapshot(mild));
    record = applyDishVisit(record, {
      kind: "sample",
      taste: close,
      snapshot: snapshot(close),
      alias: "麻婆豆腐",
    });
    expect(record.timesTasted).toBe(2);
    expect(record.sampleCount).toBe(2);
    expect(record.outlierCount).toBe(0);
    expect(record.taste.sweet).toBe(2.5);
    expect(record.snapshot.taste).toEqual(close);
    expect(record.aliases).toContain("麻婆豆腐");
  });

  it("rejects a huge outlier from the mean but still counts the taste", () => {
    let record = createDishRecord("mapo tofu", ["mapo tofu"], snapshot(mild));
    const before = { ...record.taste };
    record = applyDishVisit(record, {
      kind: "sample",
      taste: wild,
      snapshot: snapshot(wild),
    });
    expect(record.timesTasted).toBe(2);
    expect(record.sampleCount).toBe(1);
    expect(record.outlierCount).toBe(1);
    expect(record.taste).toEqual(before);
    expect(record.snapshot.taste).toEqual(mild);
  });

  it("counts a cache hit toward timesTasted without changing the average", () => {
    let record = createDishRecord("mapo tofu", ["mapo tofu"], snapshot(mild));
    record = applyDishVisit(record, { kind: "hit", alias: "mapo" });
    expect(record.timesTasted).toBe(2);
    expect(record.sampleCount).toBe(1);
    expect(record.taste).toEqual(mild);
    expect(record.aliases).toContain("mapo");
  });
});
