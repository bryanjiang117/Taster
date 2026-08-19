#!/usr/bin/env python3
"""Build phenol-taste.json from Phenol-Explorer composition-data.xlsx.

Put the unzipped official download at /tmp/taster-phenol/composition-data.xlsx.
Cite Phenol-Explorer; this is a derived taste extract (tannin/naringin/limonoid only).
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_PATH = Path("/tmp/taster-phenol/composition-data.xlsx")
OUT_PATH = ROOT / "lib/engine/testdata/phenol-taste.json"

TANNIN_NEEDLES = (
    "catechin",
    "epicatechin",
    "gallocatechin",
    "epigallocatechin",
    "procyanidin",
    "tannin",
    "tannic",
)


def dump_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("_", " ").replace("-", " ")).strip()


def compound_id(name: str) -> str | None:
    n = name.lower()
    n = re.sub(r"^\([+-]\)-", "", n).replace("(+)-", "").replace("(-)-", "")
    if "naringin" in n and "naringenin" not in n:
        return "naringin"
    if "limonin" in n or "limonoid" in n:
        return "limonin"
    if any(needle in n for needle in TANNIN_NEEDLES):
        return "tannin"
    return None


def parse_amount(value, units: str) -> float | None:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    u = (units or "").lower().replace(" ", "")
    if "ug" in u or "µg" in u or "mcg" in u:
        amount = amount / 1000
    return amount


def extra_aliases(name: str) -> list[str]:
    aliases = []
    lower = name.lower()
    if "tea [green]" in lower:
        aliases.extend(["green tea", "tea"])
    if "tea [black]" in lower:
        aliases.extend(["black tea", "tea"])
    if lower.startswith("cocoa"):
        aliases.extend(["cocoa", "cocoa powder"])
    if "grapefruit" in lower and "juice" not in lower:
        aliases.append("grapefruit")
    if "blueberry" in lower and "jam" not in lower:
        aliases.append("blueberry")
    return aliases


def main() -> None:
    if not IN_PATH.exists():
        print(f"No {IN_PATH}; keeping bundled snapshot.")
        return
    try:
        import openpyxl  # type: ignore
    except ImportError:
        raise SystemExit("pip install openpyxl") from None

    wb = openpyxl.load_workbook(IN_PATH, read_only=True, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = [str(c or "") for c in next(rows)]
    idx = {h: i for i, h in enumerate(header)}
    grouped: dict[tuple[str, str, str], dict] = {}
    for row in rows:
        food = str(row[idx["food"]] or "").strip()
        compound = str(row[idx["compound"]] or "").strip()
        method = str(row[idx["experimental_method_group"]] or "").strip()
        cid = compound_id(compound)
        if not food or not cid:
            continue
        amount = parse_amount(row[idx["mean"]], str(row[idx["units"]] or ""))
        if amount is None:
            continue
        key = (food, cid, method)
        prev = grouped.get(key)
        if prev:
            prev["amount"] += amount
        else:
            grouped[key] = {"food": food, "id": cid, "method": method, "amount": amount}
    wb.close()

    # Prefer chromatography over hydrolysis for the same food+class.
    best: dict[tuple[str, str], dict] = {}
    for row in grouped.values():
        key = (row["food"], row["id"])
        method = row["method"].lower()
        hydrolysis = "hydrolysis" in method
        current = best.get(key)
        if current is None:
            best[key] = row
            continue
        current_h = "hydrolysis" in current["method"].lower()
        if current_h and not hydrolysis:
            best[key] = row
        elif current_h == hydrolysis:
            current["amount"] += row["amount"]

    by_id: dict[str, dict] = {}
    by_name: dict[str, str] = {}
    foods: dict[str, list[dict]] = defaultdict(list)
    for row in best.values():
        foods[row["food"]].append({"id": row["id"], "amount": round(row["amount"], 4)})
    for food, compounds in foods.items():
        merged: dict[str, float] = {}
        for row in compounds:
            merged[row["id"]] = merged.get(row["id"], 0) + row["amount"]
        compounds = [{"id": k, "amount": v} for k, v in merged.items() if v > 0]
        if not compounds:
            continue
        food_id = dump_key(food)[:80]
        by_id[food_id] = {"name": food, "compounds": compounds}
        for key in [food, *extra_aliases(food)]:
            dk = dump_key(key)
            if dk:
                by_name[dk] = food_id

    OUT_PATH.write_text(
        json.dumps(
            {
                "source": "Phenol-Explorer composition database; derived tannin/naringin/limonoid extract. Cite phenol-explorer.eu.",
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
