import { describe, expect, it } from "vitest";
import { normalizeIngredientName } from "./normalize";

describe("ingredient name normalization", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeIngredientName("Soy-Sauce!")).toBe("soy sauce");
  });

  it("maps common aliases to a canonical name", () => {
    expect(normalizeIngredientName("fishsauce")).toBe("fish sauce");
    expect(normalizeIngredientName("nam pla")).toBe("fish sauce");
    expect(normalizeIngredientName("table salt")).toBe("salt");
  });

  it("keeps native-script names and maps them onto the seed vocabulary", () => {
    expect(normalizeIngredientName("酱油")).toBe("soy sauce");
    expect(normalizeIngredientName("生抽")).toBe("soy sauce");
    expect(normalizeIngredientName("น้ำปลา")).toBe("fish sauce");
    expect(normalizeIngredientName("간장")).toBe("soy sauce");
    expect(normalizeIngredientName("醤油")).toBe("soy sauce");
  });

  it("does not collapse every non-English ingredient into a blank name", () => {
    expect(normalizeIngredientName("豆腐")).not.toBe("");
    expect(normalizeIngredientName("มะนาว")).not.toBe("");
  });

  it("does not collapse hot chilies into generic chili", () => {
    expect(normalizeIngredientName("bird's eye chili")).toBe("bird eye chili");
    expect(normalizeIngredientName("thai chili")).toBe("thai chili");
  });

  it("treats singular and plural English names as the same ingredient", () => {
    expect(normalizeIngredientName("kaffir lime leaves")).toBe(
      normalizeIngredientName("kaffir lime leaf"),
    );
    expect(normalizeIngredientName("kaffir lime leaves")).toBe("kaffir lime leaf");
    expect(normalizeIngredientName("onions")).toBe("onion");
    expect(normalizeIngredientName("tomatoes")).toBe("tomato");
    expect(normalizeIngredientName("chilies")).toBe("chili");
  });

  it("does not strip a trailing s from uncountable food names", () => {
    expect(normalizeIngredientName("molasses")).toBe("molasses");
    expect(normalizeIngredientName("lemongrass")).toBe("lemongrass");
    expect(normalizeIngredientName("couscous")).toBe("couscous");
  });
});
