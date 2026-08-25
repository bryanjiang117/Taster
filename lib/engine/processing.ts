import { clampTaste, scaleTaste, TASTE_LEAF_MAX } from "./taste";
import type { TasteProfile } from "./types";

const PROCESS_MULTIPLIERS: Record<string, Partial<TasteProfile>> = {
  fermentation: { umami: 1.3, sour: 1.1, salty: 1.05 },
  aging: { umami: 1.15, bitter: 1.1 },
  drying: { umami: 1.2, salty: 1.15, sweet: 1.1 },
  roasting: { bitter: 1.25, umami: 1.15, sweet: 0.9 },
  reduction: { salty: 1.1, umami: 1.1, sweet: 1.1, sour: 1.1 },
  pickling: { sour: 1.4, salty: 1.1 },
  boiling: { bitter: 0.8, salty: 0.9 },
};

export function applyProcessingToTaste(
  taste: TasteProfile,
  processes: string[],
): TasteProfile {
  let next = { ...taste };
  for (const process of processes) {
    const multipliers = PROCESS_MULTIPLIERS[process];
    if (!multipliers) continue;
    const scaled = { ...next };
    for (const [dim, factor] of Object.entries(multipliers)) {
      const key = dim as keyof TasteProfile;
      scaled[key] = next[key] * (factor ?? 1);
    }
    next = scaled;
  }
  return clampTaste(next, TASTE_LEAF_MAX);
}

export function applySolubleRetention(
  taste: TasteProfile,
  retention: number,
): TasteProfile {
  return clampTaste(scaleTaste(taste, retention));
}
