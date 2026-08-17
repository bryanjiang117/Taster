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
] as const;

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
