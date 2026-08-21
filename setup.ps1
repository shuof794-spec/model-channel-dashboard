#Requires -Version 5.1
<#
.SYNOPSIS
    Model Channel Dashboard 一键部署脚本
.DESCRIPTION
    自动检测环境、配置端口、安装依赖、启动服务。
    在新电脑上运行一次即可完成全部部署。
.NOTES
    用法:  在 PowerShell 中运行  .\setup.ps1
#>

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
$ConfigFile = Join-Path $ProjectDir "config.json"
$VenvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"
$RequirementsFile = Join-Path $ProjectDir "relaywatch\requirements.txt"

# ============================================================
#  颜色输出辅助
# ============================================================
function Write-Step   { param([string]$msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK     { param([string]$msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Err    { param([string]$msg) Write-Host "    [X]  $msg" -ForegroundColor Red }
function Write-Info   { param([string]$msg) Write-Host "    $msg" -ForegroundColor Gray }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Model Channel Dashboard - 部署向导" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ============================================================
#  STEP 1: 加载已有配置
# ============================================================
Write-Step "1/7  加载配置"

$settings = @{
    apiPort       = 4180
    frontendPort  = 4173
    proxyUrl      = ""
    pythonPath    = ""
}

if (Test-Path $ConfigFile) {
    try {
        $saved = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        if ($saved.apiPort)       { $settings.apiPort       = [int]$saved.apiPort }
        if ($saved.frontendPort)  { $settings.frontendPort  = [int]$saved.frontendPort }
        if ($saved.proxyUrl)      { $settings.proxyUrl      = $saved.proxyUrl }
        if ($saved.pythonPath)    { $settings.pythonPath    = $saved.pythonPath }
        Write-OK "已加载旧配置: API=$($settings.apiPort) 前端=$($settings.frontendPort) 代理=$($settings.proxyUrl)"
    } catch {
        Write-Warn "旧配置解析失败，使用默认值"
    }
} else {
    Write-Info "首次部署，使用默认值"
}

# ============================================================
#  STEP 2: 检测 Node.js
# ============================================================
Write-Step "2/7  检测 Node.js"

try {
    $nodeVer = & node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "node not found" }
    Write-OK "Node.js $nodeVer"
    # 检查版本 >= 18
    $major = [int]($nodeVer -replace '^v','' -replace '\..*','')
    if ($major -lt 18) {
        Write-Err "Node.js 版本过低 ($nodeVer)，需要 18 或更高"
        exit 1
    }
} catch {
    Write-Err "未检测到 Node.js，请安装 Node.js 18+: https://nodejs.org/"
    exit 1
}

# ============================================================
#  STEP 3: 检测 Python
# ============================================================
Write-Step "3/7  检测 Python"

function Find-Python {
    # 优先使用已有配置
    if ($settings.pythonPath -and (Test-Path $settings.pythonPath)) {
        return $settings.pythonPath
    }
    # 优先使用 .venv
    if (Test-Path $VenvPython) {
        return $VenvPython
    }
    # 查找系统 Python
    try {
        $sysPy = & python --version 2>&1
        if ($LASTEXITCODE -eq 0) { return "python" }
    } catch {}
    # 查找 python3
    try {
        $sysPy3 = & python3 --version 2>&1
        if ($LASTEXITCODE -eq 0) { return "python3" }
    } catch {}
    return $null
}

$pyPath = Find-Python
if ($pyPath) {
    $pyVer = & "$pyPath" --version 2>&1
    Write-OK "Python: $pyVer ($pyPath)"
    $settings.pythonPath = $pyPath
} else {
    Write-Warn "未检测到 Python，数据抓取功能可能不可用"
    Write-Info "可安装 Python 3.10+: https://www.python.org/"
}

# ============================================================
#  STEP 4: 自动检测代理端口
# ============================================================
Write-Step "4/7  检测 VPN / 代理端口"

$knownProxyPorts = @(7890, 1080, 10808, 10809, 10090, 10091, 1087, 17890, 20170, 20171)
$foundProxies = @()

foreach ($port in $knownProxyPorts) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $proc = Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        $foundProxies += @{ port = $port; process = $name }
        Write-Info "发现代理端口: $port ($name)"
    }
}

if ($foundProxies.Count -gt 0) {
    Write-OK "找到 $($foundProxies.Count) 个可能的代理端口"
} else {
    Write-Warn "未发现常见代理端口，可能不需要代理"
}

# 让用户选择代理
Write-Host ""
Write-Host "  代理配置 (用于访问海外数据源):" -ForegroundColor White
Write-Host "  [0] 不使用代理" -ForegroundColor Gray

for ($i = 0; $i -lt $foundProxies.Count; $i++) {
    $p = $foundProxies[$i]
    Write-Host "  [$($i+1)] $($p.port) ($($p.process))" -ForegroundColor Gray
}
Write-Host "  [S] 手动输入端口" -ForegroundColor Gray
Write-Host "  [K] 保留当前: $($settings.proxyUrl)" -ForegroundColor Gray

$proxyChoice = Read-Host "  请选择 [0/$($foundProxies.Count+1)/S/K]"

$selectedProxy = ""
switch ($proxyChoice) {
    "0" { $selectedProxy = "" }
    "K" { $selectedProxy = $settings.proxyUrl }
    "S" {
        $manualPort = Read-Host "  请输入代理端口"
        if ($manualPort -match '^\d+$') {
            $selectedProxy = "http://127.0.0.1:$manualPort"
        }
    }
    default {
        $idx = [int]$proxyChoice - 1
        if ($idx -ge 0 -and $idx -lt $foundProxies.Count) {
            $selectedProxy = "http://127.0.0.1:$($foundProxies[$idx].port)"
        }
    }
}
$settings.proxyUrl = $selectedProxy

if ($selectedProxy) {
    Write-OK "代理: $selectedProxy"
} else {
    Write-OK "不使用代理"
}

# ============================================================
#  STEP 5: 端口配置
# ============================================================
Write-Step "5/7  配置端口"

# 检测端口占用
function Test-PortFree {
    param([int]$port)
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return (-not $conn)
}

Write-Host ""
Write-Host "  当前端口配置:" -ForegroundColor White
Write-Host "  API 端口:     $($settings.apiPort)" -ForegroundColor Gray
Write-Host "  前端端口:     $($settings.frontendPort)" -ForegroundColor Gray

# 检查端口是否空闲
foreach ($p in @($settings.apiPort, $settings.frontendPort)) {
    if (-not (Test-PortFree -port $p)) {
        $proc = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        $procInfo = Get-Process -Id $proc[0].OwningProcess -ErrorAction SilentlyContinue
        Write-Warn "端口 $p 已被占用 ($($procInfo.ProcessName))，将自动调整"
    }
}

$changePorts = Read-Host "  是否修改端口? [y/N]"
if ($changePorts -eq "y" -or $changePorts -eq "Y") {
    $newApi = Read-Host "  API 端口 [$($settings.apiPort)]"
    if ($newApi -match '^\d+$') { $settings.apiPort = [int]$newApi }
    
    $newFrontend = Read-Host "  前端端口 [$($settings.frontendPort)]"
    if ($newFrontend -match '^\d+$') { $settings.frontendPort = [int]$newFrontend }
}

# 确保端口可用
if (-not (Test-PortFree -port $settings.apiPort)) {
    Write-Warn "API 端口 $($settings.apiPort) 被占用，尝试释放..."
    $busyConn = Get-NetTCPConnection -LocalPort $settings.apiPort -State Listen -ErrorAction SilentlyContinue
    if ($busyConn) {
        Stop-Process -Id $busyConn[0].OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}
if (-not (Test-PortFree -port $settings.frontendPort)) {
    Write-Warn "前端端口 $($settings.frontendPort) 被占用，尝试释放..."
    $busyConn = Get-NetTCPConnection -LocalPort $settings.frontendPort -State Listen -ErrorAction SilentlyContinue
    if ($busyConn) {
        Stop-Process -Id $busyConn[0].OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

Write-OK "API 端口: $($settings.apiPort)"
Write-OK "前端端口: $($settings.frontendPort)"

# ============================================================
#  STEP 6: 安装依赖
# ============================================================
Write-Step "6/7  安装依赖"

# npm 依赖
Write-Info "安装 npm 依赖..."
Push-Location $ProjectDir
try {
    & npm install 2>&1 | Out-Null
    Write-OK "npm 依赖安装完成"
} catch {
    Write-Err "npm install 失败: $_"
}
Pop-Location

# Python 依赖
if ($pyPath -and $pyPath -ne "python" -and $pyPath -ne "python3") {
    Write-Info "安装 Python 依赖..."
    try {
        & "$pyPath" -m pip install -r $RequirementsFile 2>&1 | Out-Null
        Write-OK "Python 依赖安装完成"
    } catch {
        Write-Warn "Python 依赖安装失败，部分功能可能不可用"
    }
} elseif ($pyPath) {
    Write-Info "使用系统 Python，跳过虚拟环境依赖安装"
    Write-Info "如需 RelayWatch 功能，请手动运行: python -m pip install -r relaywatch\requirements.txt"
}

# ============================================================
#  STEP 7: 保存配置 & 生成启动脚本
# ============================================================
Write-Step "7/7  保存配置并生成启动脚本"

# 保存 config.json
$configObj = [PSCustomObject]@{
    apiPort      = $settings.apiPort
    frontendPort = $settings.frontendPort
    proxyUrl     = $settings.proxyUrl
    pythonPath   = $settings.pythonPath
}
$configObj | ConvertTo-Json -Depth 3 | Set-Content -Path $ConfigFile -Encoding UTF8
Write-OK "配置已保存: config.json"

# 生成 start.bat (一键启动)
$batContent = @"
@echo off
chcp 65001 >nul 2>&1
echo ==========================================
echo   Model Channel Dashboard
echo ==========================================
echo.

cd /d "$ProjectDir"

REM 读取 config.json 获取端口 (简易解析)
set API_PORT=$($settings.apiPort)
set FRONTEND_PORT=$($settings.frontendPort)
set BANANA_HTTP_PROXY=$($settings.proxyUrl)
set MODEL_DASHBOARD_PYTHON=$($settings.pythonPath)
set RELAYWATCH_PYTHON=$($settings.pythonPath)

echo  API Port:     %API_PORT%
echo  Frontend:     %FRONTEND_PORT%
echo  Proxy:        %BANANA_HTTP_PROXY%
echo  Python:       %MODEL_DASHBOARD_PYTHON%
echo.

echo [1/2] Starting API Server...
start "Model Dashboard API - Port %API_PORT%" cmd /k "cd /d `"$ProjectDir`" && set `"BANANA_HTTP_PROXY=$($settings.proxyUrl)`" && set `"MODEL_DASHBOARD_PYTHON=$($settings.pythonPath)`" && set `"RELAYWATCH_PYTHON=$($settings.pythonPath)`" && node server.mjs"

echo Waiting for API...
timeout /t 3 /nobreak >nul

echo [2/2] Starting Vite Dev Server...
start "Model Dashboard Vite - Port %FRONTEND_PORT%" cmd /k "cd /d `"$ProjectDir`" && set `"VITE_PORT=$($settings.frontendPort)`" && npx vite --host 127.0.0.1"

echo.
echo ==========================================
echo  All services started!
echo ==========================================
echo.
echo  Frontend: http://127.0.0.1:%FRONTEND_PORT%
echo  API:      http://127.0.0.1:%API_PORT%
echo.
pause
"@
$batContent | Set-Content -Path (Join-Path $ProjectDir "start.bat") -Encoding ASCII
Write-OK "启动脚本已生成: start.bat"

# 生成 stop.bat (一键停止)
$stopBat = @"
@echo off
chcp 65001 >nul 2>&1
echo Stopping Model Channel Dashboard services...

taskkill /FI "WINDOWTITLE eq Model Dashboard API*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Model Dashboard Vite*" /F >nul 2>&1

echo Done!
pause
"@
$stopBat | Set-Content -Path (Join-Path $ProjectDir "stop.bat") -Encoding ASCII
Write-OK "停止脚本已生成: stop.bat"

# ============================================================
#  完成
# ============================================================
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  部署完成!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  配置文件:  config.json" -ForegroundColor White
Write-Host "  启动方式:  双击 start.bat" -ForegroundColor White
Write-Host "  停止方式:  双击 stop.bat" -ForegroundColor White
Write-Host ""
Write-Host "  API:      http://127.0.0.1:$($settings.apiPort)" -ForegroundColor Yellow
Write-Host "  Frontend: http://127.0.0.1:$($settings.frontendPort)" -ForegroundColor Yellow
Write-Host ""

$startNow = Read-Host "  是否立即启动服务? [Y/n]"
if ($startNow -ne "n" -and $startNow -ne "N") {
    Write-Host ""
    Write-Host "启动服务..." -ForegroundColor Cyan
    & (Join-Path $ProjectDir "start.bat")
}
