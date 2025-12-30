@echo off
setlocal
cd /d "C:\Users\anderson.couto_agenc\OneDrive\Desktop\fc25_sorteio"

call .\.venv\Scripts\python.exe import_xlsx_teams.py
if errorlevel 1 goto :error

call .\.venv\Scripts\python.exe app.py
if errorlevel 1 goto :error

goto :eof

:error
echo.
echo Erro ao executar. Verifique as mensagens acima.
pause
