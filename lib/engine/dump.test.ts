import { describe, expect, it } from "vitest";
import { FctDumpClient } from "./fct";
import { DukeDumpClient } from "./duke";
import { PhenolDumpClient } from "./phenol";
import { UmamiDumpClient } from "./umamidb";

describe("bundled chemistry dumps", () => {
  it("prefers the origin-matched FAO row", async () => {
    const client = new FctDumpClient();
    const africa = await client.candidates("egusi", {
      culture: "Yoruba",
      country: "Nigeria",
    });
    expect(africa[0]?.name).toMatch(/egusi|citrullus|melon seed/i);
    const sodium = africa[0] ? await client.compounds(africa[0].id) : [];
    expect(sodium.some((row) => row.id === "sodium" && row.amount > 0)).toBe(
      true,
    );
  });

  it("finds sorghum and fonio in the FAO nutrient dump", async () => {
    const client = new FctDumpClient();
    const sorghum = await client.candidates("sorghum", {
      culture: "Yoruba",
      country: "Nigeria",
    });
    const fonio = await client.candidates("fonio", { country: "Burkina Faso" });
    expect(sorghum[0]?.name).toMatch(/sorghum/i);
    expect(fonio[0]?.name).toMatch(/fonio/i);
  });

  it("finds tea and blueberry polyphenols in the Phenol-Explorer dump", async () => {
    const phenol = new PhenolDumpClient();
    const tea = await phenol.candidates("green tea");
    const berry = await phenol.candidates("blueberry");
    const tannin = tea[0] ? await phenol.compounds(tea[0].id) : [];
    expect(tea[0]?.name).toMatch(/tea/i);
    expect(berry[0]?.name).toMatch(/blueberr/i);
    expect(tannin.some((row) => row.id === "tannin" && row.amount > 0)).toBe(
      true,
    );
  });

  it("loads quantified umami and duke rows", async () => {
    const umami = new UmamiDumpClient();
    const duke = new DukeDumpClient();
    const kombu = await umami.candidates("kombu");
    const pepper = await duke.candidates("black pepper");
    const horseradish = await duke.candidates("horseradish");
    const nori = await umami.candidates("nori");
    const glu = kombu[0] ? await umami.compounds(kombu[0].id) : [];
    const pungent = pepper[0] ? await duke.compounds(pepper[0].id) : [];
    const bitter = horseradish[0]
      ? await duke.compounds(horseradish[0].id)
      : [];
    const noriGlu = nori[0] ? await umami.compounds(nori[0].id) : [];
    expect(glu.some((row) => row.id === "glutamate" && row.amount > 1000)).toBe(
      true,
    );
    expect(pungent.some((row) => row.id === "piperine" && row.amount > 0)).toBe(
      true,
    );
    expect(horseradish[0]?.name).toMatch(/horseradish|armoracia/i);
    expect(
      bitter.some(
        (row) =>
          (row.id === "sinigrin" || row.id === "allyl_isothiocyanate") &&
          row.amount > 0,
      ),
    ).toBe(true);
    expect(noriGlu.some((row) => row.id === "glutamate" && row.amount > 0)).toBe(
      true,
    );
  });

  it("maps grocery chili peppers to fruit capsaicin, not seed", async () => {
    const duke = new DukeDumpClient();
    const { draftTasteFromCompounds } = await import("./chemistry");
    const thai = await duke.candidates("thai chili");
    expect(thai[0]?.name).toMatch(/frutescens.*fruit/i);
    const thaiDraft = draftTasteFromCompounds(
      thai[0] ? await duke.compounds(thai[0].id) : [],
    );
    expect(thaiDraft.taste.spicy).toBeGreaterThan(7);

    const generic = await duke.candidates("chili");
    expect(generic[0]?.name).toMatch(/annuum.*fruit/i);
    const genericDraft = draftTasteFromCompounds(
      generic[0] ? await duke.compounds(generic[0].id) : [],
    );
    expect(genericDraft.taste.spicy).toBeGreaterThan(5);
  });

  it("does not match prepared dishes on a single-token chili query", async () => {
    const client = new FctDumpClient();
    const hits = await client.candidates("chili");
    expect(hits.every((hit) => !/con carne|preemball/i.test(hit.name))).toBe(
      true,
    );
  });
});
