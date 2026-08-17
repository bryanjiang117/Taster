import { describe, expect, it } from "vitest";
import { readProgressStream } from "./progress-stream";

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
});
