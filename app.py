
import json
import os
import random
import secrets
import sqlite3
from datetime import datetime
from functools import wraps
from typing import Any, Dict, Optional

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from werkzeug.security import generate_password_hash

from services.datasets import compute_stats, list_datasets, load_rows
from services.draws import apply_filters, balance_pool_by_tiers, draw_assignments, make_bracket, make_round_robin

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "data", "history.sqlite3")
POOLS_PATH = os.path.join(APP_DIR, "data", "pools.json")

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret")

ASSET_LINKS = [
    {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "com.onrender.futebol_basquete.twa",
            "sha256_cert_fingerprints": [
                "7C:69:8F:59:78:04:9B:72:A0:97:DE:44:1C:B1:A7:4B:EE:1E:3A:19:67:0A:42:33:9F:29:FB:A1:6E:EE:C3:09"
            ],
        },
    }
]


def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


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

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_pro INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS shares (
                code TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            """
        )

        con.commit()
    finally:
        con.close()


def load_pools() -> Dict[str, Any]:
    try:
        with open(POOLS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def save_history(dataset_key: str, payload: Dict[str, Any]) -> None:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO draws (created_at, dataset_key, payload_json) VALUES (?, ?, ?)",
            (_now_iso(), dataset_key, json.dumps(payload, ensure_ascii=False)),
        )
        con.commit()
    finally:
        con.close()


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT id, email, password_hash, is_pro FROM users WHERE email = ?", (email,))
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "email": row[1], "password_hash": row[2], "is_pro": bool(row[3])}
    finally:
        con.close()


def create_user(email: str, password: str) -> Dict[str, Any]:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO users (email, password_hash, is_pro, created_at) VALUES (?, ?, 0, ?)",
            (email, generate_password_hash(password), _now_iso()),
        )
        con.commit()
        return {"id": cur.lastrowid, "email": email, "is_pro": False}
    finally:
        con.close()


def generate_code(length: int = 6) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def save_share(payload: Dict[str, Any]) -> str:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        for _ in range(5):
            code = generate_code(6)
            cur.execute("SELECT code FROM shares WHERE code = ?", (code,))
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO shares (code, created_at, payload_json) VALUES (?, ?, ?)",
                    (code, _now_iso(), json.dumps(payload, ensure_ascii=False)),
                )
                con.commit()
                return code
        raise RuntimeError("Nao foi possivel gerar codigo.")
    finally:
        con.close()


def load_share(code: str) -> Optional[Dict[str, Any]]:
    code = (code or "").strip().upper()
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("SELECT payload_json FROM shares WHERE code = ?", (code,))
        row = cur.fetchone()
        if not row:
            return None
        return json.loads(row[0])
    finally:
        con.close()


def update_share(code: str, payload: Dict[str, Any]) -> bool:
    code = (code or "").strip().upper()
    if not code:
        return False
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("UPDATE shares SET payload_json = ? WHERE code = ?", (json.dumps(payload, ensure_ascii=False), code))
        con.commit()
        return cur.rowcount > 0
    finally:
        con.close()


def ensure_guest_session() -> None:
    if session.get("user_id"):
        return
    guest_email = f"guest-{secrets.token_hex(4)}@local"
    guest_user = create_user(guest_email, secrets.token_hex(16))
    session["user_id"] = guest_user["id"]
    session["user_email"] = "Convidado"
    session["is_pro"] = False




def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            ensure_guest_session()
        return fn(*args, **kwargs)

    return wrapper


init_db()


@app.before_request
def auto_login_guest():
    if request.path.startswith("/static/"):
        return
    if request.endpoint in {"login", "login_post", "register", "register_post"}:
        return
    ensure_guest_session()


@app.get("/login")
def login():
    return redirect(url_for("index"))


@app.post("/login")
def login_post():
    return redirect(url_for("index"))


@app.get("/register")
def register():
    return redirect(url_for("index"))


@app.post("/register")
def register_post():
    return redirect(url_for("index"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.get("/api/me")
def api_me():
    return jsonify(
        {
            "logged_in": bool(session.get("user_id")),
            "email": session.get("user_email"),
            "is_pro": bool(session.get("is_pro")),
        }
    )


@app.get("/")
@login_required
def index():
    return render_template("index.html")


@app.get("/.well-known/assetlinks.json")
def assetlinks():
    return jsonify(ASSET_LINKS)


@app.get("/s/<code>")
def share_page(code: str):
    if not load_share(code):
        abort(404)
    return redirect(url_for("index", code=code.upper()))



@app.get("/api/datasets")
@login_required
def api_datasets():
    return jsonify({"datasets": list_datasets()})


@app.get("/api/pools")
@login_required
def api_pools():
    return jsonify(load_pools())


@app.get("/api/stats")
@login_required
def api_stats():
    dataset = request.args.get("dataset", "fc25")
    try:
        return jsonify(compute_stats(dataset))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.get("/api/teams_info")
@login_required
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
@login_required
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
@login_required
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
@login_required
def api_draw():
    payload = request.get_json(force=True, silent=False) or {}
    dataset = payload.get("dataset") or "fc25"
    participants = payload.get("participants") or []
    filters = payload.get("filters") or None
    balance_mode = (payload.get("balance_mode") or "random").strip().lower()
    avoid_repeat = bool(payload.get("avoid_repeat") or False)
    avoid_repeat_window = int(payload.get("avoid_repeat_window") or 1)
    exclude_team_ids = payload.get("exclude_team_ids") or []
    seed = (payload.get("seed") or "").strip()

    if not isinstance(participants, list) or not all(isinstance(p, str) for p in participants):
        return jsonify({"error": "participants deve ser uma lista de strings."}), 400
    participants = [p.strip() for p in participants if p.strip()]
    if len(participants) < 1:
        return jsonify({"error": "Adicione ao menos 1 participante."}), 400

    normalized = [p.lower() for p in participants]
    if len(set(normalized)) != len(normalized):
        return jsonify({"error": "Participantes duplicados. Remova nomes repetidos."}), 400

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
        if exclude_team_ids:
            exclude_set = {str(x) for x in exclude_team_ids}
            pool = [t for t in pool if str(t.get("team_id")) not in exclude_set]
        if balance_mode == "tiers":
            pool = balance_pool_by_tiers(pool)
        if len(participants) > len(pool):
            return jsonify(
                {
                    "error": f"Participantes ({len(participants)}) maior que times disponiveis no pool ({len(pool)})."
                }
            ), 400
        if seed:
            random.seed(seed)
        draw_rows = draw_assignments(participants, pool)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    meta = {
        "seed": seed or "auto",
        "timestamp": _now_iso(),
        "balance_mode": balance_mode,
        "avoid_repeat": avoid_repeat,
        "avoid_repeat_window": avoid_repeat_window,
    }
    out = {
        "dataset": dataset,
        "participants": participants,
        "filters": filters,
        "pool_count": len(pool),
        "draw": draw_rows,
        "meta": meta,
    }
    save_history(dataset, out)
    return jsonify(out)


@app.post("/api/bracket")
@login_required
def api_bracket():
    payload = request.get_json(force=True, silent=False) or {}
    draw_rows = payload.get("draw") or []
    if not isinstance(draw_rows, list) or len(draw_rows) < 2:
        return jsonify({"error": "Envie o campo draw com ao menos 2 participantes."}), 400
    return jsonify(make_bracket(draw_rows))


@app.post("/api/round_robin")
@login_required
def api_round_robin():
    payload = request.get_json(force=True, silent=False) or {}
    draw_rows = payload.get("draw") or []
    if not isinstance(draw_rows, list) or len(draw_rows) < 2:
        return jsonify({"error": "Envie o campo draw com ao menos 2 participantes."}), 400
    return jsonify(make_round_robin(draw_rows))


@app.post("/api/share")
@login_required
def api_share():
    payload = request.get_json(force=True, silent=False) or {}
    code = save_share(payload)
    return jsonify({"code": code, "url": url_for("index", code=code, _external=True)})


@app.put("/api/share/<code>")
@login_required
def api_share_put(code: str):
    payload = request.get_json(force=True, silent=False) or {}
    if not update_share(code, payload):
        return jsonify({"error": "Nao encontrado."}), 404
    code = (code or "").strip().upper()
    return jsonify({"code": code, "url": url_for("index", code=code, _external=True)})


@app.get("/api/share/<code>")
def api_share_get(code: str):
    payload = load_share(code)
    if not payload:
        return jsonify({"error": "Nao encontrado."}), 404
    return jsonify(payload)


@app.post("/api/export_xlsx")
@login_required
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
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    init_db()
    app.run(host="0.0.0.0", port=port, debug=debug)
