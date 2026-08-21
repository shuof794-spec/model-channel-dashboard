@echo off
chcp 65001 >nul 2>&1
echo ==========================================
echo   Stopping Model Channel Dashboard
echo ==========================================
echo.

echo Stopping API Server...
taskkill /FI "WINDOWTITLE eq Model Dashboard API*" /F >nul 2>&1

echo Stopping Vite Dev Server...
taskkill /FI "WINDOWTITLE eq Model Dashboard Vite*" /F >nul 2>&1

echo.
echo All services stopped.
echo.
pause
