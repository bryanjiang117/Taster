import { describe, expect, it } from "vitest";
import { abortable, abortError, isAbortError, throwIfAborted } from "./abort";

describe("throwIfAborted", () => {
  it("throws AbortError when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });

  it("does nothing when the signal is live or missing", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });
});

describe("abortable", () => {
  it("rejects as soon as the signal aborts, even if work is still pending", async () => {
    const controller = new AbortController();
    const pending = abortable(
      controller.signal,
      new Promise<string>(() => {}),
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("resolves the inner value when work finishes first", async () => {
    const value = await abortable(
      new AbortController().signal,
      Promise.resolve(7),
    );
    expect(value).toBe(7);
  });
});

describe("isAbortError", () => {
  it("recognizes AbortError and ignores other failures", () => {
    expect(isAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "ResponseAborted" }))).toBe(
      true,
    );
    expect(isAbortError(new Error("Network error."))).toBe(false);
  });
});
