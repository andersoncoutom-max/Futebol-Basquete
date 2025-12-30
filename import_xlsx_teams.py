import csv
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
XLSX_PATH = os.path.join(BASE_DIR, "times_fc25.xlsx")
OUTPUT_CSV = os.path.join(BASE_DIR, "data", "teams_fc25.csv")
SHEET_NAME = "ALL_CLASSIFIED"

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def col_to_idx(col: str) -> int:
    idx = 0
    for ch in col:
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def _sheet_file_by_name(zf: zipfile.ZipFile, name: str) -> Optional[str]:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    for sheet in wb.findall("a:sheets/a:sheet", NS):
        if sheet.get("name") == name:
            sheet_id = sheet.get("sheetId")
            if sheet_id and sheet_id.isdigit():
                return f"xl/worksheets/sheet{sheet_id}.xml"
    return None


def _parse_sheet(zf: zipfile.ZipFile, sheet_path: str) -> List[List[str]]:
    root = ET.fromstring(zf.read(sheet_path))
    rows: List[List[str]] = []
    for row in root.findall("a:sheetData/a:row", NS):
        cells: Dict[int, str] = {}
        for c in row.findall("a:c", NS):
            ref = c.get("r")
            if not ref:
                continue
            col = re.match(r"[A-Z]+", ref)
            if not col:
                continue
            idx = col_to_idx(col.group(0))
            value = ""
            if c.get("t") == "inlineStr":
                t = c.find("a:is/a:t", NS)
                value = t.text if t is not None else ""
            else:
                v = c.find("a:v", NS)
                value = v.text if v is not None else ""
            cells[idx] = value
        if cells:
            max_idx = max(cells.keys())
            row_vals = [""] * (max_idx + 1)
            for i, v in cells.items():
                row_vals[i] = v
            rows.append(row_vals)
    return rows


def _to_int(value: str) -> int:
    try:
        return int(float(value))
    except Exception:
        return 0


def _get_cell(row: List[str], idx: int) -> str:
    if idx < len(row):
        return row[idx]
    return ""


def _infer_category(team_type: str, gender: str) -> str:
    team_type = (team_type or "").strip().upper()
    gender = (gender or "").strip().upper()
    if gender == "WOMEN":
        return "women"
    if team_type == "NATIONAL":
        return "national"
    return "clubs"


def build_csv_from_xlsx(xlsx_path: str, output_csv: str) -> int:
    if not os.path.exists(xlsx_path):
        raise FileNotFoundError(f"Arquivo nao encontrado: {xlsx_path}")

    with zipfile.ZipFile(xlsx_path, "r") as zf:
        sheet_path = _sheet_file_by_name(zf, SHEET_NAME)
        if not sheet_path or sheet_path not in zf.namelist():
            raise FileNotFoundError(f"Aba {SHEET_NAME} nao encontrada no XLSX.")

        rows = _parse_sheet(zf, sheet_path)

    if not rows:
        raise ValueError("Planilha vazia.")

    header = [h.strip() for h in rows[0]]
    header_map = {name: idx for idx, name in enumerate(header) if name}

    required = ["team_name", "overall", "attack", "midfield", "defence", "team_url"]
    missing = [r for r in required if r not in header_map]
    if missing:
        raise ValueError(f"Colunas obrigatorias ausentes: {', '.join(missing)}")

    os.makedirs(os.path.dirname(output_csv), exist_ok=True)

    best: Dict[Tuple[str, str, str], Dict[str, str]] = {}

    for row in rows[1:]:
        team_name = _get_cell(row, header_map["team_name"]).strip()
        if not team_name:
            continue

        is_valid = _get_cell(row, header_map.get("is_valid", -1)).strip() if "is_valid" in header_map else "1"
        if is_valid == "0":
            continue

        team_type = _get_cell(row, header_map.get("team_type", -1)) if "team_type" in header_map else ""
        gender = _get_cell(row, header_map.get("gender", -1)) if "gender" in header_map else ""
        category = _infer_category(team_type, gender)

        overall = _to_int(_get_cell(row, header_map["overall"]))
        attack = _to_int(_get_cell(row, header_map["attack"]))
        midfield = _to_int(_get_cell(row, header_map["midfield"]))
        defence = _to_int(_get_cell(row, header_map["defence"]))

        team_url = _get_cell(row, header_map["team_url"]).strip()
        team_path = _get_cell(row, header_map.get("team_path", -1))
        team_id = _get_cell(row, header_map.get("team_id", -1))
        competition = _get_cell(row, header_map.get("competition", -1))
        country = _get_cell(row, header_map.get("country", -1))

        avg_age = _to_int(_get_cell(row, header_map.get("avg_age", -1)))
        stadium_capacity = _to_int(_get_cell(row, header_map.get("stadium_capacity", -1)))
        youth_development = _to_int(_get_cell(row, header_map.get("youth_development", -1)))
        profitability = _to_int(_get_cell(row, header_map.get("profitability", -1)))
        intl_prestige = _to_int(_get_cell(row, header_map.get("intl_prestige", -1)))
        since_year = _to_int(_get_cell(row, header_map.get("since_year", -1)))
        worth_int = _to_int(_get_cell(row, header_map.get("worth_int", -1)))
        budget_int = _to_int(_get_cell(row, header_map.get("budget_int", -1)))

        league = competition.strip() or country.strip() or "N/A"

        key = (team_name.strip().lower(), team_type.strip().upper(), gender.strip().upper())
        current = best.get(key)
        if current is None or overall > _to_int(current.get("overall")):
            best[key] = {
                "team_id": team_id,
                "team_name": team_name,
                "team_type": team_type,
                "gender": gender,
                "competition": competition,
                "country": country,
                "league": league,
                "overall": str(overall),
                "attack": str(attack),
                "midfield": str(midfield),
                "defence": str(defence),
                "avg_age": str(avg_age),
                "stadium_capacity": str(stadium_capacity),
                "youth_development": str(youth_development),
                "profitability": str(profitability),
                "intl_prestige": str(intl_prestige),
                "since_year": str(since_year),
                "worth_int": str(worth_int),
                "budget_int": str(budget_int),
                "team_url": team_url,
                "team_path": team_path,
                "is_valid": "1",
                "category": category,
            }

    ordered = sorted(best.values(), key=lambda t: (-_to_int(t.get("overall")), t.get("team_name", "").lower()))

    headers = [
        "team_id",
        "team_name",
        "team_type",
        "gender",
        "competition",
        "country",
        "league",
        "overall",
        "attack",
        "midfield",
        "defence",
        "avg_age",
        "stadium_capacity",
        "youth_development",
        "profitability",
        "intl_prestige",
        "since_year",
        "worth_int",
        "budget_int",
        "team_url",
        "team_path",
        "is_valid",
        "category",
    ]

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for row in ordered:
            w.writerow(row)

    return len(ordered)


if __name__ == "__main__":
    n = build_csv_from_xlsx(XLSX_PATH, OUTPUT_CSV)
    print(f"OK. CSV gerado com {n} times em data/teams_fc25.csv")
