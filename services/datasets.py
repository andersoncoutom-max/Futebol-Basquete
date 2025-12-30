import csv
import json
import os
from typing import Any, Dict, List

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_PATH = os.path.join(APP_DIR, "data", "datasets.json")

def load_registry() -> Dict[str, Any]:
    if not os.path.exists(REGISTRY_PATH):
        raise FileNotFoundError("Arquivo data/datasets.json não encontrado.")
    with open(REGISTRY_PATH, "r", encoding="utf-8") as fp:
        return json.load(fp)

def list_datasets() -> List[Dict[str, Any]]:
    return load_registry().get("datasets", [])

def get_dataset(key: str) -> Dict[str, Any]:
    for d in list_datasets():
        if d.get("key") == key:
            return d
    raise KeyError(f"Dataset não encontrado: {key}")

def _to_int(value: Any) -> int:
    try:
        return int(float(value)) if value not in ("", None) else 0
    except Exception:
        return 0

def load_rows(dataset_key: str) -> List[Dict[str, Any]]:
    ds = get_dataset(dataset_key)
    csv_path = os.path.join(APP_DIR, ds["csv_path"])
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV do dataset não encontrado: {csv_path}")

    rows: List[Dict[str, Any]] = []
    with open(csv_path, "r", encoding="utf-8") as fp:
        reader = csv.DictReader(fp)
        for r in reader:
            for k in ["overall", "attack", "midfield", "defence", "offense", "defense"]:
                if k in r:
                    r[k] = _to_int(r.get(k))
            r["is_valid"] = str(r.get("is_valid", "")).lower() in ("true", "1", "yes")
            rows.append(r)
    return rows

def compute_stats(dataset_key: str) -> Dict[str, Any]:
    rows = load_rows(dataset_key)
    valid = [r for r in rows if r.get("is_valid", True)]
    return {
        "dataset": dataset_key,
        "total_rows": len(rows),
        "valid_rows": len(valid),
        "max_overall": max((int(r.get("overall", 0) or 0) for r in valid), default=0),
        "min_overall": min((int(r.get("overall", 0) or 0) for r in valid), default=0),
    }
