import json
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request, send_file

from services.datasets import compute_stats, list_datasets, load_rows
from services.draws import apply_filters, draw_assignments, make_bracket

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "data", "history.sqlite3")

app = Flask(__name__)


def init_db() -> None:
    os.makedirs(os.path.join(APP_DIR, "data"), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS draws (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                dataset_key TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            """
        )
        cur.execute("PRAGMA table_info(draws)")
        cols = {row[1] for row in cur.fetchall()}
        if "dataset_key" not in cols:
            cur.execute("ALTER TABLE draws ADD COLUMN dataset_key TEXT NOT NULL DEFAULT 'fc25'")
        con.commit()
    finally:
        con.close()


def save_history(dataset_key: str, payload: Dict[str, Any]) -> None:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO draws (created_at, dataset_key, payload_json) VALUES (?, ?, ?)",
            (datetime.utcnow().isoformat(timespec="seconds"), dataset_key, json.dumps(payload, ensure_ascii=False)),
        )
        con.commit()
    finally:
        con.close()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/datasets")
def api_datasets():
    return jsonify({"datasets": list_datasets()})


@app.get("/api/stats")
def api_stats():
    dataset = request.args.get("dataset", "fc25")
    try:
        return jsonify(compute_stats(dataset))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.get("/api/teams_info")
def api_teams_info():
    dataset = request.args.get("dataset", "fc25")
    try:
        stats = compute_stats(dataset)
        return jsonify(
            {
                "total_teams": stats.get("valid_rows", 0),
                "max_overall": stats.get("max_overall", 0),
                "min_overall": stats.get("min_overall", 0),
                "counts": {
                    "clubs": stats.get("club", 0),
                    "women": stats.get("women", 0),
                    "men": stats.get("men", 0),
                    "national": stats.get("national", 0),
                },
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.post("/api/facets")
def api_facets():
    payload = request.get_json(force=True, silent=False) or {}
    dataset = payload.get("dataset") or "fc25"
    try:
        rows = load_rows(dataset)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    def uniq(field: str):
        s = set()
        for r in rows:
            v = (r.get(field) or "").strip()
            if v:
                s.add(v)
        return sorted(s)

    return jsonify(
        {
            "dataset": dataset,
            "team_types": uniq("team_type"),
            "genders": uniq("gender"),
            "competitions": uniq("competition"),
            "countries": uniq("country"),
            "conferences": uniq("conference"),
            "divisions": uniq("division"),
        }
    )


@app.post("/api/pool_preview")
def api_pool_preview():
    payload = request.get_json(force=True, silent=False) or {}
    dataset = payload.get("dataset") or "fc25"
    filters = payload.get("filters") or {}
    limit = int(payload.get("limit") or 30)

    try:
        rows = load_rows(dataset)
        pool = apply_filters(rows, filters)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    sample = [
        {
            "team_id": t.get("team_id"),
            "team_name": t.get("team_name"),
            "overall": t.get("overall"),
            "attack": t.get("attack", t.get("offense")),
            "midfield": t.get("midfield"),
            "defence": t.get("defence", t.get("defense")),
            "team_type": t.get("team_type"),
            "gender": t.get("gender"),
            "competition": t.get("competition"),
            "country": t.get("country"),
            "conference": t.get("conference"),
            "division": t.get("division"),
        }
        for t in pool[: max(0, min(limit, 200))]
    ]

    return jsonify({"dataset": dataset, "count": len(pool), "sample": sample})


@app.post("/api/draw")
def api_draw():
    payload = request.get_json(force=True, silent=False) or {}
    dataset = payload.get("dataset") or "fc25"
    participants = payload.get("participants") or []
    filters = payload.get("filters") or None

    if not isinstance(participants, list) or not all(isinstance(p, str) for p in participants):
        return jsonify({"error": "participants deve ser uma lista de strings."}), 400
    participants = [p.strip() for p in participants if p.strip()]
    if len(participants) < 1:
        return jsonify({"error": "Adicione ao menos 1 participante."}), 400

    if filters is None:
        mode = payload.get("mode", "all")
        top_n = payload.get("top_n", 10)
        category = (payload.get("category") or "all").lower()

        team_types = ["CLUB", "NATIONAL"]
        genders = ["MEN", "WOMEN"]

        if category == "women":
            genders = ["WOMEN"]
        elif category == "men":
            genders = ["MEN"]
        elif category == "national":
            team_types = ["NATIONAL"]
        elif category == "clubs":
            team_types = ["CLUB"]
        elif category == "national_men":
            team_types = ["NATIONAL"]
            genders = ["MEN"]
        elif category == "national_women":
            team_types = ["NATIONAL"]
            genders = ["WOMEN"]
        elif category == "clubs_men":
            team_types = ["CLUB"]
            genders = ["MEN"]
        elif category == "clubs_women":
            team_types = ["CLUB"]
            genders = ["WOMEN"]

        filters = {
            "mode": mode,
            "top_n": top_n,
            "team_types": team_types,
            "genders": genders,
            "overall_min": 0,
            "include_invalid": False,
        }

    try:
        rows = load_rows(dataset)
        pool = apply_filters(rows, filters)
        if len(participants) > len(pool):
            return jsonify(
                {
                    "error": f"Participantes ({len(participants)}) maior que times disponiveis no pool ({len(pool)})."
                }
            ), 400
        draw_rows = draw_assignments(participants, pool)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    out = {
        "dataset": dataset,
        "participants": participants,
        "filters": filters,
        "pool_count": len(pool),
        "draw": draw_rows,
    }
    save_history(dataset, out)
    return jsonify(out)


@app.post("/api/bracket")
def api_bracket():
    payload = request.get_json(force=True, silent=False) or {}
    draw_rows = payload.get("draw") or []
    if not isinstance(draw_rows, list) or len(draw_rows) < 2:
        return jsonify({"error": "Envie o campo draw com ao menos 2 participantes."}), 400
    return jsonify(make_bracket(draw_rows))


@app.post("/api/export_xlsx")
def api_export_xlsx():
    payload = request.get_json(force=True, silent=False) or {}
    rows = payload.get("draw") or []
    if not isinstance(rows, list) or len(rows) == 0:
        return jsonify({"error": "Nenhum resultado para exportar."}), 400

    try:
        from openpyxl import Workbook
    except Exception:
        return jsonify({"error": "openpyxl nao instalado. Rode: pip install openpyxl"}), 400

    wb = Workbook()
    ws = wb.active
    ws.title = "SORTEIO"

    headers = [
        "PARTICIPANTE",
        "TIME",
        "OVR",
        "ATT/OF",
        "MID",
        "DEF",
        "TIPO",
        "GENERO",
        "COMPETICAO",
        "PAIS",
        "CONFERENCIA",
        "DIVISAO",
    ]
    ws.append(headers)

    for r in rows:
        ws.append(
            [
                r.get("participant", ""),
                r.get("team_name", ""),
                r.get("overall", 0),
                r.get("attack", r.get("offense", 0)),
                r.get("midfield", 0),
                r.get("defence", r.get("defense", 0)),
                r.get("team_type", ""),
                r.get("gender", ""),
                r.get("competition", ""),
                r.get("country", ""),
                r.get("conference", ""),
                r.get("division", ""),
            ]
        )

    widths = [22, 30, 6, 8, 6, 6, 10, 10, 18, 18, 16, 16]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + i)].width = w

    out_path = os.path.join(APP_DIR, "data", "export_sorteio.xlsx")
    wb.save(out_path)
    return send_file(out_path, as_attachment=True, download_name="sorteio.xlsx")


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
