import type { ConfidenceSource } from "./types";

const SOURCE_SCORES: Record<ConfidenceSource, number> = {
  measured: 0.95,
  nutrition: 0.8,
  recipe: 0.55,
  llm: 0.3,
};

export function sourceConfidence(source: ConfidenceSource): number {
  return SOURCE_SCORES[source];
}

export function dishConfidence(
  parts: Array<{ confidence: number; contribution: number }>,
  options?: { flavorInconsistency?: number },
): number {
  const weight = parts.reduce((sum, part) => sum + part.contribution, 0);
  if (weight <= 0) return 0;

  const weighted =
    parts.reduce((sum, part) => sum + part.confidence * part.contribution, 0) /
    weight;

  const inconsistency = clamp01(options?.flavorInconsistency ?? 0);
  const agreement = 1 - inconsistency;
  return clamp01(weighted * (0.25 + 0.75 * agreement));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
