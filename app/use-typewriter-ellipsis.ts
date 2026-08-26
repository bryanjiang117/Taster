"use client";

import { useEffect, useState } from "react";
import {
  startTypewriter,
  stepTypewriter,
  typewriterText,
  type TypewriterState,
} from "@/lib/ui/typewriter-placeholder";

const ELLIPSIS = ["..."];

const DELAYS = {
  type: 72,
  delete: 38,
  hold: 480,
} as const;

export function useTypewriterEllipsis(ready: boolean): {
  text: string;
  reveal: boolean;
} {
  const [state, setState] = useState<TypewriterState>(startTypewriter);
  const [typedFull, setTypedFull] = useState(false);
  const [reduced, setReduced] = useState(false);

  const reveal = ready && (reduced || typedFull);
  const active = !reveal;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (state.phase === "hold" && state.length > 0) setTypedFull(true);
  }, [state]);

  useEffect(() => {
    if (!active || reduced) return;

    const delay =
      state.phase === "type" && state.length === 0 ? 0 : DELAYS[state.phase];
    const timer = window.setTimeout(() => {
      setState((current) => stepTypewriter(current, ELLIPSIS));
    }, delay);

    return () => window.clearTimeout(timer);
  }, [active, reduced, state]);

  return {
    text: reduced ? "..." : typewriterText(state, ELLIPSIS),
    reveal,
  };
}
