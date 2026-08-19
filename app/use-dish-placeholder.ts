"use client";

import { useEffect, useState } from "react";
import {
  delayForPhase,
  DISH_PLACEHOLDERS,
  shufflePhrases,
  stepTypewriter,
  type TypewriterState,
  typewriterText,
} from "@/lib/ui/typewriter-placeholder";

function heldPhrase(
  phrases: readonly string[],
  index: number,
): TypewriterState {
  const phrase = phrases[index] ?? "";
  return { index, length: phrase.length, phase: "hold" };
}

export function useDishPlaceholder(active: boolean): string {
  const [phrases, setPhrases] = useState<readonly string[]>(DISH_PLACEHOLDERS);
  const [state, setState] = useState<TypewriterState>(() =>
    heldPhrase(DISH_PLACEHOLDERS, 0),
  );
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // Shuffle after mount so the first paint matches SSR, then start on a random dish.
    const shuffled = shufflePhrases(DISH_PLACEHOLDERS);
    setPhrases(shuffled);
    setState(heldPhrase(shuffled, 0));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!active) {
      setState((current) => heldPhrase(phrases, current.index));
    }
  }, [active, phrases]);

  useEffect(() => {
    if (!active) return;

    const delay = reduced ? delayForPhase("hold") : delayForPhase(state.phase);
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (reduced) {
          const next = (current.index + 1) % phrases.length;
          return heldPhrase(phrases, next);
        }
        return stepTypewriter(current, phrases);
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [active, phrases, reduced, state]);

  if (!active) {
    return phrases[state.index] ?? "";
  }

  return typewriterText(state, phrases);
}
