Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Model Channel Dashboard - 启动脚本" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$projectDir = "E:\Project\Model Channel Dashboard\model-channel-dashboard"
Set-Location $projectDir

# Set environment variables
$env:MODEL_DASHBOARD_PYTHON = "$projectDir\.venv\Scripts\python.exe"
$env:RELAYWATCH_PYTHON = "$projectDir\.venv\Scripts\python.exe"
$env:BANANA_HTTP_PROXY = "http://127.0.0.1:17890"

Write-Host "📁 工作目录: $projectDir" -ForegroundColor Yellow
Write-Host "🐍 Python: $env:MODEL_DASHBOARD_PYTHON" -ForegroundColor Yellow
Write-Host "🌐 代理: $env:BANANA_HTTP_PROXY" -ForegroundColor Yellow
Write-Host ""

# Start API server
Write-Host "🚀 启动 API 服务..." -ForegroundColor Green
$apiProcess = Start-Process node -ArgumentList "server.mjs" -WorkingDirectory $projectDir -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2

# Verify API is running
$apiConn = Get-NetTCPConnection -LocalPort 4180 -ErrorAction SilentlyContinue
if ($apiConn) {
    Write-Host "✅ API 服务已启动 - 端口 4180" -ForegroundColor Green
} else {
    Write-Host "❌ API 服务启动失败" -ForegroundColor Red
}

# Start Vite dev server
Write-Host "🚀 启动 Vite 前端..." -ForegroundColor Green
$viteProcess = Start-Process cmd -ArgumentList "/k", "cd /d `"$projectDir`" && npx vite --host 127.0.0.1" -PassThru
Start-Sleep -Seconds 3

# Verify Vite is running
$viteConn = Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue
if ($viteConn) {
    Write-Host "✅ Vite 前端已启动 - 端口 4173" -ForegroundColor Green
} else {
    Write-Host "❌ Vite 前端启动失败" -ForegroundColor Red
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  所有服务已启动!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 前端地址: http://127.0.0.1:4173" -ForegroundColor Yellow
Write-Host "🔌 API 地址: http://127.0.0.1:4180" -ForegroundColor Yellow
Write-Host ""
Write-Host "按任意键关闭此窗口..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
