import { normalizeIngredientName } from "./normalize";
import type {
  IngredientMix,
  IngredientQuantity,
  ProcessEffect,
  Recipe,
} from "./types";

const BULK_OIL_SHARE = 0.12;
const BULK_WATER_SHARE = 0.12;
/** Flavored cooking liquids keep this much contribution after full absorb/evaporate. */
const FLAVORED_LIQUID_FLOOR = 0.25;
/** Plain water below this remaining fraction no longer dilutes the dish. */
const TRACE_WATER = 0.2;

/** Finishing / flavor oils stay in the bowl even when the listed amount is large. */
const FLAVOR_OIL =
  /\b(chili|sesame|truffle|olive|walnut|pumpkin seed|chili crisp|chile)\s+oil\b/;

/** Neutral fry/poach oil that is normally drained — not the served dish. */
const NEUTRAL_OIL =
  /\b(vegetable|canola|peanut|sunflower|corn|grapeseed|rapeseed|neutral|cooking|deep.?fry)\s+oil\b|^oil$/;

const PLAIN_WATER =
  /^(water|cold water|hot water|warm water|tap water|boiling water)$/;

const FLAVORED_COOKING_LIQUID =
  /\b(stock|broth|bouillon|dashi|fumet|wine|beer|sake|mirin|cider)\b/;

const GRAIN =
  /\b(rice|arborio|bomba|carnaroli|risotto|pasta|noodle|orzo|couscous|quinoa|barley|farro|bulgur|polenta)\b/;

export function isBulkNeutralCookingOil(name: string): boolean {
  const n = normalizeIngredientName(name);
  if (!n) return false;
  if (FLAVOR_OIL.test(n)) return false;
  return NEUTRAL_OIL.test(n);
}

export function isPlainCookingWater(name: string): boolean {
  return PLAIN_WATER.test(normalizeIngredientName(name));
}

export function isFlavoredCookingLiquid(name: string): boolean {
  const n = normalizeIngredientName(name);
  if (!n || isPlainCookingWater(n)) return false;
  return FLAVORED_COOKING_LIQUID.test(n);
}

function recipeHasGrain(recipe: Recipe): boolean {
  return recipe.ingredients.some((item) =>
    GRAIN.test(normalizeIngredientName(item.name)),
  );
}

/** Infer mix.intensity when extract omitted prep. Bulk drained fry oil → 0. */
export function inferDiscardedCookingMedium(
  ingredient: IngredientQuantity,
  recipeVolumeMl: number,
): IngredientMix | undefined {
  const existing = ingredient.mix;
  if (existing?.intensity === 0) return existing;
  // Respect explicit concentration (>1) or non-default intensity choices.
  if (existing?.intensity != null && existing.intensity !== 1) return existing;

  if (ingredient.role === "out" || recipeVolumeMl <= 0) return existing;

  const share = ingredient.volumeMl / recipeVolumeMl;
  if (share < BULK_OIL_SHARE) return existing;

  if (isBulkNeutralCookingOil(ingredient.name)) {
    return {
      ...existing,
      intensity: 0,
      why: existing?.why ?? "drained",
    };
  }

  return existing;
}

function liquidLossMl(processes: ProcessEffect[] | undefined): {
  lost: number;
  mostlyEvaporation: boolean;
} {
  let evaporated = 0;
  let absorbed = 0;
  for (const effect of processes ?? []) {
    if (effect.type !== "evaporation" && effect.type !== "absorption") continue;
    const delta = effect.volumeDeltaMl ?? 0;
    if (delta >= 0) continue;
    if (effect.type === "evaporation") evaporated += -delta;
    else absorbed += -delta;
  }
  return {
    lost: evaporated + absorbed,
    mostlyEvaporation: evaporated >= absorbed,
  };
}

function cookingLiquids(recipe: Recipe): IngredientQuantity[] {
  return recipe.ingredients.filter((item) => {
    if (item.role === "out") return false;
    return (
      isPlainCookingWater(item.name) || isFlavoredCookingLiquid(item.name)
    );
  });
}

function intensityLocked(mix: IngredientMix | undefined): boolean {
  if (!mix) return false;
  if (mix.intensity === 0) return true;
  return mix.intensity != null && mix.intensity !== 1;
}

