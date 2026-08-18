import { describe, expect, it } from "vitest";
import { parseJsonText } from "./llm-parse";

describe("parseJsonText", () => {
  it("parses a compact object", () => {
    expect(parseJsonText<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(parseJsonText<{ a: number }>("```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
  });

  it("recovers fields when a long string is truncated at a ~64KB cap", () => {
    const prefix =
      '{"strategy":"llm","taste":{"sweet":1,"sour":0,"salty":2,"spicy":3,"umami":1,"bitter":0},"reasoning":"';
    const truncated = prefix + "x".repeat(65_000 - prefix.length);
    expect(truncated.length).toBe(65_000);

    const parsed = parseJsonText<{
      strategy: string;
      taste: { spicy: number };
    }>(truncated);
    expect(parsed.strategy).toBe("llm");
    expect(parsed.taste.spicy).toBe(3);
  });
});
