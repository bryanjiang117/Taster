import {
  applyDishVisit,
  createDishRecord,
  type CachedDish,
  type SearchMode,
} from "./dish-cache";
import { DishStore } from "./dish-store";
import { dishConfidence, sourceConfidence } from "./confidence";
import {
  alignScoreContributions,
  attributeRecipeTaste,
  contributionsFromPureTaste,
  roundScoreContributions,
  scaleScoreContributions,
  type MixIngredient,
  type ScoreContributions,
} from "./combine";
import {
  applyAmbiguousSeasoningAdjustment,
  primarySeasonerDimension,
  type FlaggedAmbiguousSeasoner,
} from "./ambiguous-seasoning";
import { applyEnglishNames, uniqueIngredientNames } from "./english-names";
import {
  matchesDish,
  recipeMatchesDish,
  type DishIdentity,
} from "./dish-match";
import {
  foundIngredientsFromRecipes,
  flavorsFromTaste,
  accompanimentFootnote,
} from "./found-ingredients";
import { normalizeIngredientName } from "./normalize";
import { applySolubleRetention } from "./processing";
import { applyPrepMixHeuristics } from "./prep-mix";
import { runLoggedStep, type ProgressSink } from "./progress";
import { rethrowIfAborted, throwIfAborted } from "./abort";
import { buildRepresentativeRecipe } from "./representative";
import {
  flavorInconsistency,
  MAX_RECIPES,
  MIN_EXTRACT_INGREDIENTS,
  MIN_RECIPES,
  recipesNeeded,
  tasteOfRecipe,
} from "./recipe-sample";
import { expandSearchQueries, MIN_SEARCH_POOL } from "./search-queries";
import { tryChemistryLeaf } from "./leaf";
import { emptyFoodbClient, FoodbDumpClient, type FoodbClient } from "./foodb";
import { emptyFctClient, FctDumpClient, type FctClient } from "./fct";
import { emptyDukeClient, DukeDumpClient, type DukeClient } from "./duke";
import {
  emptyPhenolClient,
  PhenolDumpClient,
  type PhenolClient,
} from "./phenol";
import { emptyUmamiClient, UmamiDumpClient, type UmamiClient } from "./umamidb";
import { emptyUsdaClient, UsdaFdcClient, type UsdaClient } from "./usda";
import {
  culinaryContextFromOrigin,
  leafCatalogAnchors,
  type CulinaryContext,
  type LlmClient,
  type TasteInputClassification,
} from "./llm";
import type { PageClient, SearchClient, SearchHit } from "./search";
import {
  asFetchedPage,
  pageFetchOk,
  pageTextIsTrusted,
  pageTitleFromHtml,
  pageUrlIsChallenge,
  recipePageUrl,
} from "./search";
import { loadProductionStore } from "./catalog";
import { IngredientStore } from "./store";
import { clampTaste, emptyTaste, roundTaste, TASTE_DIMENSIONS } from "./taste";
import {
  MAX_RESOLUTION_DEPTH,
  type DishOrigin,
  type IngredientMix,
  type ProcessEffect,
  type Recipe,
  type ResolvedIngredient,
  type TasteProfile,
} from "./types";
import {
  applyProcessEffects,
  estimateFinalVolume,
  tastingVolumeMl,
} from "./volume";

export type DishProfileResult = {
  dish: string;
  origin: DishOrigin;
  taste: TasteProfile;
  confidence: number;
  recipesAnalyzed: number;
  representative: {
    ingredients: Array<{
      name: string;
      volumeMl: number;
      occurrence: { used: number; total: number };
      role?: "in" | "out";
      mix?: IngredientMix;
    }>;
    finalVolumeMl: number;
  };
  provenance: ResolvedIngredient[];
  /** Top contributors toward each final 0–10 score (points sum toward that score). */
  scoreContributions?: ScoreContributions;
  /** Side/serving items that never enter the dish; shown as a footnote with primary flavors. */
  footnote?: string | null;
  timesTasted?: number;
  fromCache?: boolean;
};

export type PipelineDeps = {
  llm: LlmClient;
  search: SearchClient;
  pages: PageClient;
  store?: IngredientStore;
  dishStore?: DishStore;
  useCache?: boolean;
  searchMode?: SearchMode;
  recipeLimit?: number;
  timeLimitMs?: number;
  now?: () => number;
  onProgress?: ProgressSink;
  persistLearned?: (
    learned: ResolvedIngredient[],
  ) => Promise<number | void> | number | void;
  persistDish?: (record: CachedDish) => Promise<number | void> | number | void;
  signal?: AbortSignal;
  usda?: UsdaClient;
  foodb?: FoodbClient;
  fct?: FctClient;
  umami?: UmamiClient;
  phenol?: PhenolClient;
  duke?: DukeClient;
};

export const COLLECT_TIME_LIMIT_MS = 45_000;

type TasteRun = {
  store: IngredientStore;
  knownAtStart: Set<string>;
  learnedFlush: LearnedFlush;
  tasting: Set<string>;
  depth: number;
  context?: CulinaryContext;
};

function wiredDeps(deps: PipelineDeps): PipelineDeps {
  return {
    ...deps,
    usda:
      deps.usda ??
      (process.env.USDA_API_KEY ? new UsdaFdcClient() : emptyUsdaClient),
    foodb: deps.foodb ?? new FoodbDumpClient(),
    fct: deps.fct ?? new FctDumpClient(),
    umami: deps.umami ?? new UmamiDumpClient(),
    phenol: deps.phenol ?? new PhenolDumpClient(),
    duke: deps.duke ?? new DukeDumpClient(),
  };
}

function usdaClient(deps: PipelineDeps): UsdaClient {
  return deps.usda ?? emptyUsdaClient;
}

function foodbClient(deps: PipelineDeps): FoodbClient {
  return deps.foodb ?? emptyFoodbClient;
}

