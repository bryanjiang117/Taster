import { describe, expect, it } from "vitest";
import {
  delayForPhase,
  DISH_PLACEHOLDERS,
  shufflePhrases,
  startTypewriter,
  stepTypewriter,
  typewriterText,
} from "./typewriter-placeholder";

const phrases = ["pho", "mole"];

describe("stepTypewriter", () => {
  it("types one character at a time, then holds", () => {
    let state = startTypewriter();
    expect(typewriterText(state, phrases)).toBe("");

    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("p");
    expect(state.phase).toBe("type");

    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("ph");

    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("pho");
    expect(state.phase).toBe("hold");
  });

  it("deletes the held phrase then types the next one", () => {
    let state = startTypewriter();
    while (state.phase !== "hold") {
      state = stepTypewriter(state, phrases);
    }

    state = stepTypewriter(state, phrases);
    expect(state.phase).toBe("delete");
    expect(typewriterText(state, phrases)).toBe("pho");

    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("ph");
    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("p");
    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("");
    expect(state.phase).toBe("type");
    expect(phrases[state.index]).toBe("mole");

    state = stepTypewriter(state, phrases);
    expect(typewriterText(state, phrases)).toBe("m");
  });

  it("wraps back to the first phrase", () => {
    let state = startTypewriter();
    for (let i = 0; i < 20; i++) {
      state = stepTypewriter(state, phrases);
    }
    expect(phrases[state.index]).toBe("pho");
  });
});

describe("delayForPhase", () => {
  it("holds longer than it types or deletes", () => {
    expect(delayForPhase("hold")).toBeGreaterThan(delayForPhase("type"));
    expect(delayForPhase("hold")).toBeGreaterThan(delayForPhase("delete"));
    expect(delayForPhase("delete")).toBeLessThan(delayForPhase("type"));
  });
});

describe("shufflePhrases", () => {
  it("keeps every phrase exactly once", () => {
    const shuffled = shufflePhrases(DISH_PLACEHOLDERS, () => 0.42);
    expect(shuffled).toHaveLength(DISH_PLACEHOLDERS.length);
    expect(new Set(shuffled).size).toBe(DISH_PLACEHOLDERS.length);
    expect([...shuffled].sort()).toEqual([...DISH_PLACEHOLDERS].sort());
  });

  it("can put a later phrase first", () => {
    // random() === 0 always picks j = 0, so the last item moves forward.
    const shuffled = shufflePhrases(["a", "b", "c"], () => 0);
    expect(shuffled[0]).not.toBe("a");
    expect(shuffled).toEqual(["b", "c", "a"]);
  });
});

