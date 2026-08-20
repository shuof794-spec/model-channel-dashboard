# Model Channel Dashboard

模型渠道价格与性能监控网站。它把 `models.dev`、LiteLLM 和 RelayWatch 渠道数据统一成可筛选、可排序的价格对比表，并提供渠道管理、RelayWatch 抓取和 API 性能检测。

## 功能概览

- **模型渠道价格对比**：按模型、模型系列、厂商、供应商筛选；输入、输出、缓存读、缓存写价格均可排序。
- **价格详情**：点击价格单元格查看供应商、原始模型名、输入形式、上下文限制、计价单位、汇率和最近刷新时间。
- **渠道管理**：管理官方渠道和中转站的地址、API Base、数据来源、计价单位、汇率、价格倍率和连接方式。
- **渠道检测**：使用用户临时填写的 API Key 测试 TTFT、TTFB、总耗时、吞吐量、首 token 稳定性，并支持重复次数和并发检测。
- **定时更新**：API 服务每 3 小时自动更新一次，也可以在界面中手动更新；更新失败时会保留最近一次可用快照。
- **本地导出**：生成的审查版 Excel 保存在 `public/downloads/`，可从网站直接下载。

## 快速部署（推荐）

在新电脑上完成部署只需两步：

### 1. 运行部署向导

```powershell
cd "model-channel-dashboard"
powershell -ExecutionPolicy Bypass -File "setup.ps1"
```

向导会自动完成：

- ✅ 检测 Node.js 和 Python 环境
- ✅ 扫描本机 VPN / 代理端口（Clash、V2Ray、云鸟等）
- ✅ 交互式选择代理端口和 API 端口
- ✅ 安装 npm 和 Python 依赖
- ✅ 保存配置到 `config.json`
- ✅ 生成 `start.bat` 和 `stop.bat`

### 2. 启动服务

双击 **`start.bat`** 即可启动全部服务。

停止服务：双击 **`stop.bat`**。

## 目录结构

```text
model-channel-dashboard/
├─ setup.ps1               部署向导脚本（首次运行）
├─ config.json             端口和环境配置（自动生成，已加入 .gitignore）
├─ start.bat               一键启动（自动生成）
├─ stop.bat                一键停止（自动生成）
├─ src/                    React 页面和样式
├─ public/data/            当前离线展示数据（JSON 分页文件）
├─ public/downloads/       当前审查版 Excel
├─ scripts/                前端数据准备、渠道探针
├─ relaywatch/             RelayWatch 抓取和标准化脚本
├─ server.mjs              本地 API、更新任务、检测接口
├─ fetch_data_sources.py   下载 models.dev/LiteLLM 快照
├─ gen_two_tables.py       生成统一格式 Excel
├─ model_mapping.csv       人工模型名映射
├─ channel_rates.csv       渠道汇率、计价单位和倍率
├─ relaywatch_sites.json   RelayWatch 渠道配置
├─ vendor_model_*.csv      厂商和模型系列归一化词表
├─ vite.config.js          自动读取 config.json 的端口配置
├─ package.json            Node/Vite 依赖与命令
└─ README.md
```

## 环境要求

- Windows 10/11
- Node.js 18 或更高版本（推荐 LTS）
- Python 3.10 或更高版本（可选，用于数据抓取）
- 访问外部数据源时，需要可用的网络连接；`models.dev` 等站点可能需要代理。

## 配置文件

部署向导会生成 `config.json`，所有端口和环境配置集中在此：

```json
{
  "apiPort": 4180,
  "frontendPort": 4173,
  "proxyUrl": "http://127.0.0.1:17890",
  "pythonPath": ".venv\\Scripts\\python.exe"
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `apiPort` | API 服务端口 | 4180 |
| `frontendPort` | Vite 前端端口 | 4173 |
| `proxyUrl` | VPN 代理地址（空字符串 = 不使用） | 空 |
| `pythonPath` | Python 可执行文件路径 | 空（自动检测） |

### 修改配置

- **重新运行向导**：`powershell -ExecutionPolicy Bypass -File "setup.ps1"`
- **手动编辑**：直接修改 `config.json`
- **命令行临时指定**：

```powershell
$env:MODEL_DASHBOARD_API_PORT = "4181"
$env:BANANA_HTTP_PROXY = "http://127.0.0.1:17890"
npm run start
```

## 端口和代理

`vite.config.js` 会自动读取 `config.json` 中的端口，前端代理无需手动修改。

每个渠道都有连接方式：

- `direct`：直连，适合国内可直接访问的站点。
- `proxy`：仅通过代理，适合需要代理的站点。
- `auto`：先直连，失败后自动重试代理。

API Key 只在检测请求期间使用，不会写入配置文件或提交到 GitHub。不要把真实密钥写进 CSV、JSON 或 README。

## 手动安装（进阶）

如果不想使用部署向导，也可以手动安装：

```powershell
cd "model-channel-dashboard"
npm install

# 为数据抓取建立独立 Python 环境（可选）
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r relaywatch\requirements.txt

