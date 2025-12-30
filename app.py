import json
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request, send_file

from services.datasets import compute_stats, list_datasets, load_rows
from services.draws import apply_filters, draw_assignments, make_bracket, make_round_robin

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "data", "history.sqlite3")

app = Flask(__name__)


def init_db() -> None:
    os.makedirs(os.path.join(APP_DIR, "data"), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()

        # Histórico de sorteios
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

        # Compatibilidade: caso venha de uma versão antiga sem dataset_key
        cur.execute("PRAGMA table_info(draws)")
        cols = {row[1] for row in cur.fetchall()}
        if "dataset_key" not in cols:
            cur.execute("ALTER TABLE draws ADD COLUMN dataset_key TEXT NOT NULL DEFAULT 'fc25'")

        # Entitlements temporários (rewarded)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS entitlements (
                client_id TEXT NOT NULL,
                feature TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (client_id, feature)
            );
            """
        )

        con.commit()
    finally:
        con.close()


init_db()


@app.get("/")
def home():
    return render_template("index.html")


def _now_ts() -> int:
    return int(datetime.utcnow().timestamp())


def grant_entitlement(client_id: str, feature: str, seconds: int) -> Dict[str, Any]:
    now = _now_ts()
    expires = now + int(seconds)
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT OR REPLACE INTO entitlements (client_id, feature, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (client_id, feature, expires, now),
        )
        con.commit()
    finally:
        con.close()
    return {"client_id": client_id, "feature": feature, "expires_at": expires}


def has_entitlement(client_id: str, feature: str) -> bool:
    now = _now_ts()
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT expires_at FROM entitlements WHERE client_id = ? AND feature = ?",
            (client_id, feature),
        )
        row = cur.fetchone()
        if not row:
            return False
        expires = int(row[0])
        return expires > now
    finally:
        con.close()


def cleanup_entitlements() -> None:
    now = _now_ts()
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM entitlements WHERE expires_at <= ?", (now,))
        con.commit()
    finally:
        con.close()




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

@app.post("/api/round_robin")
def api_round_robin():
    payload = request.get_json(force=True, silent=False) or {}
    draw_rows = payload.get("draw") or []
    if not isinstance(draw_rows, list) or len(draw_rows) < 2:
        return jsonify({"error": "Envie o campo draw com ao menos 2 participantes."}), 400
    return jsonify(make_round_robin(draw_rows))



@app.post("/api/entitlement/check")
def api_entitlement_check():
    payload = request.get_json(force=True, silent=False) or {}
    client_id = str(payload.get("client_id") or "").strip()
    feature = str(payload.get("feature") or "").strip()
    if not client_id or not feature:
        return jsonify({"error": "client_id e feature são obrigatórios."}), 400
    cleanup_entitlements()
    return jsonify({"client_id": client_id, "feature": feature, "allowed": has_entitlement(client_id, feature)})


@app.post("/api/entitlement/grant")
def api_entitlement_grant():
    """
    Modo desenvolvimento: simula o rewarded.
    Em produção, este endpoint deve ser acionado somente após validação do provedor de anúncios.
    """
    payload = request.get_json(force=True, silent=False) or {}
    client_id = str(payload.get("client_id") or "").strip()
    feature = str(payload.get("feature") or "").strip()
    seconds = int(payload.get("seconds") or 900)  # 15 min padrão
    if not client_id or not feature:
        return jsonify({"error": "client_id e feature são obrigatórios."}), 400
    cleanup_entitlements()
    return jsonify({"granted": True, **grant_entitlement(client_id, feature, seconds)})


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
    # Execução local (desenvolvimento)
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    init_db()
    app.run(host="0.0.0.0", port=port, debug=debug)
