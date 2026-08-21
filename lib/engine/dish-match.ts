export type DishIdentity = {
  dish: string;
  nativeName: string;
};

export type DishHitText = {
  title: string;
  snippet: string;
  url: string;
};

export type PageDishEvidence = {
  /** Live page URL after redirects (not a search-hit label). */
  url?: string;
  /** Document / og / h1 title from fetched HTML. */
  pageTitle?: string;
};

export function matchesDish(text: string, identity: DishIdentity): boolean {
  const hay = fold(text);
  if (!hay) return false;

  const native = fold(identity.nativeName);
  if (hasNativeName(hay, native)) return true;

  const dish = fold(identity.dish);
  if (dish.length < 2) return false;
  if (hay.includes(dish)) return true;
  if (compactContains(compact(hay), compact(dish))) return true;

  const tokens = dish.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;

  // Multi-word Latin names need a contiguous phrase (tres leches), not
  // scattered tokens (tres … leche elsewhere on the page).
  if (tokens.length >= 2 && !primaryScript(dish)) {
    return phraseContains(hay, tokens);
  }

  return tokens.every((token) => fuzzyContains(hay, token));
}

export function recipeMatchesDish(
  recipeTitle: string | undefined,
  hit: DishHitText,
  identity: DishIdentity,
  page?: PageDishEvidence,
): boolean {
  // Extract title is veto-only: an honest other-dish name rejects. A matching
  // extract title must not accept — models invent the query dish on wrong URLs.
  if (extractedTitleIsOtherDish(recipeTitle, identity)) return false;

  const pageUrl = page?.url ?? hit.url;
  const pageTitle = page?.pageTitle ?? "";
  if (matchesDish(`${pageUrl} ${pageTitle}`, identity)) return true;

  // No document title (captcha / empty shell): search-hit title is the only
  // page-identity signal left. Do not use this fallback when HTML already
  // named a different dish — that is how wrong URLs get laundered.
  if (pageTitle) return false;
  return matchesDish(`${hit.title} ${hit.snippet}`, identity);
}

function extractedTitleIsOtherDish(
  recipeTitle: string | undefined,
  identity: DishIdentity,
): boolean {
  const extracted = fold(recipeTitle ?? "");
  if (!extracted) return false;
  if (matchesDish(extracted, identity)) return false;
  const native = fold(identity.nativeName);
  if (native.length >= 2 && nativeTitleAgrees(extracted, native)) return false;

  const extractScript = primaryScript(extracted);
  const nativeScript = primaryScript(native);

  // Same non-Latin script, different dish (鱼香茄子 vs 水煮肉片).
  if (nativeScript && extractScript === nativeScript) return true;

  // Latin extract naming a different Latin-script dish (torta vs paella).
  // Do not veto Latin titles when the native name is non-Latin — those are
  // usually translations of the same dish.
  if (!extractScript && !nativeScript && native.length >= 2) return true;

  return false;
}

function nativeTitleAgrees(extracted: string, native: string): boolean {
  return extracted.includes(native) || native.includes(extracted);
}

function primaryScript(text: string): string | null {
  if (/\p{Script=Han}/u.test(text)) return "han";
  if (/\p{Script=Thai}/u.test(text)) return "thai";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "japanese";
  if (/\p{Script=Hangul}/u.test(text)) return "hangul";
  if (/\p{Script=Cyrillic}/u.test(text)) return "cyrillic";
  if (/\p{Script=Arabic}/u.test(text)) return "arabic";
  if (/\p{Script=Devanagari}/u.test(text)) return "devanagari";
  return null;
}

function hasNativeName(hay: string, native: string): boolean {
  return native.length >= 2 && hay.includes(native);
}

function phraseContains(hay: string, tokens: string[]): boolean {
  const words = hay.split(/\s+/).filter(Boolean);
  if (words.length < tokens.length) return false;
  for (let i = 0; i <= words.length - tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) {
      const token = tokens[j]!;
      const word = words[i + j]!;
      if (word === token) continue;
      const maxDist = maxEdits(token.length);
      if (maxDist === 0 || levenshtein(word, token) > maxDist) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function compactContains(hay: string, needle: string): boolean {
  if (needle.length < 2) return false;
  if (hay.includes(needle)) return true;
  const maxDist = maxEdits(needle.length);
  if (maxDist === 0) return false;
  for (let i = 0; i <= hay.length - needle.length + maxDist; i++) {
    const end = Math.min(hay.length, i + needle.length + maxDist);
    const window = hay.slice(i, end);
    if (window.length < needle.length - maxDist) continue;
    const slice = window.slice(0, needle.length);
    if (slice.length >= needle.length - maxDist && levenshtein(slice, needle) <= maxDist) {
      return true;
    }
  }
  return false;
}

function fuzzyContains(hay: string, token: string): boolean {
  if (hay.includes(token)) return true;
  const maxDist = maxEdits(token.length);
  if (maxDist === 0) return false;
  return hay.split(/\s+/).some((word) => levenshtein(word, token) <= maxDist);
}

function maxEdits(length: number): number {
  if (length < 5) return 0;
  return Math.max(1, Math.floor(length * 0.2));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i]![0] = i;
  for (let j = 0; j < cols; j++) dist[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dist[a.length]![b.length]!;
}

function fold(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
