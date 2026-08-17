export type DishIdentity = {
  dish: string;
  nativeName: string;
};

export type DishHitText = {
  title: string;
  snippet: string;
  url: string;
};

export function matchesDish(text: string, identity: DishIdentity): boolean {
  const hay = fold(text);
  if (!hay) return false;

  const native = fold(identity.nativeName);
  if (hasNativeName(hay, native)) return true;

  const dish = fold(identity.dish);
  if (dish.length >= 2 && hay.includes(dish)) return true;
  if (compactContains(compact(hay), compact(dish))) return true;

  const tokens = dish.split(/\s+/).filter((token) => token.length >= 2);
  return tokens.length > 0 && tokens.every((token) => fuzzyContains(hay, token));
}

export function recipeMatchesDish(
  recipeTitle: string | undefined,
  hit: DishHitText,
  identity: DishIdentity,
): boolean {
  const page = fold(`${hit.title} ${hit.snippet} ${hit.url}`);
  if (hasNativeName(page, fold(identity.nativeName))) return true;
  return matchesDish(
    `${recipeTitle ?? ""} ${hit.title} ${hit.snippet} ${hit.url}`,
    identity,
  );
}

function hasNativeName(hay: string, native: string): boolean {
  return native.length >= 2 && hay.includes(native);
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
