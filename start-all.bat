@echo off
echo ==============================
echo  Model Channel Dashboard
echo  Starting all services...
echo ==============================

REM Start API server in new window
start "API Server" powershell -ExecutionPolicy Bypass -File "%~dp0start-api.ps1"

REM Wait a moment
timeout /t 2 /nobreak >nul

REM Start Vite dev server in new window
start "Vite Dev Server" powershell -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"

echo.
echo Services started!
echo   Frontend: http://127.0.0.1:4173
echo   API:      http://127.0.0.1:4180
echo.
pause
