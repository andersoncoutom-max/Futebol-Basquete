
import json
import os
import secrets
import sqlite3
from datetime import datetime
from functools import wraps
from typing import Any, Dict, Optional

import eventlet
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
from flask_socketio import SocketIO, emit, join_room
from werkzeug.security import check_password_hash, generate_password_hash

from services.datasets import compute_stats, list_datasets, load_rows
from services.draws import apply_filters, draw_assignments, make_bracket, make_round_robin

eventlet.monkey_patch()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "data", "history.sqlite3")

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret")
socketio = SocketIO(app, cors_allowed_origins="*")


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

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tournaments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                dataset TEXT NOT NULL,
                mode TEXT NOT NULL,
                created_at TEXT NOT NULL,
                owner_user_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'open'
            );
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tournament_players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tournament_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tournament_matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tournament_id INTEGER NOT NULL,
                round_index INTEGER NOT NULL,
                match_index INTEGER NOT NULL,
                a_player TEXT,
                a_team TEXT,
                b_player TEXT,
                b_team TEXT,
                winner TEXT,
                confirmed_by_a INTEGER NOT NULL DEFAULT 0,
                confirmed_by_b INTEGER NOT NULL DEFAULT 0,
                confirmed_by_admin INTEGER NOT NULL DEFAULT 0
            );
            """
        )

        con.commit()
    finally:
        con.close()


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


def get_tournament_by_code(code: str) -> Optional[Dict[str, Any]]:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT id, code, name, dataset, mode, created_at, owner_user_id, status FROM tournaments WHERE code = ?",
            (code,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "code": row[1],
            "name": row[2],
            "dataset": row[3],
            "mode": row[4],
            "created_at": row[5],
            "owner_user_id": row[6],
            "status": row[7],
        }
    finally:
        con.close()


def list_tournament_players(tournament_id: int) -> list[Dict[str, Any]]:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT user_id, display_name FROM tournament_players WHERE tournament_id = ? ORDER BY id",
            (tournament_id,),
        )
        return [{"user_id": row[0], "display_name": row[1]} for row in cur.fetchall()]
    finally:
        con.close()


def get_player_name(tournament_id: int, user_id: int) -> Optional[str]:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT display_name FROM tournament_players WHERE tournament_id = ? AND user_id = ?",
            (tournament_id, user_id),
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        con.close()


def list_tournament_matches(tournament_id: int) -> list[Dict[str, Any]]:
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            """
            SELECT id, round_index, match_index, a_player, a_team, b_player, b_team,
                   winner, confirmed_by_a, confirmed_by_b, confirmed_by_admin
            FROM tournament_matches
            WHERE tournament_id = ?
            ORDER BY round_index, match_index
            """,
            (tournament_id,),
        )
        out = []
        for row in cur.fetchall():
            out.append(
                {
                    "id": row[0],
                    "round_index": row[1],
                    "match_index": row[2],
                    "a_player": row[3],
                    "a_team": row[4],
                    "b_player": row[5],
                    "b_team": row[6],
                    "winner": row[7],
                    "confirmed_by_a": bool(row[8]),
                    "confirmed_by_b": bool(row[9]),
                    "confirmed_by_admin": bool(row[10]),
                }
            )
        return out
    finally:
        con.close()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)

    return wrapper


init_db()


@app.get("/login")
def login():
    return render_template("login.html")


@app.post("/login")
def login_post():
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    user = get_user_by_email(email)
    if not user or not check_password_hash(user["password_hash"], password):
        return render_template("login.html", error="Credenciais invalidas."), 400
    session["user_id"] = user["id"]
    session["user_email"] = user["email"]
    session["is_pro"] = bool(user["is_pro"])
    return redirect(url_for("index"))


@app.get("/register")
def register():
    return render_template("register.html")


@app.post("/register")
def register_post():
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    password2 = request.form.get("password2") or ""
    if not email or not password:
        return render_template("register.html", error="Preencha email e senha."), 400
    if password != password2:
        return render_template("register.html", error="Senhas nao conferem."), 400
    if get_user_by_email(email):
        return render_template("register.html", error="Email ja cadastrado."), 400
    user = create_user(email, password)
    session["user_id"] = user["id"]
    session["user_email"] = user["email"]
    session["is_pro"] = False
    return redirect(url_for("index"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


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


@app.get("/s/<code>")
def share_page(code: str):
    payload = load_share(code)
    if not payload:
        abort(404)
    return render_template("share.html", payload_json=json.dumps(payload, ensure_ascii=False))


@app.get("/tournament")
@login_required
def tournament_page():
    return render_template("tournament.html")


@app.get("/api/datasets")
@login_required
def api_datasets():
    return jsonify({"datasets": list_datasets()})


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
    draw_rows = payload.get("draw") or []
    if not isinstance(draw_rows, list) or len(draw_rows) < 1:
        return jsonify({"error": "Envie um sorteio valido para compartilhar."}), 400
    code = save_share(payload)
    return jsonify({"code": code, "url": url_for("share_page", code=code, _external=True)})


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


@app.post("/api/tournaments")
@login_required
def api_tournament_create():
    payload = request.get_json(force=True, silent=False) or {}
    name = (payload.get("name") or "").strip()
    dataset = (payload.get("dataset") or "fc25").strip()
    mode = (payload.get("mode") or "bracket").strip()
    display_name = (payload.get("display_name") or "").strip()
    if not name or not display_name:
        return jsonify({"error": "Informe nome do torneio e seu apelido."}), 400

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        code = generate_code(6)
        cur.execute(
            "INSERT INTO tournaments (code, name, dataset, mode, created_at, owner_user_id, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
            (code, name, dataset, mode, _now_iso(), session["user_id"]),
        )
        tournament_id = cur.lastrowid
        cur.execute(
            "INSERT INTO tournament_players (tournament_id, user_id, display_name, created_at) VALUES (?, ?, ?, ?)",
            (tournament_id, session["user_id"], display_name, _now_iso()),
        )
        con.commit()
    finally:
        con.close()

    return jsonify({"code": code})


@app.post("/api/tournaments/join")
@login_required
def api_tournament_join():
    payload = request.get_json(force=True, silent=False) or {}
    code = (payload.get("code") or "").upper().strip()
    display_name = (payload.get("display_name") or "").strip()
    if not code or not display_name:
        return jsonify({"error": "Informe o codigo e seu apelido."}), 400

    tournament = get_tournament_by_code(code)
    if not tournament:
        return jsonify({"error": "Torneio nao encontrado."}), 404
    if tournament["owner_user_id"] != session.get("user_id"):
        return jsonify({"error": "Apenas o admin pode iniciar."}), 403

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT id FROM tournament_players WHERE tournament_id = ? AND user_id = ?",
            (tournament["id"], session["user_id"]),
        )
        if not cur.fetchone():
            cur.execute(
                "INSERT INTO tournament_players (tournament_id, user_id, display_name, created_at) VALUES (?, ?, ?, ?)",
                (tournament["id"], session["user_id"], display_name, _now_iso()),
            )
            con.commit()
    finally:
        con.close()

    socketio.emit("tournament_update", {"code": code}, room=code)
    return jsonify({"code": code})


@app.get("/api/tournaments/<code>")
@login_required
def api_tournament_get(code: str):
    code = code.upper().strip()
    tournament = get_tournament_by_code(code)
    if not tournament:
        return jsonify({"error": "Torneio nao encontrado."}), 404
    if tournament["owner_user_id"] != session.get("user_id"):
        return jsonify({"error": "Apenas o admin pode iniciar."}), 403
    players = list_tournament_players(tournament["id"])
    matches = list_tournament_matches(tournament["id"])
    return jsonify({"tournament": tournament, "players": players, "matches": matches})


@app.post("/api/tournaments/<code>/start")
@login_required
def api_tournament_start(code: str):
    code = code.upper().strip()
    tournament = get_tournament_by_code(code)
    if not tournament:
        return jsonify({"error": "Torneio nao encontrado."}), 404
    if tournament["owner_user_id"] != session.get("user_id"):
        return jsonify({"error": "Apenas o admin pode iniciar."}), 403

    payload = request.get_json(force=True, silent=False) or {}
    mode = (payload.get("mode") or tournament["mode"]).strip()

    players = list_tournament_players(tournament["id"])
    participants = [p["display_name"] for p in players]
    if len(participants) < 2:
        return jsonify({"error": "Adicione pelo menos 2 jogadores."}), 400

    rows = load_rows(tournament["dataset"])
    pool = apply_filters(rows, {"mode": "all"})
    if len(participants) > len(pool):
        return jsonify({"error": "Participantes maior que o pool."}), 400

    draw_rows = draw_assignments(participants, pool)

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM tournament_matches WHERE tournament_id = ?", (tournament["id"],))

        if mode == "round_robin":
            rr = make_round_robin(draw_rows)
            for idx, match in enumerate(rr.get("matches") or []):
                a = match.get("a") or {}
                b = match.get("b") or {}
                cur.execute(
                    """
                    INSERT INTO tournament_matches (
                        tournament_id, round_index, match_index, a_player, a_team, b_player, b_team, winner,
                        confirmed_by_a, confirmed_by_b, confirmed_by_admin
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)
                    """,
                    (
                        tournament["id"],
                        int(match.get("round") or 1),
                        idx,
                        a.get("participant"),
                        a.get("team_name"),
                        b.get("participant"),
                        b.get("team_name"),
                    ),
                )
        else:
            bracket = make_bracket(draw_rows)
            rounds = bracket.get("rounds") or []
            for r_idx, rnd in enumerate(rounds):
                for m_idx, match in enumerate(rnd.get("matches") or []):
                    a = match.get("a") or {}
                    b = match.get("b") or {}
                    cur.execute(
                        """
                        INSERT INTO tournament_matches (
                            tournament_id, round_index, match_index, a_player, a_team, b_player, b_team, winner,
                            confirmed_by_a, confirmed_by_b, confirmed_by_admin
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)
                        """,
                        (
                            tournament["id"],
                            r_idx + 1,
                            m_idx,
                            a.get("participant"),
                            a.get("team_name"),
                            b.get("participant"),
                            b.get("team_name"),
                        ),
                    )

        con.commit()
    finally:
        con.close()

    socketio.emit("tournament_update", {"code": code}, room=code)
    return jsonify({"ok": True})


@app.post("/api/tournaments/<code>/confirm")
@login_required
def api_tournament_confirm(code: str):
    code = code.upper().strip()
    payload = request.get_json(force=True, silent=False) or {}
    match_id = int(payload.get("match_id") or 0)
    winner = payload.get("winner")
    if winner not in ("a", "b"):
        return jsonify({"error": "Winner invalido."}), 400

    tournament = get_tournament_by_code(code)
    if not tournament:
        return jsonify({"error": "Torneio nao encontrado."}), 404
    if tournament["owner_user_id"] != session.get("user_id"):
        return jsonify({"error": "Apenas o admin pode iniciar."}), 403

    player_name = get_player_name(tournament["id"], session["user_id"])
    is_admin = tournament["owner_user_id"] == session.get("user_id")

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT a_player, b_player, winner, confirmed_by_a, confirmed_by_b, confirmed_by_admin FROM tournament_matches WHERE id = ? AND tournament_id = ?",
            (match_id, tournament["id"]),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "Partida nao encontrada."}), 404

        a_player, b_player, current_winner, c_a, c_b, c_admin = row

        if not is_admin and player_name not in (a_player, b_player):
            return jsonify({"error": "Sem permissao."}), 403

        if current_winner and current_winner != winner:
            return jsonify({"error": "Resultado ja definido."}), 400

        if is_admin:
            c_admin = 1
        if player_name == a_player:
            c_a = 1
        if player_name == b_player:
            c_b = 1

        cur.execute(
            """
            UPDATE tournament_matches
            SET winner = ?, confirmed_by_a = ?, confirmed_by_b = ?, confirmed_by_admin = ?
            WHERE id = ?
            """,
            (winner, int(c_a), int(c_b), int(c_admin), match_id),
        )
        con.commit()
    finally:
        con.close()

    socketio.emit("tournament_update", {"code": code}, room=code)
    return jsonify({"ok": True})


@socketio.on("join_tournament")
def join_tournament(data):
    code = (data.get("code") or "").upper().strip()
    if not code:
        emit("error", {"error": "Codigo invalido."})
        return
    join_room(code)
    emit("joined", {"code": code})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    init_db()
    socketio.run(app, host="0.0.0.0", port=port, debug=debug)
