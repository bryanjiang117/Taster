import { abortable, throwIfAborted } from "@/lib/engine/abort";
import type { ProgressEvent } from "@/lib/engine/progress";

export async function readProgressStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ProgressEvent) => void,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

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
        onEvent(JSON.parse(line.slice(6)) as ProgressEvent);
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    cancelReader();
  }
}
