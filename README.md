# Sorteio FC (Flask)

## Objetivo
Sorteio de times e chaveamento para campeonatos caseiros (EA FC e NBA 2K).

## Rodar localmente
- `pip install -r requirements.txt`
- `python app.py`
- Abra: `http://127.0.0.1:5000`

## Datasets
- `data/datasets.json` descreve os datasets disponíveis.
- EA FC 25: `data/teams_fc25.csv`
- NBA 2K25: `data/teams_nba.csv`

## Presets (competições)
Os presets (ex.: Champions/Libertadores/Playoffs) ficam em `data/pools.json` e são carregados por `/api/pools`.

## Sala (código)
Use o botão `Sala` para criar/entrar. O link compartilhável fica no formato `/?code=ABC123`.
