import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// The release folder is self-contained: scripts, configs and relaywatch all
// live next to this file. Keep paths relative so the project can be cloned
// and started from any directory.
const workspaceRoot = appRoot;
const publicRoot = path.join(appRoot, "public");
const dataRoot = path.join(publicRoot, "data");
const dataFile = path.join(dataRoot, "index.json");
const statusFile = path.join(publicRoot, "data", "status.json");
const downloadFile = path.join(publicRoot, "downloads", "AI_API_models_审查版.xlsx");
const relaywatchConfigFile = path.join(workspaceRoot, "relaywatch_sites.json");
const python = process.env.MODEL_DASHBOARD_PYTHON || process.env.PYTHON || "python";
const relayPython = process.env.RELAYWATCH_PYTHON || python;
const proxy = process.env.BANANA_HTTP_PROXY || "http://127.0.0.1:10090";
const port = Number(process.env.MODEL_DASHBOARD_API_PORT || 4180);
const connectionModes = new Set(["auto", "direct", "proxy"]);

let updateRunning = false;

const defaultRelaywatchSites = [
  { url: "https://api.bianxieai.com", name: "Bianxieai", pricingUrl: "https://api.bianxieai.com", apiBase: "https://api.bianxieai.com/v1", source: "relaywatch爬取", exchangeRate: 7.3, billingUnit: "USD", pricingMode: "auto", priceScale: 1, category: "transit" },
  { url: "https://apipool.net", name: "Apipool", pricingUrl: "https://apipool.net", apiBase: "https://api.apipool.net/v1", source: "relaywatch爬取", exchangeRate: 7.3, billingUnit: "USD", pricingMode: "auto", priceScale: 1, category: "transit" },
];

async function writeStatus(status) {
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, JSON.stringify(status, null, 2), "utf8");
}

async function loadRelaywatchSites() {
  try {
    const payload = JSON.parse(await fs.readFile(relaywatchConfigFile, "utf8"));
    if (Array.isArray(payload)) return payload;
  } catch {
    // Fall back to the built-in sites when the config has not been created yet.
  }
  return defaultRelaywatchSites;
}

async function saveRelaywatchSites(sites) {
  await fs.writeFile(relaywatchConfigFile, JSON.stringify(sites, null, 2), "utf8");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) reject(new Error("请求内容过大"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("请求数据不是有效 JSON")); }
    });
    req.on("error", reject);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || workspaceRoot,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    if (options.input !== undefined) {
      child.stdin.write(String(options.input));
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function normalizeConnectionMode(value, fallback = "proxy") {
  const mode = String(value || "").trim().toLowerCase();
  return connectionModes.has(mode) ? mode : fallback;
}

function environmentForConnection(mode) {
  const env = { ...process.env };
  const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
  proxyKeys.forEach((key) => { delete env[key]; });
  if (mode === "proxy") {
    env.HTTP_PROXY = proxy;
    env.HTTPS_PROXY = proxy;
    env.http_proxy = proxy;
    env.https_proxy = proxy;
    env.NO_PROXY = "localhost,127.0.0.1,::1";
    env.no_proxy = env.NO_PROXY;
  } else {
    env.NO_PROXY = "*";
    env.no_proxy = "*";
  }
  return env;
}

async function runRelaywatchRefresh(sites, rawFile, mode) {
  const origins = sites.map((site) => site?.url).filter(Boolean);
  if (!origins.length) return;
  const args = ["refresh_sites.py"];
  origins.forEach((origin) => args.push("--origin", origin));
  args.push("--raw", rawFile, "--concurrency", "8", "--limit-per-host", "2");
  await run(relayPython, args, { cwd: path.join(workspaceRoot, "relaywatch"), env: environmentForConnection(mode) });
}

async function readRelayRows(rawFile) {
  try {
    const payload = JSON.parse(await fs.readFile(rawFile, "utf8"));
    return Array.isArray(payload) ? payload : (Array.isArray(payload?.rows) ? payload.rows : []);
  } catch {
    return [];
  }
}

async function findLatestSnapshot(prefix) {
  const snapshotRoot = path.join(workspaceRoot, "data_snapshots");
  try {
    const entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of candidates) {
      const candidate = path.join(snapshotRoot, name);
      const stat = await fs.stat(candidate);
      if (stat.size > 1000) return candidate;
    }
  } catch {
    // A missing snapshot directory is handled by the caller.
  }
  return null;
}

