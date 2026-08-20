@echo off
chcp 65001 >nul 2>&1
echo ==========================================
echo   Model Channel Dashboard
echo ==========================================
echo.

cd /d "%~dp0"

REM === ?? config.json ?????? setup ===
if not exist "config.json" (
    echo [INFO] config.json not found, running setup...
    echo.
    powershell -ExecutionPolicy Bypass -File "setup.ps1"
    goto :eof
)

REM === ? PowerShell ?? config.json ===
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).apiPort"') do set API_PORT=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).frontendPort"') do set FRONTEND_PORT=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).proxyUrl"') do set BANANA_HTTP_PROXY=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).pythonPath"') do set MODEL_DASHBOARD_PYTHON=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).pythonPath"') do set RELAYWATCH_PYTHON=%%i

echo  API Port:     %API_PORT%
echo  Frontend:     %FRONTEND_PORT%
echo  Proxy:        %BANANA_HTTP_PROXY%
echo  Python:       %MODEL_DASHBOARD_PYTHON%
echo.

echo [1/2] Starting API Server...
start "Model Dashboard API - Port %API_PORT%" cmd /k "cd /d `"%~dp0`" && set `"BANANA_HTTP_PROXY=%BANANA_HTTP_PROXY%`" && set `"MODEL_DASHBOARD_PYTHON=%MODEL_DASHBOARD_PYTHON%`" && set `"RELAYWATCH_PYTHON=%RELAYWATCH_PYTHON%`" && node server.mjs"

echo Waiting for API...
timeout /t 3 /nobreak >nul

echo [2/2] Starting Vite Dev Server...
start "Model Dashboard Vite - Port %FRONTEND_PORT%" cmd /k "cd /d `"%~dp0`" && set `"VITE_PORT=%FRONTEND_PORT%`" && npx vite --host 127.0.0.1"

echo.
echo ==========================================
echo  All services started!
echo ==========================================
echo.
echo  Frontend: http://127.0.0.1:%FRONTEND_PORT%
echo  API:      http://127.0.0.1:%API_PORT%
echo.
echo  Press any key to close this window...
pause >nul
