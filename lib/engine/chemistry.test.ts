import { describe, expect, it } from "vitest";
import {
  acidProcessFood,
  applyCalibration,
  draftTasteFromCompounds,
  mergeCompoundLayers,
  type CompoundAmount,
} from "./chemistry";

function amounts(rows: Array<[string, number]>): CompoundAmount[] {
  return rows.map(([id, amount]) => ({ id, amount }));
}

describe("acidProcessFood", () => {
  it("flags fermented and pickled grocery names that need acid chemistry", () => {
    expect(acidProcessFood("kimchi")).toBe(true);
    expect(acidProcessFood("sauerkraut")).toBe(true);
    expect(acidProcessFood("pickled cucumber")).toBe(true);
    expect(acidProcessFood("plain yogurt")).toBe(true);
    expect(acidProcessFood("rice vinegar")).toBe(true);
    expect(acidProcessFood("cabbage")).toBe(false);
    expect(acidProcessFood("soy sauce")).toBe(false);
  });
});

describe("compound mixer", () => {
  it("maps table salt sodium above the usual 0–10 mouthful scale", () => {
    const { taste, evidence } = draftTasteFromCompounds(
      amounts([["sodium", 38700]]),
    );
    expect(taste.salty).toBe(12);
    expect(evidence.salty).toBe(true);
    expect(evidence.sweet).toBe(false);
  });

  it("scores soy-sauce sodium as nearly as salty as salt", () => {
    const { taste } = draftTasteFromCompounds(amounts([["sodium", 5500]]));
    expect(taste.salty).toBeGreaterThanOrEqual(9);
  });

  it("scores ham-level sodium as clearly salty, not a trace", () => {
    const { taste } = draftTasteFromCompounds(amounts([["sodium", 800]]));
    expect(taste.salty).toBeGreaterThanOrEqual(5);
    expect(taste.salty).toBeLessThan(8);
  });

  it("keeps carrot-level sodium as a tiny salty score, not zero and not high", () => {
    const { taste } = draftTasteFromCompounds(amounts([["sodium", 69]]));
    expect(taste.salty).toBeGreaterThan(0);
    expect(taste.salty).toBeLessThan(1);
  });

  it("weights sugars by relative sweetness, not total grams", () => {
    const fructose = draftTasteFromCompounds(amounts([["fructose", 9]])).taste;
    const glucose = draftTasteFromCompounds(amounts([["glucose", 9]])).taste;
    const lactose = draftTasteFromCompounds(amounts([["lactose", 9]])).taste;
    expect(fructose.sweet).toBeGreaterThan(glucose.sweet);
    expect(glucose.sweet).toBeGreaterThan(lactose.sweet);
    expect(lactose.sweet).toBeGreaterThan(0);
  });

  it("scores orange-level sucrose-equivalent as clearly sweet, not sugar-ceiling", () => {
    const { taste } = draftTasteFromCompounds(
      amounts([
        ["fructose", 2.4],
        ["glucose", 2.2],
        ["sucrose", 4.3],
      ]),
    );
    expect(taste.sweet).toBeGreaterThanOrEqual(6);
    expect(taste.sweet).toBeLessThan(9);
  });

  it("treats lemon citric acid as near-ceiling sour, tomato malic/citric as milder", () => {
    const lemon = draftTasteFromCompounds(amounts([["citric_acid", 6000]])).taste;
    const tomato = draftTasteFromCompounds(
      amounts([
        ["citric_acid", 500],
        ["malic_acid", 400],
      ]),
    ).taste;
    expect(lemon.sour).toBeGreaterThan(8);
    expect(tomato.sour).toBeGreaterThan(1);
    expect(tomato.sour).toBeLessThan(lemon.sour);
  });

  it("lets nucleotides boost glutamate umami instead of adding a separate bucket", () => {
    const gluOnly = draftTasteFromCompounds(amounts([["glutamate", 200]])).taste;
    const withImp = draftTasteFromCompounds(
      amounts([
        ["glutamate", 200],
        ["imp", 80],
      ]),
    ).taste;
    expect(withImp.umami).toBeGreaterThan(gluOnly.umami);
  });

  it("does not treat protein-scale glutamic acid as kombu", () => {
    const { taste, evidence } = draftTasteFromCompounds(
      amounts([["glutamic_acid_bound", 2000]]),
    );
    expect(taste.umami).toBeLessThan(1);
    expect(evidence.umami).toBe(false);
  });

  it("does not treat vegetable potassium or vitamin C as salt or sour", () => {
    const { taste, evidence } = draftTasteFromCompounds(
      amounts([
        ["potassium", 2243],
        ["ascorbic_acid", 348],
        ["sodium", 16],
      ]),
    );
    expect(taste.salty).toBeLessThan(0.5);
    expect(taste.sour).toBeLessThan(0.2);
    expect(evidence.sour).toBe(false);
  });

  it("does not treat hydrolyzed aspartic acid as tomato umami", () => {
    const { taste } = draftTasteFromCompounds(
      amounts([
        ["aspartate", 855],
        ["glutamic_acid_bound", 1940],
      ]),
    );
    expect(taste.umami).toBeLessThan(1);
  });

  it("scores capsaicin much hotter than the same milligrams of piperine", () => {
    const chili = draftTasteFromCompounds(amounts([["capsaicin", 30]])).taste;
    const pepper = draftTasteFromCompounds(amounts([["piperine", 7750]])).taste;
    expect(chili.spicy).toBeGreaterThan(6);
    expect(pepper.spicy).toBeGreaterThan(0.1);
    expect(pepper.spicy).toBeLessThan(0.3);
    expect(chili.spicy).toBeGreaterThan(pepper.spicy);
  });

  it("does not treat ginger, garlic, mustard, or sanshool as chili heat", () => {
    const ginger = draftTasteFromCompounds(amounts([["gingerol", 363.4]]));
    const garlic = draftTasteFromCompounds(amounts([["allicin", 1465]]));
    const mustard = draftTasteFromCompounds(amounts([["allyl_isothiocyanate", 80]]));
    const sichuan = draftTasteFromCompounds(amounts([["hydroxy_alpha_sanshool", 80]]));
    expect(ginger.taste.spicy).toBe(0);
    expect(garlic.taste.spicy).toBe(0);
    expect(mustard.taste.spicy).toBe(0);
    expect(sichuan.taste.spicy).toBe(0);
    expect(ginger.evidence.spicy).toBe(false);
  });

  it("keeps caffeine bitter quieter than quinine at the same milligrams", () => {
    const coffee = draftTasteFromCompounds(amounts([["caffeine", 80]])).taste;
    const tonic = draftTasteFromCompounds(amounts([["quinine", 80]])).taste;
    expect(coffee.bitter).toBeGreaterThan(0);
    expect(tonic.bitter).toBeGreaterThan(coffee.bitter);
  });

  it("lets sugar suppress bitter and sour a little without wiping them", () => {
    const bitterOnly = draftTasteFromCompounds(amounts([["caffeine", 80]])).taste;
    const withSugar = draftTasteFromCompounds(
      amounts([
        ["caffeine", 80],
        ["sucrose", 12],
      ]),
    ).taste;
    expect(withSugar.bitter).toBeLessThan(bitterOnly.bitter);
    expect(withSugar.bitter).toBeGreaterThan(bitterOnly.bitter * 0.4);
  });

  it("ignores unknown ids and zero quantities instead of inventing a dimension", () => {
    const { taste, evidence } = draftTasteFromCompounds([
      { id: "not-a-real-molecule", amount: 9000 },
      { id: "sodium", amount: 0 },
    ]);
    expect(taste.salty).toBe(0);
    expect(evidence.salty).toBe(false);
    expect(Object.values(evidence).every((on) => !on)).toBe(true);
  });

  it("records evidence only for dimensions that had a quantified driver", () => {
    const { evidence } = draftTasteFromCompounds(
      amounts([
        ["sucrose", 5],
        ["sodium", 400],
      ]),
    );
    expect(evidence.sweet).toBe(true);
    expect(evidence.salty).toBe(true);
    expect(evidence.spicy).toBe(false);
    expect(evidence.bitter).toBe(false);
  });

  it("lets calibration add chili heat when labs scored a chili as sweet pepper", () => {
    const draft = draftTasteFromCompounds(amounts([["sucrose", 5]]));
    const chili = applyCalibration(draft, { sweet: 1, spicy: 8 }, "chili pepper");
    expect(chili.spicy).toBe(8);
    expect(chili.sweet).toBe(1);

    const ginger = applyCalibration(draft, { spicy: 8 }, "ginger");
    expect(ginger.spicy).toBe(0);
  });
});

describe("mergeCompoundLayers", () => {
  it("lets earlier layers win a compound class and keeps later-only classes", () => {
    const merged = mergeCompoundLayers([
      { amounts: [{ id: "glutamate", amount: 1600 }] },
      { amounts: [{ id: "tannin", amount: 80 }] },
      { amounts: [{ id: "capsaicin", amount: 20 }] },
      {
        amounts: [
          { id: "glutamate", amount: 50 },
          { id: "sucrose", amount: 4 },
        ],
      },
      { amounts: [{ id: "sodium", amount: 400 }] },
    ]);
    const byId = Object.fromEntries(merged.map((row) => [row.id, row.amount]));
    expect(byId.glutamate).toBe(1600);
    expect(byId.tannin).toBe(80);
    expect(byId.capsaicin).toBe(20);
    expect(byId.sucrose).toBe(4);
    expect(byId.sodium).toBe(400);
  });
});
