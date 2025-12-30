# Sorteios Pro (Flask)

## Objetivo
Sorteio de times por esporte com filtros, exportação e chaveamento.

## Rodar localmente
pip install -r requirements.txt
python app.py
Abra: http://127.0.0.1:5000

## Datasets
- data/datasets.json registra os datasets disponíveis.
- EA FC 25: data/teams_fc25.csv (já incluso)
- NBA 2K25: data/teams_nba2k25.csv (placeholder vazio)

Para adicionar NBA 2K25:
1) Preencha data/teams_nba2k25.csv com as colunas:
   team_id,team_name,league,overall,offense,defense,conference,division,is_valid
2) Reinicie o servidor

## Chaveamento
Após gerar sorteio, clique em "Gerar chaveamento" para criar o bracket inicial.


## Todos contra todos (sem BYE)
Após gerar o sorteio, clique em "Todos contra todos" para gerar a lista completa de confrontos entre todos os participantes.


## Monetização: anúncios recompensados (simulado)
Este projeto inclui um fluxo de "anúncio recompensado" no front-end para liberar recursos por 15 minutos:
- Exportar Excel
- Chaveamento
- Todos contra todos

### Como funciona
- O navegador cria um client_id e envia para o backend.
- O backend guarda um entitlement temporário em SQLite.
- O modal conta 10 segundos e libera o botão.

### Produção
Em produção, substitua o endpoint /api/entitlement/grant por uma validação real do provedor de anúncios.
