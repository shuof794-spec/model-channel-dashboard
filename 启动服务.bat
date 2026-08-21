@echo off
echo ==============================
echo  Model Channel Dashboard
echo  Starting all services...
echo ==============================
echo.

cd /d "E:\Project\Model Channel Dashboard\model-channel-dashboard"

set MODEL_DASHBOARD_PYTHON=%CD%\.venv\Scripts\python.exe
set RELAYWATCH_PYTHON=%CD%\.venv\Scripts\python.exe
set BANANA_HTTP_PROXY=http://127.0.0.1:17890

echo [1/2] Starting API Server on port 4180...
start "API Server - Port 4180" cmd /k "title API Server - Port 4180 && cd /d "%CD%" && set MODEL_DASHBOARD_PYTHON=%CD%\.venv\Scripts\python.exe && set RELAYWATCH_PYTHON=%CD%\.venv\Scripts\python.exe && set BANANA_HTTP_PROXY=http://127.0.0.1:17890 && node server.mjs"

echo Waiting for API to start...
timeout /t 3 /nobreak >nul

echo [2/2] Starting Vite Dev Server on port 4173...
start "Vite Dev Server - Port 4173" cmd /k "title Vite Dev Server - Port 4173 && cd /d "%CD%" && npx vite --host 127.0.0.1"

echo.
echo ==============================
echo  All services started!
echo ==============================
echo   Frontend: http://127.0.0.1:4173
echo   API:      http://127.0.0.1:4180
echo.
echo Press any key to close this window...
pause >nul
