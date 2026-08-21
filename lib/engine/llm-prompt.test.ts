import { describe, expect, it } from "vitest";
import {
  calibrateLeafPrompt,
  canonicalizeIngredientNamesPrompt,
  classifyTasteInputPrompt,
  confirmFoodShortlistsPrompt,
  culinaryContextLine,
  estimateLeafPrompt,
  identifyDishPrompt,
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

  it("requires cuisine-typical forms for ambiguous generics like sausage", () => {
    const line = culinaryContextLine({
      dish: "clay pot rice",
      nativeName: "煲仔饭",
      culture: "Cantonese",
      country: "China",
      language: "Chinese",
    });
    expect(line.toLowerCase()).toMatch(/sausage|腊肠|香肠/);
    expect(line.toLowerCase()).toMatch(/chinese sausage|lap cheong/);
    expect(line.toLowerCase()).toMatch(/romaniz|native/);
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
    expect(extract).toContain("mix.why");
    expect(extract.toLowerCase()).toContain("marinade");
    expect(extract.toLowerCase()).toContain("evaporat");
    expect(extract.toLowerCase()).toContain("contribut");
    expect(extract.toLowerCase()).toContain("freshly cracked");
    expect(extract.toLowerCase()).toContain("frying oil");
    expect(extract.toLowerCase()).toContain("pasta water");
    expect(extract.toLowerCase()).toMatch(
      /mix\.intensity is the fraction of the listed amount that contributes/,
    );
    expect(extract.toLowerCase()).toContain("pinch");
    expect(extract.toLowerCase()).toMatch(/never for salt|not tbsp/);
    expect(extract.toLowerCase()).toMatch(
      /different dish|not (the )?target|return \{\"ingredients\":\[\]\}|empty ingredients/,
    );
    expect(extract.toLowerCase()).toMatch(/honest|real|actual|page('s)? (own )?title/);
    expect(extract.toLowerCase()).not.toMatch(
      /prefer ceviche if several dishes appear/,
    );
  });

  it("canonicalizes ambiguous generics to the cuisine-typical food even when catalog has only the generic", () => {
    const prompt = canonicalizeIngredientNamesPrompt(
      ["香肠", "sausage"],
      ["sausage", "soy sauce", "rice"],
      {
        dish: "clay pot rice",
        nativeName: "煲仔饭",
        culture: "Cantonese",
        country: "China",
        language: "Chinese",
      },
    );
    expect(prompt.toLowerCase()).toMatch(/cuisine-typical|culinary context|ambiguous/);
    expect(prompt.toLowerCase()).toMatch(/chinese sausage|lap cheong/);
    expect(prompt.toLowerCase()).toMatch(/invent|romaniz/);
    expect(prompt.toLowerCase()).not.toMatch(
      /do not upgrade a generic name to a different product just because the catalog is more specific/,
    );
    expect(prompt.toLowerCase()).toMatch(/italian sausage|bratwurst|already specific/);
  });

  it("forbids collapsing process forms and dish-namesake foods into parent categories", () => {
    const prompt = canonicalizeIngredientNamesPrompt(
      ["김치", "kimchi"],
      ["cabbage", "rice", "soy sauce"],
      {
        dish: "kimchi fried rice",
        nativeName: "김치볶음밥",
        culture: "Korean",
        country: "South Korea",
        language: "Korean",
      },
    );
    expect(prompt.toLowerCase()).toMatch(/kimchi.*cabbage|cabbage.*kimchi|≠.*cabbage|not.*cabbage/);
    expect(prompt.toLowerCase()).toMatch(/ferment|pickle|process/);
    expect(prompt.toLowerCase()).toMatch(/dish name|namesake|title/);
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
    expect(prompt.toLowerCase()).toMatch(/kimchi|sauerkraut|ferment/);
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
    expect(prompt.toLowerCase()).toContain("sodium");
    expect(prompt.toLowerCase()).toMatch(/leaven|functional|thickener/);
    expect(prompt.toLowerCase()).not.toContain("keep it high unless the named food is actually low-sodium");
  });

  it("treats calibration as a sanity check that must fix lab-proxy misses", () => {
    const prompt = calibrateLeafPrompt(
      "cornstarch",
      { sweet: 0, sour: 0, salty: 9.2, spicy: 0, umami: 0, bitter: 0 },
      { sweet: false, sour: false, salty: true, spicy: false, umami: false, bitter: false },
    );
    expect(prompt.toLowerCase()).toContain("sanity");
    expect(prompt.toLowerCase()).toContain("implausible");
    expect(prompt.toLowerCase()).toContain("sodium");
    expect(prompt.toLowerCase()).toMatch(/must (fix|correct|change)/);
    expect(prompt.toLowerCase()).toContain("cornstarch");
  });

  it("scores chili pepper against the dish it is going into, not US sweet chili", () => {
    const prompt = calibrateLeafPrompt(
      "chili pepper",
      { sweet: 7, sour: 0.5, salty: 0, spicy: 0, umami: 0, bitter: 0 },
      { sweet: true, sour: false, salty: false, spicy: false, umami: false, bitter: false },
      {
        dish: "laziji",
        nativeName: "辣子鸡",
        culture: "Sichuan",
        country: "China",
      },
    );
    expect(prompt.toLowerCase()).toContain("laziji");
    expect(prompt).toContain("辣子鸡");
    expect(prompt.toLowerCase()).toContain("sichuan");
    expect(prompt.toLowerCase()).toContain("sweet chili");
    expect(prompt.toLowerCase()).toContain("bell");
    expect(prompt.toLowerCase()).toContain("hot chili");
    expect(prompt.toLowerCase()).toContain("chili pepper");
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

  it("uses the parent dish so chili pepper is not American sweet chili", () => {
    const prompt = estimateLeafPrompt("chili pepper", {
      dish: "laziji",
      nativeName: "辣子鸡",
      culture: "Sichuan",
    });
    expect(prompt.toLowerCase()).toContain("laziji");
    expect(prompt.toLowerCase()).toContain("hot chili");
    expect(prompt.toLowerCase()).toContain("sweet chili");
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

  it("tells the picker that chili in a spicy Chinese dish is hot chili, not sweet pepper", () => {
    const prompt = confirmFoodShortlistsPrompt(
      "chili pepper",
      [
        {
          source: "usda",
          hits: [
            { id: "1", name: "Peppers, sweet, red, raw" },
            { id: "2", name: "Peppers, hot chili, red, raw" },
          ],
        },
      ],
      {
        dish: "laziji",
        nativeName: "辣子鸡",
        culture: "Sichuan",
        country: "China",
      },
    );
    expect(prompt.toLowerCase()).toContain("laziji");
    expect(prompt).toContain("辣子鸡");
    expect(prompt.toLowerCase()).toContain("sweet chili");
    expect(prompt.toLowerCase()).toContain("bell");
    expect(prompt.toLowerCase()).toContain("hot chili");
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
    expect(prompt.toLowerCase()).toContain("optimistic");
    expect(prompt.toLowerCase()).toContain("prefer");
    expect(prompt.toLowerCase()).toContain("unfamiliar");
  });
});

describe("identify dish prompt", () => {
  it("resolves bare names to the popular form and keeps specific variants", () => {
    const native = identifyDishPrompt("paella");
    expect(native).toContain("paella");
    expect(native.toLowerCase()).toMatch(/popular|usually mean|most (people|commonly)/);
    expect(native.toLowerCase()).toContain("seafood");
    expect(native.toLowerCase()).toMatch(/valenciana|specific|qualifier|variant/);
    expect(native.toLowerCase()).not.toMatch(/goal:\s*authentic home-country/);

    const typed = identifyDishPrompt("paella valenciana", { searchMode: "typed" });
    expect(typed).toContain("paella valenciana");
    expect(typed.toLowerCase()).toMatch(/honor|exact|specific/);
    expect(typed.toLowerCase()).toMatch(/typed|same language|script the user typed/);
  });
});