/**
 * Intensity = fraction of the listed amount that contributes to the final served
 * dish. Evaporated/absorbed water must not keep diluting seasonings.
 */
export function inferCookingLiquidContribution(recipe: Recipe): Recipe {
  const liquids = cookingLiquids(recipe);
  if (!liquids.length) return recipe;

  const { lost, mostlyEvaporation } = liquidLossMl(recipe.processes);
  const listed = recipeListedVolume(recipe);
  const hasGrain = recipeHasGrain(recipe);

  const adjustments = new Map<string, IngredientMix>();
  let accountedLoss = 0;

  if (lost > 0) {
    const totalLiquid = liquids.reduce((sum, item) => sum + item.volumeMl, 0) || 1;
    for (const item of liquids) {
      if (intensityLocked(item.mix)) continue;
      const share = item.volumeMl / totalLiquid;
      const lostHere = Math.min(item.volumeMl, lost * share);
      const remaining = Math.max(0, item.volumeMl - lostHere);
      let intensity = remaining / item.volumeMl;
      const flavored = isFlavoredCookingLiquid(item.name);
      if (flavored) {
        intensity = Math.max(FLAVORED_LIQUID_FLOOR, intensity);
      } else if (intensity < TRACE_WATER) {
        // Trace free water left after cook-off does not dilute the dish.
        intensity = 0;
      }

      if (intensity >= 0.999) continue;
      const why =
        item.mix?.why ??
        (intensity === 0
          ? mostlyEvaporation
            ? "evaporated"
            : "absorbed"
          : mostlyEvaporation
            ? "evaporated"
            : "absorbed");
      adjustments.set(item.name, {
        ...item.mix,
        intensity: roundMix(intensity),
        why,
      });
      accountedLoss += item.volumeMl * (1 - intensity);
    }
  } else if (hasGrain) {
    for (const item of liquids) {
      if (intensityLocked(item.mix)) continue;
      if (!isPlainCookingWater(item.name)) continue;
      if (listed <= 0 || item.volumeMl / listed < BULK_WATER_SHARE) continue;
      adjustments.set(item.name, {
        ...item.mix,
        intensity: 0,
        why: item.mix?.why ?? "absorbed",
      });
      accountedLoss += item.volumeMl;
    }
  }

  if (!adjustments.size) return recipe;

  const ingredients = recipe.ingredients.map((item) => {
    const mix = adjustments.get(item.name);
    return mix ? { ...item, mix } : item;
  });

  return {
    ...recipe,
    ingredients,
    processes: reconcileLiquidLossProcesses(recipe.processes, accountedLoss),
  };
}

/** Intensity already removed this volume — do not shrink the bowl again. */
function reconcileLiquidLossProcesses(
  processes: ProcessEffect[] | undefined,
  accountedLossMl: number,
): ProcessEffect[] | undefined {
  if (!processes?.length || accountedLossMl <= 0) return processes;
  let remaining = accountedLossMl;
  return processes.map((effect) => {
    if (effect.type !== "evaporation" && effect.type !== "absorption") {
      return effect;
    }
    const delta = effect.volumeDeltaMl ?? 0;
    if (delta >= 0 || remaining <= 0) return effect;
    const loss = -delta;
    const covered = Math.min(loss, remaining);
    remaining -= covered;
    const nextDelta = -(loss - covered);
    return {
      ...effect,
      volumeDeltaMl: nextDelta === 0 ? undefined : nextDelta,
    };
  });
}

function roundMix(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function recipeListedVolume(recipe: Recipe): number {
  return (
    recipe.ingredients
      .filter((item) => item.role !== "out")
      .reduce((sum, item) => sum + item.volumeMl, 0) || 1
  );
}

export function applyPrepMixHeuristics(recipes: Recipe[]): Recipe[] {
  return recipes.map((recipe) => {
    const volume = recipeListedVolume(recipe);
    const withOil = {
      ...recipe,
      ingredients: recipe.ingredients.map((item) => {
        const mix = inferDiscardedCookingMedium(item, volume);
        return mix ? { ...item, mix } : item;
      }),
    };
    return inferCookingLiquidContribution(withOil);
  });
}
