const ALIAS_PAIRS: Array<[string, string]> = [
  ["fishsauce", "fish sauce"],
  ["nam pla", "fish sauce"],
  ["nuoc mam", "fish sauce"],
  ["น้ำปลา", "fish sauce"],
  ["table salt", "salt"],
  ["kosher salt", "salt"],
  ["sea salt", "salt"],
  ["盐", "salt"],
  ["鹽", "salt"],
  ["소금", "salt"],
  ["塩", "salt"],
  ["white sugar", "sugar"],
  ["granulated sugar", "sugar"],
  ["糖", "sugar"],
  ["砂糖", "sugar"],
  ["설탕", "sugar"],
  ["palm sugar", "palm sugar"],
  ["น้ำตาล", "palm sugar"],
  ["soya sauce", "soy sauce"],
  ["shoyu", "soy sauce"],
  ["light soy sauce", "soy sauce"],
  ["dark soy sauce", "soy sauce"],
  ["酱油", "soy sauce"],
  ["醬油", "soy sauce"],
  ["生抽", "soy sauce"],
  ["老抽", "soy sauce"],
  ["豉油", "soy sauce"],
  ["醤油", "soy sauce"],
  ["しょうゆ", "soy sauce"],
  ["간장", "soy sauce"],
  ["scallion", "green onion"],
  ["spring onion", "green onion"],
  ["葱", "green onion"],
  ["蔥", "green onion"],
  ["파", "green onion"],
  ["cilantro", "cilantro"],
  ["coriander leaves", "cilantro"],
  ["bird's eye chili", "chili"],
  ["bird eye chili", "chili"],
  ["thai chili", "chili"],
  ["chilli", "chili"],
  ["chilies", "chili"],
  ["chilis", "chili"],
  ["辣椒", "chili"],
  ["고추", "chili"],
  ["พริก", "chili"],
  ["豆腐", "tofu"],
  ["tofu", "tofu"],
  ["มะนาว", "lime"],
  ["柠檬", "lime"],
  ["檸檬", "lime"],
  ["蒜", "garlic"],
  ["大蒜", "garlic"],
  ["마늘", "garlic"],
  ["姜", "ginger"],
  ["薑", "ginger"],
  ["생강", "ginger"],
  ["醋", "vinegar"],
  ["식초", "vinegar"],
  ["水", "water"],
  ["물", "water"],
  ["味精", "msg"],
  ["고추장", "gochujang"],
  ["된장", "doenjang"],
  ["味噌", "miso"],
  ["みそ", "miso"],
  ["みりん", "mirin"],
  ["猪肉", "pork"],
  ["豬肉", "pork"],
  ["牛肉", "beef"],
  ["鸡肉", "chicken"],
  ["雞肉", "chicken"],
  ["虾", "shrimp"],
  ["蝦", "shrimp"],
  ["米", "rice"],
  ["椰浆", "coconut milk"],
  ["กะทิ", "coconut milk"],
];

function cleanName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES = new Map(ALIAS_PAIRS.map(([from, to]) => [cleanName(from), to]));

const IRREGULAR_PLURALS: Record<string, string> = {
  leaves: "leaf",
  loaves: "loaf",
  berries: "berry",
  cherries: "cherry",
  tomatoes: "tomato",
  potatoes: "potato",
  cloves: "clove",
};

const UNCOUNTABLE = new Set([
  "molasses",
  "couscous",
  "hummus",
  "asparagus",
  "watercress",
  "lemongrass",
]);

export function normalizeIngredientName(name: string): string {
  const cleaned = cleanName(name);
  if (!cleaned) return "";
  return ALIASES.get(cleaned) ?? singularizePhrase(cleaned);
}

function singularizePhrase(name: string): string {
  return name
    .split(" ")
    .map((word) => singularizeWord(word))
    .join(" ");
}

function singularizeWord(word: string): string {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (UNCOUNTABLE.has(word)) return word;
  if (!/^[a-z]+$/i.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}
