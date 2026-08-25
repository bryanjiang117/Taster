import { describe, expect, it } from "vitest";
import {
  applyMixGain,
  alignScoreContributions,
  attributeRecipeTaste,
  combineRecipeTaste,
  MIX_GAIN,
  MIX_P_NORM,
  punchIntensityWeight,
  PUNCH_INTENSITY_HIGH,
  PUNCH_INTENSITY_LOW,
  relativeLoudness,
  recipeTasteStats,
  roundScoreContributions,
  seasoningLoudWeight,
  seasoningPunchWeight,
  SEASONING_LOUD,
  SEASONING_SHARE,
} from "./combine";
import { loadSeedStore } from "./seed";
import { TASTE_DIMENSIONS } from "./taste";

const lime = { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 };
const lemonJuice = { sweet: 1, sour: 9.5, salty: 0, spicy: 0, umami: 0, bitter: 0.5 };
const salt = { sweet: 0, sour: 0, salty: 12, spicy: 0, umami: 0, bitter: 0 };
const fish = { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 };
const rice = { sweet: 1, sour: 0, salty: 0, spicy: 0, umami: 0.5, bitter: 0 };
const thaiChili = { sweet: 1, sour: 1, salty: 0, spicy: 10, umami: 1, bitter: 0.5 };
const blackPepper = { sweet: 0, sour: 0, salty: 0, spicy: 0.2, umami: 0, bitter: 2 };

const SPOON = 15;
const BOWL = 500;
const SHARE = SPOON / BOWL;

function ingredientBlend(loud: number, share: number): number {
  if (share <= 0 || loud <= 0) return 0;
  const linear = share * loud;
  const punch = loud * share ** (1 / MIX_P_NORM);
  const weight =
    seasoningPunchWeight(share * seasoningLoudWeight(loud)) *
    punchIntensityWeight(loud);
  return linear * (1 - weight) + punch * weight;
}

function mixed(score: number, share: number, stats: ReturnType<typeof recipeTasteStats>): number {
  const loud = relativeLoudness(score, stats);
  return applyMixGain(ingredientBlend(loud, share));
}

describe("seasoningPunchWeight", () => {
  it("uses a milder p-norm; salt leaf 12 still seasons a bowl", () => {
    expect(MIX_P_NORM).toBe(4);
    const broth = { sweet: 0.5, sour: 0, salty: 1.2, spicy: 0, umami: 2, bitter: 0 };
    const { taste, contributions } = attributeRecipeTaste(
      [
        { name: "broth", volumeMl: 480, taste: broth, role: "in" },
        { name: "salt", volumeMl: 15, taste: salt, role: "in" },
      ],
      500,
    );
    expect(taste.salty).toBeGreaterThan(8);
    expect(contributions.salty[0]?.name).toBe("salt");
  });

  it("ramps from linear at trace shares to punch-through at spoon-in-soup scale", () => {
    expect(seasoningPunchWeight(0)).toBe(0);
    expect(seasoningPunchWeight(0.003)).toBe(0);
    expect(seasoningPunchWeight(0.008)).toBeGreaterThan(0);
    expect(seasoningPunchWeight(0.008)).toBeLessThan(0.5);
    expect(seasoningPunchWeight(SEASONING_SHARE)).toBeGreaterThan(0.85);
    expect(seasoningPunchWeight(0.02)).toBe(1);
    expect(seasoningPunchWeight(0.05)).toBe(1);
  });

  it("smoothly blends linear and punch just below the old hard cutoff", () => {
    const stats = recipeTasteStats([
      { volumeMl: 10, taste: salt },
      { volumeMl: 490, taste: rice },
    ]);
    const share = 10 / 500;
    const linear = applyMixGain(share * 12);
    const punch = applyMixGain(12 * share ** (1 / MIX_P_NORM));
    const taste = combineRecipeTaste(
      [
        { volumeMl: 10, taste: salt, role: "in" },
        { volumeMl: 490, taste: rice, role: "in" },
      ],
      500,
    );
    expect(taste.salty).toBeGreaterThan(linear);
    expect(taste.salty).toBeLessThanOrEqual(punch);
    expect(taste.salty).toBeCloseTo(mixed(12, share, stats), 5);
  });
});