function fctClient(deps: PipelineDeps): FctClient {
  return deps.fct ?? emptyFctClient;
}

function umamiClient(deps: PipelineDeps): UmamiClient {
  return deps.umami ?? emptyUmamiClient;
}

function phenolClient(deps: PipelineDeps): PhenolClient {
  return deps.phenol ?? emptyPhenolClient;
}

function dukeClient(deps: PipelineDeps): DukeClient {
  return deps.duke ?? emptyDukeClient;
}

export async function profileDish(
  dish: string,
  deps: PipelineDeps,
): Promise<DishProfileResult> {
  const emit = deps.onProgress;
  throwIfAborted(deps.signal);
  deps = wiredDeps(deps);
  const store = deps.store ?? (await loadProductionStore());
  const knownAtStart = new Set(store.all().map((item) => item.ingredient));
  const learnedFlush = createLearnedFlush(knownAtStart, deps.persistLearned);
  const run: TasteRun = {
    store,
    knownAtStart,
    learnedFlush,
    tasting: new Set(),
    depth: 0,
  };

  const classification = await classifyInput(dish, deps, emit);
  if (classification.kind === "reject") {
    throw new Error(
      classification.reason?.trim()
        ? `Not a dish or ingredient: ${classification.reason.trim()}`
        : "Enter a dish or ingredient — not a brand or random text.",
    );
  }

  const ingredientName = normalizeIngredientName(
    classification.kind === "ingredient" ? classification.name : dish,
  );
  const cachedIngredient =
    store.get(ingredientName) ?? store.get(normalizeIngredientName(dish));
  if (classification.kind === "ingredient" && cachedIngredient) {
    return profileCachedIngredient(dish, cachedIngredient, true, emit, deps);
  }

  if (classification.kind === "ingredient") {
    return profileIngredient(dish, ingredientName, run, deps, emit);
  }

  const matched = await matchExistingDish(dish, deps, emit);

  if (deps.useCache && matched) {
    const updated = applyDishVisit(matched, { kind: "hit", alias: dish });
    await runLoggedStep(
      emit,
      "dish-cache",
      `Using cached profile for ${updated.canonicalName} (${updated.timesTasted} tastes)`,
      async () => {
        deps.dishStore?.put(updated);
        await deps.persistDish?.(updated);
      },
      deps.signal,
    );
    emit?.({ type: "ingredients", items: updated.snapshot.ingredients });
    return resultFromCachedDish(dish, updated, true);
  }

  const profile = await tasteFromRecipes(dish, run, deps, emit);
  const cached = await persistDishProfile(
    dish,
    profile,
    profile._recipes ?? [],
    store,
    matched,
    deps,
    emit,
  );
  if (cached) profile.timesTasted = cached.timesTasted;
  delete profile._recipes;
  return profile;
}

type DishProfileInternal = DishProfileResult & { _recipes?: Recipe[] };

async function tasteFromRecipes(
  query: string,
  run: TasteRun,
  deps: PipelineDeps,
  emit: ProgressSink | undefined,
): Promise<DishProfileInternal> {
  const searchMode = deps.searchMode ?? "native";
  const now = deps.now ?? Date.now;
  const started = now();
  const origin = await runLoggedStep(
    emit,
    "origin",
    searchMode === "typed"
      ? `Identifying culinary origin of "${query}" (searching in the typed language)`
      : `Identifying culinary origin of "${query}"`,
    () => deps.llm.identifyDish(query, { searchMode }),
    deps.signal,
  );
  run.context = culinaryContextFromOrigin(origin);

  const collected = await collectRecipes(origin, deps, run, started, false);

  if (collected.recipes.length === 0) {
    throw new Error(emptyRecipeMessage(query, collected));
  }

  const recipes = applyPrepMixHeuristics(
    await matchRecipeIngredients(
      collected.recipes,
      run.store,
      deps,
      culinaryContextFromOrigin(origin),
    ),
  );

  await resolveMissingIngredients(recipes, run, deps, true);

  const representative = await runLoggedStep(
    emit,
    "representative",
    `Building representative recipe from ${recipes.length} sources (occurrence-weighted mean volume share)`,
    async () => {
      const startingVolume = median(
        recipes.map((recipe) =>
          recipe.ingredients
            .filter((item) => item.role !== "out")
            .reduce((sum, item) => sum + tastingVolumeMl(item), 0),
        ),
      );
      const processes = commonProcesses(recipes);
      const finalVolumeMl = estimateFinalVolume(
        [{ name: "base", volumeMl: startingVolume }],
        processes,
      );
      const built = buildRepresentativeRecipe(recipes, finalVolumeMl);
      const volumeInfo = applyProcessEffects(startingVolume, processes);
      return { built, volumeInfo, processes };
    },
    deps.signal,
  );

  const resolved: ResolvedIngredient[] = [];
  for (const ingredient of representative.built.ingredients) {
    if (!ingredient.name) continue;
    const known = run.store.has(ingredient.name);
    const item = await runLoggedStep(
      emit,
      `resolve:${ingredient.name}`,
      known
        ? `Loading cached taste vector for ${ingredient.name}`
        : `Resolving unknown ingredient ${ingredient.name}`,
      () => resolveFood(ingredient.name, run, deps, true),
      deps.signal,
    );
    if (item) resolved.push(item);
    emit?.({
      type: "ingredients",
      items: foundIngredientsFromRecipes(recipes, run.store),
    });
  }

  const byName = new Map(resolved.map((item) => [item.ingredient, item]));
  const mixable: MixIngredient[] = representative.built.ingredients.flatMap(
    (ingredient) => {
      const item = byName.get(normalizeIngredientName(ingredient.name));
      if (!item) return [];
      return [
        {
          name: normalizeIngredientName(ingredient.name),
          volumeMl: ingredient.volumeMl,
          taste: item.taste,
          role: ingredient.role,
          mix: ingredient.mix,
        },
      ];
    },
  );

  const { taste, scoreContributions } = await runLoggedStep(
    emit,
    "score",
    "Computing taste from ingredient amounts, prep, and volume",
    async () => {
      const attributed = attributeRecipeTaste(
        mixable,
        representative.built.finalVolumeMl,
      );
      const retention = representative.volumeInfo.solubleRetention;
      return {
        taste: applySolubleRetention(attributed.taste, retention),
        scoreContributions: scaleScoreContributions(
          attributed.contributions,
          retention,
        ),
      };
    },
    deps.signal,
  );

  const adjusted = await adjustAmbiguousSeasoners({
    taste,
    scoreContributions,
    representative: representative.built.ingredients,
    mixable,
    context: run.context ?? { dish: query, nativeName: query },
    llm: deps.llm,
    emit,
    signal: deps.signal,
  });
  const tasteAfter = adjusted.taste;
  const scoreContributionsAfter = adjusted.scoreContributions;

  const contributions = mixable.map((ingredient, i) => ({
    confidence: resolved[i]?.confidence ?? 0,
    contribution: TASTE_DIMENSIONS.reduce(
      (sum, dim) =>
        sum +
        ingredient.taste[dim] *
          (ingredient.volumeMl / representative.built.finalVolumeMl),
      0,
    ),
  }));

  const inconsistency = flavorInconsistency(
    recipes.map((recipe) => tasteOfRecipe(recipe, run.store)),
  );

  const learned = run.store
    .all()
    .filter((item) => !run.knownAtStart.has(item.ingredient));
  if (learned.length && deps.persistLearned) {
    await runLoggedStep(
      emit,
      "persist-seed",
      `Saving ${learned.length} new ingredient${learned.length === 1 ? "" : "s"} to the ingredient catalog`,
      () => run.learnedFlush.flushRemaining(run.store),
      deps.signal,
    );
  }

  const foundItems = foundIngredientsFromRecipes(recipes, run.store);
  const footnote = accompanimentFootnote(foundItems);
  const roundedTaste = roundTaste(tasteAfter);

  return {
    dish: query,
    origin,
    taste: roundedTaste,
    confidence: round2(
      dishConfidence(contributions, { flavorInconsistency: inconsistency }),
    ),
    recipesAnalyzed: recipes.length,
    representative: {
      ingredients: representative.built.ingredients.map((item) => ({
        ...item,
        name: normalizeIngredientName(item.name),
        volumeMl: round2(item.volumeMl),
      })),
      finalVolumeMl: round2(representative.built.finalVolumeMl),
    },
    provenance: resolved,
    scoreContributions: finalizeScoreContributions(
      scoreContributionsAfter,
      roundedTaste,
    ),
    footnote,
    _recipes: recipes,
  };
}

