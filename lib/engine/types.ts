import type { ChemistrySourceId } from "./identity";

export const TASTE_DIMENSIONS = [
  "sweet",
  "sour",
  "salty",
  "spicy",
  "umami",
  "bitter",
] as const;

export type TasteDimension = (typeof TASTE_DIMENSIONS)[number];

export type TasteProfile = Record<TasteDimension, number>;

export type ConfidenceSource = "measured" | "nutrition" | "recipe" | "llm";

export type ProcessType =
  | "evaporation"
  | "absorption"
  | "expansion"
  | "discard"
  | "fat_separation"
  | "diffusion"
  | "fermentation"
  | "aging"
  | "drying"
  | "roasting"
  | "reduction"
  | "pickling"
  | "boiling";

export type ProcessEffect = {
  type: ProcessType;
  volumeDeltaMl?: number;
  discardedSolubleFraction?: number;
};

/** Whether the ingredient is cooked/mixed into the dish (`in`) or only a side/serving item (`out`). */
export type IngredientRole = "in" | "out";

/** Prep-aware mix knobs from the recipe extract. Defaults are identity. */
export type IngredientMix = {
  /** Fraction of listed amount that contributes to the final served dish (1 = as listed). */
  intensity?: number;
  /** Per-dimension multipliers from how it was prepared. */
  scale?: Partial<TasteProfile>;
  /** 1–2 word reason when intensity ≠ 1 (marinade, evaporated, absorbed, …). */
  why?: string;
};

export type IngredientQuantity = {
  name: string;
  volumeMl: number;
  /** Defaults to `in` when omitted (legacy extracts). */
  role?: IngredientRole;
  mix?: IngredientMix;
  /**
   * Primary seasoner with a clearly ambiguous amount (to taste / as needed /
   * missing). Triggers a post-mix Gemini adjustment of that seasoner's dimension.
   */
  quantityAmbiguous?: boolean;
};

export type ResolvedIngredient = {
  ingredient: string;
  taste: TasteProfile;
  derivedFrom: string[];
  processing: string[];
  confidence: number;
  source: ConfidenceSource;
  /** Lab databases that supplied compound data, when resolved via chemistry. */
  measuredFrom?: ChemistrySourceId[];
  reasoning?: string;
};

export type Recipe = {
  title?: string;
  url?: string;
  language?: string;
  ingredients: IngredientQuantity[];
  processes?: ProcessEffect[];
  finalVolumeMl?: number;
};

export type RepresentativeIngredient = IngredientQuantity & {
  occurrence: { used: number; total: number };
};

export type DishOrigin = {
  dish: string;
  country: string;
  culture: string;
  nativeName: string;
  language: string;
  languageCode: string;
  searchQueries: string[];
};

export const MAX_RESOLUTION_DEPTH = 3;