describe("seasoningLoudWeight", () => {
  it("ramps smoothly instead of a hard ≥7 cliff", () => {
    expect(seasoningLoudWeight(0)).toBe(0);
    expect(seasoningLoudWeight(3)).toBe(0);
    expect(seasoningLoudWeight(5.5)).toBeGreaterThan(0.3);
    expect(seasoningLoudWeight(5.5)).toBeLessThan(0.7);
    expect(seasoningLoudWeight(SEASONING_LOUD)).toBe(1);
    expect(seasoningLoudWeight(10)).toBe(1);
  });
});

describe("punchIntensityWeight", () => {
  it("keeps mid notes partial and peak notes full", () => {
    expect(PUNCH_INTENSITY_LOW).toBe(5.25);
    expect(PUNCH_INTENSITY_HIGH).toBe(10);
    expect(punchIntensityWeight(0)).toBe(0);
    expect(punchIntensityWeight(5)).toBe(0);
    expect(punchIntensityWeight(7)).toBeGreaterThan(0.15);
    expect(punchIntensityWeight(7)).toBeLessThan(0.45);
    expect(punchIntensityWeight(10)).toBe(1);
    expect(punchIntensityWeight(12)).toBe(1);
  });
});

describe("relativeLoudness", () => {
  it("keeps peer scores linear when nothing dominates the recipe", () => {
    const stats = recipeTasteStats([
      { volumeMl: 50, taste: { sweet: 3, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 } },
      { volumeMl: 50, taste: { sweet: 0, sour: 0, salty: 3, spicy: 0, umami: 0, bitter: 0 } },
    ]);
    expect(relativeLoudness(3, stats)).toBeCloseTo(3, 5);
  });

  it("quiets a 3 when the recipe also has a 10, but milder than √(score/peak)", () => {
    const stats = recipeTasteStats([
      { volumeMl: 50, taste: { sweet: 3, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 } },
      { volumeMl: 50, taste: { sweet: 0, sour: 0, salty: 10, spicy: 0, umami: 0, bitter: 0 } },
    ]);
    const quieted = relativeLoudness(3, stats);
    expect(quieted).toBeGreaterThan(3 * Math.sqrt(0.3));
    expect(quieted).toBeLessThan(3);
    expect(relativeLoudness(10, stats)).toBe(10);
  });

  it("blends toward full score without a cliff at 85% of peak", () => {
    // High avg so toAvg does not dominate; cliff is vs peak only.
    const stats = { peak: 10, avg: 20 };
    const below = relativeLoudness(8.4, stats);
    const above = relativeLoudness(8.6, stats);
    expect(above - below).toBeLessThan(0.25);
    expect(below).toBeGreaterThan(8);
    expect(below).toBeLessThan(8.4);
    expect(above).toBeLessThan(8.6);
    expect(relativeLoudness(10, stats)).toBe(10);
  });
});

