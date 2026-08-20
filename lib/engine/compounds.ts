import type { TasteDimension } from "./types";

export type CompoundClass =
  | "sugar"
  | "acid"
  | "sodium"
  | "glutamate"
  | "glutamate_bound"
  | "nucleotide"
  | "capsaicinoid"
  | "piperine"
  | "gingerol"
  | "isothiocyanate"
  | "allicin"
  | "sanshool"
  | "alkaloid_bitter"
  | "quinine"
  | "glucosinolate"
  | "tannin"
  | "limonoid"
  | "naringin";

export type CompoundDef = {
  id: string;
  aliases: string[];
  dimension: TasteDimension;
  class: CompoundClass;
  /** Amount in `unit` that sits mid-scale on the saturating curve. */
  tau: number;
  unit: "g_per_100g" | "mg_per_100g";
  /** Multiply amount before the curve (fructose sweeter than glucose). */
  potency: number;
};

export const COMPOUNDS: CompoundDef[] = [
  {
    id: "sucrose",
    aliases: ["sucrose", "table sugar", "saccharose"],
    dimension: "sweet",
    class: "sugar",
    tau: 7.5,
    unit: "g_per_100g",
    potency: 1,
  },
  {
    id: "glucose",
    aliases: ["glucose", "dextrose"],
    dimension: "sweet",
    class: "sugar",
    tau: 7.5,
    unit: "g_per_100g",
    potency: 0.7,
  },
  {
    id: "fructose",
    aliases: ["fructose", "levulose"],
    dimension: "sweet",
    class: "sugar",
    tau: 7.5,
    unit: "g_per_100g",
    potency: 1.2,
  },
  {
    id: "lactose",
    aliases: ["lactose", "milk sugar"],
    dimension: "sweet",
    class: "sugar",
    tau: 7.5,
    unit: "g_per_100g",
    potency: 0.16,
  },
  {
    id: "maltose",
    aliases: ["maltose", "malt sugar"],
    dimension: "sweet",
    class: "sugar",
    tau: 7.5,
    unit: "g_per_100g",
    potency: 0.5,
  },
  {
    id: "sorbitol",
    aliases: ["sorbitol", "glucitol"],
    dimension: "sweet",
    class: "sugar",
    tau: 7.5,
    unit: "g_per_100g",
    potency: 0.6,
  },
  {
    id: "citric_acid",
    aliases: ["citric acid", "citrate"],
    dimension: "sour",
    class: "acid",
    tau: 2500,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "malic_acid",
    aliases: ["malic acid", "malate"],
    dimension: "sour",
    class: "acid",
    tau: 2500,
    unit: "mg_per_100g",
    potency: 0.9,
  },
  {
    id: "acetic_acid",
    aliases: ["acetic acid", "acetate", "vinegar acid"],
    dimension: "sour",
    class: "acid",
    tau: 2500,
    unit: "mg_per_100g",
    potency: 1.35,
  },
  {
    id: "lactic_acid",
    aliases: ["lactic acid", "lactate"],
    dimension: "sour",
    class: "acid",
    tau: 2500,
    unit: "mg_per_100g",
    potency: 0.7,
  },
  {
    id: "tartaric_acid",
    aliases: ["tartaric acid", "tartrate"],
    dimension: "sour",
    class: "acid",
    tau: 2500,
    unit: "mg_per_100g",
    potency: 1.1,
  },
  {
    id: "ascorbic_acid",
    aliases: ["ascorbic acid", "vitamin c"],
    dimension: "sour",
    class: "acid",
    tau: 2500,
    unit: "mg_per_100g",
    potency: 0.5,
  },
  {
    id: "sodium",
    aliases: ["sodium", "na", "salt"],
    dimension: "salty",
    class: "sodium",
    tau: 900,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "potassium",
    aliases: ["potassium", "k", "potassium chloride"],
    dimension: "salty",
    class: "sodium",
    tau: 900,
    unit: "mg_per_100g",
    potency: 0.35,
  },
  {
    id: "glutamate",
    aliases: ["glutamate", "free glutamate", "msg", "monosodium glutamate", "l-glutamic acid"],
    dimension: "umami",
    class: "glutamate",
    tau: 450,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "aspartate",
    aliases: ["aspartate", "free aspartate", "aspartic acid", "l-aspartic acid"],
    dimension: "umami",
    class: "glutamate",
    tau: 450,
    unit: "mg_per_100g",
    potency: 0.3,
  },
  {
    id: "glutamic_acid_bound",
    aliases: ["glutamic acid", "protein glutamic acid"],
    dimension: "umami",
    class: "glutamate_bound",
    tau: 450,
    unit: "mg_per_100g",
    potency: 0.04,
  },
  {
    id: "imp",
    aliases: ["imp", "inosinate", "inosine monophosphate", "disodium inosinate"],
    dimension: "umami",
    class: "nucleotide",
    tau: 50,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "gmp",
    aliases: ["gmp", "guanylate", "guanosine monophosphate", "disodium guanylate"],
    dimension: "umami",
    class: "nucleotide",
    tau: 50,
    unit: "mg_per_100g",
    potency: 2.3,
  },
  {
    id: "amp",
    aliases: ["amp", "adenylate", "adenosine monophosphate"],
    dimension: "umami",
    class: "nucleotide",
    tau: 50,
    unit: "mg_per_100g",
    potency: 0.5,
  },
  {
    id: "capsaicin",
    aliases: ["capsaicin", "capsaicinoid", "dihydrocapsaicin"],
    dimension: "spicy",
    class: "capsaicinoid",
    tau: 12,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "piperine",
    aliases: ["piperine"],
    dimension: "spicy",
    class: "piperine",
    tau: 384000,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "gingerol",
    aliases: ["gingerol", "6-gingerol", "shogaol", "6-shogaol"],
    dimension: "spicy",
    class: "gingerol",
    tau: 800,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "allyl_isothiocyanate",
    aliases: ["allyl isothiocyanate", "aitc", "mustard oil"],
    dimension: "spicy",
    class: "isothiocyanate",
    tau: 40,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "allicin",
    aliases: ["allicin", "diallyl thiosulfinate"],
    dimension: "spicy",
    class: "allicin",
    tau: 150,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "hydroxy_alpha_sanshool",
    aliases: ["hydroxy-alpha-sanshool", "sanshool", "hydroxy-α-sanshool"],
    dimension: "spicy",
    class: "sanshool",
    tau: 80,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "caffeine",
    aliases: ["caffeine"],
    dimension: "bitter",
    class: "alkaloid_bitter",
    tau: 90,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "theobromine",
    aliases: ["theobromine"],
    dimension: "bitter",
    class: "alkaloid_bitter",
    tau: 140,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "quinine",
    aliases: ["quinine"],
    dimension: "bitter",
    class: "quinine",
    tau: 25,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "naringin",
    aliases: ["naringin"],
    dimension: "bitter",
    class: "naringin",
    tau: 50,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "limonin",
    aliases: ["limonin", "limonoid"],
    dimension: "bitter",
    class: "limonoid",
    tau: 8,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "sinigrin",
    aliases: ["sinigrin", "glucosinolate"],
    dimension: "bitter",
    class: "glucosinolate",
    tau: 60,
    unit: "mg_per_100g",
    potency: 1,
  },
  {
    id: "tannin",
    aliases: ["tannin", "tannic acid", "polyphenol", "catechin", "epicatechin"],
    dimension: "bitter",
    class: "tannin",
    tau: 200,
    unit: "mg_per_100g",
    potency: 1,
  },
];

const BY_ID = new Map(COMPOUNDS.map((row) => [row.id, row]));
const BY_ALIAS = new Map<string, CompoundDef>();
for (const row of COMPOUNDS) {
  BY_ALIAS.set(row.id, row);
  for (const alias of row.aliases) {
    BY_ALIAS.set(normalizeCompoundName(alias), row);
  }
}

export function normalizeCompoundName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function findCompound(idOrName: string): CompoundDef | undefined {
  const trimmed = idOrName.trim();
  return BY_ID.get(trimmed) ?? BY_ALIAS.get(normalizeCompoundName(trimmed));
}
