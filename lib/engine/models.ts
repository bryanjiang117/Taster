export const FAST_MODEL = "gemini-3.5-flash-lite";
export const SMART_MODEL = "gemini-3.6-flash";

const HARD_INGREDIENT =
  /\b(sauce|paste|dressing|marinade|condiment|extract|fermented|pickled|aged|miso|gochujang|doenjang|doubanjiang|douchi|ponzu|teriyaki|kecap|sambal|harissa|marmite|anchovy|garum|koji|nuruk|jeotgal|shrimp paste|bean paste|fish paste|xo)\b|[酱醬장]/i;

export function needsSmartIngredient(name: string): boolean {
  return HARD_INGREDIENT.test(name.trim());
}

export function shouldEscalateOrigin(origin: {
  country?: string;
  nativeName?: string;
  languageCode?: string;
  searchQueries?: string[];
}): boolean {
  const queries = origin.searchQueries ?? [];
  const native = origin.nativeName?.trim() ?? "";
  const country = origin.country?.trim() ?? "";
  if (!country || country.toLowerCase() === "unknown") return true;
  if (!native) return true;
  if (queries.length < 2) return true;
  const asciiOnly = /^[\x00-\x7F]+$/.test(native);
  const lang = (origin.languageCode ?? "en").toLowerCase();
  if (asciiOnly && !lang.startsWith("en") && queries.every((q) => /^[\x00-\x7F]+$/.test(q))) {
    return true;
  }
  return false;
}
