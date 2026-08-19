#!/usr/bin/env python3
"""Cited Umami Information Center / Ninomiya snapshot → umami-taste.json.

UmamiDB has no bulk dump. Values are published free glutamate / nucleotide
concentrations (mg/100g) from UIC tables and Ninomiya 1998.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "lib/engine/testdata/umami-taste.json"

# mg/100g. Ninomiya K. (1998) Food Rev. Int.; Umami Information Center tables.
FOODS = [
    {
        "id": "kombu",
        "name": "Kombu",
        "aliases": ["kombu", "kelp", "konbu"],
        "compounds": [{"id": "glutamate", "amount": 1600}],
    },
    {
        "id": "nori",
        "name": "Nori",
        "aliases": ["nori", "laver"],
        "compounds": [{"id": "glutamate", "amount": 1378}],
    },
    {
        "id": "wakame",
        "name": "Wakame",
        "aliases": ["wakame"],
        "compounds": [{"id": "glutamate", "amount": 9}],
    },
    {
        "id": "dried-shiitake",
        "name": "Dried shiitake",
        "aliases": ["shiitake", "dried shiitake"],
        "compounds": [
            {"id": "glutamate", "amount": 1060},
            {"id": "gmp", "amount": 150},
        ],
    },
    {
        "id": "fresh-shiitake",
        "name": "Fresh shiitake",
        "aliases": ["fresh shiitake"],
        "compounds": [{"id": "glutamate", "amount": 70}],
    },
    {
        "id": "katsuobushi",
        "name": "Katsuobushi",
        "aliases": ["katsuobushi", "bonito flakes"],
        "compounds": [
            {"id": "glutamate", "amount": 30},
            {"id": "imp", "amount": 600},
        ],
    },
    {
        "id": "soy-sauce",
        "name": "Soy sauce",
        "aliases": ["soy sauce"],
        "compounds": [{"id": "glutamate", "amount": 800}],
    },
    {
        "id": "parmesan",
        "name": "Parmesan",
        "aliases": ["parmesan"],
        "compounds": [{"id": "glutamate", "amount": 1400}],
    },
    {
        "id": "tomato",
        "name": "Tomato, ripe",
        "aliases": ["tomato", "tomatoes"],
        "compounds": [{"id": "glutamate", "amount": 200}],
    },
    {
        "id": "green-tea",
        "name": "Green tea",
        "aliases": ["green tea"],
        "compounds": [{"id": "glutamate", "amount": 220}],
    },
    {
        "id": "scallop",
        "name": "Scallop",
        "aliases": ["scallop"],
        "compounds": [
            {"id": "glutamate", "amount": 140},
            {"id": "gmp", "amount": 10},
        ],
    },
    {
        "id": "sardine",
        "name": "Sardine",
        "aliases": ["sardine"],
        "compounds": [
            {"id": "glutamate", "amount": 280},
            {"id": "imp", "amount": 280},
        ],
    },
]


def dump_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def main() -> None:
    by_name: dict[str, str] = {}
    by_id: dict[str, dict] = {}
    for food in FOODS:
        by_id[food["id"]] = {"name": food["name"], "compounds": food["compounds"]}
        for alias in [food["name"], *food["aliases"]]:
            by_name[dump_key(alias)] = food["id"]
    OUT_PATH.write_text(
        json.dumps(
            {
                "source": "Umami Information Center / Ninomiya 1998 published free amino acid tables. Snapshot, not a live scrape.",
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
