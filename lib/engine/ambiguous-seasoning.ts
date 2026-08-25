import type { TasteDimension } from "./types";

const SALT =
  /\b(kosher\s+salt|sea\s+salt|table\s+salt|salt|sal|sel|塩|盐)\b/i;
const SWEETENER =
  /\b(brown\s+sugar|white\s+sugar|cane\s+sugar|palm\s+sugar|coconut\s+sugar|powdered\s+sugar|castor\s+sugar|sugar|honey|maple\s+syrup|molasses|agave|jaggery|糖|砂糖|蜂蜜)\b/i;
const ACID =
  /\b(lemon\s+juice|lime\s+juice|lemon|lime|yuzu|vinegar|rice\s+vinegar|apple\s+cider\s+vinegar|balsamic|citric\s+acid|柠檬|檸檬|ライム|醋|酢)\b/i;
/** Chili heat seasoners — not black pepper / Sichuan peppercorn. */
const CHILI =
  /\b(thai\s+chili|bird(?:'s)?\s*eye\s+chili|birdseye\s+chili|chili\s+pepper|chilli\s+pepper|hot\s+chili|dried\s+chili|chili\s+flakes?|chilli\s+flakes?|red\s+pepper\s+flakes?|cayenne|habanero|jalape[nñ]o|scotch\s*bonnet|gochugaru|chili|chilli|辣椒|干辣椒|朝天椒)\b/i;
const UMAMI_BOOSTER = /\b(msg|monosodium\s+glutamate|味の素|味精)\b/i;

/** Name classes that code still sizes as to-taste when Gemini amount-fill fails. */
export function primarySeasonerDimension(name: string): TasteDimension | null {
  const n = name.trim();
  if (!n) return null;
  if (SALT.test(n)) return "salty";
  if (SWEETENER.test(n)) return "sweet";
  if (ACID.test(n)) return "sour";
  if (CHILI.test(n)) return "spicy";
  if (UMAMI_BOOSTER.test(n)) return "umami";
  return null;
}
