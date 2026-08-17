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

export type IngredientQuantity = {
  name: string;
  volumeMl: number;
  /** Defaults to `in` when omitted (legacy extracts). */
  role?: IngredientRole;
};

export type ResolvedIngredient = {
  ingredient: string;
  taste: TasteProfile;
  derivedFrom: string[];
  processing: string[];
  confidence: number;
  source: ConfidenceSource;
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