type RecipeCollection = {
  recipes: Recipe[];
  hitCount: number;
  searchErrors: string[];
  offTopicDropped: number;
  skippedOtherDish: number;
};

async function collectRecipes(
  origin: DishOrigin,
  deps: PipelineDeps,
  run: TasteRun,
  started: number,
  allowNested: boolean,
): Promise<RecipeCollection> {
  const identity: DishIdentity = {
    dish: origin.dish,
    nativeName: origin.nativeName,
  };
  const maxRecipes = deps.recipeLimit ?? MAX_RECIPES;
  const minRecipes = Math.min(MIN_RECIPES, maxRecipes);
  const timeLimitMs = deps.timeLimitMs ?? COLLECT_TIME_LIMIT_MS;
  const now = deps.now ?? Date.now;
  const timedOut = () => now() - started >= timeLimitMs;
  let target = minRecipes;
  const queries = expandSearchQueries(origin, deps.searchMode ?? "native");
  const hits: SearchHit[] = [];
  const searchErrors: string[] = [];
  const searched = new Set<string>();
  const tried = new Set<string>();
  const recipes: Recipe[] = [];
  let skippedOtherDish = 0;

  const uniqueHits = () => dedupeUrls(hits);
  const titledHits = (pool: SearchHit[]) =>
    pool.filter((hit) =>
      matchesDish(`${hit.title} ${hit.snippet} ${hit.url}`, identity),
    );
  const untitledHits = (pool: SearchHit[]) =>
    pool.filter(
      (hit) => !matchesDish(`${hit.title} ${hit.snippet} ${hit.url}`, identity),
    );
  const untriedTitledCount = () =>
    titledHits(uniqueHits()).filter((hit) => !tried.has(urlKey(hit.url)))
      .length;

  const searchUntil = async (minUnique: number) => {
    for (const query of queries) {
      if (timedOut()) break;
      if (uniqueHits().length >= minUnique) break;
      const stillNeed = target - recipes.length;
      if (stillNeed > 0 && untriedTitledCount() >= stillNeed) break;
      if (searched.has(query)) continue;
      searched.add(query);
      try {
        const found = await runLoggedStep(
          deps.onProgress,
          `search:${query}`,
          `Searching the web for ${query}`,
          () => deps.search.search(query),
          deps.signal,
        );
        hits.push(...found);
      } catch (error) {
        rethrowIfAborted(error);
        searchErrors.push(
          error instanceof Error ? error.message : "search failed",
        );
      }
    }
  };

  const refreshTarget = async () => {
    if (recipes.length < minRecipes) return;
    const aligned = applyPrepMixHeuristics(
      await matchRecipeIngredients(
        recipes,
        run.store,
        deps,
        culinaryContextFromOrigin(origin),
      ),
    );
    if (aligned !== recipes) {
      recipes.splice(0, recipes.length, ...aligned);
    }
    await resolveMissingIngredients(recipes, run, deps, allowNested);
    const inconsistency = flavorInconsistency(
      recipes.map((recipe) => tasteOfRecipe(recipe, run.store)),
    );
    const needed = Math.min(
      maxRecipes,
      Math.max(recipes.length, recipesNeeded(inconsistency)),
    );
    if (needed > target) {
      deps.onProgress?.({
        type: "step",
        id: `expand-sample:${needed}`,
        message: `Flavor spread ${inconsistency.toFixed(2)} — fetching ${needed} recipes (min ${minRecipes}, max ${maxRecipes})`,
        status: "done",
        durationMs: 0,
      });
    } else if (needed === minRecipes && recipes.length === minRecipes) {
      deps.onProgress?.({
        type: "step",
        id: "sample-stable",
        message: `Flavors agree — staying at ${minRecipes} recipes`,
        status: "done",
        durationMs: 0,
      });
    }
    target = needed;
  };

  const takeHits = (queue: SearchHit[], count: number): SearchHit[] => {
    const batch: SearchHit[] = [];
    for (const hit of queue) {
      if (batch.length >= count) break;
      const key = urlKey(hit.url);
      if (tried.has(key)) continue;
      tried.add(key);
      batch.push(hit);
    }
    return batch;
  };

  const acceptRecipe = async (hit: SearchHit, extracted: ExtractedPage) => {
    const { recipe, pageTitle, pageUrl } = extracted;
    if (!recipe?.ingredients.length) {
      logRecipeExtract("empty", hit, recipe);
      return;
    }
    if (!usableExtract(recipe)) {
      logRecipeExtract("too-few", hit, recipe);
      return;
    }
    if (!recipeIsForDish(recipe, hit, identity, { url: pageUrl, pageTitle })) {
      skippedOtherDish += 1;
      logRecipeExtract("other-dish", hit, recipe);
      deps.onProgress?.({
        type: "step",
        id: `skip:${hit.url}`,
        message: `Skipped different dish: ${recipe.title || hit.title}`,
        status: "done",
        durationMs: 0,
      });
      return;
    }
    const english = await translateRecipe(
      recipe,
      run.store,
      deps,
      culinaryContextFromOrigin(origin),
    );
    logRecipeExtract("used", hit, english);
    recipes.push(english);
    deps.onProgress?.({
      type: "ingredients",
      items: foundIngredientsFromRecipes(recipes, run.store),
    });
  };

  const extractFrom = async (queue: SearchHit[]) => {
    while (!timedOut()) {
      await refreshTarget();
      if (recipes.length >= target) return;
      const batch = takeHits(queue, target - recipes.length);
      if (batch.length === 0) return;
      const extracted = await Promise.all(
        batch.map((hit) => extractOneRecipe(hit, origin, deps)),
      );
      for (let i = 0; i < batch.length; i++) {
        await acceptRecipe(batch[i]!, extracted[i]!);
      }
    }
  };

  await searchUntil(MIN_SEARCH_POOL);
  await extractFrom(titledHits(uniqueHits()));

  while (
    recipes.length < target &&
    searched.size < queries.length &&
    !timedOut()
  ) {
    await searchUntil(uniqueHits().length + 4);
    await extractFrom(titledHits(uniqueHits()));
  }

  const leftover = untitledHits(uniqueHits());
  if (recipes.length < minRecipes && leftover.length > 0 && !timedOut()) {
    deps.onProgress?.({
      type: "step",
      id: `untitled-urls:${origin.dish}`,
      message: `Only ${recipes.length} titled match${recipes.length === 1 ? "" : "es"} — reading ${leftover.length} more page${leftover.length === 1 ? "" : "s"} whose titles omitted ${origin.nativeName || origin.dish}`,
      status: "done",
      durationMs: 0,
    });
    await extractFrom(leftover);
  }

  if (timedOut() && recipes.length > 0) {
    deps.onProgress?.({
      type: "step",
      id: "time-limit",
      message: `Hit ${Math.round(timeLimitMs / 1000)}s limit with ${recipes.length} recipe${recipes.length === 1 ? "" : "s"} — scoring those`,
      status: "done",
      durationMs: now() - started,
    });
  }

  const unique = uniqueHits();
  return {
    recipes,
    hitCount: unique.length,
    searchErrors,
    offTopicDropped: untitledHits(unique).length,
    skippedOtherDish,
  };
}

