import { describe, expect, it } from "vitest";
import { TASTE_DIMENSIONS, capTaste, ceilingTaste, clampScore, emptyTaste, mergeTastes, overlayTaste, polarizeTaste } from "./taste";

describe("taste scores", () => {
  it("starts at zero on every dimension", () => {
    const t = emptyTaste();
    for (const dim of TASTE_DIMENSIONS) {
      expect(t[dim]).toBe(0);
    }
  });

  it("clamps display scores to 0–10 and leaves up to 12", () => {
    expect(clampScore(-2)).toBe(0);
    expect(clampScore(11)).toBe(10);
    expect(clampScore(11, 12)).toBe(11);
    expect(clampScore(13, 12)).toBe(12);
    expect(clampScore(7.4)).toBe(7.4);
  });

  it("takes the per-dimension max across ingredient vectors", () => {
    const ceiling = ceilingTaste([
      { sweet: 1, sour: 10, salty: 0, spicy: 0, umami: 0, bitter: 1 },
      { sweet: 0, sour: 1, salty: 9, spicy: 0, umami: 9, bitter: 0.5 },
    ]);
    expect(ceiling.sour).toBe(10);
    expect(ceiling.salty).toBe(9);
    expect(ceiling.bitter).toBe(1);
  });

  it("barely moves a 6 when 7 is the peak, and halves a 2", () => {
    const taste = polarizeTaste({
      sweet: 6,
      sour: 0,
      salty: 7,
      spicy: 0,
      umami: 0,
      bitter: 2,
    });
    expect(taste.salty).toBe(7);
    expect(taste.sweet).toBeGreaterThan(5.7);
    expect(taste.bitter).toBeGreaterThan(0.8);
    expect(taste.bitter).toBeLessThan(1.15);
  });

  it("quiets cabbage-level sweetness next to real salt without touching umami", () => {
    const savory = polarizeTaste({
      sweet: 2,
      sour: 0,
      salty: 5,
      spicy: 0,
      umami: 4,
      bitter: 0,
    });
    expect(savory.salty).toBe(5);
    expect(savory.umami).toBeCloseTo(4, 0);
    expect(savory.sweet).toBeLessThan(2);
    expect(savory.sweet).toBeGreaterThan(0);
  });

  it("leaves a close cluster of mild scores together", () => {
    const cluster = polarizeTaste({
      sweet: 2.8,
      sour: 2.5,
      salty: 3.1,
      spicy: 0,
      umami: 0,
      bitter: 0,
    });
    expect(cluster.sweet).toBeCloseTo(2.8, 0);
    expect(cluster.sour).toBeCloseTo(2.5, 0);
    expect(cluster.salty).toBeCloseTo(3.1, 1);
  });

  it("leaves real mid and high scores close and only drops a trace vs the peak", () => {
    const dish = polarizeTaste({
      sweet: 6.4,
      sour: 8.1,
      salty: 9.3,
      spicy: 4.4,
      umami: 8.8,
      bitter: 1.2,
    });
    expect(dish.sweet).toBeGreaterThan(5);
    expect(dish.sour).toBeCloseTo(8.1, 0);
    expect(dish.salty).toBe(9.3);
    expect(dish.spicy).toBe(4.4);
    expect(dish.umami).toBeCloseTo(8.8, 1);
    expect(dish.bitter).toBeLessThan(0.5);
  });

  it("keeps moderate flavors when one dimension saturates at 10", () => {
    const ceviche = polarizeTaste({
      sweet: 1,
      sour: 10,
      salty: 2.2,
      spicy: 1,
      umami: 4.8,
      bitter: 1,
    });
    expect(ceviche.sour).toBe(10);
    expect(ceviche.umami).toBeCloseTo(4.8, 0);
    expect(ceviche.salty).toBeCloseTo(2.2, 0);
    expect(ceviche.sweet).toBeLessThan(1);
    expect(ceviche.spicy).toBeLessThan(0.5);
  });

  it("leaves two strong tastes alone when both are actually there", () => {
    const sweetSalty = polarizeTaste({
      sweet: 5,
      sour: 0,
      salty: 5,
      spicy: 0,
      umami: 1,
      bitter: 0,
    });
    expect(sweetSalty.sweet).toBe(5);
    expect(sweetSalty.salty).toBe(5);
    expect(sweetSalty.umami).toBeLessThan(1);
  });

  it("does not let a zero in the mouthful overlay wipe chemistry salty", () => {
    const merged = overlayTaste(
      { sweet: 0, sour: 0, salty: 9, spicy: 0, umami: 8, bitter: 0 },
      { sweet: 1, sour: 1, salty: 0, spicy: 0, umami: 10, bitter: 0 },
    );
    expect(merged.salty).toBe(9);
    expect(merged.umami).toBe(10);
  });

  it("does not let a perceptual dish score exceed the strongest ingredient on that dimension", () => {
    const perceptual = {
      sweet: 4,
      sour: 8,
      salty: 3,
      spicy: 2,
      umami: 3,
      bitter: 3.4,
    };
    const capped = capTaste(
      perceptual,
      { sweet: 9, sour: 10, salty: 9, spicy: 8, umami: 9, bitter: 1 },
    );
    expect(capped.bitter).toBe(1);
    expect(capped.salty).toBe(3);
    expect(capped.sour).toBe(8);
  });
});
