import { abortable, throwIfAborted } from "@/lib/engine/abort";
import type { ProgressEvent } from "@/lib/engine/progress";

export type ProgressStreamOutcome = "done" | "error" | "incomplete";

export async function readProgressStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ProgressStreamOutcome> {
  const reader = body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  let outcome: ProgressStreamOutcome = "incomplete";

  try {
    throwIfAborted(signal);
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await abortable(signal, reader.read());
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((row) => row.startsWith("data: "));
        if (!line) continue;
        throwIfAborted(signal);
        const event = JSON.parse(line.slice(6)) as ProgressEvent;
        if (event.type === "done") outcome = "done";
        if (event.type === "error") outcome = "error";
        onEvent(event);
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    cancelReader();
  }

  return outcome;
}
