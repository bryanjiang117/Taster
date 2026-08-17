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
});
