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

  it("requires a contiguous multi-word Latin phrase, not scattered tokens", () => {
    const tres = { dish: "tres leches", nativeName: "tres leches" };
    expect(matchesDish("Pastel de tres leches tradicional", tres)).toBe(true);
    expect(matchesDish("receta-de-pastel-de-tres-leches", tres)).toBe(true);
    expect(matchesDish("algo con leche y tres cosas", tres)).toBe(false);
    expect(
      matchesDish("Alfajores blancos. Lo más visto: Torta tres leches", tres),
    ).toBe(true);
  });
});

describe("recipeMatchesDish", () => {
  it("keeps a page when the native name is on the URL or fetched page title", () => {
    expect(
      recipeMatchesDish(
        "Nam Ngiao",
        {
          title: "some soft search title",
          snippet: "",
          url: "https://example.com/recipe",
        },
        { dish: "nam ngiaw", nativeName: "น้ำเงี้ยว" },
        { pageTitle: "น้ำเงี้ยว สูตรแม่" },
      ),
    ).toBe(true);
    expect(
      recipeMatchesDish(
        "Nam Ngiao",
        {
          title: "soft",
          snippet: "",
          url: "https://example.com/nam-ngiao-recipe",
        },
        { dish: "nam ngiaw", nativeName: "น้ำเงี้ยว" },
      ),
    ).toBe(true);
  });

  it("does not let a matching extract or search title launder a wrong URL", () => {
    const ceviche = { dish: "ceviche", nativeName: "ceviche" };
    const hit = {
      title: "Ceviche PERUANO - ¡Receta original paso a paso!",
      snippet: "ceviche peruano",
      url: "https://recetas.elperiodico.com/receta-de-alfajores-marplatenses-blancos-76228.html",
    };
    expect(
      recipeMatchesDish("Ceviche PERUANO - ¡Receta original paso a paso!", hit, ceviche, {
        pageTitle: "Alfajores marplatenses blancos - Receta DELICIOSA",
      }),
    ).toBe(false);
    expect(
      recipeMatchesDish("Ceviche PERUANO", hit, ceviche, {
        url: hit.url,
        pageTitle: "",
      }),
    ).toBe(true);
  });

  it("accepts when the fetched page title matches even if the URL is opaque", () => {
    expect(
      recipeMatchesDish(
        "Sichuan boiled beef",
        {
          title: "soft search label",
          snippet: "",
          url: "https://www.xiachufang.com/recipe/103518864/",
        },
        { dish: "shuizhurou", nativeName: "水煮肉片" },
        { pageTitle: "水煮肉片的做法" },
      ),
    ).toBe(true);
  });

  it("keeps a shorter native title of the same dish on the page", () => {
    expect(
      recipeMatchesDish(
        "水煮肉",
        {
          title: "soft",
          snippet: "",
          url: "https://example.com/shuizhu",
        },
        { dish: "shuizhurou", nativeName: "水煮肉片" },
        { pageTitle: "水煮肉片" },
      ),
    ).toBe(true);
  });

  it("rejects an extract whose native title is a different dish even when the page matched", () => {
    const shuizhu = { dish: "shuizhurou", nativeName: "水煮肉片" };
    expect(
      recipeMatchesDish(
        "鱼香茄子",
        {
          title: "soft",
          snippet: "",
          url: "https://example.com/shuizhu",
        },
        shuizhu,
        { pageTitle: "水煮肉片的做法" },
      ),
    ).toBe(false);
    expect(
      recipeMatchesDish(
        "宫保鸡丁",
        {
          title: "soft",
          snippet: "",
          url: "https://xiachufang.com/recipe/123",
        },
        shuizhu,
        { pageTitle: "水煮肉片" },
      ),
    ).toBe(false);
  });

  it("rejects a Latin-script other dish even when the search hit mentions the query dish", () => {
    const paella = { dish: "paella", nativeName: "paella" };
    expect(
      recipeMatchesDish(
        "Receta de Torta con leche condensada y harina leudante",
        {
          title: "Paella de marisco",
          snippet: "receta tradicional",
          url: "https://recetas.elperiodico.com/receta-de-torta-con-leche-condensada-y-harina-leudante-76404.html",
        },
        paella,
        { pageTitle: "Receta de Torta con leche condensada y harina leudante" },
      ),
    ).toBe(false);
  });
});