function recipeIsForDish(
  recipe: Recipe,
  hit: SearchHit,
  identity: DishIdentity,
  page: { url: string; pageTitle: string },
): boolean {
  return recipeMatchesDish(recipe.title, hit, identity, page);
}

type ExtractedPage = {
  recipe: Recipe | null;
  pageTitle: string;
  pageUrl: string;
};

function emptyRecipeMessage(dish: string, collected: RecipeCollection): string {
  if (collected.hitCount === 0 && collected.searchErrors.length > 0) {
    return `Search failed for "${dish}" (${collected.searchErrors[0]}). This is often a flaky API/rate-limit, not a missing dish — try again.`;
  }
  if (collected.hitCount === 0) {
    return `No recipe pages came back for "${dish}". Origin search queries may have been too weak — try again.`;
  }
  if (
    collected.offTopicDropped > 0 &&
    collected.offTopicDropped === collected.hitCount
  ) {
    return `Search returned ${collected.hitCount} pages for "${dish}", but they were other dishes. Try again.`;
  }
  if (collected.skippedOtherDish > 0) {
    return `Found ${collected.hitCount} pages for "${dish}"; ${collected.skippedOtherDish} extracted as a different dish and none of the rest had a usable ingredient list. Try again.`;
  }
  return `Found ${collected.hitCount} pages for "${dish}" but none produced a usable recipe (≥${MIN_EXTRACT_INGREDIENTS} ingredients). URL reads often flake on retry — try again.`;
}

