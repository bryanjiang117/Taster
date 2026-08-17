import { abortError, isAbortError } from "@/lib/engine/abort";
import { GeminiLlm, GeminiSearch } from "@/lib/engine/llm";
import { profileDish } from "@/lib/engine/pipeline";
import type { ProgressEvent } from "@/lib/engine/progress";
import { loadProductionStore, persistProductionLearned } from "@/lib/engine/catalog";
import { loadProductionDishStore, persistProductionDish } from "@/lib/engine/dish-catalog";
import { DuckDuckGoSearch, FetchPageClient, searchWithFallback } from "@/lib/engine/search";

export const dynamic = "force-dynamic";
/** Pho-scale runs (recipe collect ≤30s + many unknown ingredient LLM lookups) exceed 60s on Vercel. */
export const maxDuration = 600;

const KEEPALIVE_MS = 15_000;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    dish?: string;
    useCache?: boolean;
    typedLanguage?: boolean;
  };
  const dish = body.dish?.trim();
  if (!dish) {
    return Response.json({ error: "Enter a dish name." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stop = new AbortController();
  const abortStop = () => {
    if (!stop.signal.aborted) stop.abort();
  };
  request.signal.addEventListener("abort", abortStop);

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      let keepalive: ReturnType<typeof setInterval> | undefined;
      const send = (event: ProgressEvent) => {
        if (stop.signal.aborted || request.signal.aborted) {
          abortStop();
          throw abortError();
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (error) {
          abortStop();
          if (isAbortError(error)) throw error;
          throw abortError();
        }
      };

      try {
        // SSE comment keepalives — HTTP/1.1 proxies may drop idle streams during long Gemini lookups.
        keepalive = setInterval(() => {
          if (stop.signal.aborted || request.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            abortStop();
          }
        }, KEEPALIVE_MS);

        const llm = new GeminiLlm();
        const geminiSearch = new GeminiSearch(llm);
        const ddg = new DuckDuckGoSearch(stop.signal);

        const store = await loadProductionStore();
        const dishStore = await loadProductionDishStore();
        const result = await profileDish(dish, {
          llm,
          search: {
            search: (query) => searchWithFallback(geminiSearch, ddg, query),
          },
          pages: new FetchPageClient(stop.signal),
          store,
          dishStore,
          useCache: Boolean(body.useCache),
          searchMode: body.typedLanguage ? "typed" : "native",
          onProgress: send,
          persistLearned: persistProductionLearned,
          persistDish: persistProductionDish,
          signal: stop.signal,
        });

        send({ type: "done", totalMs: Date.now() - started, result });
      } catch (error) {
        if (isAbortError(error) || stop.signal.aborted || request.signal.aborted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Taste profile failed.";
        send({ type: "error", error: message, totalMs: Date.now() - started });
      } finally {
        if (keepalive) clearInterval(keepalive);
        request.signal.removeEventListener("abort", abortStop);
        try {
          controller.close();
        } catch {
          /* stream already cancelled by the client */
        }
      }
    },
    cancel() {
      abortStop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
