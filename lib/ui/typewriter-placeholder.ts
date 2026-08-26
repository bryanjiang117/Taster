export type TypewriterPhase = "type" | "hold" | "delete";

export type TypewriterState = {
  index: number;
  length: number;
  phase: TypewriterPhase;
};

export const DISH_PLACEHOLDERS = [
  "green papaya salad",
  "peruvian ceviche",
  "mapo tofu",
  "shakshuka",
  "phở bò",
  "kimchi jjigae",
  "chicken mole poblano",
  "nigerian jollof rice",
  "pad thai",
  "tonkotsu ramen",
  "unagi don",
  "tacos al pastor",
  "butter chicken",
  "gazpacho",
  "pasta puttanesca",
  "ukrainian borscht",
  "hungarian goulash",
  "chana masala",
  "hyderabadi chicken biryani",
  "tom yum goong",
  "chicken green curry",
  "pork banh mi",
  "thai basil chicken",
  "beef bibimbap",
  "beef bulgogi",
  "sundubu jjigae",
  "peking duck",
  "kung pao chicken",
  "hot and sour soup",
  "dan dan noodles",
  "fish-fragrant eggplant",
  "xinjiang cumin lamb",
  "takoyaki",
  "sukiyaki",
  "salade niçoise",
  "choucroute garnie",
  "duck à l'orange",
  "gambas al ajillo",
  "patatas bravas",
  "chicken and sausage gumbo",
  "cajun jambalaya",
  "crawfish etouffee",
  "cochinita pibil",
  "steak with chimichurri",
  "brazilian feijoada",
  "lomo saltado",
  "jerk chicken",
  "jamaican curry goat",
  "pozole rojo",
  "chicken enchiladas verdes",
  "elote",
  "chicken tinga",
  "aguachile",
  "lamb gyro",
  "chicken shawarma",
  "lemon chicken tagine",
  "adana kebab",
  "lahmacun",
  "fattoush",
  "muhammara",
  "doro wat",
  "kitfo",
  "piri piri chicken",
  "chicken yassa",
  "nasi goreng",
  "nasi lemak",
  "gado gado",
  "beef rendang",
  "curry laksa",
  "assam laksa",
  "khao soi",
  "chicken adobo",
  "pork sisig",
  "lamb rogan josh",
  "tandoori chicken",
  "chicken chettinad",
  "pork vindaloo",
  "tteokbokki",
  "jjamppong",
  "larb gai",
  "moqueca",
  "koshari",
  "ropa vieja",
  "pasta all'amatriciana",
  "orecchiette with broccoli rabe",
  "pizza diavola",
  "avgolemono",
  "horiatiki",
  "bigos",
  "bun bo hue",
  "canh chua",
  "anticuchos",
  "mojo roast pork",
] as const;

/** Fisher–Yates shuffle of the whole list, including the starting phrase. */
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

const DELAYS: Record<TypewriterPhase, number> = {
  type: 72,
  delete: 38,
  hold: 3000,
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