function dateStamp() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("");
}

async function updateAll() {
  if (updateRunning) return { ok: false, message: "更新已在进行中" };
  updateRunning = true;
  const startedAt = new Date().toISOString();
  await writeStatus({ state: "running", startedAt, message: "正在抓取最新 models 数据" });
  const stamp = dateStamp();
  let snapshot = path.join(workspaceRoot, "data_snapshots", `models_providers_${stamp}.json`);
  const relayRaw = path.join(workspaceRoot, "data_snapshots", `relaywatch_raw_${stamp}.json`);
  const relayNormalized = path.join(workspaceRoot, "data_snapshots", `relaywatch_normalized_${stamp}_full`);
  const relaySites = await loadRelaywatchSites();
  const outputWorkbook = downloadFile;
  const env = environmentForConnection("proxy");
  let sourceNotice = "";
  try {
    try {
      await run(python, ["fetch_data_sources.py", "--date", stamp, "--models-url", "https://models.dev/api.json"], { env });
    } catch (error) {
      const fallbackSnapshot = await findLatestSnapshot("models_providers_");
      if (!fallbackSnapshot) throw error;
      snapshot = fallbackSnapshot;
      sourceNotice = `上游数据暂不可用，沿用最近一次 models 快照（${path.basename(fallbackSnapshot)}）`;
    }
    const groupedSites = new Map([["direct", []], ["proxy", []], ["auto", []]]);
    relaySites.forEach((site) => {
      if (site?.url) groupedSites.get(normalizeConnectionMode(site.connectionMode, "proxy")).push(site);
    });
    await runRelaywatchRefresh(groupedSites.get("direct"), relayRaw, "direct");
    await runRelaywatchRefresh(groupedSites.get("proxy"), relayRaw, "proxy");
    const autoSites = groupedSites.get("auto");
    if (autoSites.length) {
      await runRelaywatchRefresh(autoSites, relayRaw, "direct");
      const rows = await readRelayRows(relayRaw);
      const failedOrigins = new Set(rows.filter((row) => !row.any_ok).map((row) => row.requested_origin || row.origin));
      await runRelaywatchRefresh(autoSites.filter((site) => failedOrigins.has(site.url)), relayRaw, "proxy");
    }
    await run(relayPython, [
      "normalize_data.py",
      "--input", relayRaw,
      "--out-dir", relayNormalized,
      "--full-models",
    ], { cwd: path.join(workspaceRoot, "relaywatch"), env: process.env });
    await run(python, [
      "gen_two_tables.py",
      "--litellm", await findLatestSnapshot("LiteLLM_model_prices_and_context_window_") || path.join(workspaceRoot, "LiteLLM_model_prices_and_context_window_20260813.json"),
      "--models", snapshot,
      "--mapping", "model_mapping.csv",
      "--channel-rates", "channel_rates.csv",
      "--relaywatch-dir", relayNormalized,
      "--relaywatch-raw", relayRaw,
      "--relaywatch-config", relaywatchConfigFile,
      "--out", outputWorkbook,
    ], { cwd: workspaceRoot, env: process.env });
    await run(python, [path.join(appRoot, "scripts", "prepare_data.py"), "--workbook", outputWorkbook], { cwd: workspaceRoot, env: process.env });
    const finishedAt = new Date().toISOString();
    const message = sourceNotice ? `数据已更新；${sourceNotice}` : "数据已更新";
    await writeStatus({ state: "success", startedAt, finishedAt, message, source: snapshot });
    return { ok: true, finishedAt, message };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await writeStatus({ state: "error", startedAt, finishedAt, message: String(error.message || error) });
    return { ok: false, message: String(error.message || error) };
  } finally {
    updateRunning = false;
  }
}

