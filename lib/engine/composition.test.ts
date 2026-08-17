import { describe, expect, it } from "vitest";
import { tasteFromComposition } from "./composition";

describe("composition → taste mapping", () => {
  it("maps high sodium to high saltiness", () => {
    const soy = tasteFromComposition({ sodiumMgPer100g: 5500 });
    expect(soy.salty).toBeGreaterThan(8);
  });

  it("maps sugar grams to sweetness", () => {
    const honey = tasteFromComposition({ sugarGPer100g: 80 });
    expect(honey.sweet).toBeGreaterThan(8);
    const water = tasteFromComposition({ sugarGPer100g: 0 });
    expect(water.sweet).toBe(0);
  });

  it("maps low pH to sourness", () => {
    const lemon = tasteFromComposition({ pH: 2.3 });
    expect(lemon.sour).toBeGreaterThan(8);
    const vinegar = tasteFromComposition({ pH: 2.5 });
    expect(vinegar.sour).toBeGreaterThan(8);
    const tomato = tasteFromComposition({ pH: 4.3 });
    expect(tomato.sour).toBeGreaterThan(3);
    expect(tomato.sour).toBeLessThan(6);
  });

  it("does not treat typical food pH as sour", () => {
    const whitePepper = tasteFromComposition({ pH: 5.5 });
    expect(whitePepper.sour).toBe(0);
    const meat = tasteFromComposition({ pH: 6.0 });
    expect(meat.sour).toBe(0);
    const water = tasteFromComposition({ pH: 7 });
    expect(water.sour).toBe(0);
  });

  it("maps glutamate to umami", () => {
    const kombu = tasteFromComposition({ glutamateMgPer100g: 1600 });
    expect(kombu.umami).toBeGreaterThan(8);
  });

  it("maps scoville to spiciness with a log scale", () => {
    const jalapeno = tasteFromComposition({ scoville: 5000 });
    const habanero = tasteFromComposition({ scoville: 200000 });
    expect(jalapeno.spicy).toBeGreaterThan(3);
    expect(jalapeno.spicy).toBeLessThan(7);
    expect(habanero.spicy).toBeGreaterThan(jalapeno.spicy);
    expect(habanero.spicy).toBeLessThanOrEqual(10);
  });
});
