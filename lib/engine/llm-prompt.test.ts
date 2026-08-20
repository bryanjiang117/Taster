import { describe, expect, it } from "vitest";
import {
  calibrateLeafPrompt,
  canonicalizeIngredientNamesPrompt,
  classifyTasteInputPrompt,
  confirmFoodShortlistsPrompt,
  culinaryContextLine,
  estimateLeafPrompt,
  isCommonIngredientPrompt,
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
    expect(canonicalize.toLowerCase()).toContain("sweet chili");
    expect(canonicalize.toLowerCase()).toContain("chili oil");

    const extract = recipeExtractPrompt("page text", "https://example.com/ceviche", context);
    expect(extract).toContain("Peruvian");
    expect(extract).toContain("page text");
    expect(extract).toMatch(/role to "in" or "out"/);
    expect(extract.toLowerCase()).toContain("common sense");
    expect(extract).toContain("mix.intensity");
    expect(extract.toLowerCase()).toContain("freshly cracked");
  });
});

describe("leaf calibration prompt", () => {
  it("reserves 10s for the most intense form and scores juice above whole fruit", () => {
    const prompt = calibrateLeafPrompt("yuzu", {
      sweet: 1,
      sour: 8,
      salty: 0,
      spicy: 0,
      umami: 0,
      bitter: 1,
    });
    expect(prompt).toContain("yuzu");
    expect(prompt.toLowerCase()).toContain("lemon");
    expect(prompt.toLowerCase()).toContain("juice");
    expect(prompt).toMatch(/9\.5/);
    expect(prompt.toLowerCase()).toContain("invent");
    expect(prompt.toLowerCase()).not.toContain("citrus juice is as sour as the fruit");
  });

  it("anchors everyday foods so fruit, onion, and pepper match how they taste", () => {
    const prompt = calibrateLeafPrompt("orange", {
      sweet: 7,
      sour: 2,
      salty: 0,
      spicy: 0,
      umami: 0,
      bitter: 0,
    });
    expect(prompt.toLowerCase()).toContain("orange");
    expect(prompt.toLowerCase()).toContain("onion");
    expect(prompt.toLowerCase()).toContain("black pepper");
    expect(prompt).toMatch(/0\.2/);
    expect(prompt.toLowerCase()).toContain("chili");
    expect(prompt.toLowerCase()).toContain("ginger");
    expect(prompt.toLowerCase()).toContain("chili heat");
    expect(prompt.toLowerCase()).not.toContain("gingerol");
    expect(prompt.toLowerCase()).toContain("salty");
    expect(prompt).toMatch(/8\.5/);
    expect(prompt.toLowerCase()).toContain("make room");
  });
});

describe("leaf estimate prompt", () => {
  it("asks for a mouthful of the named food and keeps distinct names distinct", () => {
    const prompt = estimateLeafPrompt("soft shell crab");
    expect(prompt).toContain("soft shell crab");
    expect(prompt.toLowerCase()).toContain("mouthful");
    expect(prompt.toLowerCase()).toContain("thai chili");
    expect(prompt.toLowerCase()).toContain("soft shell crab");
    expect(prompt).toMatch(/10 umami/i);
    expect(prompt.toLowerCase()).not.toContain("just chili");
  });
});

describe("food identity prompt", () => {
  it("asks Gemini to pick or reject a shortlist per source in one call", () => {
    const prompt = confirmFoodShortlistsPrompt(
      "chili oil",
      [
        {
          source: "usda",
          hits: [
            { id: "1", name: "Oil, canola" },
            { id: "2", name: "Chili oil" },
          ],
        },
        { source: "foodb", hits: [{ id: "3", name: "Oil palm" }] },
      ],
      {
        dish: "mapo tofu",
        nativeName: "麻婆豆腐",
        culture: "Sichuan",
      },
    );
    expect(prompt).toContain("chili oil");
    expect(prompt).toContain("Oil, canola");
    expect(prompt).toContain("Chili oil");
    expect(prompt.toLowerCase()).toContain("mapo");
    expect(prompt.toLowerCase()).toContain("canola");
    expect(prompt).toMatch(/"usda":\s*1/);
    expect(prompt).toMatch(/null/);
  });
});

describe("common ingredient prompt", () => {
  it("asks whether the name is pantry versus a dish that needs a recipe", () => {
    const prompt = isCommonIngredientPrompt("doubanjiang");
    expect(prompt).toContain("doubanjiang");
    expect(prompt.toLowerCase()).toContain("pantry");
    expect(prompt.toLowerCase()).toContain("recipe");
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
    expect(prompt.toLowerCase()).toContain("spaghetti");
    expect(prompt.toLowerCase()).toContain("dish");
  });
});
