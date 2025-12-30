# Deploy rápido (Render)

## O que já está pronto
- Gunicorn adicionado em requirements.txt
- Procfile e render.yaml incluídos
- app.py inicializa o SQLite em produção (gunicorn)

## Render (Web Service)
1. Suba este projeto para o GitHub
2. No Render: New -> Web Service -> selecione o repositório
3. Configure:
   - Build Command: pip install -r requirements.txt
   - Start Command: gunicorn -b 0.0.0.0:$PORT app:app
4. Deploy

## Observação (SQLite)
Este projeto usa SQLite em data/history.sqlite3.
Para MVP está ok. Para escalar (histórico de salas/usuários), migre para Postgres.
