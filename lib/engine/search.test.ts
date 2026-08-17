import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asFetchedPage,
  FetchPageClient,
  htmlToPageText,
  pageFetchOk,
  pageTextIsTrusted,
  searchWithFallback,
  type SearchHit,
} from "./search";

const hit = (n: number): SearchHit => ({
  title: `Recipe ${n}`,
  url: `https://example.com/r${n}`,
  snippet: "",
});

describe("searchWithFallback", () => {
  it("uses the fallback when the primary search returns too few pages", async () => {
    const queries: string[] = [];
    const hits = await searchWithFallback(
      { search: async () => [hit(1)] },
      {
        search: async (query) => {
          queries.push(query);
          return [hit(1), hit(2), hit(3), hit(4), hit(5)];
        },
      },
      "麻婆豆腐 食谱",
    );

    expect(queries).toEqual(["麻婆豆腐 食谱"]);
    expect(hits.map((item) => item.url)).toEqual([
      "https://example.com/r1",
      "https://example.com/r2",
      "https://example.com/r3",
      "https://example.com/r4",
      "https://example.com/r5",
    ]);
  });

  it("still merges fallback pages when the primary already returned several URLs", async () => {
    const hits = await searchWithFallback(
      { search: async () => [hit(1), hit(2), hit(3), hit(4), hit(5)] },
      { search: async () => [hit(9)] },
      "query",
    );

    expect(hits.map((item) => item.url)).toEqual([
      "https://example.com/r1",
      "https://example.com/r2",
      "https://example.com/r3",
      "https://example.com/r4",
      "https://example.com/r5",
      "https://example.com/r9",
    ]);
  });

  it("runs primary and fallback search at the same time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const delaySearch = (hits: SearchHit[]) => ({
      search: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        return hits;
      },
    });

    const hits = await searchWithFallback(
      delaySearch([hit(1)]),
      delaySearch([hit(2)]),
      "query",
    );

    expect(maxInFlight).toBe(2);
    expect(hits.map((item) => item.url)).toEqual([
      "https://example.com/r1",
      "https://example.com/r2",
    ]);
  });
});

describe("htmlToPageText", () => {
  it("keeps JSON-LD recipe data that lives in script tags", () => {
    const text = htmlToPageText(`
      <html><body>
        <script type="application/ld+json">{"@type":"Recipe","recipeIngredient":["tofu","soy sauce"]}</script>
        <script>window.__SPA = true</script>
        <p>Enable JavaScript to view this recipe.</p>
      </body></html>
    `);
    expect(text).toContain("JSON-LD:");
    expect(text).toContain("tofu");
    expect(text).toContain("soy sauce");
    expect(text).not.toContain("window.__SPA");
    expect(pageTextIsTrusted(text)).toBe(true);
  });

  it("does not trust a short JavaScript shell as a recipe page", () => {
    const text = htmlToPageText(
      "<html><body><p>Enable JavaScript</p></body></html>",
    );
    expect(pageTextIsTrusted(text)).toBe(false);
  });
});

describe("asFetchedPage", () => {
  it("keeps a plain string as the requested URL", () => {
    expect(asFetchedPage("hello", "https://example.com/a")).toEqual({
      text: "hello",
      url: "https://example.com/a",
    });
  });

  it("uses the resolved URL when the fetcher followed a redirect", () => {
    expect(
      asFetchedPage(
        { text: "recipe", url: "https://example.com/real" },
        "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
      ),
    ).toEqual({ text: "recipe", url: "https://example.com/real" });
  });
});

describe("pageFetchOk", () => {
  it("treats a missing status as a successful fetch", () => {
    expect(pageFetchOk({ text: "x", url: "https://example.com" })).toBe(true);
  });

  it("rejects HTTP error pages", () => {
    expect(
      pageFetchOk({
        text: "error",
        url: "https://wtable.co.kr/recipes/1064",
        status: 500,
      }),
    ).toBe(false);
  });
});

describe("FetchPageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the URL after redirects", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        ({
          ok: true,
          status: 200,
          url: "https://example.com/som-tam",
          text: async () =>
            `<html><body><p>${"papaya fish sauce chili ".repeat(40)}</p></body></html>`,
        }) as Response,
    );

    const page = await new FetchPageClient().fetchText(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    );

    expect(page).toEqual({
      text: expect.stringContaining("papaya"),
      url: "https://example.com/som-tam",
      status: 200,
    });
  });
});
