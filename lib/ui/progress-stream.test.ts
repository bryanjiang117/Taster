import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "@/lib/engine/progress";
import { readProgressStream } from "./progress-stream";

function sseStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("readProgressStream", () => {
  it("rejects as soon as the abort signal fires, even if the body never closes", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start() {
        /* leave the stream open */
      },
    });
    const controller = new AbortController();
    const pending = readProgressStream(stream, () => {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports incomplete when the stream ends without done or error", async () => {
    const events: ProgressEvent[] = [];
    const outcome = await readProgressStream(
      sseStream([
        `data: ${JSON.stringify({ type: "step", id: "resolve:clove", message: "Resolving unknown ingredient clove", status: "running" })}\n\n`,
      ]),
      (event) => events.push(event),
    );
    expect(outcome).toBe("incomplete");
    expect(events).toHaveLength(1);
  });

  it("reports done when the stream ends with a done event", async () => {
    const outcome = await readProgressStream(
      sseStream([
        `data: ${JSON.stringify({ type: "done", totalMs: 12, result: { dish: "pho" } })}\n\n`,
      ]),
      () => {},
    );
    expect(outcome).toBe("done");
  });

  it("ignores SSE comment keepalives between data events", async () => {
    const events: ProgressEvent[] = [];
    const outcome = await readProgressStream(
      sseStream([
        `data: ${JSON.stringify({ type: "step", id: "a", message: "go", status: "running" })}\n\n`,
        `: keepalive\n\n`,
        `data: ${JSON.stringify({ type: "done", totalMs: 1, result: {} })}\n\n`,
      ]),
      (event) => events.push(event),
    );
    expect(outcome).toBe("done");
    expect(events.map((e) => e.type)).toEqual(["step", "done"]);
  });
});
