@echo off
rem Startet den Vite-Dev-Server der App und öffnet automatisch den Browser (http://localhost:5173).
cd /d "%~dp0app"
call npm run dev
echo.
echo --- Dev-Server beendet ---
pause
