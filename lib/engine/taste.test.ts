import { describe, expect, it } from "vitest";
import { TASTE_DIMENSIONS, capTaste, ceilingTaste, clampScore, emptyTaste, mergeTastes, polarizeTaste, toPerceptualScore, toPerceptualTaste } from "./taste";

describe("taste scores", () => {
  it("starts at zero on every dimension", () => {
    const t = emptyTaste();
    for (const dim of TASTE_DIMENSIONS) {
      expect(t[dim]).toBe(0);
    }
  });

  it("clamps scores to 0–10", () => {
    expect(clampScore(-2)).toBe(0);
    expect(clampScore(11)).toBe(10);
    expect(clampScore(7.4)).toBe(7.4);
  });

  it("merges tastes by summing contributions then clamping", () => {
    const merged = mergeTastes([
      { sweet: 3, sour: 8, salty: 1, spicy: 0, umami: 2, bitter: 0 },
      { sweet: 2, sour: 1, salty: 9, spicy: 0, umami: 1, bitter: 0 },
    ]);
    expect(merged.sweet).toBe(5);
    expect(merged.sour).toBe(9);
    expect(merged.salty).toBe(10);
  });

  it("maps typical seasoning concentrations onto a readable 0–10 scale", () => {
    // 15ml fish sauce in 500ml dish: raw salty ≈ 0.27, should not stay under 1
    const perceptual = toPerceptualScore(9 * (15 / 500));
    expect(perceptual).toBeGreaterThan(2);
    expect(perceptual).toBeLessThan(8);
  });

  it("stays 0 when raw concentration is 0 and saturates toward 10", () => {
    expect(toPerceptualScore(0)).toBe(0);
    expect(toPerceptualScore(4)).toBeGreaterThan(9);
  });

  it("gets stronger when TASTE_SCALE_TAU is smaller", () => {
    const raw = 0.3;
    expect(toPerceptualScore(raw, 0.2)).toBeGreaterThan(toPerceptualScore(raw, 0.5));
  });

  it("maps sweetness a bit quieter than other dimensions at the same raw concentration", () => {
    const raw = 0.3;
    const taste = toPerceptualTaste({
      sweet: raw,
      sour: raw,
      salty: raw,
      spicy: raw,
      umami: raw,
      bitter: raw,
    });
    expect(taste.sweet).toBeLessThan(taste.salty);
    expect(taste.sweet).toBeGreaterThan(taste.salty * 0.7);
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
    expect(dish.spicy).toBeGreaterThan(2.5);
    expect(dish.spicy).toBeLessThan(4.4);
    expect(dish.umami).toBeCloseTo(8.8, 1);
    expect(dish.bitter).toBeLessThan(0.5);
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