# 检查前端生产构建
npm run build
```

### 手动启动

**终端 1 — API 服务**：

```powershell
cd "model-channel-dashboard"
$env:MODEL_DASHBOARD_PYTHON = "$PWD\.venv\Scripts\python.exe"
$env:RELAYWATCH_PYTHON = "$PWD\.venv\Scripts\python.exe"
$env:BANANA_HTTP_PROXY = "http://127.0.0.1:代理端口"
npm run start
```

**终端 2 — 前端**：

```powershell
cd "model-channel-dashboard"
npm run dev
```

浏览器打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。

## 数据更新流程

点击网站中的"更新数据"或调用 `POST /api/update` 后，服务按以下顺序执行：

1. `fetch_data_sources.py` 下载 `models.dev` 和 LiteLLM 数据到 `data_snapshots/`。
2. `relaywatch/refresh_sites.py` 按渠道的连接方式抓取状态、模型和价格原始数据。
3. `relaywatch/normalize_data.py` 将原始结果标准化。
4. `gen_two_tables.py` 合并数据、应用 `model_mapping.csv` 和 `channel_rates.csv`，生成审查版 Excel。
5. `scripts/prepare_data.py` 把 Excel 转成 `public/data/` 下的 JSON，并更新下载文件。

上游站点暂时不可用时，服务会选取最近的有效 models 快照；RelayWatch 的旧成功结果也会保留。抓取过程和错误信息可在页面的更新状态中查看，原始结果位于运行时生成的 `data_snapshots/`（该目录默认被 Git 忽略）。

## 渠道配置

### 在网页中添加

进入"渠道管理"，选择 RelayWatch 抓取，填写站点地址、名称、API Base、计价单位、汇率和连接方式，点击"尝试访问"。访问成功后配置会写入 `relaywatch_sites.json`，随后手动更新数据即可出现在价格对比表中。

### 手工编辑

- `relaywatch_sites.json`：站点 URL、显示名、API Base、连接方式和数据来源。
- `channel_rates.csv`：`supplier`、`exchange_rate`（人民币/计价单位）、`billing_unit`、`pricing_mode`、`price_scale`。
- `model_mapping.csv`：中转站原始模型名到统一模型名、模型系列和厂商的人工映射。

修改配置后重新执行数据更新；不建议直接编辑 `public/data/`，因为它是由 Excel 自动生成的缓存。

## 常用命令

```powershell
powershell -ExecutionPolicy Bypass -File "setup.ps1"   # 部署向导
.\start.bat                                              # 一键启动
.\stop.bat                                               # 一键停止
npm run dev          # Vite 开发服务器，端口见 config.json
npm run start        # 数据 API，端口见 config.json
npm run build        # 前端生产构建，输出 dist/
node --check server.mjs
python -m py_compile fetch_data_sources.py gen_two_tables.py scripts\prepare_data.py scripts\channel_probe.py relaywatch\refresh_sites.py relaywatch\normalize_data.py
```

## 环境变量参考

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MODEL_DASHBOARD_API_PORT` | API 端口 | 4180 |
| `VITE_PORT` | 前端端口 | 4173 |
| `BANANA_HTTP_PROXY` | HTTP 代理 | `http://127.0.0.1:10090` |
| `MODEL_DASHBOARD_PYTHON` | Python 路径 | `python` |
| `RELAYWATCH_PYTHON` | RelayWatch Python 路径 | 同上 |

## 故障排查

### 页面打不开

确认 `start.bat` 启动了两个窗口（API + Vite）。若端口被占用，运行 `setup.ps1` 重新选择端口，或手动编辑 `config.json`。

### 显示"读取失败"或更新卡住

1. 先在浏览器直接打开站点，确认地址和 API Base 正确。
2. 国内站点使用 `direct`，需要代理的站点使用 `proxy`，不确定时使用 `auto`。
3. 运行 `setup.ps1` 重新选择代理端口，或手动编辑 `config.json` 修改 `proxyUrl`。
4. 检查 API 启动窗口的错误信息；详细原始响应在 `data_snapshots/` 中。

### Python 找不到或缺少模块

```powershell
.\.venv\Scripts\python.exe -m pip install -r relaywatch\requirements.txt
```

### 更新后没有新价格

检查 `relaywatch_sites.json` 中的供应商名称是否与模型映射一致，检查 `channel_rates.csv` 的供应商名称、计价单位和汇率，再重新更新。没有有效价格的模型渠道不会显示为空白行。

## 上传到 GitHub

发布目录已经是一个干净的 Git 仓库，当前分支为 `main`，远端地址为 `https://github.com/shuof794-spec/model-channel-dashboard.git`。如果仓库尚未创建，请先在 GitHub 新建同名的空仓库（建议设为 Private，不要自动生成 README），然后在 PowerShell 中执行：

```powershell
cd "model-channel-dashboard"
git push -u origin main
```

Git 提示认证时，用户名填写 GitHub 用户名，密码位置填写具有仓库写权限的 Personal Access Token。也可以先把 PAT 保存为用户环境变量，再重启终端：

```powershell
[Environment]::SetEnvironmentVariable("GITHUB_PAT_TOKEN", "你的GitHub_PAT", "User")
```

PAT 至少需要对目标仓库有 Contents: Read and write 权限。不要把 Token 写入远端 URL、脚本、`.env` 或 README。

## GitHub 安全说明

仓库只应包含源码、配置模板和当前公开展示数据。`node_modules/`、Python 虚拟环境、`config.json`（本地配置）、浏览器 profile、历史抓取快照和本地密钥已在 `.gitignore` 中排除。上传前请检查：

```powershell
Get-ChildItem -Recurse -File | Select-String -Pattern 'sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}'
```

发现真实密钥时先删除并立即轮换密钥，再提交代码。
