import { normalizeIngredientName } from "./normalize";
import type { CachedDish } from "./dish-cache";

export class DishStore {
  private records = new Map<string, CachedDish>();

  constructor(seed: CachedDish[] = []) {
    for (const item of seed) this.put(item);
  }

  get(name: string): CachedDish | undefined {
    return this.records.get(normalizeIngredientName(name));
  }

  put(record: CachedDish): void {
    const canonicalName = normalizeIngredientName(record.canonicalName);
    this.records.set(canonicalName, { ...record, canonicalName });
  }

  all(): CachedDish[] {
    return [...this.records.values()];
  }
}
