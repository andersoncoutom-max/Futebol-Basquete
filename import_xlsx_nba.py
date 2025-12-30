import csv
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
XLSX_PATH = os.path.join(BASE_DIR, "times_nba.xlsx")
OUTPUT_CSV = os.path.join(BASE_DIR, "data", "teams_nba.csv")
SHEETS = {
    "NBA_TEAMS": "MEN",
    "WNBA_TEAMS": "WOMEN",
}

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


def build_csv_from_xlsx(xlsx_path: str, output_csv: str) -> int:
    if not os.path.exists(xlsx_path):
        raise FileNotFoundError(f"Arquivo nao encontrado: {xlsx_path}")

    rows_out: List[Dict[str, str]] = []

    with zipfile.ZipFile(xlsx_path, "r") as zf:
        for sheet_name, gender in SHEETS.items():
            sheet_path = _sheet_file_by_name(zf, sheet_name)
            if not sheet_path or sheet_path not in zf.namelist():
                continue

            rows = _parse_sheet(zf, sheet_path)
            if not rows:
                continue

            header = [h.strip() for h in rows[0]]
            header_map = {name: idx for idx, name in enumerate(header) if name}

            required = ["team_name", "overall", "conference", "division"]
            missing = [r for r in required if r not in header_map]
            if missing:
                raise ValueError(f"Colunas obrigatorias ausentes em {sheet_name}: {', '.join(missing)}")

            for row in rows[1:]:
                team_name = _get_cell(row, header_map["team_name"]).strip()
                if not team_name:
                    continue

                overall = _to_int(_get_cell(row, header_map["overall"]))
                inside = _to_int(_get_cell(row, header_map.get("inside_scoring", -1)))
                outside = _to_int(_get_cell(row, header_map.get("outside_scoring", -1)))
                playmaking = _to_int(_get_cell(row, header_map.get("playmaking", -1)))
                defending = _to_int(_get_cell(row, header_map.get("defending", -1)))
                rebounding = _to_int(_get_cell(row, header_map.get("rebounding", -1)))

                attack = int(round((inside + outside) / 2)) if inside or outside else overall
                midfield = playmaking or overall
                defence = defending or rebounding or overall

                conference = _get_cell(row, header_map.get("conference", -1))
                division = _get_cell(row, header_map.get("division", -1))
                city = _get_cell(row, header_map.get("city", -1))
                abbr = _get_cell(row, header_map.get("abbr", -1))

                team_id = (abbr or team_name).strip()
                competition = (conference or "NBA").strip()
                country = "USA"

                rows_out.append(
                    {
                        "team_id": team_id,
                        "team_name": team_name,
                        "team_type": "CLUB",
                        "gender": gender,
                        "competition": competition,
                        "country": country,
                        "conference": conference,
                        "division": division,
                        "league": competition,
                        "overall": str(overall),
                        "attack": str(attack),
                        "midfield": str(midfield),
                        "defence": str(defence),
                        "avg_age": "0",
                        "stadium_capacity": "0",
                        "youth_development": "0",
                        "profitability": "0",
                        "intl_prestige": "0",
                        "since_year": "0",
                        "worth_int": "0",
                        "budget_int": "0",
                        "team_url": "",
                        "team_path": "",
                        "is_valid": "1",
                        "category": "clubs",
                        "city": city,
                    }
                )

    if not rows_out:
        raise ValueError("Nenhum dado encontrado nas abas NBA_TEAMS/WNBA_TEAMS.")

    os.makedirs(os.path.dirname(output_csv), exist_ok=True)

    headers = [
        "team_id",
        "team_name",
        "team_type",
        "gender",
        "competition",
        "country",
        "conference",
        "division",
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
        "city",
    ]

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for row in rows_out:
            w.writerow(row)

    return len(rows_out)


if __name__ == "__main__":
    n = build_csv_from_xlsx(XLSX_PATH, OUTPUT_CSV)
    print(f"OK. CSV gerado com {n} times em data/teams_nba.csv")
