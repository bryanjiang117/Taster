import { tasteFromComposition, type CompositionData } from "./composition";
import { weightedTasteFromIngredients } from "./concentration";
import { dishConfidence, sourceConfidence } from "./confidence";
import { normalizeIngredientName } from "./normalize";
import { applyProcessingToTaste } from "./processing";
import { IngredientStore } from "./store";
import { clampTaste, emptyTaste } from "./taste";
import {
  MAX_RESOLUTION_DEPTH,
  type ConfidenceSource,
  type ResolvedIngredient,
  type TasteProfile,
} from "./types";

export type UnknownLookup =
  | {
      kind: "composition";
      composition: CompositionData;
      processing?: string[];
      derivedFrom?: string[];
    }
  | {
      kind: "decomposition";
      parts: Array<{ name: string; volumeMl: number }>;
      processing?: string[];
    }
  | {
      kind: "llm";
      taste: TasteProfile;
      processing?: string[];
      reasoning?: string;
    };

export type ResolveDeps = {
  store: IngredientStore;
  maxDepth?: number;
  lookupUnknown: (name: string, depth: number) => Promise<UnknownLookup>;
};

export async function resolveIngredient(
  name: string,
  deps: ResolveDeps,
  depth = 0,
): Promise<ResolvedIngredient> {
  const canonical = normalizeIngredientName(name);
  const cached = deps.store.get(canonical);
  if (cached) return cached;

  const maxDepth = deps.maxDepth ?? MAX_RESOLUTION_DEPTH;

  if (depth >= maxDepth) {
    const fallback = await deps.lookupUnknown(canonical, depth);
    const resolved = fromLookup(canonical, fallback, [], "llm");
    deps.store.put(resolved);
    return resolved;
  }

  const lookup = await deps.lookupUnknown(canonical, depth);

  if (lookup.kind === "composition") {
    const taste = applyProcessingToTaste(
      tasteFromComposition(lookup.composition),
      lookup.processing ?? [],
    );
    const resolved: ResolvedIngredient = {
      ingredient: canonical,
      taste: clampTaste(taste),
      derivedFrom: lookup.derivedFrom ?? [],
      processing: lookup.processing ?? [],
      confidence: sourceConfidence("measured"),
      source: "measured",
      reasoning: "Mapped from composition data",
    };
    deps.store.put(resolved);
    return resolved;
  }

  if (lookup.kind === "decomposition") {
    const children: ResolvedIngredient[] = [];
    for (const part of lookup.parts) {
      children.push(await resolveIngredient(part.name, deps, depth + 1));
    }

    const combined = weightedTasteFromIngredients(
      lookup.parts.map((part, i) => ({
        volumeMl: part.volumeMl,
        taste: children[i]?.taste ?? emptyTaste(),
      })),
      lookup.parts.reduce((sum, part) => sum + part.volumeMl, 0) || 1,
    );

    const taste = applyProcessingToTaste(combined, lookup.processing ?? []);
    const contributionParts = children.map((child, i) => ({
      confidence: child.confidence,
      contribution: lookup.parts[i]?.volumeMl ?? 1,
    }));

    const resolved: ResolvedIngredient = {
      ingredient: canonical,
      taste: clampTaste(taste),
      derivedFrom: lookup.parts.map((part) => normalizeIngredientName(part.name)),
      processing: lookup.processing ?? [],
      confidence: dishConfidence(contributionParts),
      source: worstSource(children.map((c) => c.source)),
      reasoning: `Decomposed into ${lookup.parts.map((p) => p.name).join(", ")}`,
    };
    deps.store.put(resolved);
    return resolved;
  }

  const resolved = fromLookup(canonical, lookup, lookup.processing ?? [], "llm");
  deps.store.put(resolved);
  return resolved;
}

function fromLookup(
  name: string,
  lookup: UnknownLookup,
  processing: string[],
  source: ConfidenceSource,
): ResolvedIngredient {
  const taste =
    lookup.kind === "llm"
      ? applyProcessingToTaste(lookup.taste, lookup.processing ?? processing)
      : emptyTaste();

  return {
    ingredient: name,
    taste: clampTaste(taste),
    derivedFrom: [],
    processing: lookup.kind === "llm" ? (lookup.processing ?? processing) : processing,
    confidence: sourceConfidence(source),
    source,
    reasoning: lookup.kind === "llm" ? lookup.reasoning : undefined,
  };
}

function worstSource(sources: ConfidenceSource[]): ConfidenceSource {
  const order: ConfidenceSource[] = ["measured", "nutrition", "recipe", "llm"];
  let worst: ConfidenceSource = "measured";
  for (const source of sources) {
    if (order.indexOf(source) > order.indexOf(worst)) worst = source;
  }
  if (sources.length === 0) return "recipe";
  return worst;
}
