import { describe, expect, it } from "vitest";
import { applyCalibration, draftTasteFromCompounds } from "./chemistry";
import { DukeDumpClient } from "./duke";
import { tryChemistryLeaf } from "./leaf";
import { IngredientStore } from "./store";
import {
  compoundsFromUsdaNutrients,
  mergeSugarSupplement,
  pickUsdaFood,
  pickUsdaFoods,
  usdaFoundationIsThin,
} from "./usda";
import { compoundsFromFoodbContents } from "./foodb";

describe("USDA nutrient mapping", () => {
  it("maps numbered nutrients onto mixer ids", () => {
    const amounts = compoundsFromUsdaNutrients([
      { number: "307", name: "Sodium, Na", amount: 1500, unit: "MG" },
      { number: "210", name: "Sucrose", amount: 4.2, unit: "G" },
      { number: "262", name: "Caffeine", amount: 40, unit: "MG" },
    ]);
    const ids = amounts.map((row) => row.id).sort();
    expect(ids).toEqual(["caffeine", "sodium", "sucrose"]);
    expect(amounts.find((row) => row.id === "sodium")?.amount).toBe(1500);
  });

  it("uses total sugars only when specific sugars are missing", () => {
    const onlyTotal = compoundsFromUsdaNutrients([
      { number: "269", name: "Sugars, total", amount: 9, unit: "G" },
    ]);
    expect(onlyTotal.some((row) => row.id === "sucrose" && row.amount === 9)).toBe(
      true,
    );
    const specific = compoundsFromUsdaNutrients([
      { number: "269", name: "Sugars, total", amount: 9, unit: "G" },
      { number: "212", name: "Fructose", amount: 4, unit: "G" },
    ]);
    expect(specific.some((row) => row.id === "sucrose")).toBe(false);
    expect(specific.some((row) => row.id === "fructose")).toBe(true);
  });

  it("merges branded sucrose when Foundation rows omit sugars", () => {
    const legacy = compoundsFromUsdaNutrients([
      { number: "307", name: "Sodium, Na", amount: 2733, unit: "MG" },
    ]);
    const branded = compoundsFromUsdaNutrients([
      { number: "307", name: "Sodium, Na", amount: 3000, unit: "MG" },
      { number: "269", name: "Sugars, total", amount: 18.75, unit: "G" },
    ]);
    const merged = mergeSugarSupplement(legacy, branded);
    expect(merged.some((row) => row.id === "sucrose" && row.amount === 18.75)).toBe(
      true,
    );
    expect(merged.filter((row) => row.id === "sodium")).toHaveLength(1);
  });

  it("does not treat potassium or protein amino acids as taste", () => {
    const amounts = compoundsFromUsdaNutrients([
      { number: "306", name: "Potassium, K", amount: 2243, unit: "MG" },
      { number: "515", name: "Glutamic acid", amount: 1.9, unit: "G" },
      { number: "514", name: "Aspartic acid", amount: 0.8, unit: "G" },
      { number: "511", name: "Arginine", amount: 0.2, unit: "G" },
      { number: "307", name: "Sodium, Na", amount: 16, unit: "MG" },
    ]);
    expect(amounts.map((row) => row.id).sort()).toEqual(["sodium"]);
  });

  it("picks the USDA row whose name is the food, not a keyword collision", () => {
    expect(
      pickUsdaFood("greater galangal", [
        {
          fdcId: 1,
          description:
            "Beverages, fruit juice drink, greater than 3% juice, high vitamin C",
          dataType: "SR Legacy",
        },
      ])?.description,
    ).toBeUndefined();
    expect(
      pickUsdaFood("tamarind paste", [
        { fdcId: 1, description: "Candies, Tamarind", dataType: "SR Legacy" },
        { fdcId: 2, description: "Tamarinds, raw", dataType: "SR Legacy" },
        {
          fdcId: 3,
          description: "Tomato, paste, canned, without salt added",
          dataType: "Foundation",
        },
      ])?.description,
    ).toBe("Tamarinds, raw");
    expect(
      pickUsdaFood("cabbage", [
        { fdcId: 1, description: "Cabbage, kimchi", dataType: "SR Legacy" },
        { fdcId: 2, description: "Cabbage, mustard, salted", dataType: "SR Legacy" },
        { fdcId: 3, description: "Cabbage, green, raw", dataType: "Foundation" },
      ])?.description,
    ).toBe("Cabbage, green, raw");
    expect(
      pickUsdaFood("tomato", [
        { fdcId: 1, description: "Tomato powder", dataType: "SR Legacy" },
        { fdcId: 2, description: "Tomato, roma", dataType: "Foundation" },
        { fdcId: 3, description: "Tomatoes, grape, raw", dataType: "Foundation" },
      ])?.description,
    ).toBe("Tomatoes, grape, raw");
  });

  it("returns a ranked shortlist, not only the single best row", () => {
    const picks = pickUsdaFoods("soy sauce", [
      { fdcId: 1, description: "Soy sauce", dataType: "Foundation" },
      { fdcId: 2, description: "Soy sauce, tamari", dataType: "SR Legacy" },
      { fdcId: 3, description: "Soy sauce made from soy (tamari)", dataType: "SR Legacy" },
    ]);
    expect(picks.map((row) => row.description)).toEqual([
      "Soy sauce",
      "Soy sauce, tamari",
      "Soy sauce made from soy (tamari)",
    ]);
  });

  it("adds branded products when Foundation and SR Legacy have no real match", () => {
    const foundation = [
      {
        fdcId: 1,
        description: "Beverages, fruit juice drink, greater than 3% juice",
        dataType: "SR Legacy",
      },
    ];
    expect(usdaFoundationIsThin("fish sauce", foundation)).toBe(true);
    const picks = pickUsdaFoods(
      "fish sauce",
      foundation,
      [
        { fdcId: 10, description: "Red Boat Fish Sauce", dataType: "Branded" },
        {
          fdcId: 11,
          description: "Lean Cuisine Chicken Alfredo Dinner",
          dataType: "Branded",
        },
      ],
    );
    expect(picks.map((row) => row.description)).toEqual(["Red Boat Fish Sauce"]);
  });

  it("keeps Foundation ahead of Branded when both confirm the same food", () => {
    const picks = pickUsdaFoods(
      "soy sauce",
      [{ fdcId: 1, description: "Soy sauce", dataType: "Foundation" }],
      [{ fdcId: 2, description: "Kikkoman Soy Sauce", dataType: "Branded" }],
    );
    expect(picks[0]?.description).toBe("Soy sauce");
    expect(picks.some((row) => row.description === "Kikkoman Soy Sauce")).toBe(
      false,
    );
  });
});