async function probeAndAddRelaywatchSite(input) {
  if (updateRunning) return { ok: false, message: "当前正在更新数据，请稍后再试" };
  const rawUrl = String(input?.url || input?.pricingUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("仅支持 HTTP/HTTPS 网址");
  } catch (error) {
    return { ok: false, message: error.message || "网址格式不正确" };
  }
  const origin = parsed.href.replace(/\/+$/, "");
  const requestedMode = normalizeConnectionMode(input?.connectionMode, "proxy");
  const probeOrigins = [origin];
  const hostname = parsed.hostname;
  if (!hostname.startsWith("api.")) {
    const apiUrl = new URL(origin);
    apiUrl.hostname = `api.${hostname}`;
    const apiOrigin = apiUrl.href.replace(/\/+$/, "");
    if (!probeOrigins.includes(apiOrigin)) probeOrigins.push(apiOrigin);
  }
  const probeFile = path.join(workspaceRoot, "data_snapshots", `relaywatch_probe_${Date.now()}.json`);
  try {
    const modesToTry = requestedMode === "auto" ? ["direct", "proxy"] : [requestedMode];
    let rows = [];
    let row;
    let connectionModeUsed = requestedMode;
    for (const mode of modesToTry) {
      const probeArgs = ["refresh_sites.py"];
      probeOrigins.forEach((candidate) => probeArgs.push("--origin", candidate));
      probeArgs.push("--raw", probeFile, "--status-only", "--concurrency", "2", "--limit-per-host", "1");
      await run(relayPython, probeArgs, { cwd: path.join(workspaceRoot, "relaywatch"), env: environmentForConnection(mode) });
      rows = await readRelayRows(probeFile);
      row = rows.find((item) => item.any_ok) || rows.find((item) => item.requested_origin === origin || item.origin === origin) || rows[0];
      if (row?.any_ok) {
        connectionModeUsed = mode;
        break;
      }
    }
    if (!row?.any_ok) {
      const status = row?.endpoints?.status?.status;
      const endpointError = Object.values(row?.endpoints || {}).map((endpoint) => endpoint?.error).find(Boolean);
      const modeFailure = requestedMode === "direct" ? "直连失败" : requestedMode === "proxy" ? "代理访问失败" : "直连和代理均失败";
      return { ok: false, message: status ? `${modeFailure}：状态接口返回 HTTP ${status}` : endpointError ? `${modeFailure}：${endpointError}` : `${modeFailure}：RelayWatch 未获取到可用接口` };
    }
    const detectedOrigin = String(row.origin || origin).replace(/\/+$/, "");
    const sites = await loadRelaywatchSites();
    const existingIndex = sites.findIndex((site) => [site.url, site.pricingUrl].filter(Boolean).map((value) => String(value).replace(/\/+$/, "")).some((value) => value === origin || value === detectedOrigin));
    const previous = existingIndex >= 0 ? sites[existingIndex] : {};
    const exchangeRate = Number(input?.exchangeRate);
    const requestedPriceScale = Number(input?.priceScale);
    const pricingModes = new Set(["auto", "billing_expr", "model_ratio"]);
    const pricingMode = pricingModes.has(String(input?.pricingMode || "").trim().toLowerCase())
      ? String(input.pricingMode).trim().toLowerCase()
      : (previous.pricingMode || "auto");
    const site = {
      ...previous,
      url: detectedOrigin,
      name: String(input?.name || previous.name || new URL(origin).hostname.split(".")[0]),
      pricingUrl: String(input?.pricingUrl || previous.pricingUrl || origin),
      apiBase: String(input?.apiBase || previous.apiBase || `${detectedOrigin}/v1`),
      source: "relaywatch爬取",
      connectionMode: requestedMode,
      lastConnectionMode: connectionModeUsed,
      exchangeRate: Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : (previous.exchangeRate || 6.74),
      billingUnit: String(input?.billingUnit || previous.billingUnit || "USD"),
      pricingMode,
      priceScale: Number.isFinite(requestedPriceScale) && requestedPriceScale > 0 ? requestedPriceScale : (previous.priceScale || 1),
      category: String(input?.category || previous.category || "transit"),
    };
    if (existingIndex >= 0) sites[existingIndex] = site;
    else sites.push(site);
    await saveRelaywatchSites(sites);
    const modeLabel = connectionModeUsed === "direct" ? "直连" : "代理";
    return { ok: true, message: `${existingIndex >= 0 ? "访问成功，已更新 RelayWatch 渠道" : "访问成功，已添加到 RelayWatch 抓取列表"}（使用${modeLabel}）`, connectionModeUsed, site };
  } catch (error) {
    return { ok: false, message: `RelayWatch 访问失败：${String(error.message || error).split("\n")[0]}` };
  } finally {
    await fs.rm(probeFile, { force: true }).catch(() => {});
  }
}

