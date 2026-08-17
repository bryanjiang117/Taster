import { describe, expect, it } from "vitest";
import { loadSeedStore } from "./seed";

describe("test ingredient snapshot", () => {
  it("loads measured salt for offline pipeline tests", () => {
    expect(loadSeedStore().get("salt")?.source).toBe("measured");
  });

  it("treats lemon and lime as the sour ceiling", () => {
    expect(loadSeedStore().get("lemon")?.taste.sour).toBe(10);
    expect(loadSeedStore().get("lime")?.taste.sour).toBe(10);
  });

  it("scores onion as barely sweet and black pepper as mild heat", () => {
    const onion = loadSeedStore().get("onion")?.taste.sweet ?? -1;
    const pepper = loadSeedStore().get("black pepper")?.taste.spicy ?? -1;
    expect(onion).toBeGreaterThanOrEqual(0);
    expect(onion).toBeLessThanOrEqual(1);
    expect(pepper).toBeGreaterThanOrEqual(2);
    expect(pepper).toBeLessThanOrEqual(3);
  });
});
