#!/usr/bin/env python3
"""Build a slim FooDB taste extract from the public 2020 JSON dump. No API key."""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = Path("/tmp/foodb-json/foodb_2020_04_07_json.zip")
OUT_PATH = ROOT / "lib/engine/testdata/foodb-taste.json"
COMPOUNDS_TS = ROOT / "lib/engine/compounds.ts"


def normalize(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower().replace("_", " ").replace("-", " "))


def aliases_from_ts() -> dict[str, str]:
    text = COMPOUNDS_TS.read_text()
    mapping: dict[str, str] = {}
    for block in re.finditer(
        r'id:\s*"([^"]+)"[\s\S]*?aliases:\s*\[([^\]]+)\]',
        text,
    ):
        cid = block.group(1)
        aliases = re.findall(r'"([^"]+)"', block.group(2))
        mapping[normalize(cid)] = cid
        for alias in aliases:
            mapping[normalize(alias)] = cid
    extra = {
        "sodium, na": "sodium",
        "na": "sodium",
        "sucrose": "sucrose",
        "total sugars": "sucrose",
        "sugars, total": "sucrose",
        "citric acid, total": "citric_acid",
        "l glutamic acid": "glutamate",
        "glutamic acid": "glutamic_acid_bound",
        "msg": "glutamate",
        "capsaicinoids": "capsaicin",
        "dihydrocapsaicin": "capsaicin",
        "6 gingerol": "gingerol",
        "6 shogaol": "gingerol",
        "tannins": "tannin",
        "tannic acid": "tannin",
        "catechins": "tannin",
        "glucosinolates": "sinigrin",
    }
    mapping.update(extra)
    return mapping


def units_from_ts() -> dict[str, str]:
    text = COMPOUNDS_TS.read_text()
    units: dict[str, str] = {}
    for block in re.finditer(
        r'id:\s*"([^"]+)"[\s\S]*?unit:\s*"(g_per_100g|mg_per_100g)"',
        text,
    ):
        units[block.group(1)] = block.group(2)
    return units


def parse_amount(obj: dict, unit: str) -> float | None:
    for key in ("standard_content", "orig_content"):
        raw = obj.get(key)
        if raw in (None, "", "null"):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value <= 0:
            continue
        raw_unit = str(obj.get("orig_unit") or "").lower().replace(" ", "")
        is_mg = raw_unit.startswith("mg") or "mg/" in raw_unit
        is_ug = "ug" in raw_unit or "µg" in raw_unit
        mg = value
        if is_ug:
            mg = value / 1000
        elif not is_mg and ("g/100" in raw_unit or raw_unit == "g"):
            mg = value * 1000
        if unit == "g_per_100g":
            return mg / 1000
        return mg
    return None


def main() -> None:
    aliases = aliases_from_ts()
    units = units_from_ts()
    z = zipfile.ZipFile(ZIP_PATH)
    foods: dict[int, dict] = {}
    by_name: dict[str, str] = {}
    with z.open("foodb_2020_04_07_json/Food.json") as handle:
        for line in handle:
            food = json.loads(line)
            fid = int(food["id"])
            public_id = food.get("public_id") or f"FOOD{fid:05d}"
            name = food.get("name") or public_id
            foods[fid] = {"id": public_id, "name": name, "compounds": {}}
            by_name[normalize(name)] = public_id

    kept = 0
    scanned = 0
    with z.open("foodb_2020_04_07_json/Content.json") as handle:
        for line in handle:
            scanned += 1
            if scanned % 500_000 == 0:
                print(f"scanned {scanned} kept {kept}", flush=True)
            row = json.loads(line)
            source_name = row.get("orig_source_name") or ""
            cid = aliases.get(normalize(str(source_name)))
            if not cid:
                continue
            amount = parse_amount(row, units.get(cid, "mg_per_100g"))
            if amount is None:
                continue
            food = foods.get(int(row["food_id"]))
            if not food:
                continue
            prev = food["compounds"].get(cid)
            if prev is None or amount > prev:
                food["compounds"][cid] = amount
            kept += 1

    by_id = {}
    for food in foods.values():
        if not food["compounds"]:
            continue
        by_id[food["id"]] = {
            "name": food["name"],
            "compounds": [
                {"id": cid, "amount": amount}
                for cid, amount in sorted(food["compounds"].items())
            ],
        }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    named = {
        name: fid
        for name, fid in by_name.items()
        if fid in by_id
    }
    payload = {
        "source": "FooDB 2020-04-07 public JSON dump (no API key)",
        "url": "https://foodb.ca/system/downloads/foodb_2020_04_07_json.zip",
        "byName": named,
        "byId": by_id,
    }
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    print(
        f"wrote {OUT_PATH} foods={len(by_id)} names={len(named)} "
        f"bytes={OUT_PATH.stat().st_size} scanned={scanned} kept={kept}"
    )


if __name__ == "__main__":
    main()
