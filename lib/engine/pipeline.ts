import {
  applyDishVisit,
  createDishRecord,
  type CachedDish,
  type SearchMode,
} from "./dish-cache";
import { DishStore } from "./dish-store";
import { dishConfidence } from "./confidence";
import { weightedTasteFromIngredients } from "./concentration";
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
import { resolveIngredient, type ResolveDeps, type UnknownLookup } from "./resolve";
import {
  culinaryContextFromOrigin,
  type CulinaryContext,
  type LlmClient,
  type TasteInputClassification,
} from "./llm";
import type { PageClient, SearchClient, SearchHit } from "./search";
import { asFetchedPage, pageFetchOk, pageTextIsTrusted } from "./search";
import { loadProductionStore } from "./catalog";
import { IngredientStore } from "./store";
import {
  capTaste,
  ceilingTaste,
  clampTaste,
  roundTaste,
  toPerceptualTaste,
  TASTE_DIMENSIONS,
} from "./taste";
import {
  MAX_RESOLUTION_DEPTH,
  type DishOrigin,
  type ProcessEffect,
  type Recipe,
  type ResolvedIngredient,
  type TasteProfile,
} from "./types";
import { applyProcessEffects, estimateFinalVolume } from "./volume";

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
    }>;
    finalVolumeMl: number;
  };
  provenance: ResolvedIngredient[];
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
};

export const COLLECT_TIME_LIMIT_MS = 30_000;

