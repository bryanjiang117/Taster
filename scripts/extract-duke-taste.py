#!/usr/bin/env python3
"""Build duke-taste.json from Dr. Duke chemical-plants CSV exports.

Downloads CSVs from phytochem.nal.usda.gov into /tmp/taster-duke/ if missing.
Skips qualitative rows. Midpoint ppm / 10 → mg/100g, matching duke.ts.
"""

from __future__ import annotations

import csv
import io
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_DIR = Path("/tmp/taster-duke")
OUT_PATH = ROOT / "lib/engine/testdata/duke-taste.json"
UA = "Mozilla/5.0 (compatible; taster-ingest/1.0; research)"

CHEMICALS = {
    "piperine": "piperine",
    "capsaicin": "capsaicin",
    "dihydrocapsaicin": "capsaicin",
    "6-gingerol": "gingerol",
    "gingerol": "gingerol",
    "allicin": "allicin",
    "sinigrin": "sinigrin",
    "allyl-isothiocyanate": "allyl_isothiocyanate",
    "caffeine": "caffeine",
    "theobromine": "theobromine",
    "quinine": "quinine",
    "naringin": "naringin",
    "limonin": "limonin",
}

COMMON_NAMES = {
    "piper nigrum": ["black pepper", "pepper", "piper nigrum"],
    "capsicum annuum": ["chile", "paprika", "capsicum", "chili", "cayenne"],
    "capsicum frutescens": [
        "tabasco",
        "thai chili",
        "bird eye chili",
        "birds eye chili",
    ],
    "zingiber officinale": ["ginger"],
    "allium sativum": ["garlic"],
    "allium sativum var. sativum": ["garlic"],
    "armoracia rusticana": ["horseradish"],
    "brassica nigra": ["mustard", "black mustard"],
    "brassica juncea": ["mustard"],
    "sinapis alba": ["mustard"],
    "camellia sinensis": ["tea", "green tea", "black tea"],
    "theobroma cacao": ["cocoa", "cacao", "cocoa powder"],
    "coffea arabica": ["coffee"],
    "citrus paradisi": ["grapefruit"],
    "citrus limon": ["lemon"],
    "wasabia japonica": ["wasabi"],
    "eutrema japonicum": ["wasabi"],
}

PART_RANK = {
    "fruit": 0,
    "rhizome": 1,
    "root": 2,
    "bulb": 3,
    "leaf": 4,
    "seed": 5,
}

SKIP_PARTS = {"essential oil", "essent. oil", "seed essent. oil", "leaf essent. oil"}


def part_rank(part: str) -> int:
    lowered = part.lower()
    for key, rank in PART_RANK.items():
        if key in lowered:
            return rank
    return 99


def dump_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("_", " ").replace("-", " ")).strip()


def parse_ppm(raw: str) -> float | None:
    text = (raw or "").strip().lower()
    if not text or text in {"not available", "na", "-", "*"}:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 0 else None


def midpoint(low: float | None, high: float | None) -> float | None:
    values = [n for n in (low, high) if n is not None]
    if not values:
        return None
    return sum(values) / len(values)


def fetch_csv(slug: str) -> str | None:
    IN_DIR.mkdir(parents=True, exist_ok=True)
    path = IN_DIR / f"{slug}.csv"
    if path.exists() and path.stat().st_size > 50:
        return path.read_text(encoding="utf-8", errors="replace")
    page_url = f"https://phytochem.nal.usda.gov/chemical-{slug}"
    req = urllib.request.Request(page_url, headers={"User-Agent": UA})
    try:
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        print(f"skip {slug}: {exc}")
        return None
    match = re.search(r"csv-export/(\d+)", html)
    if not match:
        print(f"skip {slug}: no export id")
        return None
    csv_url = f"https://phytochem.nal.usda.gov/chemical-plants-csv-export/{match.group(1)}?page&_format=csv"
    req = urllib.request.Request(csv_url, headers={"User-Agent": UA})
    data = urllib.request.urlopen(req, timeout=30).read()
    path.write_bytes(data)
    return data.decode("utf-8", errors="replace")


def main() -> None:
    foods: dict[tuple[str, str], dict[str, float]] = defaultdict(dict)
    for slug, compound in CHEMICALS.items():
        text = fetch_csv(slug)
        if not text:
            continue
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            plant = (row.get("Plant Name") or "").strip()
            part = (row.get("Plant Part") or "").strip()
            if not plant:
                continue
            if part.lower() in SKIP_PARTS:
                continue
            ppm = midpoint(
                parse_ppm(row.get("Low Parts Per Million") or ""),
                parse_ppm(row.get("High Parts Per Million") or ""),
            )
            if ppm is None:
                continue
            mg = round(ppm / 10, 4)
            key = (plant, part or "Plant")
            foods[key][compound] = max(foods[key].get(compound, 0), mg)

    by_id: dict[str, dict] = {}
    by_name: dict[str, str] = {}
    for (plant, part), compounds in foods.items():
        display = f"{plant}, {part}" if part else plant
        food_id = dump_key(display)[:80]
        by_id[food_id] = {
            "name": display,
            "part": part,
            "compounds": [{"id": k, "amount": v} for k, v in compounds.items()],
        }
        names = [display, plant, *COMMON_NAMES.get(plant.lower(), [])]
        for name in names:
            dk = dump_key(name)
            if not dk:
                continue
            prev = by_name.get(dk)
            if prev:
                prev_part = by_id[prev].get("part") or ""
                if part_rank(part) >= part_rank(prev_part):
                    continue
            by_name[dk] = food_id

    if not by_id:
        print("No Duke rows; leaving existing snapshot.")
        return
    OUT_PATH.write_text(
        json.dumps(
            {
                "source": "USDA Dr. Duke Phytochemical and Ethnobotanical Databases; quantified ppm midpoint.",
                "byName": by_name,
                "byId": by_id,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"Wrote {len(by_id)} foods to {OUT_PATH}")


if __name__ == "__main__":
    main()
