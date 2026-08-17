import { describe, expect, it } from "vitest";
import { runLoggedStep, type ProgressEvent } from "./progress";

describe("runLoggedStep", () => {
  it("emits running then done with duration", async () => {
    const events: ProgressEvent[] = [];
    const value = await runLoggedStep(events.push.bind(events), "search", "searching the web for 麻婆豆腐 食谱", async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return 3;
    });
    expect(value).toBe(3);
    expect(events[0]).toMatchObject({
      type: "step",
      id: "search",
      message: "searching the web for 麻婆豆腐 食谱",
      status: "running",
    });
    expect(events[1]).toMatchObject({
      type: "step",
      id: "search",
      status: "done",
    });
    expect(events[1]?.type === "step" && (events[1].durationMs ?? 0) >= 10).toBe(true);
  });

  it("rejects with AbortError when the signal fires during the step", async () => {
    const controller = new AbortController();
    const events: ProgressEvent[] = [];
    const pending = runLoggedStep(
      events.push.bind(events),
      "search",
      "searching",
      () => new Promise<number>(() => {}),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(events.at(-1)).toMatchObject({ id: "search", status: "done" });
  });
});
