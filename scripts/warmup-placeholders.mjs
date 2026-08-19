import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_FILE = join(ROOT, "lib/ui/typewriter-placeholder.ts");
const BASE = process.env.TASTER_URL ?? "http://localhost:3000";
const RESULTS =
  process.env.TASTER_RESULTS ?? "/tmp/taster-placeholder-warmup.jsonl";
const PRIOR_RESULTS = [
  "/tmp/taster-warmup-results.jsonl",
  RESULTS,
];
const PAUSE_MS = 3_000;
const MAX_RETRIES = 2;

function loadDishes() {
  const source = readFileSync(PLACEHOLDER_FILE, "utf8");
  const match = source.match(
    /export const DISH_PLACEHOLDERS = \[([\s\S]*?)\] as const;/,
  );
  if (!match) throw new Error("Could not parse DISH_PLACEHOLDERS");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function loadCompleted() {
  const ok = new Set();
  for (const path of PRIOR_RESULTS) {
    try {
      const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const row = JSON.parse(line);
        if (row.ok) ok.add(row.dish);
      }
    } catch {
      // missing file
    }
  }
  return ok;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTaste(taste) {
  if (!taste) return "";
  return Object.entries(taste)
    .map(([k, v]) => `${k[0]}${v}`)
    .join(" ");
}

async function profileDish(dish) {
  const res = await fetch(`${BASE}/api/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dish, useCache: false, typedLanguage: false }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return {
      type: "error",
      error: `HTTP ${res.status} ${text.slice(0, 200)}`,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last = null;
  let lastStep = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((row) => row.startsWith("data: "));
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      last = event;
      if (event.type === "step" && event.status === "running") {
        lastStep = event.message;
        console.log(`  … ${event.message}`);
      }
      if (event.type === "done" || event.type === "error") return event;
    }
  }

  return (
    last ?? {
      type: "error",
      error: `stream closed without done (${lastStep || "no steps"})`,
    }
  );
}

async function runDish(dish) {
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`  retry ${attempt}/${MAX_RETRIES} after ${lastError}`);
      await sleep(PAUSE_MS * attempt);
    }
    const t0 = Date.now();
    try {
      const event = await profileDish(dish);
      const ms = Date.now() - t0;
      if (event?.type === "done") {
        const result = event.result ?? {};
        const names = (result.representative?.ingredients ?? []).map((x) => x.name);
        return {
          dish,
          ok: true,
          ms,
          recipes: result.recipesAnalyzed,
          confidence: result.confidence,
          taste: result.taste,
          ingredients: names,
          origin: result.origin?.culture ?? result.origin?.country,
        };
      }
      lastError = event?.error ?? "unknown error";
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
  }
  return { dish, ok: false, ms: 0, error: lastError };
}

const all = loadDishes();
const completed = loadCompleted();
const pending = all.filter((dish) => !completed.has(dish));
const started = Date.now();
let okCount = completed.size;
let failCount = 0;

console.log(`${all.length} placeholder dishes; ${completed.size} already cached`);
console.log(`Running ${pending.length} via ${BASE}`);
console.log(`Results → ${RESULTS}\n`);

for (let i = 0; i < pending.length; i++) {
  const dish = pending[i];
  console.log(`\n[${i + 1}/${pending.length}] ${dish}`);
  const row = await runDish(dish);
  if (row.ok) {
    okCount += 1;
    console.log(
      `  ✓ ${row.ms}ms recipes=${row.recipes} conf=${Math.round((row.confidence ?? 0) * 100)}% ${formatTaste(row.taste)} (${row.ingredients.length} ings)`,
    );
  } else {
    failCount += 1;
    console.log(`  ✗ ${row.error}`);
  }
  appendFileSync(RESULTS, JSON.stringify(row) + "\n");
  if (i < pending.length - 1) await sleep(PAUSE_MS);
}

console.log(
  `\nDone ${okCount}/${all.length} cached (${failCount} failed this run) in ${Math.round((Date.now() - started) / 1000)}s`,
);
process.exit(failCount ? 1 : 0);
