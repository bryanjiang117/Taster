export type TypewriterPhase = "type" | "hold" | "delete";

export type TypewriterState = {
  index: number;
  length: number;
  phase: TypewriterPhase;
};

export const DISH_PLACEHOLDERS = [
  "som tam",
  "ceviche",
  "mapo tofu",
  "shakshuka",
  "phở bò",
  "kimchi jjigae",
  "mole poblano",
  "jollof rice",
  "palak paneer",
  "tonkatsu",
  "pad thai",
  "ramen",
  "sushi",
  "tacos al pastor",
  "butter chicken",
  "gazpacho",
  "paella",
  "risotto",
  "lasagna",
  "borscht",
  "goulash",
  "falafel",
  "hummus",
  "biryani",
  "dal makhani",
  "tom yum",
  "green curry",
  "massaman curry",
  "banh mi",
  "bun cha",
  "bibimbap",
  "bulgogi",
  "jajangmyeon",
  "xiao long bao",
  "peking duck",
  "kung pao chicken",
  "hot pot",
  "gyoza",
  "okonomiyaki",
  "tempura",
  "miso soup",
  "onigiri",
  "pierogi",
  "schnitzel",
  "sauerbraten",
  "ratatouille",
  "bouillabaisse",
  "coq au vin",
  "croque monsieur",
  "quiche lorraine",
  "fish and chips",
  "shepherd's pie",
  "bangers and mash",
  "poutine",
  "clam chowder",
  "gumbo",
  "jambalaya",
  "fried chicken",
  "mac and cheese",
  "chili con carne",
  "empanadas",
  "arepas",
  "feijoada",
  "churrasco",
  "asado",
  "pupusas",
  "pozole",
  "enchiladas",
  "chiles rellenos",
  "tamales",
  "carnitas",
  "moussaka",
  "souvlaki",
  "gyro",
  "spanakopita",
  "baklava",
  "kebab",
  "shawarma",
  "mansaf",
  "tagine",
  "couscous",
  "harira",
  "injera",
  "doro wat",
  "egusi soup",
  "suya",
  "bobotie",
  "bunny chow",
  "nasi goreng",
  "satay",
  "rendang",
  "laksa",
  "hainanese chicken rice",
  "char kway teow",
  "adobo",
  "sinigang",
  "lechon",
  "pancit",
  "lumpia",
] as const;

/** Fisher–Yates shuffle; returns a new array. */
export function shufflePhrases(
  phrases: readonly string[],
  random: () => number = Math.random,
): string[] {
  const next = [...phrases];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

/** Shuffle everything after the first item so SSR and hydration can share it. */
export function shuffleRest(
  phrases: readonly string[],
  random: () => number = Math.random,
): string[] {
  if (phrases.length <= 1) return [...phrases];
  const [first, ...rest] = phrases;
  return [first!, ...shufflePhrases(rest, random)];
}

const DELAYS: Record<TypewriterPhase, number> = {
  type: 72,
  delete: 38,
  hold: 2200,
};

export function startTypewriter(): TypewriterState {
  return { index: 0, length: 0, phase: "type" };
}

export function typewriterText(
  state: TypewriterState,
  phrases: readonly string[],
): string {
  const phrase = phrases[state.index] ?? "";
  return phrase.slice(0, state.length);
}

export function delayForPhase(phase: TypewriterPhase): number {
  return DELAYS[phase];
}

export function stepTypewriter(
  state: TypewriterState,
  phrases: readonly string[],
): TypewriterState {
  const phrase = phrases[state.index] ?? "";

  if (state.phase === "type") {
    const length = Math.min(state.length + 1, phrase.length);
    return {
      ...state,
      length,
      phase: length >= phrase.length ? "hold" : "type",
    };
  }

  if (state.phase === "hold") {
    return { ...state, phase: "delete" };
  }

  const length = Math.max(state.length - 1, 0);
  if (length > 0) {
    return { ...state, length, phase: "delete" };
  }

  return {
    index: phrases.length === 0 ? 0 : (state.index + 1) % phrases.length,
    length: 0,
    phase: "type",
  };
}
