import { describe, expect, it } from "vitest";
import { matchesDish, recipeMatchesDish } from "./dish-match";

describe("matchesDish", () => {
  it("treats the native-script name as the identity of the dish", () => {
    expect(
      matchesDish("家常麻婆豆腐的做法", { dish: "mapo tofu", nativeName: "麻婆豆腐" }),
    ).toBe(true);
    expect(
      matchesDish("ขนมจีนน้ำเงี้ยว สูตรแม่", {
        dish: "nam ngiaw",
        nativeName: "น้ำเงี้ยว",
      }),
    ).toBe(true);
    expect(
      matchesDish("ผัดไทยกุ้งสด", { dish: "pad thai", nativeName: "ผัดไทย" }),
    ).toBe(true);
  });

  it("accepts romanized titles that differ only by usual spelling variation", () => {
    expect(
      matchesDish("Nam Ngiao", { dish: "nam ngiaw", nativeName: "น้ำเงี้ยว" }),
    ).toBe(true);
    expect(
      matchesDish("Pad Tai", { dish: "pad thai", nativeName: "ผัดไทย" }),
    ).toBe(true);
  });

  it("rejects other dishes from the same cuisine", () => {
    const mapo = { dish: "mapo tofu", nativeName: "麻婆豆腐" };
    expect(matchesDish("鱼香茄子 Eggplant with garlic sauce", mapo)).toBe(false);
    expect(matchesDish("Claypot rice 煲仔饭", mapo)).toBe(false);
    expect(matchesDish("Cold tofu salad", mapo)).toBe(false);
  });
});

describe("recipeMatchesDish", () => {
  it("keeps a page when the native name is present, even if the extracted title is romanized differently", () => {
    expect(
      recipeMatchesDish("Nam Ngiao", {
        title: "น้ำเงี้ยว",
        snippet: "",
        url: "https://example.com/recipe",
      }, { dish: "nam ngiaw", nativeName: "น้ำเงี้ยว" }),
    ).toBe(true);
  });

  it("does not veto an English extracted title when the search hit already has the native name", () => {
    expect(
      recipeMatchesDish("Sichuan boiled beef", {
        title: "水煮肉片的做法",
        snippet: "",
        url: "https://example.com/shuizhu",
      }, { dish: "shuizhurou", nativeName: "水煮肉片" }),
    ).toBe(true);
  });

  it("keeps a shorter native title of the same dish", () => {
    expect(
      recipeMatchesDish("水煮肉", {
        title: "水煮肉片",
        snippet: "",
        url: "https://example.com/shuizhu",
      }, { dish: "shuizhurou", nativeName: "水煮肉片" }),
    ).toBe(true);
  });

  it("rejects an extract whose native title is a different dish even when the search hit matched", () => {
    const shuizhu = { dish: "shuizhurou", nativeName: "水煮肉片" };
    expect(
      recipeMatchesDish("鱼香茄子", {
        title: "水煮肉片的做法",
        snippet: "",
        url: "https://example.com/shuizhu",
      }, shuizhu),
    ).toBe(false);
    expect(
      recipeMatchesDish("宫保鸡丁", {
        title: "水煮肉片",
        snippet: "",
        url: "https://xiachufang.com/recipe/123",
      }, shuizhu),
    ).toBe(false);
  });
});
