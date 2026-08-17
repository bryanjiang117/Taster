import { describe, expect, it } from "vitest";
import {
  canonicalizeIngredientNamesPrompt,
  classifyTasteInputPrompt,
  culinaryContextLine,
  ingredientLookupPrompt,
  recipeExtractPrompt,
} from "./llm";

describe("culinary context in LLM name prompts", () => {
  it("asks the model to use dish cuisine, not dictionary English", () => {
    const line = culinaryContextLine({
      dish: "ceviche",
      nativeName: "ceviche",
      culture: "Peruvian",
      country: "Peru",
      language: "Spanish",
    });
    expect(line).toContain("ceviche");
    expect(line).toContain("Peruvian");
    expect(line).toContain("Spanish");
    expect(line.toLowerCase()).toContain("dictionary");
    expect(line.toLowerCase()).toContain("lime");
  });

  it("puts that context into canonicalize and extract prompts", () => {
    const context = {
      dish: "ceviche",
      nativeName: "ceviche",
      culture: "Peruvian",
      country: "Peru",
      language: "Spanish",
    };
    const canonicalize = canonicalizeIngredientNamesPrompt(
      ["limón"],
      ["lemon", "lime"],
      context,
    );
    expect(canonicalize).toContain("limón");
    expect(canonicalize).toContain("lime");
    expect(canonicalize).toContain("Peruvian");

    const extract = recipeExtractPrompt("page text", "https://example.com/ceviche", context);
    expect(extract).toContain("Peruvian");
    expect(extract).toContain("page text");
    expect(extract).toMatch(/role to "in" or "out"/);
  });
});

describe("ingredient lookup prompt", () => {
  it("anchors 10 sour to lemon and lime and tells the model not to hedge", () => {
    const prompt = ingredientLookupPrompt("yuzu");
    expect(prompt).toContain("yuzu");
    expect(prompt.toLowerCase()).toContain("lemon");
    expect(prompt.toLowerCase()).toContain("lime");
    expect(prompt).toMatch(/10 sour/i);
    expect(prompt.toLowerCase()).toContain("common sense");
  });
});

describe("classify taste input prompt", () => {
  it("accepts dishes and ingredients and rejects brands and gibberish", () => {
    const prompt = classifyTasteInputPrompt("Coca-Cola");
    expect(prompt).toContain("Coca-Cola");
    expect(prompt.toLowerCase()).toContain("dish");
    expect(prompt.toLowerCase()).toContain("ingredient");
    expect(prompt.toLowerCase()).toContain("brand");
    expect(prompt.toLowerCase()).toContain("reject");
  });
});
