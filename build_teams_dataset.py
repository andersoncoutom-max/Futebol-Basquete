import csv
import os
import re
import time
from dataclasses import dataclass
from typing import List, Tuple
import requests
from bs4 import BeautifulSoup

BASE = "https://www.fifacm.com"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LEAGUES_URL = f"{BASE}/25/leagues"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": BASE,
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

@dataclass
class Team:
    team_name: str
    league: str
    overall: int
    attack: int
    midfield: int
    defence: int
    team_url: str

def _get(url: str) -> str:
    r = SESSION.get(url, timeout=30)
    if r.status_code == 403:
        raise RuntimeError(
            "Acesso negado (HTTP 403). O site pode bloquear automatizacao. "
            "Tente novamente mais tarde ou use outra rede."
        )
    r.raise_for_status()
    return r.text

def _parse_leagues(html: str) -> List[Tuple[str, str]]:
    """
    Retorna lista de (league_name, league_url).
    """
    soup = BeautifulSoup(html, "html.parser")
    links = soup.select('a[href^="/25/league/"]')
    seen = set()
    out = []
    for a in links:
        href = a.get("href", "").strip()
        name = a.get_text(strip=True)
        if not href or not name:
            continue
        full = f"{BASE}{href}"
        key = (name, full)
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out

def _extract_team_cards(league_name: str, league_url: str, html: str) -> List[Team]:
    """
    Nas paginas de liga do FIFACM, os times aparecem em blocos com texto tipo:
    "OVR 80 ATT 77 MID 78 DEF 80"
    """
    soup = BeautifulSoup(html, "html.parser")
    anchors = soup.select('a[href^="/25/team/"]')

    teams: List[Team] = []
    for a in anchors:
        href = a.get("href", "").strip()
        full_url = f"{BASE}{href}" if href.startswith("/") else href
        text = " ".join(a.get_text(" ", strip=True).split())

        # Exemplo de padrao que aparece na liga:
        # "Manchester United ... OVR 80 ATT 77 MID 78 DEF 80 ..."
        m = re.search(r"\bOVR\s+(\d+)\s+ATT\s+(\d+)\s+MID\s+(\d+)\s+DEF\s+(\d+)\b", text)
        if not m:
            continue

        overall, att, mid, deff = map(int, m.groups())

        # O nome do time geralmente e a primeira parte do texto antes de valores; tenta capturar de forma robusta
        # Heuristica: pega o texto do link e remove trechos de numeros e tokens comuns
        # Alternativa mais robusta: abrir a pagina do time. Aqui mantemos simples e rapido.
        name_guess = a.get_text(" ", strip=True)
        name_guess = re.sub(r"\bOVR\b.*$", "", name_guess).strip()
        name_guess = re.sub(r"\s+\|.*$", "", name_guess).strip()
        name_guess = re.sub(r"\s{2,}", " ", name_guess).strip()

        if not name_guess:
            continue

        teams.append(Team(
            team_name=name_guess,
            league=league_name,
            overall=overall,
            attack=att,
            midfield=mid,
            defence=deff,
            team_url=full_url
        ))

    # Remover duplicatas por URL
    uniq = {}
    for t in teams:
        uniq[t.team_url] = t
    return list(uniq.values())

def build_dataset(output_csv: str = os.path.join(BASE_DIR, "data", "teams_fc25.csv"), sleep_s: float = 0.2) -> int:
    leagues_html = _get(LEAGUES_URL)
    leagues = _parse_leagues(leagues_html)

    all_teams: List[Team] = []
    for league_name, league_url in leagues:
        try:
            html = _get(league_url)
            teams = _extract_team_cards(league_name, league_url, html)
            all_teams.extend(teams)
            time.sleep(sleep_s)
        except Exception as e:
            print(f"[WARN] Falha ao processar liga: {league_name} ({league_url}). Erro: {e}")

    # Dedup global por nome+liga+overall (caso algum time apareca em mais de uma lista)
    seen = set()
    final: List[Team] = []
    for t in all_teams:
        key = (t.team_name.lower(), t.league.lower(), t.overall, t.attack, t.midfield, t.defence)
        if key in seen:
            continue
        seen.add(key)
        final.append(t)

    final.sort(key=lambda x: (-x.overall, x.team_name.lower()))

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["team_name", "league", "overall", "attack", "midfield", "defence", "team_url"])
        for t in final:
            w.writerow([t.team_name, t.league, t.overall, t.attack, t.midfield, t.defence, t.team_url])

    return len(final)

if __name__ == "__main__":
    n = build_dataset()
    print(f"OK. Dataset gerado com {n} times em data/teams_fc25.csv")
