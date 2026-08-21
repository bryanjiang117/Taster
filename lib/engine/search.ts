import * as cheerio from "cheerio";

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export interface SearchClient {
  search(query: string): Promise<SearchHit[]>;
}

export interface PageClient {
  fetchText(url: string): Promise<string | FetchedPage>;
}

export type FetchedPage = {
  text: string;
  url: string;
  status?: number;
  /** From raw HTML before body extraction — used for dish matching. */
  pageTitle?: string;
};

export function asFetchedPage(
  result: string | FetchedPage,
  requestedUrl: string,
): FetchedPage {
  if (typeof result === "string") {
    return {
      text: result,
      url: requestedUrl,
      pageTitle: pageTitleFromHtml(result),
    };
  }
  return {
    text: result.text,
    url: result.url || requestedUrl,
    status: result.status,
    pageTitle: result.pageTitle ?? pageTitleFromHtml(result.text),
  };
}

export function pageFetchOk(page: FetchedPage): boolean {
  if (page.status == null) return true;
  return page.status >= 200 && page.status < 400;
}

const CHALLENGE_URL = /humancheck|captcha|recaptcha|hcaptcha|turnstile/i;

export function pageUrlIsChallenge(url: string): boolean {
  try {
    const parsed = new URL(url);
    return CHALLENGE_URL.test(`${parsed.pathname}${parsed.search}`);
  } catch {
    return CHALLENGE_URL.test(url);
  }
}

export function recipePageUrl(fetchedUrl: string, requestedUrl: string): string {
  if (!pageUrlIsChallenge(fetchedUrl)) return fetchedUrl;
  return (
    recipeUrlFromNextParam(fetchedUrl) ??
    (pageUrlIsChallenge(requestedUrl) ? fetchedUrl : requestedUrl)
  );
}

function recipeUrlFromNextParam(url: string): string | null {
  try {
    const parsed = new URL(url);
    const next = parsed.searchParams.get("next");
    if (!next) return null;
    const resolved = new URL(next, parsed.origin);
    if (resolved.origin !== parsed.origin) return null;
    if (pageUrlIsChallenge(resolved.href)) return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/** Extra HTML search is always merged so a short Gemini list is not the whole pool. */

export async function searchWithFallback(
  primary: SearchClient,
  fallback: SearchClient,
  query: string,
): Promise<SearchHit[]> {
  const [primaryResult, extraResult] = await Promise.allSettled([
    primary.search(query),
    fallback.search(query),
  ]);
  const fromPrimary =
    primaryResult.status === "fulfilled" ? primaryResult.value : [];
  const fromExtra =
    extraResult.status === "fulfilled" ? extraResult.value : [];
  return uniqueSearchHits([...fromPrimary, ...fromExtra]);
}

export function uniqueSearchHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.split("?")[0] ?? hit.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const MIN_TRUSTED_PAGE_CHARS = 500;

export function htmlToPageText(html: string): string {
  const $ = cheerio.load(html);
  const jsonLd: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (raw) jsonLd.push(raw);
  });
  $("script, style, nav, footer, iframe").remove();
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (jsonLd.length) parts.push(`JSON-LD:\n${jsonLd.join("\n")}`);
  if (body) parts.push(body);
  return parts.join("\n").slice(0, 12_000);
}

/** Page-grounded title for dish matching — never trust LLM search/extract titles alone. */
export function pageTitleFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const og =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $('meta[name="og:title"]').attr("content")?.trim() ||
    "";
  if (og) return og;
  const docTitle = $("title").first().text().replace(/\s+/g, " ").trim();
  if (docTitle) return docTitle;
  return $("h1").first().text().replace(/\s+/g, " ").trim();
}

export function pageTextIsTrusted(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/JSON-LD:/i.test(trimmed) && trimmed.length >= 32) return true;
  return trimmed.length >= MIN_TRUSTED_PAGE_CHARS;
}

export class DuckDuckGoSearch implements SearchClient {
  constructor(private readonly signal?: AbortSignal) {}

  async search(query: string): Promise<SearchHit[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: this.signal,
    });
    if (!response.ok) {
      throw new Error(`Search failed (${response.status})`);
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const hits: SearchHit[] = [];

    $(".result").each((_, el) => {
      const title = $(el).find(".result__a").text().trim();
      const href = $(el).find(".result__a").attr("href") ?? "";
      const snippet = $(el).find(".result__snippet").text().trim();
      const resolved = unwrapDuckDuckGoUrl(href);
      if (title && resolved) {
        hits.push({ title, url: resolved, snippet });
      }
    });

    return hits.slice(0, 12);
  }
}

export class FetchPageClient implements PageClient {
  constructor(private readonly signal?: AbortSignal) {}

  async fetchText(url: string): Promise<FetchedPage> {
    const timeout = AbortSignal.timeout(12_000);
    const signal = this.signal ? AbortSignal.any([timeout, this.signal]) : timeout;
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal,
    });
    const html = await response.text();
    return {
      text: htmlToPageText(html),
      url: response.url || url,
      status: response.status,
      pageTitle: pageTitleFromHtml(html),
    };
  }
}

function unwrapDuckDuckGoUrl(href: string): string {
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return href;
  }
}