async function runChannelCheck(input) {
  const apiKey = String(input?.apiKey || "").trim();
  const model = String(input?.model || "").trim();
  const prompt = String(input?.prompt || "请用一句话回答：1+1等于几？").trim();
  const rawBase = String(input?.apiBase || "").trim().replace(/\/+$/, "");
  if (!apiKey) return { ok: false, message: "请填写 API Key" };
  if (!model) return { ok: false, message: "请选择测试模型" };
  if (!rawBase) return { ok: false, message: "请填写 API Base" };
  try {
    const result = await run(relayPython, [path.join(appRoot, "scripts", "channel_probe.py")], {
      cwd: workspaceRoot,
      env: environmentForConnection("direct"),
      input: JSON.stringify({
        apiKey,
        model,
        prompt,
        apiBase: rawBase,
        connectionMode: normalizeConnectionMode(input?.connectionMode, "auto"),
        proxy,
        maxTokens: 32,
      }),
    });
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    const payload = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    if (!payload || typeof payload !== "object") throw new Error("检测程序没有返回有效结果");
    return payload;
  } catch (error) {
    return { ok: false, message: `检测程序失败：${String(error.message || error).split("\n")[0]}` };
  }
}

function average(values) {
  return values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100 : null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const meanValue = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.round(Math.sqrt(values.reduce((total, value) => total + ((value - meanValue) ** 2), 0) / values.length) * 100) / 100;
}

async function runChannelCheckBatch(input) {
  const requestedRuns = Number(input?.runs);
  const requestedConcurrency = Number(input?.concurrency);
  const totalRuns = Math.min(20, Math.max(1, Number.isFinite(requestedRuns) ? Math.floor(requestedRuns) : 1));
  const concurrency = Math.min(totalRuns, Math.max(1, Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : 1));
  const results = [];
  for (let offset = 0; offset < totalRuns; offset += concurrency) {
    const size = Math.min(concurrency, totalRuns - offset);
    const chunk = await Promise.all(Array.from({ length: size }, (_, index) => runChannelCheck({ ...input, runs: 1, concurrency: 1, batchIndex: offset + index + 1 })));
    results.push(...chunk.map((item, index) => ({ ...item, runIndex: offset + index + 1 })));
  }
  const successful = results.filter((item) => item?.ok && item.metrics);
  const metricValues = (key) => successful.map((item) => Number(item.metrics[key])).filter((value) => Number.isFinite(value));
  const ttft = metricValues("ttftMs");
  const ttfb = metricValues("ttfbMs");
  const total = metricValues("totalMs");
  const throughput = metricValues("throughput");
  const itl = metricValues("itlMs");
  const peakThroughput = metricValues("peakThroughput");
  const peakTps = metricValues("peakTps");
  const successfulCurves = successful
    .map((item) => Array.isArray(item.metrics?.tpsCurve) ? item.metrics.tpsCurve : [])
    .filter((curve) => curve.length);
  const maxCurveLength = successfulCurves.length ? Math.max(...successfulCurves.map((curve) => curve.length)) : 0;
  const avgTpsCurve = Array.from({ length: maxCurveLength }, (_, index) => average(successfulCurves.map((curve) => Number(curve[index] || 0))));
  const successRate = Math.round((successful.length / totalRuns) * 10000) / 100;
  const summary = {
    totalRuns,
    concurrency,
    successCount: successful.length,
    failureCount: totalRuns - successful.length,
    successRate,
    errorRate: Math.round((100 - successRate) * 100) / 100,
    avgTtftMs: average(ttft),
    p50TtftMs: percentile(ttft, 0.5),
    p95TtftMs: percentile(ttft, 0.95),
    p99TtftMs: percentile(ttft, 0.99),
    stdDevTtftMs: standardDeviation(ttft),
    avgTtfbMs: average(ttfb),
    p50TtfbMs: percentile(ttfb, 0.5),
    p95TtfbMs: percentile(ttfb, 0.95),
    p99TtfbMs: percentile(ttfb, 0.99),
    avgTotalMs: average(total),
    p50TotalMs: percentile(total, 0.5),
    p95TotalMs: percentile(total, 0.95),
    p99TotalMs: percentile(total, 0.99),
    stdDevTotalMs: standardDeviation(total),
    minTotalMs: total.length ? Math.min(...total) : null,
    maxTotalMs: total.length ? Math.max(...total) : null,
    avgThroughput: average(throughput),
    p50Throughput: percentile(throughput, 0.5),
    p95Throughput: percentile(throughput, 0.95),
    p99Throughput: percentile(throughput, 0.99),
    avgItlMs: average(itl),
    p95ItlMs: percentile(itl, 0.95),
    avgPeakThroughput: average(peakThroughput),
    avgPeakTps: average(peakTps),
    avgTpsCurve,
  };
  const firstMetrics = successful[0]?.metrics || results.find((item) => item?.metrics)?.metrics || {};
  const metrics = {
    ...firstMetrics,
    ok: successful.length === totalRuns,
    ttftMs: summary.avgTtftMs,
    ttfbMs: summary.avgTtfbMs,
    totalMs: summary.avgTotalMs,
    throughput: summary.avgThroughput,
    peakThroughput: summary.avgPeakThroughput,
    peakTps: summary.avgPeakTps,
    tpsCurve: summary.avgTpsCurve,
    itlMs: summary.avgItlMs,
    streamStability: `${summary.successCount}/${summary.totalRuns} 成功`,
    successRate: summary.successRate,
    errorRate: summary.errorRate,
    concurrency: `${summary.concurrency} 并发`,
  };
  return {
    ok: metrics.ok,
    message: `批量检测完成：${summary.successCount}/${summary.totalRuns} 次成功，平均 TTFT ${summary.avgTtftMs ?? "—"} ms，P95 TTFT ${summary.p95TtftMs ?? "—"} ms`,
    metrics,
    summary,
    results,
  };
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  res.end(text);
}

