import type { SearchMode } from "./dish-cache";
import type { DishOrigin } from "./types";

export const MIN_SEARCH_POOL = 8;

export function expandSearchQueries(
  origin: DishOrigin,
  searchMode: SearchMode = "native",
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const query = raw.trim();
    if (!query) return;
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(query);
  };

  for (const query of origin.searchQueries) add(query);

  const native = origin.nativeName.trim();
  const dish = origin.dish.trim();
  if (searchMode === "typed") {
    if (dish) {
      add(`${dish} recipe`);
      add(dish);
    }
    return out.slice(0, 8);
  }

  if (native) {
    add(`${native} 食谱`);
    add(`${native} 做法`);
    add(`${native} recipe`);
    add(native);
  }
  if (dish && dish.toLowerCase() !== native.toLowerCase()) {
    add(`${dish} recipe`);
    add(dish);
  }
  return out.slice(0, 8);
}
