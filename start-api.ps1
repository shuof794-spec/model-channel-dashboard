$ErrorActionPreference = "Continue"
Set-Location "E:\Project\Model Channel Dashboard\model-channel-dashboard"
$env:MODEL_DASHBOARD_PYTHON = "$PWD\.venv\Scripts\python.exe"
$env:RELAYWATCH_PYTHON = "$PWD\.venv\Scripts\python.exe"
$env:BANANA_HTTP_PROXY = "http://127.0.0.1:17890"
Write-Host "=== Starting API Server ===" -ForegroundColor Cyan
Write-Host "Python: $env:MODEL_DASHBOARD_PYTHON"
Write-Host "Proxy:  $env:BANANA_HTTP_PROXY"
node server.mjs