describe("combineRecipeTaste", () => {
  it("does not drop peer 3s when sweet and salty are both moderate", () => {
    const taste = combineRecipeTaste(
      [
        { volumeMl: 50, taste: { ...rice, sweet: 3, salty: 0 }, role: "in" },
        { volumeMl: 50, taste: { ...rice, sweet: 0, salty: 3 }, role: "in" },
      ],
      100,
    );
    expect(taste.sweet).toBeGreaterThanOrEqual(2.5);
    expect(taste.salty).toBeGreaterThanOrEqual(2.5);
    expect(taste.sweet).toBeLessThanOrEqual(3);
    expect(taste.salty).toBeLessThanOrEqual(3);
  });

  it("quiets sweet 3 next to salty 10 at the same volume", () => {
    const peers = combineRecipeTaste(
      [
        { volumeMl: 50, taste: { ...rice, sweet: 3, salty: 3 }, role: "in" },
        { volumeMl: 50, taste: { ...rice, sweet: 3, salty: 0 }, role: "in" },
      ],
      100,
    );
    const dominated = combineRecipeTaste(
      [
        { volumeMl: 50, taste: { ...rice, sweet: 3, salty: 0 }, role: "in" },
        { volumeMl: 50, taste: { ...rice, sweet: 0, salty: 10 }, role: "in" },
      ],
      100,
    );
    expect(dominated.sweet).toBeLessThan(peers.sweet);
    expect(dominated.salty).toBeGreaterThan(peers.salty);
  });

  it("lets a spoon of salt season a bowl that was fried in discarded oil", () => {
    const oil = { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 };
    const chicken = { sweet: 0.5, sour: 0, salty: 0.5, spicy: 0, umami: 2, bitter: 0 };
    const soy = { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 8, bitter: 0.5 };
    const withOilBath = combineRecipeTaste(
      [
        { volumeMl: 500, taste: chicken, role: "in" },
        { volumeMl: 300, taste: oil, role: "in", mix: { intensity: 0 } },
        { volumeMl: 15, taste: soy, role: "in" },
        { volumeMl: 5, taste: salt, role: "in" },
      ],
      820,
    );
    const eatenOil = combineRecipeTaste(
      [
        { volumeMl: 500, taste: chicken, role: "in" },
        { volumeMl: 300, taste: oil, role: "in", mix: { intensity: 1 } },
        { volumeMl: 15, taste: soy, role: "in" },
        { volumeMl: 5, taste: salt, role: "in" },
      ],
      820,
    );
    expect(withOilBath.salty).toBeGreaterThan(3);
    expect(withOilBath.salty).toBeGreaterThan(eatenOil.salty);
  });

  it("lets a spoon of salt (12) season a bowl", () => {
    const stats = recipeTasteStats([
      { volumeMl: SPOON, taste: salt },
      { volumeMl: BOWL - SPOON, taste: rice },
    ]);
    const taste = combineRecipeTaste(
      [
        { volumeMl: SPOON, taste: salt, role: "in" },
        { volumeMl: BOWL - SPOON, taste: rice, role: "in" },
      ],
      BOWL,
    );
    expect(taste.salty).toBeCloseTo(mixed(12, SHARE, stats), 5);
    expect(taste.salty).toBeGreaterThanOrEqual(6.5);
  });

  it("keeps rice-level sweet ≈ 1 quiet next to salt 12", () => {
    const taste = combineRecipeTaste(
      [
        { volumeMl: SPOON, taste: salt, role: "in" },
        { volumeMl: BOWL - SPOON, taste: rice, role: "in" },
      ],
      BOWL,
    );
    expect(taste.sweet).toBeLessThanOrEqual(1.2);
    expect(taste.salty).toBeGreaterThan(taste.sweet * 3);
  });

  it("keeps trace sugar quiet in a large savory dish", () => {
    const sugar = { sweet: 10, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 };
    const taste = combineRecipeTaste(
      [
        { volumeMl: 500, taste: { ...rice, umami: 2.5 }, role: "in" },
        { volumeMl: 43, taste: { ...rice, sweet: 1.8 }, role: "in" },
        { volumeMl: 35, taste: { ...rice, sweet: 2, spicy: 0.5 }, role: "in" },
        { volumeMl: 62, taste: { ...rice, sweet: 1.5, salty: 6, umami: 7 }, role: "in" },
        { volumeMl: 50, taste: { ...rice, sweet: 0.8 }, role: "in" },
        { volumeMl: 8, taste: sugar, role: "in" },
      ],
      847,
    );
    expect(taste.sweet).toBeLessThan(4);
  });

  it("lets sugar and oyster sauce register sweet in a soup-scale bowl", () => {
    const sugar = { sweet: 10, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 };
    const oyster = { sweet: 3, sour: 0.5, salty: 8, spicy: 0, umami: 7, bitter: 0.5 };
    const broth = { sweet: 0.5, sour: 0.2, salty: 3, spicy: 0.5, umami: 4, bitter: 0.2 };
    const taste = combineRecipeTaste(
      [
        { volumeMl: 500, taste: broth, role: "in" },
        { volumeMl: 200, taste: rice, role: "in" },
        { volumeMl: 120, taste: { ...rice, sweet: 1.5, umami: 0.5 }, role: "in" },
        { volumeMl: 80, taste: { ...rice, umami: 5, salty: 1 }, role: "in" },
        { volumeMl: 20, taste: { ...fish, salty: 9, umami: 8 }, role: "in" },
        { volumeMl: 12, taste: oyster, role: "in" },
        { volumeMl: 8, taste: sugar, role: "in" },
        { volumeMl: 12, taste: { ...rice, spicy: 8, sweet: 1 }, role: "in" },
      ],
      952,
    );
    expect(taste.sweet).toBeGreaterThanOrEqual(1.2);
    expect(taste.sweet).toBeLessThan(4);
  });

  it("mixes chili heat like other dimensions when salt and sugar peak the recipe", () => {
    const taste = combineRecipeTaste(
      [
        { volumeMl: 400, taste: { ...rice, sweet: 0.5, umami: 0.8 }, role: "in" },
        { volumeMl: 140, taste: { ...rice, umami: 6, salty: 0.5 }, role: "in" },
        {
          volumeMl: 30,
          taste: { sweet: 1.5, sour: 2, salty: 7.5, spicy: 5.5, umami: 7.5, bitter: 1.5 },
          role: "in",
        },
        { volumeMl: 15, taste: { ...fish, salty: 8.8, umami: 8.5, spicy: 0 }, role: "in" },
        { volumeMl: 10, taste: { ...rice, spicy: 4.5, sweet: 1.4 }, role: "in" },
        { volumeMl: 9, taste: { sweet: 10, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 }, role: "in" },
        { volumeMl: 5, taste: { ...rice, spicy: 2, bitter: 2.5 }, role: "in" },
      ],
      850,
    );
    // Mid spicy notes quiet vs sugar/salt peaks; intensity gate keeps ~5.5 from full punch.
    expect(taste.spicy).toBeLessThan(5.5);
    expect(taste.spicy).toBeGreaterThan(0.3);
    // Spoon of sugar in the bowl should read as real sweet, not a trace.
    expect(taste.sweet).toBeGreaterThanOrEqual(1.5);
    expect(taste.sweet).toBeLessThan(5);
  });

  it("boosts a raw ~5 mix to ~8 on the dish", () => {
    expect(applyMixGain(5)).toBeCloseTo(5 * MIX_GAIN, 5);
  });

  it("scores a sauce-heavy salad near 9 on its lead tastes", () => {
    const store = loadSeedStore();
    const taste = (name: string) => store.get(name)!.taste;
    const total = 95;
    const profile = combineRecipeTaste(
      [
        { volumeMl: 30, taste: taste("lime"), role: "in" },
        { volumeMl: 25, taste: taste("fish sauce"), role: "in" },
        { volumeMl: 10, taste: taste("chili"), role: "in" },
        { volumeMl: 15, taste: taste("palm sugar"), role: "in" },
        { volumeMl: 15, taste: taste("water"), role: "in" },
      ],
      total,
    );
    expect(profile.sour).toBeGreaterThanOrEqual(8);
    expect(profile.salty).toBeGreaterThanOrEqual(8);
    expect(profile.umami).toBeGreaterThanOrEqual(7.5);
  });

  it("ignores out ingredients", () => {
    const taste = combineRecipeTaste(
      [
        { volumeMl: 100, taste: rice, role: "in" },
        { volumeMl: 30, taste: lime, role: "out" },
      ],
      100,
    );
    expect(taste.sour).toBe(0);
  });

  it("applies Gemini prep intensity and per-dimension scale before mixing", () => {
    const plain = combineRecipeTaste([{ volumeMl: 20, taste: fish, role: "in" }], 100);
    const bloomed = combineRecipeTaste(
      [
        {
          volumeMl: 20,
          taste: fish,
          role: "in",
          mix: { intensity: 1, scale: { umami: 1.2, salty: 1 } },
        },
      ],
      100,
    );
    expect(bloomed.umami).toBeGreaterThan(plain.umami);
    expect(bloomed.salty).toBeCloseTo(plain.salty);
  });

  it("caps each dimension at the strongest in-ingredient", () => {
    const taste = combineRecipeTaste(
      [
        { volumeMl: 80, taste: fish, role: "in" },
        { volumeMl: 20, taste: lime, role: "in" },
      ],
      10,
    );
    expect(taste.salty).toBeLessThanOrEqual(9);
    expect(taste.sour).toBeLessThanOrEqual(9);
  });

  it("keeps a spoon of black pepper near zero in the bowl", () => {
    const ingredients = [
      { volumeMl: SPOON, taste: blackPepper, role: "in" as const },
      { volumeMl: BOWL - SPOON, taste: rice, role: "in" as const },
    ];
    const stats = recipeTasteStats(ingredients);
    const taste = combineRecipeTaste(ingredients, BOWL);
    expect(taste.spicy).toBeCloseTo(mixed(0.2, SHARE, stats), 5);
    expect(taste.spicy).toBeLessThan(0.2);
  });

  it("punches each ingredient from its own bowl share (crowding ignored)", () => {
    const ketchup = {
      sweet: 7,
      sour: 3,
      salty: 3,
      spicy: 0,
      umami: 1.5,
      bitter: 0,
    };
    const worcestershire = {
      sweet: 2,
      sour: 3,
      salty: 5,
      spicy: 0,
      umami: 6.5,
      bitter: 0,
    };
    const beef = {
      sweet: 0.3,
      sour: 0,
      salty: 2,
      spicy: 0,
      umami: 4,
      bitter: 0,
    };
    const { taste, contributions } = attributeRecipeTaste(
      [
        { name: "beef", volumeMl: 350, taste: beef, role: "in" },
        { name: "ketchup", volumeMl: SPOON, taste: ketchup, role: "in" },
        {
          name: "worcestershire sauce",
          volumeMl: SPOON,
          taste: worcestershire,
          role: "in",
        },
      ],
      450,
    );
    const ketchupSweet =
      contributions.sweet.find((row) => row.name === "ketchup")?.points ?? 0;
    const worcUmami =
      contributions.umami.find((row) => row.name === "worcestershire sauce")
        ?.points ?? 0;
    // Mid-loud spoon (~7) lands ~2 sweet, not leaf-like ~6 from joint p-norm collapse.
    expect(ketchupSweet).toBeGreaterThan(1.5);
    expect(ketchupSweet).toBeLessThan(3.5);
    expect(taste.sweet).toBeLessThan(4);
    // Same spoon share punches umami without beef stealing the seasoning term.
    expect(worcUmami).toBeGreaterThan(1);
    expect(worcUmami).toBeLessThan(ketchupSweet + 0.5);
  });

  it("still caps spicy at the hottest in-ingredient when shares exceed 1", () => {
    const taste = combineRecipeTaste(
      [{ volumeMl: 200, taste: thaiChili, role: "in" }],
      100,
    );
    expect(taste.spicy).toBeLessThanOrEqual(10);
    expect(taste.spicy).toBe(10);
  });
});

