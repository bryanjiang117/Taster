import { CHEMISTRY_SOURCE_LABELS, type ChemistrySourceId } from "@/lib/engine/identity";
import type { ConfidenceSource } from "@/lib/engine/types";

export type IngredientProvenance = {
  source?: ConfidenceSource;
  measuredFrom?: ChemistrySourceId[];
  reasoning?: string;
  confidence?: number;
};

export function formatIngredientProvenance(item: IngredientProvenance): string | null {
  if (!item.source) return null;

  const pct =
    item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : "";

  if (item.source === "recipe") {
    const detail = item.reasoning?.replace(/^Tasted from /i, "") ?? "recipes";
    return `From recipes · ${detail}${pct}`;
  }

  if (item.source === "llm") {
    return `Estimated · Gemini${pct}`;
  }

  const databases = formatDatabases(item.measuredFrom);
  if (databases) {
    return `Measured · ${databases}${pct}`;
  }

  if (item.reasoning === "Mapped from measured food compounds") {
    return `Measured · lab databases${pct}`;
  }

  if (item.reasoning === "Mapped from composition data") {
    return `Measured · composition data${pct}`;
  }

  return `Measured · Taster catalog${pct}`;
}

function formatDatabases(sources: ChemistrySourceId[] | undefined): string | null {
  if (!sources?.length) return null;
  return sources.map((id) => CHEMISTRY_SOURCE_LABELS[id]).join(", ");
}