async function extractOneRecipe(
  hit: SearchHit,
  origin: DishOrigin,
  deps: PipelineDeps,
): Promise<ExtractedPage> {
  const language = origin.language;
  const culinary = culinaryContextFromOrigin(origin);
  const label = hit.title || hit.url;
  let best: Recipe | null = null;
  let pageUrl = hit.url;
  let pageTitle = "";
  let fetched: ReturnType<typeof asFetchedPage>;
  const done = (recipe: Recipe | null): ExtractedPage => ({
    recipe,
    pageTitle,
    pageUrl,
  });
  try {
    fetched = asFetchedPage(
      await runLoggedStep(
        deps.onProgress,
        `fetch:${hit.url}`,
        `Fetching page HTML: ${label}`,
        () => deps.pages.fetchText(hit.url),
        deps.signal,
      ),
      hit.url,
    );
  } catch (error) {
    rethrowIfAborted(error);
    return done(null);
  }
  if (!pageFetchOk(fetched)) return done(null);
  const challenge = pageUrlIsChallenge(fetched.url);
  pageUrl = recipePageUrl(fetched.url, hit.url);
  if (!challenge)
    pageTitle = fetched.pageTitle ?? pageTitleFromHtml(fetched.text);

  try {
    if (!challenge && pageTextIsTrusted(fetched.text)) {
      const recipe = await runLoggedStep(
        deps.onProgress,
        `parse:${hit.url}`,
        `Extracting ingredients from ${label}`,
        () =>
          deps.llm.extractRecipe(
            `${hit.title}\n${hit.snippet}\n${fetched.text}`,
            pageUrl,
            culinary,
          ),
        deps.signal,
      );
      best = richerRecipe(best, recipe);
      if (usableExtract(best)) {
        return done(finishExtract(withPageUrl(best, pageUrl), language));
      }
    }
  } catch (error) {
    rethrowIfAborted(error);
  }

  if (deps.llm.extractRecipeFromUrl) {
    try {
      const fromUrl = await runLoggedStep(
        deps.onProgress,
        `url:${hit.url}`,
        `Reading recipe via URL context: ${label}`,
        () => deps.llm.extractRecipeFromUrl!(pageUrl, culinary),
        deps.signal,
      );
      best = richerRecipe(best, fromUrl);
      if (usableExtract(best)) {
        return done(finishExtract(withPageUrl(best, pageUrl), language));
      }
    } catch (error) {
      rethrowIfAborted(error);
      return done(finishExtract(withPageUrl(best, pageUrl), language));
    }
    return done(finishExtract(withPageUrl(best, pageUrl), language));
  }

  try {
    const recipe = await deps.llm.extractRecipe(
      `${hit.title}\n${hit.snippet}`,
      pageUrl,
      culinary,
    );
    best = richerRecipe(best, recipe);
  } catch (error) {
    rethrowIfAborted(error);
    return done(finishExtract(withPageUrl(best, pageUrl), language));
  }
  return done(finishExtract(withPageUrl(best, pageUrl), language));
}

function withPageUrl(recipe: Recipe | null, url: string): Recipe | null {
  if (!recipe) return null;
  return { ...recipe, url };
}

function richerRecipe(a: Recipe | null, b: Recipe | null): Recipe | null {
  if (!a) return b;
  if (!b) return a;
  return b.ingredients.length > a.ingredients.length ? b : a;
}

function usableExtract(recipe: Recipe | null): recipe is Recipe {
  return Boolean(
    recipe && recipe.ingredients.length >= MIN_EXTRACT_INGREDIENTS,
  );
}

function finishExtract(recipe: Recipe | null, language: string): Recipe | null {
  if (!recipe) return null;
  recipe.language = language;
  return recipe;
}

function logRecipeExtract(
  outcome: "used" | "other-dish" | "too-few" | "empty",
  hit: SearchHit,
  recipe: Recipe | null,
): void {
  if (process.env.NODE_ENV === "test") return;
  const title = recipe?.title || hit.title || "(untitled)";
  const url = recipe?.url || hit.url;
  const items = recipe?.ingredients.length
    ? recipe.ingredients
        .map((item) => `    - ${item.name} (${item.volumeMl} ml)`)
        .join("\n")
    : "    (no ingredients)";
  console.info(`[taster] ${outcome}: ${title}\n    ${url}\n${items}`);
}

async function matchRecipeIngredients(
  recipes: Recipe[],
  store: IngredientStore,
  deps: PipelineDeps,
  context?: CulinaryContext,
): Promise<Recipe[]> {
  if (!deps.llm.canonicalizeIngredientNames) return recipes;
  const names = uniqueIngredientNames(recipes);
  if (!names.length) return recipes;
  const catalog = store.all().map((item) => item.ingredient);
  const map = await runLoggedStep(
    deps.onProgress,
    "match-ingredients",
    "Normalizing ingredient names against the catalog",
    () => deps.llm.canonicalizeIngredientNames!(names, catalog, context),
    deps.signal,
  );
  const matched = applyEnglishNames(recipes, map);
  deps.onProgress?.({
    type: "ingredients",
    items: foundIngredientsFromRecipes(matched, store),
  });
  return matched;
}

async function translateRecipe(
  recipe: Recipe,
  store: IngredientStore,
  deps: PipelineDeps,
  context?: CulinaryContext,
): Promise<Recipe> {
  const localized = applyEnglishNames([recipe], {})[0]!;
  const names = uniqueIngredientNames([localized]);
  if (!names.length || !deps.llm.canonicalizeIngredientNames) return localized;
  const catalog = store.all().map((item) => item.ingredient);

  const map = await runLoggedStep(
    deps.onProgress,
    `name:${names.join("|")}`,
    "Normalizing ingredient names against the catalog",
    () => deps.llm.canonicalizeIngredientNames!(names, catalog, context),
    deps.signal,
  );
  return applyEnglishNames([localized], map)[0]!;
}