describe("attributeRecipeTaste", () => {
  it("returns the same taste as combineRecipeTaste", () => {
    const ingredients = [
      { name: "salt", volumeMl: 10, taste: salt, role: "in" as const },
      { name: "rice", volumeMl: 490, taste: rice, role: "in" as const },
    ];
    const attributed = attributeRecipeTaste(ingredients, 500);
    expect(attributed.taste).toEqual(combineRecipeTaste(ingredients, 500));
  });

  it("attributes salty mostly to salt and sums to the dish score", () => {
    const { taste, contributions } = attributeRecipeTaste(
      [
        { name: "salt", volumeMl: 10, taste: salt, role: "in" },
        { name: "rice", volumeMl: 490, taste: rice, role: "in" },
      ],
      500,
    );
    expect(contributions.salty[0]?.name).toBe("salt");
    expect(contributions.salty[0]!.points).toBeGreaterThan(
      contributions.salty[1]?.points ?? 0,
    );
    const sum = contributions.salty.reduce((total, row) => total + row.points, 0);
    expect(sum).toBeCloseTo(taste.salty, 5);
  });

  it("keeps every positive contributor after finalize", () => {
    const ingredients = Array.from({ length: 8 }, (_, index) => ({
      name: `salt-${index}`,
      volumeMl: 2,
      taste: salt,
      role: "in" as const,
    }));
    ingredients.push({
      name: "rice",
      volumeMl: 484,
      taste: rice,
      role: "in",
    });
    const { taste, contributions } = attributeRecipeTaste(ingredients, 500);
    expect(contributions.salty.length).toBeGreaterThan(5);
    const shown = roundScoreContributions(
      alignScoreContributions(contributions, taste),
    );
    expect(shown.salty.length).toBe(contributions.salty.length);
    expect(shown.salty.every((row) => row.points > 0)).toBe(true);
  });

  it("keeps tiny sweet contributors visible when the dish score is only 0.2", () => {
    const aligned = alignScoreContributions(
      {
        sweet: [
          { name: "sugar", points: 0.08 },
          { name: "oyster sauce", points: 0.05 },
          { name: "broth", points: 0.04 },
          { name: "cabbage", points: 0.03 },
        ],
        sour: [],
        salty: [],
        spicy: [],
        umami: [],
        bitter: [],
      },
      {
        sweet: 0.2,
        sour: 0,
        salty: 0,
        spicy: 0,
        umami: 0,
        bitter: 0,
      },
    );
    const shown = roundScoreContributions(aligned);
    expect(shown.sweet.map((row) => row.name)).toEqual([
      "sugar",
      "oyster sauce",
      "broth",
      "cabbage",
    ]);
    expect(shown.sweet.every((row) => row.points > 0)).toBe(true);
    const sum = shown.sweet.reduce((total, row) => total + row.points, 0);
    expect(sum).toBeCloseTo(0.2, 1);
  });

  it("drops intensity-0 baths and out-of-dish sides", () => {
    const { contributions } = attributeRecipeTaste(
      [
        {
          name: "frying oil",
          volumeMl: 200,
          taste: { sweet: 0, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 },
          role: "in",
          mix: { intensity: 0 },
        },
        {
          name: "chili oil dip",
          volumeMl: 30,
          taste: thaiChili,
          role: "out",
        },
        { name: "salt", volumeMl: 10, taste: salt, role: "in" },
        { name: "rice", volumeMl: 490, taste: rice, role: "in" },
      ],
      500,
    );
    expect(contributions.salty.map((row) => row.name)).toEqual(["salt"]);
    expect(contributions.spicy).toEqual([]);
  });

  it("leaves empty lists when a dimension scores zero", () => {
    const { taste, contributions } = attributeRecipeTaste(
      [{ name: "rice", volumeMl: 100, taste: rice, role: "in" }],
      100,
    );
    expect(taste.spicy).toBe(0);
    expect(contributions.spicy).toEqual([]);
    for (const dim of TASTE_DIMENSIONS) {
      if (taste[dim] <= 0) expect(contributions[dim]).toEqual([]);
    }
  });
});
