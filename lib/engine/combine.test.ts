import { describe, expect, it } from "vitest";
import {
  applyMixGain,
  combineRecipeTaste,
  MIX_GAIN,
  MIX_P_NORM,
  relativeLoudness,
  recipeTasteStats,
  SEASONING_LOUD,
  SEASONING_SHARE,
} from "./combine";
import { loadSeedStore } from "./seed";

const lime = { sweet: 1, sour: 9, salty: 0, spicy: 0, umami: 0, bitter: 1 };
const lemonJuice = { sweet: 1, sour: 9.5, salty: 0, spicy: 0, umami: 0, bitter: 0.5 };
const salt = { sweet: 0, sour: 0, salty: 10, spicy: 0, umami: 0, bitter: 0 };
const fish = { sweet: 1, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 };
const rice = { sweet: 1, sour: 0, salty: 0, spicy: 0, umami: 0.5, bitter: 0 };
const thaiChili = { sweet: 1, sour: 1, salty: 0, spicy: 10, umami: 1, bitter: 0.5 };
const blackPepper = { sweet: 0, sour: 0, salty: 0, spicy: 0.2, umami: 0, bitter: 2 };

const SPOON = 15;
const BOWL = 500;
const SHARE = SPOON / BOWL;

function mixed(score: number, share: number, stats: ReturnType<typeof recipeTasteStats>): number {
  const loud = relativeLoudness(score, stats);
  const linear = applyMixGain(share * loud);
  if (loud >= SEASONING_LOUD && share >= SEASONING_SHARE) {
    return applyMixGain(loud * share ** (1 / MIX_P_NORM));
  }
  return linear;
}

function mixedSpicy(score: number, share: number): number {
  return applyMixGain(score * share ** (1 / MIX_P_NORM));
}

describe("relativeLoudness", () => {
  it("keeps peer scores linear when nothing dominates the recipe", () => {
    const stats = recipeTasteStats([
      { volumeMl: 50, taste: { sweet: 3, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 } },
      { volumeMl: 50, taste: { sweet: 0, sour: 0, salty: 3, spicy: 0, umami: 0, bitter: 0 } },
    ]);
    expect(relativeLoudness(3, stats)).toBe(3);
  });

  it("quiets a 3 when the recipe also has a 10, but less harshly than score²/peak", () => {
    const stats = recipeTasteStats([
      { volumeMl: 50, taste: { sweet: 3, sour: 0, salty: 0, spicy: 0, umami: 0, bitter: 0 } },
      { volumeMl: 50, taste: { sweet: 0, sour: 0, salty: 10, spicy: 0, umami: 0, bitter: 0 } },
    ]);
    expect(relativeLoudness(3, stats)).toBeCloseTo(3 * Math.sqrt(0.3), 5);
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

  it("lets a spoon of salt (10) season a bowl", () => {
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
    expect(taste.salty).toBeCloseTo(mixed(10, SHARE, stats), 5);
    expect(taste.salty).toBeGreaterThanOrEqual(6.5);
  });

  it("keeps rice-level sweet ≈ 1 quiet next to salt 10", () => {
    const taste = combineRecipeTaste(
      [
        { volumeMl: SPOON, taste: salt, role: "in" },
        { volumeMl: BOWL - SPOON, taste: rice, role: "in" },
      ],
      BOWL,
    );
    expect(taste.sweet).toBeLessThan(0.6);
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
    expect(taste.sweet).toBeLessThan(1.5);
  });

  it("keeps mapo-like chili bean paste spicy even next to salt and sugar 10s", () => {
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
    expect(taste.spicy).toBeGreaterThanOrEqual(4);
    expect(taste.sweet).toBeLessThan(1.5);
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
    expect(profile.umami).toBeGreaterThanOrEqual(8);
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
    const taste = combineRecipeTaste(
      [
        { volumeMl: SPOON, taste: blackPepper, role: "in" },
        { volumeMl: BOWL - SPOON, taste: rice, role: "in" },
      ],
      BOWL,
    );
    expect(taste.spicy).toBeCloseTo(mixedSpicy(0.2, SHARE), 5);
    expect(taste.spicy).toBeLessThan(0.2);
  });

  it("adds two seasonings in p-space like one with their combined share", () => {
    const split = combineRecipeTaste(
      [
        { volumeMl: SPOON / 2, taste: salt, role: "in" },
        { volumeMl: SPOON / 2, taste: salt, role: "in" },
        { volumeMl: BOWL - SPOON, taste: rice, role: "in" },
      ],
      BOWL,
    );
    const together = combineRecipeTaste(
      [
        { volumeMl: SPOON, taste: salt, role: "in" },
        { volumeMl: BOWL - SPOON, taste: rice, role: "in" },
      ],
      BOWL,
    );
    expect(split.salty).toBeCloseTo(together.salty, 5);
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