async function serve(res, filePath, contentType) {
  try {
    const buffer = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(buffer);
  } catch {
    json(res, 404, { error: "文件不存在" });
  }
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function resolveDataPath(urlPath) {
  try {
    const relativePath = decodeURIComponent(urlPath.slice("/data/".length));
    const resolved = path.resolve(dataRoot, relativePath);
    const rootPrefix = `${dataRoot}${path.sep}`;
    return resolved.startsWith(rootPrefix) ? resolved : null;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }
  if (url.pathname === "/api/data" && req.method === "GET") return serve(res, dataFile, "application/json; charset=utf-8");
  if (url.pathname === "/api/status" && req.method === "GET") return serve(res, statusFile, "application/json; charset=utf-8");
  if (url.pathname === "/api/update" && req.method === "POST") return json(res, 200, await updateAll());
  if (url.pathname === "/api/relaywatch/add" && req.method === "POST") {
    try { return json(res, 200, await probeAndAddRelaywatchSite(await readJsonBody(req))); }
    catch (error) { return json(res, 400, { ok: false, message: error.message || "请求失败" }); }
  }
  if (url.pathname === "/api/channel-check" && req.method === "POST") {
    try { return json(res, 200, await runChannelCheck(await readJsonBody(req))); }
    catch (error) { return json(res, 400, { ok: false, message: error.message || "检测请求失败" }); }
  }
  if (url.pathname === "/api/channel-check/batch" && req.method === "POST") {
    try { return json(res, 200, await runChannelCheckBatch(await readJsonBody(req))); }
    catch (error) { return json(res, 400, { ok: false, message: error.message || "批量检测请求失败" }); }
  }
  if (url.pathname === "/downloads/workbook.xlsx" && req.method === "GET") return serve(res, downloadFile, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  if (url.pathname.startsWith("/data/") && req.method === "GET") {
    const filePath = resolveDataPath(url.pathname);
    if (!filePath) return json(res, 400, { error: "非法数据路径" });
    return serve(res, filePath, contentTypeFor(filePath));
  }
  json(res, 404, { error: "Not found" });
});

async function recoverInterruptedUpdate() {
  try {
    const previous = JSON.parse(await fs.readFile(statusFile, "utf8"));
    if (previous?.state !== "running") return;
    await writeStatus({
      ...previous,
      state: "success",
      recoveredAt: new Date().toISOString(),
      message: "服务已恢复，沿用最近一次数据快照",
    });
  } catch {
    // A missing or malformed status file should not prevent the API from starting.
  }
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Model Dashboard API listening on http://127.0.0.1:${port}`);
  recoverInterruptedUpdate().catch(() => {});
});

setInterval(() => { updateAll().catch(() => {}); }, 3 * 60 * 60 * 1000);
