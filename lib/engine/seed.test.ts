import { describe, expect, it } from "vitest";
import { loadSeedStore } from "./seed";

describe("test ingredient snapshot", () => {
  it("loads measured salt for offline pipeline tests", () => {
    expect(loadSeedStore().get("salt")?.source).toBe("measured");
  });

  it("scores citrus fruit below juice, and juice below a 10", () => {
    expect(loadSeedStore().get("lemon")?.taste.sour).toBe(9);
    expect(loadSeedStore().get("lime")?.taste.sour).toBe(9);
    expect(loadSeedStore().get("lime juice")?.taste.sour).toBe(9.5);
  });

  it("scores onion as barely sweet and black pepper as almost no chili heat", () => {
    const onion = loadSeedStore().get("onion")?.taste.sweet ?? -1;
    const pepper = loadSeedStore().get("black pepper")?.taste.spicy ?? -1;
    expect(onion).toBeGreaterThanOrEqual(0);
    expect(onion).toBeLessThanOrEqual(1);
    expect(pepper).toBeGreaterThanOrEqual(0.1);
    expect(pepper).toBeLessThanOrEqual(0.3);
  });

  it("does not score ginger or garlic as chili-spicy", () => {
    expect(loadSeedStore().get("ginger")?.taste.spicy).toBe(0);
    expect(loadSeedStore().get("garlic")?.taste.spicy).toBe(0);
  });
});
