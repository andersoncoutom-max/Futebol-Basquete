import csv
import os
from typing import Any, Dict, List

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(APP_DIR), "data")

DATASETS = {
    "fc25": {
        "label": "FC 25",
        "path": os.path.join(DATA_DIR, "teams_fc25.csv"),
    },
    "nba": {
        "label": "NBA 2K25",
        "path": os.path.join(DATA_DIR, "teams_nba.csv"),
    },
}

def _to_int(value: Any) -> int:
    try:
        return int(float(value)) if value not in ("", None) else 0
    except Exception:
        return 0


def list_datasets() -> List[Dict[str, Any]]:
    out = []
    for key, meta in DATASETS.items():
        out.append({"key": key, "label": meta.get("label", key)})
    return out


def load_rows(dataset: str) -> List[Dict[str, Any]]:
    if dataset not in DATASETS:
        raise ValueError("Dataset invalido.")
    path = DATASETS[dataset]["path"]
    if not os.path.exists(path):
        raise FileNotFoundError(f"Arquivo nao encontrado: {path}")

    rows: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            for k in [
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
            ]:
                if k in r:
                    r[k] = _to_int(r.get(k))
            r["is_valid"] = str(r.get("is_valid", "")).lower() in ("true", "1", "yes")
            rows.append(r)
    return rows


def compute_stats(dataset: str) -> Dict[str, Any]:
    rows = load_rows(dataset)
    valid = [r for r in rows if r.get("is_valid", True)]
    return {
        "dataset": dataset,
        "total_rows": len(rows),
        "valid_rows": len(valid),
        "club": sum(1 for t in valid if (t.get("team_type") or "").upper() == "CLUB"),
        "national": sum(1 for t in valid if (t.get("team_type") or "").upper() == "NATIONAL"),
        "women": sum(1 for t in valid if (t.get("gender") or "").upper() == "WOMEN"),
        "men": sum(1 for t in valid if (t.get("gender") or "").upper() == "MEN"),
        "max_overall": max((t.get("overall", 0) for t in valid), default=0),
        "min_overall": min((t.get("overall", 0) for t in valid), default=0),
    }
