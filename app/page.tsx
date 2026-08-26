"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useDishPlaceholder } from "./use-dish-placeholder";
import { useTypewriterEllipsis } from "./use-typewriter-ellipsis";
import { IngredientList } from "./ingredient-list";
import { ProgressLog } from "./progress-log";
import { ScoreList } from "./score-list";
import { isAbortError } from "@/lib/engine/abort";
import type { ScoreContributions } from "@/lib/engine/combine";
import type { FoundIngredient } from "@/lib/engine/found-ingredients";
import type { TasteProfile } from "@/lib/engine/taste";
import type { ProgressStepEvent } from "@/lib/engine/progress";
import { tidyQueryName } from "@/lib/engine/normalize";
import { readProgressStream } from "@/lib/ui/progress-stream";

const USE_CACHE_KEY = "taster.useCache.v2";
const TYPED_LANGUAGE_KEY = "taster.typedLanguage.v2";

type ApiResult = {
  dish: string;
  origin: { nativeName: string; country: string; language: string };
  taste: TasteProfile;
  confidence: number;
  recipesAnalyzed: number;
  scoreContributions?: ScoreContributions;
  footnote?: string | null;
  timesTasted?: number;
  fromCache?: boolean;
};

export default function HomePage() {
  const [dish, setDish] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [steps, setSteps] = useState<ProgressStepEvent[]>([]);
  const [ingredients, setIngredients] = useState<FoundIngredient[]>([]);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [useCache, setUseCache] = useState(false);
  const [typedLanguage, setTypedLanguage] = useState(false);
  const [totalTastes, setTotalTastes] = useState<number | null>(null);
  const pendingEllipsis = useTypewriterEllipsis(totalTastes != null);
  const countPending = !pendingEllipsis.reveal;
  const placeholder = useDishPlaceholder(!dish && !loading);
  const abortRef = useRef<AbortController | null>(null);
  const dishInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(loading);
  const dishRef = useRef(dish);
  const startTasteRef = useRef<() => void>(() => {});
  const [sheetArrive, setSheetArrive] = useState(false);

  loadingRef.current = loading;
  dishRef.current = dish;

  useEffect(() => {
    setUseCache(readFlag(USE_CACHE_KEY));
    setTypedLanguage(readFlag(TYPED_LANGUAGE_KEY));
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { totalTastes?: number };
        const fetched = data.totalTastes;
        if (!cancelled && typeof fetched === "number") {
          setTotalTastes((current) => current ?? fetched);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function focusDish() {
      if (loadingRef.current || abortRef.current) return;
      dishInputRef.current?.focus();
    }

    focusDish();

    function onWindowFocus() {
      focusDish();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") focusDish();
    }

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!result) {
      setSheetArrive(false);
      return;
    }
    const sheet = sheetRef.current;
    if (!sheet) return;

    let cancelled = false;
    let afterScroll: number | undefined;

    function startArrive() {
      if (cancelled) return;
      setSheetArrive(true);
    }

    function afterScrollEnds() {
      afterScroll = window.setTimeout(startArrive, 200);
    }

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });

    // Prefer scrollend; fall back if the browser never fires it (already at bottom / older engines).
    const fallback = window.setTimeout(afterScrollEnds, 900);
    function onScrollEnd() {
      window.clearTimeout(fallback);
      afterScrollEnds();
    }
    document.addEventListener("scrollend", onScrollEnd, { once: true });

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      window.clearTimeout(afterScroll);
      document.removeEventListener("scrollend", onScrollEnd);
    };
  }, [result]);

  function stopTasting() {
    const abort = abortRef.current;
    abortRef.current = null;
    abort?.abort();
    setLoading(false);
    dishInputRef.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      stopTasting();
      return;
    }
    void startTaste();
  }

  async function startTaste() {
    if (abortRef.current) return;
    const abort = new AbortController();
    abortRef.current = abort;
    dishInputRef.current?.blur();
    const query = tidyQueryName(dish);
    if (query !== dish) setDish(query);
    const started = Date.now();
    setError(null);
    setResult(null);
    setSteps([]);
    setIngredients([]);
    setTotalMs(null);
    setLoading(true);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dish: query, useCache, typedLanguage }),
        signal: abort.signal,
      });

      if (!response.body) {
        setError("No response stream.");
        return;
      }

      if (
        !response.ok &&
        !response.headers.get("content-type")?.includes("event-stream")
      ) {
        const data = (await response.json()) as { error?: string };
        setError(data.error || "Could not profile this dish.");
        return;
      }

      const outcome = await readProgressStream(
        response.body,
        (event) => {
          if (abort.signal.aborted) return;
          if (event.type === "step") {
            setSteps((current) => upsertStep(current, event));
          } else if (event.type === "ingredients") {
            setIngredients(event.items);
          } else if (event.type === "done") {
            setTotalMs(event.totalMs);
            setResult(event.result as ApiResult);
            if (typeof event.totalTastes === "number") {
              setTotalTastes(event.totalTastes);
            }
          } else if (event.type === "error") {
            setTotalMs(event.totalMs);
            setError(event.error);
          }
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      if (outcome === "incomplete") {
        setTotalMs(Date.now() - started);
        setSteps((current) => finishRunningSteps(current));
        setError("Taste timed out before finishing. Try again.");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setError("Network error.");
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setLoading(false);
        dishInputRef.current?.focus({ preventScroll: true });
      }
    }
  }

  startTasteRef.current = () => {
    void startTaste();
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (loadingRef.current || !dishRef.current.trim()) return;
      event.preventDefault();
      startTasteRef.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main>
      <p
        className="taste-count"
        aria-live={countPending ? "off" : "polite"}
        aria-busy={countPending}
      >
        <span className="taste-count-label">Total tastings:</span>
        <b aria-hidden={countPending || undefined}>
          {pendingEllipsis.reveal && totalTastes != null
            ? totalTastes.toLocaleString("en-US")
            : pendingEllipsis.text || "\u00a0"}
        </b>
      </p>
      <h1>Taster</h1>
      <div className="intro-copy">
        <p className="lede">Type a dish. Get a taste profile. The more specific the better.</p>
      </div>

      <form onSubmit={onSubmit}>
        <div className="dish-field">
          <input
            ref={dishInputRef}
            id="dish"
            name="dish"
            value={dish}
            onChange={(event) => setDish(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoFocus
            required
          />
        </div>
        <fieldset className="modes">
          <ModeToggle
            label="Use dish cache"
            hint="Use the shared average if this dish was tasted before"
            on={useCache}
            onChange={(value) => {
              setUseCache(value);
              writeFlag(USE_CACHE_KEY, value);
            }}
          />
          <ModeToggle
            label="Typed language"
            hint="Search recipes in the language you typed, not the origin language"
            on={typedLanguage}
            onChange={(value) => {
              setTypedLanguage(value);
              writeFlag(TYPED_LANGUAGE_KEY, value);
            }}
          />
        </fieldset>
        <button
          className={loading ? "taste stop" : "taste"}
          type="submit"
          disabled={!loading && !dish.trim()}
        >
          {loading ? "Stop" : "Taste"}
        </button>
      </form>

      <ProgressLog steps={steps} totalMs={totalMs} running={loading} />
      <IngredientList items={ingredients} />

      {error ? <p className="error">{error}</p> : null}

      {result ? (
        <section
          ref={sheetRef}
          className={sheetArrive ? "sheet sheet-arrive" : "sheet"}
          aria-live="polite"
        >
          <header>
            <div className="sheet-title">
              <strong>{result.dish}</strong>
              <span className="sheet-mark" aria-hidden="true" />
            </div>
            <span>
              {result.origin.nativeName} · {result.origin.country}
            </span>
          </header>
          <ScoreList
            taste={result.taste}
            contributions={result.scoreContributions}
          />
          <div className="meta">
            {result.timesTasted === 1 ? (
              <p>Congrats! You were the first one to taste this dish!</p>
            ) : result.timesTasted ? (
              <p>
                Tasted {result.timesTasted} times
                {result.fromCache ? " · cached average" : ""}
              </p>
            ) : result.fromCache ? (
              <p>cached average</p>
            ) : null}
            <p>
              Confidence {Math.round(result.confidence * 100)}% ·{" "}
              {result.recipesAnalyzed} recipes
            </p>
          </div>
          <AccompanimentFootnote
            items={ingredients}
            fallback={result.footnote}
          />
        </section>
      ) : null}
    </main>
  );
}

function AccompanimentFootnote({
  items,
  fallback,
}: {
  items: FoundIngredient[];
  fallback?: string | null;
}) {
  const sides = items.filter((item) => item.out);
  if (sides.length === 0) {
    return fallback ? <p className="footnote">{fallback}</p> : null;
  }

  return (
    <div className="footnote">
      <p className="footnote-label">Often served with</p>
      <ul>
        {sides.map((item) => (
          <li key={item.name}>
            <span>{item.name}</span>
            <span className="footnote-flavors">
              {item.pending
                ? "tasting…"
                : item.flavors.length
                  ? item.flavors.join(" · ")
                  : "neutral"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModeToggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="mode">
      <span className="mode-copy">
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <div className="mode-switch" role="group" aria-label={label}>
        <button
          type="button"
          className="mode-btn"
          aria-pressed={on}
          onClick={() => onChange(true)}
        >
          On
        </button>
        <button
          type="button"
          className="mode-btn"
          aria-pressed={!on}
          onClick={() => onChange(false)}
        >
          Off
        </button>
      </div>
    </div>
  );
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function upsertStep(
  current: ProgressStepEvent[],
  incoming: ProgressStepEvent,
): ProgressStepEvent[] {
  const index = current.findIndex((step) => step.id === incoming.id);
  if (index === -1) return [...current, incoming];
  const next = [...current];
  next[index] = incoming;
  return next;
}

function finishRunningSteps(steps: ProgressStepEvent[]): ProgressStepEvent[] {
  return steps.map((step) =>
    step.status === "running" ? { ...step, status: "done" as const } : step,
  );
}
