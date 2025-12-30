import random
from typing import Any, Dict, List

def apply_filters(rows: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    include_invalid = bool(filters.get("include_invalid") or False)
    overall_min = int(filters.get("overall_min") or 0)

    def _set_or_none(key: str):
        v = filters.get(key)
        if not v:
            return None
        if isinstance(v, list):
            return set(str(x) for x in v)
        return set([str(v)])

    team_types = _set_or_none("team_types")
    genders = _set_or_none("genders")
    conferences = _set_or_none("conferences")
    divisions = _set_or_none("divisions")
    competitions = _set_or_none("competitions")
    countries = _set_or_none("countries")

    out: List[Dict[str, Any]] = []
    for r in rows:
        if not include_invalid and not r.get("is_valid", True):
            continue
        if int(r.get("overall", 0) or 0) < overall_min:
            continue

        if team_types is not None and str(r.get("team_type", "")) not in team_types:
            continue
        if genders is not None and str(r.get("gender", "")) not in genders:
            continue
        if conferences is not None and str(r.get("conference", "")) not in conferences:
            continue
        if divisions is not None and str(r.get("division", "")) not in divisions:
            continue
        if competitions is not None and str(r.get("competition", "")) not in competitions:
            continue
        if countries is not None and str(r.get("country", "")) not in countries:
            continue

        out.append(r)

    out.sort(
        key=lambda x: (
            int(x.get("overall", 0) or 0),
            int(x.get("attack", x.get("offense", 0)) or 0),
            int(x.get("midfield", 0) or 0),
            int(x.get("defence", x.get("defense", 0)) or 0),
        ),
        reverse=True,
    )

    mode = str(filters.get("mode") or "all").lower()
    top_n = int(filters.get("top_n") or 0)
    if mode == "top" and top_n > 0:
        out = out[:top_n]

    return out

def draw_assignments(participants: List[str], pool: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(participants) > len(pool):
        raise ValueError(f"Participantes ({len(participants)}) maior que pool ({len(pool)}).")
    shuffled = pool[:]
    random.shuffle(shuffled)
    return [{"participant": p, **shuffled[i]} for i, p in enumerate(participants)]

def make_bracket(draw_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(draw_rows)
    if n < 2:
        return {"size": n, "rounds": []}

    size = 1
    while size < n:
        size *= 2

    seeds: List[Any] = draw_rows[:] + [None] * (size - n)

    def pairings(seed_list: List[Any]) -> List[Dict[str, Any]]:
        m = len(seed_list)
        pairs = []
        for i in range(m // 2):
            a = seed_list[i]
            b = seed_list[m - 1 - i]
            pairs.append({"a": a, "b": b, "label": f"Jogo {i+1}"})
        return pairs

    rounds = [{
        "round": 1,
        "name": "Final" if len(seeds) == 2 else ("Semifinal" if len(seeds) == 4 else f"Rodada de {len(seeds)}"),
        "matches": pairings(seeds),
    }]

    return {"size": size, "rounds": rounds}


def make_round_robin(draw_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Gera tabela 'todos contra todos' sem BYE.
    Retorna uma lista de jogos (match list) com todas as combinações.
    Observação: para n participantes, total de jogos = n*(n-1)/2.
    """
    n = len(draw_rows)
    if n < 2:
        return {"players": n, "matches": []}

    matches: List[Dict[str, Any]] = []
    # combinações únicas
    for a, b in __import__("itertools").combinations(draw_rows, 2):
        matches.append({
            "a": a,
            "b": b,
        })

    # embaralha a ordem dos jogos para ficar mais 'resenha'
    random.shuffle(matches)

    return {"players": n, "matches": matches, "total_matches": len(matches)}
