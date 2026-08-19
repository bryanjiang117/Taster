import { describe, expect, it } from "vitest";
import { FoodbDumpClient } from "./foodb";

describe("FoodbDumpClient", () => {
  const foodb = new FoodbDumpClient();

  it("finds carrot in the public dump without an API key", async () => {
    const hit = await foodb.search("carrot");
    expect(hit?.name.toLowerCase()).toContain("carrot");
    const amounts = await foodb.compounds(hit!.id);
    const sucrose = amounts.find((row) => row.id === "sucrose");
    expect(sucrose?.amount).toBeGreaterThan(0.5);
    expect(sucrose?.amount).toBeLessThan(50);
  });

  it("matches ordinary grocery names onto FooDB titles", async () => {
    const onion = await foodb.search("onion");
    expect(onion?.name.toLowerCase()).toMatch(/onion/);
    const soy = await foodb.search("soy sauce");
    expect(soy?.name.toLowerCase()).toContain("soy");
    const pepper = await foodb.search("black pepper");
    expect(pepper?.name.toLowerCase()).toMatch(/pepper/);
  });

  it("falls back from juice/paste forms to the parent food", async () => {
    const lime = await foodb.search("lime juice");
    expect(lime?.name.toLowerCase()).toBe("lime");
    const acids = await foodb.compounds(lime!.id);
    expect(acids.some((row) => row.id === "citric_acid" || row.id === "malic_acid")).toBe(
      true,
    );
    const tamarind = await foodb.search("tamarind paste");
    expect(tamarind?.name.toLowerCase()).toBe("tamarind");
    const tartaric = (await foodb.compounds(tamarind!.id)).find(
      (row) => row.id === "tartaric_acid",
    );
    expect(tartaric?.amount).toBeGreaterThan(1000);
  });

  it("does not treat chili oil as palm oil or chili bean paste as generic bean", async () => {
    const chiliOil = await foodb.search("chili oil");
    expect(chiliOil?.name.toLowerCase()).not.toMatch(/palm|canola/);
    const beans = await foodb.search("fermented black bean");
    expect(beans?.name.toLowerCase()).not.toBe("bean");
  });

  it("still maps black pepper onto the spice, not a random pepper plant", async () => {
    const pepper = await foodb.search("black pepper");
    expect(pepper?.name.toLowerCase()).toMatch(/pepper/);
  });

  it("returns nothing for a name that is not a food in the dump", async () => {
    await expect(foodb.search("xyzzy not a food")).resolves.toBeNull();
  });
});
