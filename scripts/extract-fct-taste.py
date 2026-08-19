#!/usr/bin/env python3
"""Ingest easy FAO/INFOODS and national Excel tables into fct-taste.json.

Looks in /tmp/taster-fct, /tmp/taster-ciqual, /tmp/taster-japan, /tmp/taster-frida.
Do not commit the raw spreadsheets. Re-run after placing new Excel files.

Maps INFOODS tagnames NA, SUCS, GLUS, FRUS, LACS, MALS, SUGAR, CITAC, MALAC,
ACEAC, LACAC, CAFFN, OA. Ignores potassium, vitamin C, and protein glutamic acid.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "lib/engine/testdata/fct-taste.json"
IN_DIRS = [
    Path("/tmp/taster-fct"),
    Path("/tmp/taster-ciqual"),
    Path("/tmp/taster-japan"),
    Path("/tmp/taster-frida"),
    Path("/tmp/taster-kenya"),
]

TAG_TO_COMPOUND = {
    "NA": ("sodium", "mg"),
    "NA+": ("sodium", "mg"),
    "SUCS": ("sucrose", "g"),
    "GLUS": ("glucose", "g"),
    "FRUS": ("fructose", "g"),
    "LACS": ("lactose", "g"),
    "MALS": ("maltose", "g"),
    "CITAC": ("citric_acid", "mg"),
    "MALAC": ("malic_acid", "mg"),
    "ACEAC": ("acetic_acid", "mg"),
    "LACAC": ("lactic_acid", "mg"),
    "CAFFN": ("caffeine", "mg"),
    "OA": ("citric_acid", "g"),
}
SKIP_TAGS = {"K", "VITC", "GLU", "GLU-", "PROT", "PROCNT", "NACL"}
SUGAR_TAGS = {"SUGAR", "SUGAR-"}
SPECIFIC_SUGARS = {"sucrose", "glucose", "fructose", "lactose", "maltose"}
TASTE_TAGS = set(TAG_TO_COMPOUND) | SUGAR_TAGS

SKIP_SHEET = re.compile(
    r"stat|fatty acid|copy|intro|component|biblio|yield|retention|"
    r"mixed dish|code|food group|overview|list of|species|documentation|"
    r"readme|parameter|source|foodgroup|normalised",
    re.I,
)

FILE_REGION = [
    (re.compile(r"wafct|western.?africa", re.I), "western africa"),
    (re.compile(r"kenya", re.I), "kenya"),
    (re.compile(r"japan", re.I), "japan"),
    (re.compile(r"ciqual", re.I), "france"),
    (re.compile(r"frida", re.I), "denmark"),
    (re.compile(r"upulses", re.I), "pulses"),
    (re.compile(r"ufish", re.I), "fish"),
]

CIQUAL_HEADER_TAG = {
    "sodium": "NA",
    "saccharose": "SUCS",
    "sucrose": "SUCS",
    "glucose": "GLUS",
    "fructose": "FRUS",
    "lactose": "LACS",
    "maltose": "MALS",
    "sucres": "SUGAR",
    "caféine": "CAFFN",
    "cafeine": "CAFFN",
}

FR_EN = {
    "tomate": "tomato",
    "citron": "lemon",
    "lime": "lime",
    "oignon": "onion",
    "ail": "garlic",
    "poivre": "black pepper",
    "sel": "salt",
    "sucre": "sugar",
    "lait": "milk",
    "beurre": "butter",
    "vinaigre": "vinegar",
    "moutarde": "mustard",
    "soja": "soy",
    "thé": "tea",
    "cafe": "coffee",
    "café": "coffee",
    "cacao": "cocoa",
    "fraise": "strawberry",
    "pomme": "apple",
    "orange": "orange",
    "banane": "banana",
    "carotte": "carrot",
    "fromage": "cheese",
    "yaourt": "yogurt",
    "oeuf": "egg",
    "œuf": "egg",
    "riz": "rice",
    "mais": "maize",
    "maïs": "maize",
}

JP_HINTS = [
    ("まこんぶ", ["kombu", "kelp", "konbu"]),
    ("りしりこんぶ", ["kombu", "kelp"]),
    ("こいくちしょうゆ", ["soy sauce"]),
    ("うすくちしょうゆ", ["soy sauce"]),
    ("醤油", ["soy sauce"]),
    ("みそ", ["miso"]),
    ("味噌", ["miso"]),
    ("トマト", ["tomato"]),
    ("緑茶", ["green tea"]),
    ("かつおぶし", ["katsuobushi", "bonito"]),
    ("わかめ", ["wakame"]),
    ("焼きのり", ["nori"]),
    ("味付けのり", ["nori"]),
    ("しょうが", ["ginger"]),
    ("生姜", ["ginger"]),
]


def dump_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("_", " ").replace("-", " ")).strip()


def parse_number(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value:  # NaN
            return None
        return float(value) if value > 0 else None
    text = str(value).strip().replace("\u00a0", " ")
    if not text or text.lower() in {
        "-",
        "–",
        "—",
        "*",
        "tr",
        "traces",
        "oa",
        "na",
        "n.d.",
        "nd",
        "null",
        "",
    }:
        return None
    if text.startswith("<") or text.startswith("≤") or text.startswith("<"):
        return None
    text = text.strip("[]()").replace(" ", "")
    if re.fullmatch(r"\d+,\d+", text):
        text = text.replace(",", ".")
    try:
        amount = float(text)
    except ValueError:
        return None
    return amount if amount > 0 else None


def normalize_tag(cell) -> str:
    raw = str(cell or "").strip().upper().replace("\n", " ")
    raw = re.sub(r"\s+", "", raw)
    raw = raw.split("(")[0]
    return raw


def scale_amount(compound: str, amount: float, unit: str) -> float:
    unit = (unit or "").lower()
    mg_ids = {"sodium", "citric_acid", "malic_acid", "acetic_acid", "lactic_acid", "caffeine"}
    if compound in mg_ids:
        if unit.startswith("g") and not unit.startswith("mg") and not unit.startswith("ug"):
            return amount * 1000
        if unit.startswith("ug") or unit.startswith("µg") or unit.startswith("mcg"):
            return amount / 1000
        return amount
    if unit.startswith("mg"):
        return amount / 1000
    return amount


def compounds_from_tags(tags: list[str], units: list[str], row: tuple) -> list[dict]:
    out: list[dict] = []
    total_sugar = None
    for tag, unit, value in zip(tags, units, row):
        tag = normalize_tag(tag)
        if tag in SKIP_TAGS:
            continue
        amount = parse_number(value)
        if amount is None:
            continue
        if tag in SUGAR_TAGS:
            total_sugar = scale_amount("sucrose", amount, unit or "g")
            continue
        mapped = TAG_TO_COMPOUND.get(tag)
        if not mapped:
            continue
        compound, default_unit = mapped
        out.append(
            {
                "id": compound,
                "amount": round(scale_amount(compound, amount, unit or default_unit), 4),
            }
        )
    if total_sugar and not any(row["id"] in SPECIFIC_SUGARS for row in out):
        out.append({"id": "sucrose", "amount": round(total_sugar, 4)})
    # Prefer specific acids over total OA mapped as citric.
    if any(row["id"] in {"citric_acid", "malic_acid", "acetic_acid", "lactic_acid"} for row in out):
        citric = [row for row in out if row["id"] == "citric_acid"]
        if len(citric) > 1:
            # keep the last non-OA? we can't tell. Sum is wrong. Keep max.
            max_c = max(row["amount"] for row in citric)
            out = [row for row in out if row["id"] != "citric_acid"]
            out.append({"id": "citric_acid", "amount": max_c})
    merged: dict[str, float] = {}
    for row in out:
        merged[row["id"]] = max(merged.get(row["id"], 0), row["amount"])
    return [{"id": k, "amount": v} for k, v in merged.items() if v > 0]


def extra_aliases(name: str) -> list[str]:
    aliases: list[str] = []
    lower = name.lower()
    if "citrullus" in lower and "melon" in lower:
        aliases.extend(["egusi", "egusi melon seed"])
    if "teff" in lower:
        aliases.append("teff")
    if "nopal" in lower or "opuntia" in lower:
        aliases.extend(["nopal", "nopales"])
    for needle, names in JP_HINTS:
        if needle in name and "茶" not in name:
            aliases.extend(names)
    first = re.split(r"[,(\[]", name, maxsplit=1)[0].strip().lower()
    if first in FR_EN:
        aliases.append(FR_EN[first])
    return aliases


def add_food(
    by_name: dict[str, str],
    by_id: dict[str, dict],
    food_id: str,
    name: str,
    region: str,
    compounds: list[dict],
    extra_names: list[str] | None = None,
) -> None:
    if not name or not compounds:
        return
    name = re.sub(r"\s+", " ", name).strip()
    if len(name) < 2:
        return
    existing = by_id.get(food_id)
    if existing:
        have = {row["id"]: row["amount"] for row in existing["compounds"]}
        for row in compounds:
            have[row["id"]] = max(have.get(row["id"], 0), row["amount"])
        existing["compounds"] = [{"id": k, "amount": v} for k, v in have.items()]
        if len(name) < len(existing["name"]):
            existing["name"] = name
    else:
        by_id[food_id] = {"name": name, "region": region, "compounds": compounds}
    keys = [name, *extra_aliases(name), *(extra_names or [])]
    for key in keys:
        dk = dump_key(key)
        if not dk:
            continue
        prev = by_name.get(dk)
        if prev and prev != food_id:
            # Keep an existing short alias; do not let a longer variant steal it.
            if len(dk.split()) <= 2:
                continue
            if len(by_id.get(prev, {}).get("name", "")) <= len(name):
                continue
        by_name[dk] = food_id


def file_region(path: Path) -> str:
    for pattern, region in FILE_REGION:
        if pattern.search(path.name):
            return region
    return dump_key(path.stem)[:40]


def should_skip_sheet(name: str) -> bool:
    if SKIP_SHEET.search(name or ""):
        return True
    if "NV_stat" in name or "stat_" in name.lower():
        return True
    return False


def find_tag_row(rows: list[tuple]) -> tuple[int, list[str], list[str]] | None:
    for i, row in enumerate(rows[:16]):
        tags = [normalize_tag(cell) for cell in row]
        hits = [t for t in tags if t in TASTE_TAGS]
        if len(hits) >= 1:
            units = []
            for cell in row:
                text = str(cell or "")
                m = re.search(r"\(([^)]+)\)", text.replace("\n", " "))
                units.append((m.group(1) if m else "").lower())
            return i, [normalize_tag(c) for c in row], units
    return None


def _header_text(cell) -> str:
    return str(cell or "").replace("\u3000", " ").replace("\n", " ").strip()


def _header_key(cell) -> str:
    return re.sub(r"\s+", "", _header_text(cell)).lower()


def name_index(rows: list[tuple]) -> int | None:
    for row in rows[:16]:
        for i, cell in enumerate(row):
            h = _header_text(cell)
            compact = h.replace(" ", "")
            hl = h.lower()
            if compact == "食品名" or hl in {"alim_nom_fr", "alim_nom_eng"}:
                return i
            if "food name in english" in hl or "foodname in english" in hl:
                return i
    for row in rows[:4]:
        for i, cell in enumerate(row):
            if "food name" in _header_text(cell).lower():
                return i
    return None


def ciqual_tag_row(header: tuple) -> tuple[list[str], list[str]] | None:
    if not any("alim_nom_fr" in _header_text(cell).lower() for cell in header):
        return None
    tags: list[str] = []
    units: list[str] = []
    for cell in header:
        h = _header_text(cell).lower()
        label = h.split("(")[0].strip()
        unit = "mg" if "(mg" in h else "g"
        tag = ""
        if label == "sodium" or h.startswith("sodium "):
            tag = "NA"
            unit = "mg"
        elif label in CIQUAL_HEADER_TAG:
            tag = CIQUAL_HEADER_TAG[label]
        tags.append(tag)
        units.append(unit)
    if "NA" not in tags and "SUCS" not in tags:
        return None
    return tags, units


def food_code_index(rows: list[tuple]) -> int | None:
    for row in rows[:16]:
        for i, cell in enumerate(row):
            h = _header_key(cell)
            if h in {"食品番号", "alim_code", "fooditemid", "foodid"}:
                return i
            if h == "code":
                return i
    return None


def country_index(header: tuple) -> int | None:
    for i, cell in enumerate(header):
        h = str(cell or "").lower()
        if "country" in h or "region" in h:
            return i
    return None


def ingest_workbook(path: Path, by_name: dict[str, str], by_id: dict[str, dict], openpyxl) -> None:
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        print(f"skip {path.name}: {exc}")
        return
    default_region = file_region(path)
    prefix = dump_key(path.stem)[:20] or "fct"
    for sheet in wb.worksheets:
        if should_skip_sheet(sheet.title):
            continue
        # Japan group sheets duplicate 表全体 and their headers misalign.
        if "japan" in path.name.lower() and sheet.title.strip() != "表全体":
            continue
        rows = list(sheet.iter_rows(values_only=True))
        if len(rows) < 3:
            continue
        header = rows[0]
        ciqual = ciqual_tag_row(header)
        if ciqual:
            tags, units = ciqual
            tag_i = 0
        else:
            found = find_tag_row(rows)
            if not found:
                continue
            tag_i, tags, units = found
        name_i = name_index(rows)
        if name_i is None:
            # WAFCT: English name is column 1; Japan 食品名 is column 3
            for guess in (1, 3, 2, 0):
                if guess < len(header):
                    name_i = guess
                    break
        country_i = country_index(header)
        sci_i = next(
            (
                i
                for i, cell in enumerate(header)
                if "scientific" in str(cell or "").lower() or "alim_nom_sci" in str(cell or "").lower()
            ),
            None,
        )
        local_i = next(
            (
                i
                for i, cell in enumerate(header)
                if "own language" in str(cell or "").lower() or "alim_nom_fr" in str(cell or "").lower()
            ),
            None,
        )
        code_i = food_code_index(rows)
        for row in rows[tag_i + 1 :]:
            if not row:
                continue
            name = str(row[name_i] or "").strip() if name_i is not None and name_i < len(row) else ""
            if not name or name.lower() in {"food name in english", "食品名"}:
                continue
            if re.fullmatch(r"\d+", name.replace(" ", "")):
                continue
            if "*:" in name:
                continue
            if "/" in name and "," not in name and len(name.split()) <= 8:
                # group headers like "Cereals and their products/Céréales..."
                continue
            compounds = compounds_from_tags(tags, units, row)
            if not compounds:
                continue
            region = default_region
            if country_i is not None and country_i < len(row) and row[country_i]:
                country = str(row[country_i]).split(",")[0].strip()
                if country:
                    region = dump_key(country) or region
            code = str(row[code_i] or "").strip() if code_i is not None and code_i < len(row) else ""
            table = "jp" if region == "japan" else prefix
            food_id = f"{table}:{dump_key(code or name)}"[:80]
            extras = []
            if sci_i is not None and sci_i < len(row) and row[sci_i]:
                extras.append(str(row[sci_i]))
            if local_i is not None and local_i < len(row) and row[local_i]:
                extras.append(str(row[local_i]))
            add_food(by_name, by_id, food_id, name, region, compounds, extras)
    wb.close()


def main() -> None:
    try:
        import openpyxl  # type: ignore
    except ImportError:
        raise SystemExit("pip install openpyxl") from None

    by_name: dict[str, str] = {}
    by_id: dict[str, dict] = {}
    files: list[Path] = []
    for folder in IN_DIRS:
        if not folder.exists():
            continue
        files.extend(sorted(folder.glob("*.xls*")))
        files.extend(sorted(folder.glob("*.XLSX")))
    files = [p for p in files if "japan-aa" not in p.name.lower()]
    seen: set[str] = set()
    for path in files:
        if path.suffix.lower() not in {".xlsx", ".xlsm", ".xls"}:
            continue
        if path.name in seen:
            continue
        if path.stat().st_size < 1000:
            continue
        seen.add(path.name)
        print(f"ingest {path}")
        ingest_workbook(path, by_name, by_id, openpyxl)
    if not by_id:
        print("No taste rows found; leaving existing snapshot.")
        return
    payload = {
        "source": (
            "FAO/INFOODS Excel (WAFCT 2019, BioFoodComp, uPulses, uFiSh, AnFooD); "
            "Japan Standard Tables 2023; ANSES CIQUAL 2025. Derived taste extract only."
        ),
        "byName": by_name,
        "byId": by_id,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(by_id)} foods / {len(by_name)} names to {OUT_PATH}")


if __name__ == "__main__":
    main()