export async function profileDish(
  dish: string,
  deps: PipelineDeps,
): Promise<DishProfileResult> {
  const emit = deps.onProgress;
  throwIfAborted(deps.signal);
  const store = deps.store ?? (await loadProductionStore());
  const knownAtStart = new Set(store.all().map((item) => item.ingredient));
  const learnedFlush = createLearnedFlush(knownAtStart, deps.persistLearned);
  const now = deps.now ?? Date.now;
  const started = now();
  const searchMode = deps.searchMode ?? "native";

  const classification = await classifyInput(dish, deps, emit);
  if (classification.kind === "reject") {
    throw new Error(
      classification.reason?.trim()
        ? `Not a dish or ingredient: ${classification.reason.trim()}`
        : "Enter a dish or ingredient — not a brand or random text.",
    );
  }
  if (classification.kind === "ingredient") {
    return profileIngredient(
      dish,
      classification.name,
      store,
      knownAtStart,
      learnedFlush,
      deps,
      emit,
    );
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

  const origin = await runLoggedStep(
    emit,
    "origin",
    searchMode === "typed"
      ? `Identifying culinary origin of "${dish}" (searching in the typed language)`
      : `Identifying culinary origin of "${dish}"`,
    () => deps.llm.identifyDish(dish, { searchMode }),
    deps.signal,
  );

  const collected = await collectRecipes(
    origin,
    deps,
    store,
    started,
    learnedFlush.onLearned,
  );

  if (collected.recipes.length === 0) {
    throw new Error(emptyRecipeMessage(dish, collected));
  }

  const recipes = await matchRecipeIngredients(
    collected.recipes,
    store,
    deps,
    culinaryContextFromOrigin(origin),
  );

  await resolveMissingIngredients(recipes, store, deps, learnedFlush.onLearned);

  const representative = await runLoggedStep(
    emit,
    "representative",
    `Building representative recipe from ${recipes.length} sources (≥50% occurrence, median volume share)`,
    async () => {
      const startingVolume = median(
        recipes.map((recipe) =>
          recipe.ingredients
            .filter((item) => item.role !== "out")
            .reduce((sum, item) => sum + item.volumeMl, 0),
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
    const known = store.has(ingredient.name);
    resolved.push(
      await runLoggedStep(
        emit,
        `resolve:${ingredient.name}`,
        known
          ? `Loading cached taste vector for ${ingredient.name}`
          : `Resolving unknown ingredient ${ingredient.name}`,
        () =>
          resolveIngredient(ingredient.name, {
            store,
            maxDepth: MAX_RESOLUTION_DEPTH,
            lookupUnknown: (name) => deps.llm.lookupIngredient(name),
            onLearned: learnedFlush.onLearned,
          }),
        deps.signal,
      ),
    );
    emit?.({
      type: "ingredients",
      items: foundIngredientsFromRecipes(recipes, store),
    });
  }

  const taste = await runLoggedStep(
    emit,
    "score",
    "Computing taste from effective concentration, then mapping onto a 0–10 perceptual scale",
    async () => {
      let scored = weightedTasteFromIngredients(
        representative.built.ingredients.map((ingredient, i) => ({
          volumeMl: ingredient.volumeMl,
          taste: resolved[i]!.taste,
        })),
        representative.built.finalVolumeMl,
      );
      scored = applySolubleRetention(
        scored,
        representative.volumeInfo.solubleRetention,
      );
      const perceptual = toPerceptualTaste(scored);
      return capTaste(
        perceptual,
        ceilingTaste(resolved.map((ingredient) => ingredient.taste)),
      );
    },
    deps.signal,
  );

  const contributions = representative.built.ingredients.map(
    (ingredient, i) => ({
      confidence: resolved[i]!.confidence,
      contribution: TASTE_DIMENSIONS.reduce(
        (sum, dim) =>
          sum +
          resolved[i]!.taste[dim] *
            (ingredient.volumeMl / representative.built.finalVolumeMl),
        0,
      ),
    }),
  );

  const inconsistency = flavorInconsistency(
    recipes.map((recipe) => tasteOfRecipe(recipe, store)),
  );

  const learned = store
    .all()
    .filter((item) => !knownAtStart.has(item.ingredient));
  if (learned.length && deps.persistLearned) {
    await runLoggedStep(
      emit,
      "persist-seed",
      `Saving ${learned.length} new ingredient${learned.length === 1 ? "" : "s"} to the ingredient catalog`,
      () => learnedFlush.flushRemaining(store),
      deps.signal,
    );
  }

  const foundItems = foundIngredientsFromRecipes(recipes, store);
  const footnote = accompanimentFootnote(foundItems);

  const profile: DishProfileResult = {
    dish,
    origin,
    taste: roundTaste(taste),
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
    footnote,
  };

  const cached = await persistDishProfile(
    dish,
    profile,
    recipes,
    store,
    matched,
    deps,
    emit,
  );
  if (cached) profile.timesTasted = cached.timesTasted;

  return profile;
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
  store: IngredientStore,
  started: number,
  onLearned?: ResolveDeps["onLearned"],
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
    const aligned = await matchRecipeIngredients(
      recipes,
      store,
      deps,
      culinaryContextFromOrigin(origin),
    );
    if (aligned !== recipes) {
      recipes.splice(0, recipes.length, ...aligned);
    }
    await resolveMissingIngredients(recipes, store, deps, onLearned);
    const inconsistency = flavorInconsistency(
      recipes.map((recipe) => tasteOfRecipe(recipe, store)),
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

  const acceptRecipe = async (hit: SearchHit, recipe: Recipe | null) => {
    if (!recipe?.ingredients.length) {
      logRecipeExtract("empty", hit, recipe);
      return;
    }
    if (!usableExtract(recipe)) {
      logRecipeExtract("too-few", hit, recipe);
      return;
    }
    if (!recipeIsForDish(recipe, hit, identity)) {
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
      store,
      deps,
      culinaryContextFromOrigin(origin),
    );
    logRecipeExtract("used", hit, english);
    recipes.push(english);
    deps.onProgress?.({
      type: "ingredients",
      items: foundIngredientsFromRecipes(recipes, store),
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
): boolean {
  return recipeMatchesDish(recipe.title, hit, identity);
}

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
): Promise<Recipe | null> {
  const language = origin.language;
  const culinary = culinaryContextFromOrigin(origin);
  const label = hit.title || hit.url;
  let best: Recipe | null = null;
  let pageUrl = hit.url;
  let fetched: ReturnType<typeof asFetchedPage>;
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
    return null;
  }
  if (!pageFetchOk(fetched)) return null;
  pageUrl = fetched.url;

  try {
    if (pageTextIsTrusted(fetched.text)) {
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
        return finishExtract(withPageUrl(best, pageUrl), language);
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
        () => deps.llm.extractRecipeFromUrl!(hit.url, culinary),
        deps.signal,
      );
      best = richerRecipe(best, fromUrl);
      if (usableExtract(best)) {
        return finishExtract(withPageUrl(best, pageUrl), language);
      }
    } catch (error) {
      rethrowIfAborted(error);
      return finishExtract(withPageUrl(best, pageUrl), language);
    }
    return finishExtract(withPageUrl(best, pageUrl), language);
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
    return finishExtract(withPageUrl(best, pageUrl), language);
  }
  return finishExtract(withPageUrl(best, pageUrl), language);
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
  store: IngredientStore,
  deps: PipelineDeps,
  onLearned?: ResolveDeps["onLearned"],
): Promise<void> {
  const missing = uniqueIngredientNames(recipes).filter(
    (name) => name && !store.has(name),
  );
  for (const name of missing) {
    await runLoggedStep(
      deps.onProgress,
      `resolve:${name}`,
      `Resolving unknown ingredient ${name}`,
      () =>
        resolveIngredient(name, {
          store,
          maxDepth: MAX_RESOLUTION_DEPTH,
          lookupUnknown: (n) => deps.llm.lookupIngredient(n),
          onLearned,
        }),
      deps.signal,
    );
    deps.onProgress?.({
      type: "ingredients",
      items: foundIngredientsFromRecipes(recipes, store),
    });
  }
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

async function profileIngredient(
  query: string,
  classifiedName: string,
  store: IngredientStore,
  knownAtStart: Set<string>,
  learnedFlush: LearnedFlush,
  deps: PipelineDeps,
  emit: ProgressSink | undefined,
): Promise<DishProfileResult> {
  const name = normalizeIngredientName(classifiedName || query);
  await runLoggedStep(
    emit,
    "ingredient",
    `Treating "${name}" as an ingredient (no recipe search)`,
    async () => undefined,
    deps.signal,
  );

  const fromCache = store.has(name);
  const resolved = await runLoggedStep(
    emit,
    `resolve:${name}`,
    fromCache
      ? `Loading cached taste vector for ${name} from the ingredient catalog`
      : `Resolving unknown ingredient ${name}`,
    () =>
      resolveIngredient(name, {
        store,
        maxDepth: MAX_RESOLUTION_DEPTH,
        lookupUnknown: (lookupName) => deps.llm.lookupIngredient(lookupName),
        onLearned: learnedFlush.onLearned,
      }),
    deps.signal,
  );

  emit?.({
    type: "ingredients",
    items: [
      {
        name,
        used: 1,
        total: 1,
        pending: false,
        flavors: flavorsFromTaste(resolved.taste),
        out: false,
        taste: resolved.taste,
        source: resolved.source,
        derivedFrom: resolved.derivedFrom,
        processing: resolved.processing,
        confidence: resolved.confidence,
        recipes: [],
      },
    ],
  });

  const taste = await runLoggedStep(
    emit,
    "score",
    `Using ingredient catalog taste for ${name} (no dilution)`,
    async () => roundTaste(clampTaste(resolved.taste)),
    deps.signal,
  );

  const learned = store
    .all()
    .filter((item) => !knownAtStart.has(item.ingredient));
  if (learned.length && deps.persistLearned) {
    await runLoggedStep(
      emit,
      "persist-seed",
      `Saving ${learned.length} new ingredient${learned.length === 1 ? "" : "s"} to the ingredient catalog`,
      () => learnedFlush.flushRemaining(store),
      deps.signal,
    );
  }

  return {
    dish: query,
    origin: {
      dish: name,
      country: "",
      culture: "ingredient",
      nativeName: name,
      language: "English",
      languageCode: "en",
      searchQueries: [],
    },
    taste,
    confidence: round2(
      dishConfidence([{ confidence: resolved.confidence, contribution: 1 }]),
    ),
    recipesAnalyzed: 0,
    representative: {
      ingredients: [
        {
          name,
          volumeMl: 100,
          occurrence: { used: 1, total: 1 },
        },
      ],
      finalVolumeMl: 100,
    },
    provenance: [resolved],
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
  return {
    dish,
    origin: record.snapshot.origin,
    taste: record.taste,
    confidence: record.snapshot.confidence,
    recipesAnalyzed: record.snapshot.recipesAnalyzed,
    representative: record.snapshot.representative,
    provenance: record.snapshot.provenance,
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
  onLearned: NonNullable<ResolveDeps["onLearned"]>;
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
    if (knownAtStart.has(item.ingredient) || flushed.has(item.ingredient)) return;
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

export type { UnknownLookup };
