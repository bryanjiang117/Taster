import { describe, expect, it } from "vitest";
import { nextStartedAt } from "./progress-timer";

describe("nextStartedAt", () => {
  it("records the first time a step is running", () => {
    const next = nextStartedAt(
      {},
      [{ id: "search", status: "running" }],
      1000,
    );
    expect(next).toEqual({ search: 1000 });
  });

  it("keeps the original start while the same step is still running", () => {
    const next = nextStartedAt(
      { search: 1000 },
      [{ id: "search", status: "running" }],
      1800,
    );
    expect(next).toEqual({ search: 1000 });
  });

  it("starts a new clock when the log is cleared for another tasting", () => {
    const previous = nextStartedAt(
      { search: 1000 },
      [],
      4000,
    );
    expect(previous).toEqual({});

    const next = nextStartedAt(
      previous,
      [{ id: "search", status: "running" }],
      5000,
    );
    expect(next).toEqual({ search: 5000 });
  });

  it("starts a new clock when a finished step runs again", () => {
    const afterDone = nextStartedAt(
      { search: 1000 },
      [{ id: "search", status: "done" }],
      2500,
    );
    const next = nextStartedAt(
      afterDone,
      [{ id: "search", status: "running" }],
      8000,
    );
    expect(next).toEqual({ search: 8000 });
  });
});
