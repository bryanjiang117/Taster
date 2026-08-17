"use client";

import { useEffect, useState } from "react";
import {
  delayForPhase,
  DISH_PLACEHOLDERS,
  stepTypewriter,
  type TypewriterState,
  typewriterText,
} from "@/lib/ui/typewriter-placeholder";

function heldPhrase(index: number): TypewriterState {
  const phrase = DISH_PLACEHOLDERS[index] ?? "";
  return { index, length: phrase.length, phase: "hold" };
}

export function useDishPlaceholder(active: boolean): string {
  const [state, setState] = useState<TypewriterState>(() => heldPhrase(0));
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!active) {
      setState((current) => heldPhrase(current.index));
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const delay = reduced ? delayForPhase("hold") : delayForPhase(state.phase);
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (reduced) {
          const next = (current.index + 1) % DISH_PLACEHOLDERS.length;
          return heldPhrase(next);
        }
        return stepTypewriter(current, DISH_PLACEHOLDERS);
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [active, reduced, state]);

  if (!active) {
    return DISH_PLACEHOLDERS[state.index] ?? "";
  }

  return typewriterText(state, DISH_PLACEHOLDERS);
}
