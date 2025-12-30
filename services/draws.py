import random
from typing import Any, Dict, List


def _to_int(value: Any) -> int:
    try:
        return int(float(value)) if value not in ("", None) else 0
    except Exception:
        return 0


def apply_filters(rows: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    team_types = set(filters.get("team_types") or ["CLUB", "NATIONAL"])
    genders = set(filters.get("genders") or ["MEN", "WOMEN"])
    competitions = set(filters.get("competitions") or [])
    countries = set(filters.get("countries") or [])
    conferences = set(filters.get("conferences") or [])
    divisions = set(filters.get("divisions") or [])
    overall_min = int(filters.get("overall_min") or 0)
    overall_max = int(filters.get("overall_max") or 999)
    include_invalid = bool(filters.get("include_invalid") or False)

    out = []
    for t in rows:
        if not include_invalid and not t.get("is_valid", True):
            continue
        if team_types and (t.get("team_type") or "") not in team_types:
            continue
        if genders and (t.get("gender") or "") not in genders:
            continue
        if competitions and (t.get("competition") or "") not in competitions:
            continue
        if countries and (t.get("country") or "") not in countries:
            continue
        if conferences and (t.get("conference") or "") not in conferences:
            continue
        if divisions and (t.get("division") or "") not in divisions:
            continue

        overall = _to_int(t.get("overall", 0))
        if overall < overall_min or overall > overall_max:
            continue
        out.append(t)

    out.sort(
        key=lambda x: (
            _to_int(x.get("overall", 0)),
            _to_int(x.get("attack", 0)),
            _to_int(x.get("midfield", 0)),
            _to_int(x.get("defence", 0)),
        ),
        reverse=True,
    )

    mode = filters.get("mode", "all")
    top_n = int(filters.get("top_n") or 0)
    if mode == "top" and top_n > 0:
        out = out[:top_n]

    return out


def draw_assignments(participants: List[str], pool: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    pool_copy = pool[:]
    random.shuffle(pool_copy)

    result = []
    for i, person in enumerate(participants):
        t = pool_copy[i]
        result.append(
            {
                "participant": person,
                "team_id": t.get("team_id"),
                "team_name": t.get("team_name"),
                "team_type": t.get("team_type"),
                "gender": t.get("gender"),
                "overall": t.get("overall"),
                "attack": t.get("attack"),
                "midfield": t.get("midfield"),
                "defence": t.get("defence"),
                "competition": t.get("competition"),
                "country": t.get("country"),
                "conference": t.get("conference"),
                "division": t.get("division"),
            }
        )

    return result


def make_bracket(draw_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    entries = draw_rows[:]
    random.shuffle(entries)

    total = len(entries)
    base = 1
    while base * 2 <= total:
        base *= 2
    extras = total - base

    rounds = []

    def create_matches(participants: List[Dict[str, Any]]):
        matches = []
        for i in range(0, len(participants), 2):
            a = participants[i] if i < len(participants) else None
            b = participants[i + 1] if i + 1 < len(participants) else None
            matches.append({"a": a, "b": b})
        return matches

    if extras > 0:
        rep_count = extras * 2
        rep_participants = entries[:rep_count]
        byes = entries[rep_count:]
        rounds.append({"name": "Repescagem", "matches": create_matches(rep_participants)})
        rounds.append({"name": f"Proxima fase ({len(byes) + extras} jogadores)", "byes": byes})
    else:
        rounds.append({"name": f"Fase de {total}", "matches": create_matches(entries)})

    return {"count": total, "rounds": rounds}