async function resolveMissingIngredients(
  recipes: Recipe[],
  run: TasteRun,
  deps: PipelineDeps,
  allowNested: boolean,
): Promise<void> {
  const missing = uniqueIngredientNames(recipes).filter(
    (name) => name && !run.store.has(name),
  );
  for (const name of missing) {
    await runLoggedStep(
      deps.onProgress,
      `resolve:${name}`,
      `Resolving unknown ingredient ${name}`,
      () => resolveFood(name, run, deps, allowNested),
      deps.signal,
    );
    deps.onProgress?.({
      type: "ingredients",
      items: foundIngredientsFromRecipes(recipes, run.store),
    });
  }
}

async function resolveFood(
  name: string,
  run: TasteRun,
  deps: PipelineDeps,
  allowNested: boolean,
): Promise<ResolvedIngredient | null> {
  const canonical = normalizeIngredientName(name);
  const cached = run.store.get(canonical);
  if (cached) return cached;
  if (run.tasting.has(canonical)) return null;
  if (run.depth >= MAX_RESOLUTION_DEPTH) return null;

  run.tasting.add(canonical);
  try {
    const leaf = await tryChemistryLeaf(canonical, {
      store: run.store,
      usda: usdaClient(deps),
      foodb: foodbClient(deps),
      fct: fctClient(deps),
      umami: umamiClient(deps),
      phenol: phenolClient(deps),
      duke: dukeClient(deps),
      origin: run.context,
      confirmFoodShortlists: deps.llm.confirmFoodShortlists
        ? (query, shortlists) =>
            deps.llm.confirmFoodShortlists!(query, shortlists, run.context)
        : undefined,
      calibrateLeaf: deps.llm.calibrateLeafTaste
        ? (n, draft, evidence) =>
            deps.llm.calibrateLeafTaste!(
              n,
              draft,
              evidence,
              run.context,
              leafCatalogAnchors(run.store),
            )
        : undefined,
    });
    if (leaf) {
      run.store.put(leaf);
      await run.learnedFlush.onLearned(leaf);
      return leaf;
    }
    const estimated = await estimateGroceryLeaf(
      canonical,
      deps,
      run.context,
      run.store,
    );
    if (estimated) {
      run.store.put(estimated);
      await run.learnedFlush.onLearned(estimated);
      return estimated;
    }
    if (!allowNested) return null;

    const nestedRun: TasteRun = {
      ...run,
      depth: run.depth + 1,
    };
    try {
      const nested = await tasteFromRecipes(
        canonical,
        nestedRun,
        deps,
        deps.onProgress,
      );
      const derivedFrom = nested.representative.ingredients.map(
        (item) => item.name,
      );
      if (!nestedRecipePlausible(canonical, derivedFrom)) return null;
      const resolved: ResolvedIngredient = {
        ingredient: canonical,
        taste: nested.taste,
        derivedFrom,
        processing: ["recipe"],
        confidence: nested.confidence,
        source: "recipe",
        reasoning: `Tasted from ${nested.recipesAnalyzed} recipe${nested.recipesAnalyzed === 1 ? "" : "s"}`,
      };
      run.store.put(resolved);
      await run.learnedFlush.onLearned(resolved);
      return resolved;
    } catch (error) {
      rethrowIfAborted(error);
      return null;
    }
  } finally {
    run.tasting.delete(canonical);
  }
}

async function estimateGroceryLeaf(
  name: string,
  deps: PipelineDeps,
  context?: CulinaryContext,
  store?: IngredientStore,
): Promise<ResolvedIngredient | null> {
  if (!deps.llm.estimateLeafTaste) return null;
  try {
    const anchors = store ? leafCatalogAnchors(store) : undefined;
    const overlay = await deps.llm.estimateLeafTaste(name, context, anchors);
    if (!overlay) return null;
    return {
      ingredient: name,
      taste: clampTaste({ ...emptyTaste(), ...overlay }),
      derivedFrom: [],
      processing: [],
      confidence: sourceConfidence("llm"),
      source: "llm",
      reasoning: "Estimated without a chemistry match",
    };
  } catch (error) {
    rethrowIfAborted(error);
    return null;
  }
}

function nestedRecipePlausible(
  ingredient: string,
  derivedFrom: string[],
): boolean {
  const query = normalizeIngredientName(ingredient);
  if (!query || !derivedFrom.length) return false;
  const tokens = query.split(" ").filter((token) => token.length >= 3);
  if (!tokens.length) return true;
  const hay = derivedFrom
    .map((name) => normalizeIngredientName(name))
    .join(" ");
  return tokens.some((token) => hay.includes(token));
}

function commonProcesses(recipes: Recipe[]): ProcessEffect[] {
  const groups = new Map<string, ProcessEffect[]>();
  for (const recipe of recipes) {
    const seen = new Set<string>();
    for (const process of recipe.processes ?? []) {
      if (seen.has(process.type)) continue;
      seen.add(process.type);
      const list = groups.get(process.type) ?? [];
      list.push(process);
      groups.set(process.type, list);
    }
  }

  const out: ProcessEffect[] = [];
  for (const [type, list] of groups) {
    if (list.length / recipes.length < 0.5) continue;
    out.push({
      type: type as ProcessEffect["type"],
      volumeDeltaMl:
        median(list.map((item) => item.volumeDeltaMl ?? 0)) || undefined,
      discardedSolubleFraction:
        median(list.map((item) => item.discardedSolubleFraction ?? 0)) ||
        undefined,
    });
  }
  return out;
}