describe("FooDB content mapping", () => {
  it("maps quantified compound names and skips empty amounts", () => {
    const amounts = compoundsFromFoodbContents([
      { name: "Capsaicin", origContent: 28, origUnit: "mg/100g" },
      { name: "Piperine", origContent: 0 },
      { name: "mystery molecule", origContent: 12, origUnit: "mg/100 g" },
    ]);
    expect(amounts).toEqual([{ id: "capsaicin", amount: 28 }]);
  });
});

describe("tryChemistryLeaf", () => {
  it("returns a measured leaf when USDA and FooDB both hit", async () => {
    const result = await tryChemistryLeaf("carrot", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Carrots, raw" }),
        compounds: async () => [{ id: "sucrose", amount: 3.5 }],
      },
      foodb: {
        search: async () => ({ id: "FOOD00001", name: "Carrot" }),
        compounds: async () => [{ id: "malic_acid", amount: 200 }],
      },
    });
    expect(result?.source).toBe("measured");
    expect(result?.measuredFrom).toEqual(
      expect.arrayContaining(["usda", "foodb"]),
    );
    expect(result?.measuredFrom).toHaveLength(2);
    expect(result?.taste.sweet).toBeGreaterThan(0);
    expect(result?.taste.sour).toBeGreaterThan(0);
  });

  it("leaves on a single confirmed FAO hit without a common-pantry check", async () => {
    const result = await tryChemistryLeaf("egusi", {
      store: new IngredientStore(),
      usda: { search: async () => null, compounds: async () => [] },
      foodb: { search: async () => null, compounds: async () => [] },
      fct: {
        candidates: async () => [{ id: "wa-egusi", name: "Egusi, melon seed" }],
        compounds: async () => [{ id: "sodium", amount: 80 }],
      },
    });
    expect(result?.taste.salty).toBeGreaterThan(0);
    expect(result?.derivedFrom).toContain("Egusi, melon seed");
  });

  it("does not leaf when Gemini rejects every candidate", async () => {
    const result = await tryChemistryLeaf("chili oil", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Oil, canola" }),
        compounds: async () => [{ id: "sodium", amount: 8 }],
      },
      foodb: {
        search: async () => ({ id: "2", name: "Oil palm" }),
        compounds: async () => [{ id: "sodium", amount: 6 }],
      },
      confirmFoodShortlists: async () => ({ usda: null, foodb: null }),
    });
    expect(result).toBeNull();
  });

  it("does not leaf when there is no quantified chemistry", async () => {
    const result = await tryChemistryLeaf("carrot", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Carrot" }),
        compounds: async () => [],
      },
      foodb: {
        search: async () => ({ id: "2", name: "Carrot" }),
        compounds: async () => [],
      },
    });
    expect(result).toBeNull();
  });

  it("rejects acid-process foods when labs have sodium but no organic acids", async () => {
    const kimchi = await tryChemistryLeaf("kimchi", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Cabbage, kimchi" }),
        compounds: async () => [
          { id: "sodium", amount: 498 },
          { id: "sucrose", amount: 1.06 },
        ],
      },
      foodb: { search: async () => null, compounds: async () => [] },
    });
    expect(kimchi).toBeNull();

    const sauerkraut = await tryChemistryLeaf("sauerkraut", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "2", name: "Sauerkraut, canned" }),
        compounds: async () => [{ id: "sodium", amount: 661 }],
      },
      foodb: { search: async () => null, compounds: async () => [] },
    });
    expect(sauerkraut).toBeNull();
  });

  it("still leaves acid-process foods when organic acids are quantified", async () => {
    const result = await tryChemistryLeaf("sauerkraut", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Sauerkraut" }),
        compounds: async () => [
          { id: "sodium", amount: 661 },
          { id: "lactic_acid", amount: 1500 },
        ],
      },
      foodb: { search: async () => null, compounds: async () => [] },
    });
    expect(result).not.toBeNull();
    expect(result?.taste.sour).toBeGreaterThan(2);
  });

  it("lets USDA amounts win over FooDB for the same compound, and keeps FooDB-only acids", async () => {
    const result = await tryChemistryLeaf("tomato", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Tomatoes, grape, raw" }),
        compounds: async () => [
          { id: "fructose", amount: 1.4 },
          { id: "glucose", amount: 1.3 },
          { id: "sodium", amount: 5 },
        ],
      },
      foodb: {
        search: async () => ({ id: "2", name: "Garden tomato" }),
        compounds: async () => [
          { id: "sucrose", amount: 43.9 },
          { id: "sodium", amount: 790 },
          { id: "malic_acid", amount: 400 },
        ],
      },
    });
    expect(result?.taste.sweet).toBeLessThan(5);
    expect(result?.taste.salty).toBeLessThan(1);
    expect(result?.taste.sour).toBeGreaterThan(1);
  });

  it("lets UmamiDB glutamate win over later tables for umami compounds", async () => {
    const result = await tryChemistryLeaf("kombu", {
      store: new IngredientStore(),
      usda: {
        search: async () => ({ id: "1", name: "Seaweed, kelp, raw" }),
        compounds: async () => [{ id: "sodium", amount: 200 }],
      },
      foodb: { search: async () => null, compounds: async () => [] },
      umami: {
        candidates: async () => [{ id: "kombu", name: "Kombu" }],
        compounds: async () => [{ id: "glutamate", amount: 1600 }],
      },
    });
    expect(result?.taste.umami).toBeGreaterThan(8);
  });

  it("lets Gemini calibrate only dimensions that have evidence, except omitted acids/umami", () => {
    const draft = draftTasteFromCompounds([{ id: "sodium", amount: 1500 }]);
    const calibrated = applyCalibration(draft, { salty: 7, bitter: 8, spicy: 3, sour: 4 });
    expect(calibrated.salty).toBe(7);
    expect(calibrated.bitter).toBe(0);
    expect(calibrated.spicy).toBe(0);
    expect(calibrated.sour).toBe(4);
  });

  it("scores ginger from Duke as pungent identity, not chili heat", async () => {
    const result = await tryChemistryLeaf("ginger", {
      store: new IngredientStore(),
      usda: { candidates: async () => [], compounds: async () => [] },
      foodb: { candidates: async () => [], compounds: async () => [] },
      fct: { candidates: async () => [], compounds: async () => [] },
      duke: new DukeDumpClient(),
    });
    expect(result).not.toBeNull();
    expect(result?.taste.spicy).toBe(0);
  });

  it("scores MSG as a glutamate salt instead of searching a recipe", async () => {
    const result = await tryChemistryLeaf("msg", {
      store: new IngredientStore(),
      usda: { search: async () => null, compounds: async () => [] },
      foodb: { search: async () => null, compounds: async () => [] },
    });
    expect(result?.taste.umami).toBeGreaterThan(8);
    expect(result?.derivedFrom).toContain("monosodium glutamate");
  });

  it("scores thai chili from its own duke alias, not generic chili", async () => {
    const thai = await tryChemistryLeaf("thai chili", {
      store: new IngredientStore(),
      usda: { candidates: async () => [], compounds: async () => [] },
      foodb: { candidates: async () => [], compounds: async () => [] },
      fct: { candidates: async () => [], compounds: async () => [] },
      duke: new DukeDumpClient(),
    });
    expect(thai?.taste.spicy).toBeGreaterThan(7);
    expect(thai?.derivedFrom?.[0]).toMatch(/frutescens/i);

    const generic = await tryChemistryLeaf("chili", {
      store: new IngredientStore(),
      usda: { candidates: async () => [], compounds: async () => [] },
      foodb: { candidates: async () => [], compounds: async () => [] },
      fct: { candidates: async () => [], compounds: async () => [] },
      duke: new DukeDumpClient(),
    });
    expect(generic?.derivedFrom?.[0]).toMatch(/annuum/i);
    expect(generic?.taste.spicy).toBeGreaterThan(5);
    expect(generic?.taste.spicy).toBeLessThan(thai!.taste.spicy!);
  });
});
