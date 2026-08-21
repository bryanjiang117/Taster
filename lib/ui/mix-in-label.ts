import type { FoundIngredient } from "@/lib/engine/found-ingredients";

/** Hover line when the ingredient does not fully contribute to the final dish. */
export function formatMixInLabel(item: FoundIngredient): string | null {
  const intensity = item.mixIntensity ?? 1;
  if (!item.out && intensity === 1) return null;

  const percent = item.out ? 0 : Math.round(intensity * 100);
  const why =
    item.mixWhy?.trim() ||
    (item.out
      ? "on the side"
      : intensity === 0
        ? "evaporated"
        : intensity > 1
          ? "concentrated"
          : undefined);

  return why ? `contributes: ${percent}% · ${why}` : `contributes: ${percent}%`;
}