function dedupeUrls(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = urlKey(hit.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function urlKey(url: string): string {
  return url.split("?")[0] ?? url;
}

async function classifyInput(
  query: string,
  deps: PipelineDeps,
  emit: ProgressSink | undefined,
): Promise<TasteInputClassification> {
  if (!deps.llm.classifyTasteInput) return { kind: "dish" };
  return runLoggedStep(
    emit,
    "classify",
    `Checking whether "${query}" is a dish or ingredient`,
    () => deps.llm.classifyTasteInput!(query),
    deps.signal,
  );
}

async function profileCachedIngredient(
  query: string,
  resolved: ResolvedIngredient,
  fromCache: boolean,
  emit: ProgressSink | undefined,
  deps: PipelineDeps,
): Promise<DishProfileResult> {
  await runLoggedStep(
    emit,
    "ingredient",
    `Treating "${resolved.ingredient}" as an ingredient`,
    async () => undefined,
    deps.signal,
  );
  return finishIngredientProfile(query, resolved, fromCache, emit, deps);
}

async function profileIngredient(
  query: string,
  classifiedName: string,
  run: TasteRun,
  deps: PipelineDeps,
  emit: ProgressSink | undefined,
): Promise<DishProfileResult> {
  const name = normalizeIngredientName(classifiedName || query);
  run.context = {
    dish: name,
    nativeName: name,
  };
  await runLoggedStep(
    emit,
    "ingredient",
    `Treating "${name}" as an ingredient`,
    async () => undefined,
    deps.signal,
  );

  const cached = run.store.get(name);
  if (cached) {
    return finishIngredientProfile(query, cached, true, emit, deps);
  }

  const resolved = await runLoggedStep(
    emit,
    `resolve:${name}`,
    `Scoring ${name} from food chemistry`,
    () => resolveFood(name, run, deps, true),
    deps.signal,
  );
  if (!resolved) {
    throw new Error(
      `Could not taste "${name}" from chemistry or a recipe. Try a more specific food name.`,
    );
  }

  const learned = run.store
    .all()
    .filter((item) => !run.knownAtStart.has(item.ingredient));
  if (learned.length && deps.persistLearned) {
    await runLoggedStep(
      emit,
      "persist-seed",
      `Saving ${learned.length} new ingredient${learned.length === 1 ? "" : "s"} to the ingredient catalog`,
      () => run.learnedFlush.flushRemaining(run.store),
      deps.signal,
    );
  }

  return finishIngredientProfile(query, resolved, false, emit, deps);
}

function finishIngredientProfile(
  query: string,
  resolved: ResolvedIngredient,
  fromCache: boolean,
  emit: ProgressSink | undefined,
  deps: PipelineDeps,
): DishProfileResult {
  emit?.({
    type: "ingredients",
    items: [
      {
        name: resolved.ingredient,
        used: 1,
        total: 1,
        pending: false,
        flavors: flavorsFromTaste(resolved.taste),
        out: false,
        taste: resolved.taste,
        source: resolved.source,
        measuredFrom: resolved.measuredFrom,
        derivedFrom: resolved.derivedFrom,
        processing: resolved.processing,
        reasoning: resolved.reasoning,
        confidence: resolved.confidence,
        recipes: [],
      },
    ],
  });

  const rounded = roundTaste(clampTaste(resolved.taste));

  return {
    dish: query,
    origin: {
      dish: resolved.ingredient,
      country: "",
      culture: "ingredient",
      nativeName: resolved.ingredient,
      language: "English",
      languageCode: "en",
      searchQueries: [],
    },
    taste: rounded,
    confidence: round2(
      dishConfidence([{ confidence: resolved.confidence, contribution: 1 }]),
    ),
    recipesAnalyzed: 0,
    representative: {
      ingredients: [
        {
          name: resolved.ingredient,
          volumeMl: 100,
          occurrence: { used: 1, total: 1 },
        },
      ],
      finalVolumeMl: 100,
    },
    provenance: [resolved],
    scoreContributions: finalizeScoreContributions(
      contributionsFromPureTaste(resolved.ingredient, rounded),
      rounded,
    ),
    footnote: null,
    fromCache,
  };
}

async function matchExistingDish(
  dish: string,
  deps: PipelineDeps,
  emit: ProgressSink | undefined,
): Promise<CachedDish | undefined> {
  const store = deps.dishStore;
  if (!store || !deps.llm.matchDish) return undefined;
  const candidates = store.all();
  if (candidates.length === 0) return undefined;
  const name = await runLoggedStep(
    emit,
    "match-dish",
    `Checking if "${dish}" matches any of ${candidates.length} previously tasted dish${candidates.length === 1 ? "" : "es"}`,
    () =>
      deps.llm.matchDish!(
        dish,
        candidates.map((row) => ({
          canonicalName: row.canonicalName,
          aliases: row.aliases,
        })),
      ),
    deps.signal,
  );
  if (!name) return undefined;
  return store.get(name);
}

function resultFromCachedDish(
  dish: string,
  record: CachedDish,
  fromCache: boolean,
): DishProfileResult {
  const taste = record.taste;
  return {
    dish,
    origin: record.snapshot.origin,
    taste,
    confidence: record.snapshot.confidence,
    recipesAnalyzed: record.snapshot.recipesAnalyzed,
    representative: record.snapshot.representative,
    provenance: record.snapshot.provenance,
    scoreContributions: scoreContributionsFromParts(
      record.snapshot.representative,
      record.snapshot.provenance,
      taste,
      record.snapshot.recipesAnalyzed,
    ),
    footnote:
      record.snapshot.footnote ??
      accompanimentFootnote(record.snapshot.ingredients),
    timesTasted: record.timesTasted,
    fromCache,
  };
}

async function persistDishProfile(
  dish: string,
  profile: DishProfileResult,
  recipes: Recipe[],
  ingredients: IngredientStore,
  matched: CachedDish | undefined,
  deps: PipelineDeps,
  emit: ProgressSink | undefined,
): Promise<CachedDish | undefined> {
  if (!deps.dishStore) return undefined;
  const snapshot = {
    origin: profile.origin,
    taste: profile.taste,
    confidence: profile.confidence,
    recipesAnalyzed: profile.recipesAnalyzed,
    representative: profile.representative,
    provenance: profile.provenance,
    ingredients: foundIngredientsFromRecipes(recipes, ingredients),
    footnote: profile.footnote ?? null,
  };
  const updated = matched
    ? applyDishVisit(matched, {
        kind: "sample",
        taste: profile.taste,
        snapshot,
        alias: dish,
      })
    : createDishRecord(
        profile.origin.dish || dish,
        [dish, profile.origin.nativeName],
        snapshot,
      );
  deps.dishStore.put(updated);
  if (deps.persistDish) {
    await runLoggedStep(
      emit,
      "persist-dish",
      `Saving dish profile for ${updated.canonicalName} (${updated.timesTasted} tastes)`,
      () => Promise.resolve(deps.persistDish!(updated)),
      deps.signal,
    );
  }
  return updated;
}

function finalizeScoreContributions(
  contributions: ScoreContributions,
  taste: TasteProfile,
): ScoreContributions {
  return roundScoreContributions(alignScoreContributions(contributions, taste));
}

async function adjustAmbiguousSeasoners(input: {
  taste: TasteProfile;
  scoreContributions: ScoreContributions;
  representative: Array<{
    name: string;
    quantityAmbiguous?: boolean;
    role?: "in" | "out";
  }>;
  mixable: MixIngredient[];
  context: CulinaryContext;
  llm: LlmClient;
  emit: ProgressSink | undefined;
  signal?: AbortSignal;
}): Promise<{ taste: TasteProfile; scoreContributions: ScoreContributions }> {
  const leafByName = new Map(
    input.mixable.map((item) => [
      normalizeIngredientName(item.name ?? ""),
      item.taste,
    ]),
  );
  const flagged: FlaggedAmbiguousSeasoner[] = [];
  const flaggedDetail: Array<{
    name: string;
    dimension: (typeof TASTE_DIMENSIONS)[number];
    leafScore: number;
    currentPoints: number;
  }> = [];

  for (const ingredient of input.representative) {
    if (!ingredient.quantityAmbiguous || ingredient.role === "out") continue;
    const name = normalizeIngredientName(ingredient.name);
    const dimension = primarySeasonerDimension(name);
    if (!dimension) continue;
    flagged.push({ name, dimension });
    const leaf = leafByName.get(name);
    flaggedDetail.push({
      name,
      dimension,
      leafScore: leaf?.[dimension] ?? 0,
      currentPoints:
        input.scoreContributions[dimension].find((row) => row.name === name)
          ?.points ?? 0,
    });
  }

  if (!flagged.length || !input.llm.adjustAmbiguousSeasoning) {
    return {
      taste: input.taste,
      scoreContributions: input.scoreContributions,
    };
  }

  const dims = [...new Set(flagged.map((row) => row.dimension))];
  try {
    const adjustment = await runLoggedStep(
      input.emit,
      "adjust-ambiguous",
      `Adjusting ${dims.join(", ")} from ambiguous seasoning amounts`,
      () =>
        input.llm.adjustAmbiguousSeasoning!({
          context: input.context,
          engineTaste: input.taste,
          contributions: input.scoreContributions,
          flagged: flaggedDetail,
        }),
      input.signal,
    );
    const applied = applyAmbiguousSeasoningAdjustment({
      taste: input.taste,
      contributions: input.scoreContributions,
      flagged,
      adjustment,
    });
    return {
      taste: applied.taste,
      scoreContributions: applied.contributions,
    };
  } catch (error) {
    rethrowIfAborted(error);
    return {
      taste: input.taste,
      scoreContributions: input.scoreContributions,
    };
  }
}

function scoreContributionsFromParts(
  representative: DishProfileResult["representative"],
  provenance: ResolvedIngredient[],
  taste: TasteProfile,
  recipesAnalyzed: number,
): ScoreContributions {
  if (recipesAnalyzed === 0 && provenance.length === 1) {
    const only = provenance[0]!;
    return finalizeScoreContributions(
      contributionsFromPureTaste(only.ingredient, taste),
      taste,
    );
  }

  const byName = new Map(
    provenance.map((item) => [normalizeIngredientName(item.ingredient), item]),
  );
  const mixable: MixIngredient[] = representative.ingredients.flatMap(
    (ingredient) => {
      const item = byName.get(normalizeIngredientName(ingredient.name));
      if (!item) return [];
      return [
        {
          name: normalizeIngredientName(ingredient.name),
          volumeMl: ingredient.volumeMl,
          taste: item.taste,
          role: ingredient.role,
          mix: ingredient.mix,
        },
      ];
    },
  );

  if (!mixable.length || representative.finalVolumeMl <= 0) {
    return finalizeScoreContributions(
      contributionsFromPureTaste(
        provenance[0]?.ingredient ?? "ingredient",
        taste,
      ),
      taste,
    );
  }

  const attributed = attributeRecipeTaste(
    mixable,
    representative.finalVolumeMl,
  );
  return finalizeScoreContributions(attributed.contributions, taste);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type LearnedFlush = {
  onLearned: (item: ResolvedIngredient) => Promise<void>;
  flushRemaining: (store: IngredientStore) => Promise<void>;
};

/** Persist each newly resolved ingredient immediately so a mid-run timeout keeps what was learned. */
function createLearnedFlush(
  knownAtStart: Set<string>,
  persistLearned: PipelineDeps["persistLearned"],
): LearnedFlush {
  const flushed = new Set<string>();

  const persistOne = async (item: ResolvedIngredient) => {
    if (!persistLearned) return;
    if (knownAtStart.has(item.ingredient) || flushed.has(item.ingredient))
      return;
    await persistLearned([item]);
    flushed.add(item.ingredient);
  };

  return {
    onLearned: persistOne,
    async flushRemaining(store) {
      if (!persistLearned) return;
      const pending = store
        .all()
        .filter(
          (item) =>
            !knownAtStart.has(item.ingredient) && !flushed.has(item.ingredient),
        );
      if (!pending.length) return;
      await persistLearned(pending);
      for (const item of pending) flushed.add(item.ingredient);
    },
  };
}

export type { FoodHit } from "./usda";
