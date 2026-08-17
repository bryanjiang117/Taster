import { normalizeIngredientName } from "./normalize";
import type { ResolvedIngredient } from "./types";

export class IngredientStore {
  private records = new Map<string, ResolvedIngredient>();

  constructor(seed: ResolvedIngredient[] = []) {
    for (const item of seed) this.put(item);
  }

  get(name: string): ResolvedIngredient | undefined {
    return this.records.get(normalizeIngredientName(name));
  }

  put(record: ResolvedIngredient): void {
    this.records.set(normalizeIngredientName(record.ingredient), {
      ...record,
      ingredient: normalizeIngredientName(record.ingredient),
    });
  }

  has(name: string): boolean {
    return this.records.has(normalizeIngredientName(name));
  }

  all(): ResolvedIngredient[] {
    return [...this.records.values()];
  }
}
