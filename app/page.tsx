"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useDishPlaceholder } from "./use-dish-placeholder";
import { IngredientList } from "./ingredient-list";
import { ProgressLog } from "./progress-log";
import { isAbortError } from "@/lib/engine/abort";
import type { FoundIngredient } from "@/lib/engine/found-ingredients";
import { TASTE_DIMENSIONS, type TasteProfile } from "@/lib/engine/taste";
import type { ProgressStepEvent } from "@/lib/engine/progress";
import { readProgressStream } from "@/lib/ui/progress-stream";

const USE_CACHE_KEY = "taster.useCache";
const TYPED_LANGUAGE_KEY = "taster.typedLanguage";

type ApiResult = {
  dish: string;
  origin: { nativeName: string; country: string; language: string };
  taste: TasteProfile;
  confidence: number;
  recipesAnalyzed: number;
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
  const [focused, setFocused] = useState(false);
  const [useCache, setUseCache] = useState(false);
  const [typedLanguage, setTypedLanguage] = useState(false);
  const placeholder = useDishPlaceholder(!focused && !dish && !loading);
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
    function focusDish() {
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

    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });

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
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    void startTaste();
  }

  async function startTaste() {
    if (abortRef.current) return;
    const abort = new AbortController();
    abortRef.current = abort;
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
        body: JSON.stringify({ dish, useCache, typedLanguage }),
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

      await readProgressStream(
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
          } else if (event.type === "error") {
            setTotalMs(event.totalMs);
            setError(event.error);
          }
        },
        abort.signal,
      );
    } catch (error) {
      if (isAbortError(error)) return;
      setError("Network error.");
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setLoading(false);
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
      <h1>Taster</h1>
      <p className="lede">Type a dish. Get a taste profile.</p>

      <form onSubmit={onSubmit}>
        <div className="dish-field">
          <input
            ref={dishInputRef}
            id="dish"
            name="dish"
            value={dish}
            onChange={(event) => setDish(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            autoComplete="off"
            autoFocus
            required
          />
        </div>
        <fieldset className="modes">
          <ModeToggle
            label="Reuse cache"
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
          type={loading ? "button" : "submit"}
          disabled={!loading && !dish.trim()}
          onClick={loading ? stopTasting : undefined}
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
              <span
                className="sheet-mark"
                aria-hidden="true"
              />
            </div>
            <span>
              {result.origin.nativeName} · {result.origin.country}
            </span>
          </header>
          <ol className="scores">
            {TASTE_DIMENSIONS.map((dim) => (
              <li key={dim}>
                <span>{label(dim)}</span>
                <b>
                  {formatScore(result.taste[dim])}
                  <small>/10</small>
                </b>
              </li>
            ))}
          </ol>
          <p className="meta">
            Confidence {Math.round(result.confidence * 100)}% ·{" "}
            {result.recipesAnalyzed} recipes
            {result.timesTasted
              ? ` · Tasted ${result.timesTasted} time${result.timesTasted === 1 ? "" : "s"}`
              : ""}
            {result.fromCache ? " · cached average" : ""}
          </p>
          {result.footnote ? <p className="footnote">{result.footnote}</p> : null}
        </section>
      ) : null}
    </main>
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

function label(dim: string): string {
  return dim.charAt(0).toUpperCase() + dim.slice(1);
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
