import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const TYPE_LABELS = ["输入", "输出", "缓存读", "缓存写"];
const DEFAULT_PAGE_SIZE = 24;
const LONG_OUTPUT_PROMPT = "请连续生成一段不少于 500 个汉字的科幻短篇小说。不要列提纲、不要解释写作过程、不要提前总结；请直接输出完整正文，并尽量持续生成到请求允许的最大长度。";
const MAX_DETECTION_RUNS = 300;
const MAX_DETECTION_CONCURRENCY = 100;
const API_KEY_STORAGE_KEY = "model-dashboard-channel-api-keys";
const ACTIVE_JOB_STORAGE_KEY = "model-dashboard-active-channel-job";

const safeStorage = {
  get(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Local storage is optional for this local-only tool.
    }
  },
};

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatDate(value) {
  if (!value) return "尚未更新";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatSourceDate(value) {
  if (!value) return "尚未提供";
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{4}-\d{2}$/.test(text) ? text : formatDate(value);
}

function dataConnectionLog(status, data) {
  const updatedAt = data?.meta?.updatedAt;
  const lines = [
    `状态：${status?.state === "running" ? "正在更新" : status?.state === "error" ? "更新异常，沿用快照" : "已连接"}`,
    `数据抓取时间：${formatDate(status?.finishedAt || status?.recoveredAt || updatedAt)}`,
    `数据版本时间：${formatDate(updatedAt)}`,
    `数据来源文件：${status?.source || "本地 public/data 快照"}`,
    `主数据文件：/data/dashboard.json`,
    `索引文件：/data/index.json`,
    `索引接口：/api/data`,
    `状态接口：/api/status`,
    `对比分片：/data/comparison/`,
    `最低价分片：/data/best/`,
    `Excel 导出：/downloads/workbook.xlsx`,
  ];
  if (status?.progress?.label) lines.push(`更新进度：${status.progress.value ?? "-"}% · ${status.progress.label}${status.progress.detail ? ` · ${status.progress.detail}` : ""}`);
  if (status?.message) lines.push(`最近日志：${status.message}`);
  return lines.join("\n");
}

function DataConnectionStatus({ status, data }) {
  const stateLabel = status.state === "running" ? "正在更新" : status.state === "error" ? "更新异常" : "本地数据已连接";
  return (
    <div className={`connection-state ${status.state}`} tabIndex="0" aria-label={dataConnectionLog(status, data)}>
      <span className="status-dot"></span>
      <div><strong>{stateLabel}</strong><small>{status.state === "error" ? "保留上次快照" : formatDate(data?.meta?.updatedAt)}</small></div>
      <div className="connection-tooltip" role="tooltip"><strong>本地数据日志</strong><pre>{dataConnectionLog(status, data)}</pre></div>
    </div>
  );
}

function UpdateProgress({ status, isRefreshing }) {
  const showFailure = status?.state === "error" && status?.progress?.label === "更新失败";
  if (!isRefreshing && status?.state !== "running" && !showFailure) return null;
  const rawValue = Number(status?.progress?.value);
  const value = Number.isFinite(rawValue) ? Math.max(2, Math.min(99, rawValue)) : 3;
  const label = status?.progress?.label || status?.message || "正在连接更新服务";
  const detail = status?.progress?.detail || "等待后端返回更新阶段";
  return (
    <div className={`update-progress ${showFailure ? "is-error" : ""}`} role="status" aria-live="polite">
      <div className="update-progress-head"><strong>{label}</strong><span>{Math.round(value)}%</span></div>
      <div className="update-progress-track"><span style={{ width: `${value}%` }}></span></div>
      <small>{detail}</small>
    </div>
  );
}

function priceTone(value, min, max) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return undefined;
  const span = max - min;
  const ratio = span <= 0 ? 0.35 : Math.max(0, Math.min(1, (Number(value) - min) / span));
  const start = [197, 234, 211];
  const end = [244, 194, 188];
  const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * ratio));
  return `rgb(${rgb.join(",")})`;
}

function categoryLabel(category) {
  if (category === "official") return "官方";
  if (category === "transit") return "中转站";
  return "待确认";
}

function categoryClass(category) {
  if (category === "official") return "tag-official";
  if (category === "transit") return "tag-transit";
  return "tag-unknown";
}

function connectionModeLabel(mode, ingestMode = "relaywatch") {
  if (ingestMode !== "relaywatch") return "不适用";
  if (mode === "direct") return "直连";
  if (mode === "proxy") return "代理";
  return mode === "auto" ? "自动" : "代理";
}

function Button({ children, icon: Icon, className = "", variant = "secondary", title, onClick, disabled, type = "button" }) {
  return (
    <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {Icon ? <Icon size={16} strokeWidth={1.8} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

function MultiSelect({ label, options, selected, onChange, searchPlaceholder = "搜索选项", menuKey, activeMenu, onActiveMenuChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isControlled = menuKey !== undefined && activeMenu !== undefined && onActiveMenuChange;
  const open = isControlled ? activeMenu === menuKey : internalOpen;
  const setOpen = (nextOpen) => {
    if (isControlled) onActiveMenuChange(nextOpen ? menuKey : null);
    else setInternalOpen(nextOpen);
  };
  const filtered = options.filter((option) => option.toLowerCase().includes(query.toLowerCase()));
  const toggle = (option) => {
    onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  };
  const labelText = selected.length ? (selected.length === 1 ? selected[0] : `${selected.length} 项已选`) : label;
  return (
    <div className={`multi-select ${open ? "is-open" : ""}`}>
      <button className={`select-trigger ${selected.length ? "is-active" : ""}`} onClick={() => setOpen((value) => !value)}>
        <span>{labelText}</span><ChevronDown size={15} />
      </button>
      {open ? (
        <div className="select-menu">
          <div className="select-search"><Search size={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} /></div>
          <div className="select-actions"><button onClick={() => onChange(options)}>全选</button><button onClick={() => onChange([])}>清空</button></div>
          <div className="select-options">
            {filtered.length ? filtered.map((option) => (
              <label key={option} className="check-option"><input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>
            )) : <div className="select-empty">没有匹配项</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ icon: Icon, label, value, detail, accent }) {
  return (
    <div className="stat-block">
      <div className={`stat-icon ${accent}`}><Icon size={17} /></div>
      <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
      {detail ? <div className="stat-detail">{detail}</div> : null}
    </div>
  );
}

function TagBadge({ category }) {
  return <span className={`tag-badge ${categoryClass(category)}`}>{categoryLabel(category)}</span>;
}

function EmptyState({ title = "没有符合条件的数据", description = "调整筛选条件后再试" }) {
  return <div className="empty-state"><CircleHelp size={22} /><strong>{title}</strong><span>{description}</span></div>;
}

function DetailPopover({ detail, position, onDetectChannel }) {
  if (!detail) return null;
  const priceLabels = ["输入", "输出", "缓存读", "缓存写"];
  const usdPrices = Array.isArray(detail.usdPrices) ? detail.usdPrices : [];
  const cnyPrices = Array.isArray(detail.cnyPrices) ? detail.cnyPrices : [];
  const fields = [
    ["渠道", detail.supplier],
    ["生产商", detail.vendor],
    ["模型系列", detail.modelSeries],
    ["原始模型名", detail.originalModelName],
    ["模式", detail.mode],
    ["输入形式", detail.inputModalities],
    ["计价单位", detail.billingUnit || "USD"],
    ["渠道汇率", detail.exchangeRate != null ? `${formatNumber(detail.exchangeRate)} CNY / ${detail.billingUnit || "USD"}` : "6.74 CNY / USD"],
    ["价格解析", detail.pricingMode === "billing_expr" ? "动态计费表达式" : detail.pricingMode === "model_ratio" ? "模型倍率" : "自动识别"],
    ["额外价格倍率", detail.priceScale != null ? formatNumber(detail.priceScale) : "1"],
    ["价格刷新", formatSourceDate(detail.lastUpdated)],
    ["最大输入上下文", detail.maxInputContext ? formatNumber(detail.maxInputContext) : "尚未提供"],
    ["最大输出", detail.maxOutput ? formatNumber(detail.maxOutput) : "尚未提供"],
    ["数据来源", detail.dataSource],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  return (
    <div className="detail-popover" style={{ left: position.x, top: position.y }}>
      <div className="detail-popover-title"><strong>{detail.model}</strong><span>{detail.supplier}</span></div>
      <div className="detail-price-grid">
        {priceLabels.map((label, index) => <div key={label}><span>{label}</span><strong>{formatNumber(usdPrices[index])}</strong><small>{formatNumber(cnyPrices[index])} CNY</small></div>)}
      </div>
      <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {onDetectChannel ? <Button className="detail-check-button" variant="primary" icon={Gauge} onClick={(event) => { event.stopPropagation(); onDetectChannel(detail); }}>检测渠道</Button> : null}
      {detail.pricingUrl ? <a href={detail.pricingUrl} target="_blank" rel="noreferrer" className="detail-source-link">打开价格网址 <ExternalLink size={12} /></a> : null}
    </div>
  );
}

function ComparisonTable({ rows, suppliers, currency, loading, sortState, onSortModel, onDetectChannel }) {
  const [selected, setSelected] = useState(null);
  const frameRef = useRef(null);
  const grouped = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.model)) map.set(row.model, []);
      map.get(row.model).push(row);
    });
    return [...map.entries()];
  }, [rows]);
  const priceRange = useMemo(() => {
    const values = rows.flatMap((row) => suppliers.map((supplier) => row.prices[supplier]?.[currency])).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
    return { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 };
  }, [rows, suppliers, currency]);
  useEffect(() => {
    const closeWhenOutside = (event) => {
      if (!frameRef.current?.contains(event.target)) setSelected(null);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, []);
  const showDetail = (event, detail) => {
    if (!detail) {
      setSelected(null);
      return;
    }
    const width = 326;
    const height = 360;
    const rect = event.currentTarget.getBoundingClientRect();
    setSelected({ detail, position: { x: Math.max(12, Math.min(rect.left + 12, window.innerWidth - width - 12)), y: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - height - 12)) } });
  };
  if (loading && !rows.length) return <div className="table-frame"><EmptyState title="正在加载当前页" description="只读取当前页面的本地数据分片，减少浏览器卡顿" /></div>;
  if (!rows.length) return <EmptyState />;
  return (
    <div ref={frameRef} className="table-frame" onClick={(event) => {
      const target = event.target;
      if (!(target instanceof Element) || (!target.closest(".detail-trigger") && !target.closest(".detail-popover"))) setSelected(null);
    }}>
      <div className="table-scroll">
        <table className="comparison-table">
          <thead><tr><th className="sticky-col model-col"><span className="model-header-label">模型名</span>{sortState.model ? <small className="active-model-sort">「{sortState.model}」按{sortState.type}价排序</small> : null}</th><th className="sticky-col vendor-col">生产商</th><th className="sticky-col type-col">价格类型 / 排序</th>{suppliers.map((supplier) => <th key={supplier}>{supplier}</th>)}</tr></thead>
          <tbody>
            {grouped.map(([model, modelRows]) => modelRows.map((row, index) => (
              <tr key={`${model}-${row.type}`}>
                {index === 0 ? <td className="sticky-col model-cell detail-trigger" rowSpan={modelRows.length} onClick={(event) => { event.stopPropagation(); showDetail(event, Object.values(row.prices)[0]?.details); }}><span className="model-cell-content"><span>{model}</span></span></td> : null}
                {index === 0 ? <td className="sticky-col vendor-cell detail-trigger" rowSpan={modelRows.length} onClick={(event) => { event.stopPropagation(); showDetail(event, Object.values(row.prices)[0]?.details); }}>{row.vendor}</td> : null}
                <td className="sticky-col type-cell"><span>{row.type}</span><button className={`type-sort ${sortState.model === model && sortState.type === row.type ? "is-sorted" : ""}`} onClick={(event) => { event.stopPropagation(); onSortModel(model, row.type); }} title={`按${model}的${row.type}价格排列渠道`} aria-label={`按${model}的${row.type}价格排列渠道`}><small>{sortState.model === model && sortState.type === row.type ? (sortState.direction === "asc" ? "小→大" : "大→小") : "排序"}</small></button></td>
                {suppliers.map((supplier) => {
                  const price = row.prices[supplier];
                  const value = price ? price[currency] : null;
                  return <td key={supplier} className={`${value !== null && value !== undefined ? "has-price" : "empty-price"} ${price?.details ? "detail-trigger" : ""}`} style={value !== null && value !== undefined ? { backgroundColor: priceTone(value, priceRange.min, priceRange.max) } : undefined} onClick={(event) => { event.stopPropagation(); showDetail(event, price?.details); }}>{value !== null && value !== undefined ? formatNumber(value) : ""}</td>;
                })}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {selected ? <DetailPopover detail={selected.detail} position={selected.position} onDetectChannel={onDetectChannel} /> : null}
    </div>
  );
}

function BestChannelRail({ modelIndex, modelSeries, loadedPages, loadPage }) {
  const railRef = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [selectedType, setSelectedType] = useState("全部系列");
  const [page, setPage] = useState(0);
  const filteredModels = useMemo(() => modelIndex.filter((item) => {
    const matchesQuery = item.model.toLowerCase().includes(query.toLowerCase());
    const matchesModel = !selectedModels.length || selectedModels.includes(item.model);
    const matchesType = selectedType === "全部系列" || (item.modelSeries || item.modelType) === selectedType;
    return matchesQuery && matchesModel && matchesType;
  }), [modelIndex, query, selectedModels, selectedType]);
  const pageCount = Math.max(1, Math.ceil(filteredModels.length / DEFAULT_PAGE_SIZE));
  useEffect(() => setPage(0), [query, selectedModels, selectedType]);
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);
  const visibleModels = useMemo(() => filteredModels.slice(page * DEFAULT_PAGE_SIZE, (page + 1) * DEFAULT_PAGE_SIZE), [filteredModels, page]);
  const neededPageIds = useMemo(() => [...new Set(visibleModels.map((item) => item.page))], [visibleModels]);
  useEffect(() => {
    neededPageIds.forEach((pageId) => loadPage("best", pageId));
  }, [neededPageIds, loadPage]);
  const cardsByModel = useMemo(() => {
    const map = new Map();
    Object.values(loadedPages).forEach((payload) => (payload?.cards || []).forEach((card) => map.set(card.model, card)));
    return map;
  }, [loadedPages]);
  const cards = visibleModels.map((item) => cardsByModel.get(item.model)).filter(Boolean);
  const loading = neededPageIds.some((pageId) => !loadedPages[pageId]);
  const scroll = (direction) => railRef.current?.scrollBy({ left: direction * 420, behavior: "smooth" });
  return (
    <section className="best-section">
      <div className="section-heading"><div><p className="eyebrow">Best route</p><h2>最低价渠道</h2><p className="section-subtitle">按输入价格排序，每张卡片对应一个模型</p></div><div className="rail-actions"><Button icon={ArrowLeft} title="向左滑动" onClick={() => scroll(-1)} /><Button icon={ArrowRight} title="向右滑动" onClick={() => scroll(1)} /></div></div>
      <div className="best-filters">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" /></div>
        <MultiSelect label="选择模型" options={modelIndex.map((item) => item.model)} selected={selectedModels} onChange={setSelectedModels} searchPlaceholder="搜索模型" />
        <select className="native-select" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}><option>全部系列</option>{modelSeries.map((series) => <option key={series}>{series}</option>)}</select>
        <span className="result-count">{filteredModels.length} 个模型</span>
        <div className="best-page-controls"><Button icon={ArrowLeft} title="上一页最低价模型" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} /><span>第 {page + 1} / {pageCount} 页</span><Button icon={ArrowRight} title="下一页最低价模型" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1} /></div>
      </div>
      <div className="best-rail" ref={railRef}>
        {cards.length ? cards.map((item) => (
          <article className="best-card" key={item.model}>
            <div className="best-card-top"><span className="model-kicker">{item.vendor}</span><TagBadge category={item.category} /></div>
            <h3>{item.model}</h3>
            <div className="best-provider"><Zap size={15} /><span>{item.supplier}</span><span className="muted">最低输入价</span></div>
            <div className="best-meta"><span>{item.inputModalities || "输入形式未提供"}</span><span>刷新 {formatSourceDate(item.lastUpdated)}</span></div>
            <div className="best-rate-note">原始计价：{item.details?.billingUnit || "USD"} · {formatNumber(item.details?.exchangeRate ?? 6.74)} CNY / 单位</div>
            <div className="price-grid">
              {TYPE_LABELS.map((type, index) => <div className="price-row" key={type}><span>{type}</span><strong>{formatNumber(item.prices.usd[index])}</strong><span className="unit">USD / 1M token</span></div>)}
            </div>
            <div className="best-card-foot"><span>CNY参考</span><span>{formatNumber(item.prices.cny[0])} / {formatNumber(item.prices.cny[1])}</span></div>
          </article>
        )) : <EmptyState title={loading ? "正在加载最低价" : "没有最低价结果"} description={loading ? "只读取当前本地数据分片" : "调整搜索或模型系列"} />}
      </div>
    </section>
  );
}

function ChannelEditor({ channel, onSave, onCancel }) {
  const [draft, setDraft] = useState(channel);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null);
  useEffect(() => setDraft(channel), [channel]);
  if (!channel) return null;
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    setSaving(true);
    setMessage("");
    setProgress({ value: 5, label: "正在准备渠道信息" });
    try {
      const result = await onSave({ ...draft, source: draft.ingestMode === "relaywatch" ? "relaywatch爬取" : (draft.source || "手动添加") }, setProgress);
      if (result?.ok === false) {
        setMessage(result.message || "保存失败");
        setProgress(null);
      }
    } catch (error) {
      setMessage(error.message || "保存失败");
      setProgress(null);
    } finally {
      setSaving(false);
    }
  };
  return (
    <aside className="editor-panel">
      <div className="editor-title"><div><p className="eyebrow">Channel record</p><h3>{channel.id === "new" ? "新增渠道" : "编辑渠道"}</h3></div><Button icon={X} title="关闭编辑" onClick={onCancel} /></div>
      <label>数据接入方式<select value={draft.ingestMode || "manual"} onChange={(event) => update("ingestMode", event.target.value)}><option value="relaywatch">RelayWatch 抓取</option><option value="manual">手动添加</option></select></label>
      <label>渠道名称<input value={draft.name || ""} onChange={(event) => update("name", event.target.value)} /></label>
      <label>生产商<input value={draft.vendor || ""} onChange={(event) => update("vendor", event.target.value)} /></label>
      <label>数据来源<input value={draft.source || ""} onChange={(event) => update("source", event.target.value)} /></label>
      <label>{draft.ingestMode === "relaywatch" ? "抓取网址" : "价格网址"}<input value={draft.pricingUrl || ""} onChange={(event) => update("pricingUrl", event.target.value)} placeholder="https://" /></label>
      <label>API base<input value={draft.apiBase || ""} onChange={(event) => update("apiBase", event.target.value)} /></label>
      {draft.ingestMode === "relaywatch" ? <label>连接方式<select value={draft.connectionMode || (channel.id === "new" ? "auto" : "proxy")} onChange={(event) => update("connectionMode", event.target.value)}><option value="auto">自动（先直连，失败后代理）</option><option value="direct">直连（不使用代理）</option><option value="proxy">代理（使用本地代理）</option></select></label> : null}
      <label>汇率（CNY/计价单位）<input type="number" min="0" step="0.0001" value={draft.exchangeRate ?? 6.74} onChange={(event) => update("exchangeRate", event.target.value === "" ? "" : Number(event.target.value))} /></label>
      <label>计价单位<select value={draft.billingUnit || "USD"} onChange={(event) => update("billingUnit", event.target.value)}><option value="USD">USD（美元）</option><option value="CNY">CNY（人民币）</option><option value="代币">代币</option><option value="其他">其他</option></select></label>
      <label>价格解析方式<select value={draft.pricingMode || "auto"} onChange={(event) => update("pricingMode", event.target.value)}><option value="auto">自动识别（推荐）</option><option value="billing_expr">动态计费表达式（ESEN/NewAPI）</option><option value="model_ratio">模型倍率（兼容普通中转站）</option></select></label>
      <label>额外价格倍率<input type="number" min="0.000001" step="0.0001" value={draft.priceScale ?? 1} onChange={(event) => update("priceScale", event.target.value === "" ? "" : Number(event.target.value))} /><small className="field-hint">1 表示不额外调整；仅在抓取倍率与实际页面价格存在固定比例差异时修改。</small></label>
      <label>渠道类型<select value={draft.category || "unknown"} onChange={(event) => update("category", event.target.value)}><option value="official">官方</option><option value="transit">中转站</option><option value="unknown">待确认</option></select></label>
      {draft.ingestMode === "relaywatch" ? <p className="editor-hint">自动模式会先直连，失败后再使用本地代理；动态计费表达式会优先使用网站返回的分档系数。只有 RelayWatch 访问成功才会保存。</p> : null}
      {saving && progress ? <div className="channel-progress" aria-live="polite"><div className="channel-progress-head"><span>{progress.label}</span><strong>{progress.value}%</strong></div><div className="channel-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.value}><span style={{ width: `${progress.value}%` }}></span></div><small>正在处理，请保持此页面打开</small></div> : null}
      {message ? <div className="editor-error">{message}</div> : null}
      <div className="editor-actions"><Button variant="primary" icon={Check} onClick={submit} disabled={saving}>{saving ? (draft.ingestMode === "relaywatch" ? "正在测试和更新" : "正在保存") : draft.ingestMode === "relaywatch" ? (channel.id === "new" ? "测试并添加" : "测试并保存") : "保存修改"}</Button><Button icon={X} onClick={onCancel} disabled={saving}>取消</Button></div>
    </aside>
  );
}

function PlaywrightImportPanel({ stagedImport, onStage, onClear }) {
  const inputRef = useRef(null);
  const [message, setMessage] = useState("");
  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const providers = Object.values(payload).filter((item) => item && item.models && typeof item.models === "object");
      const normalizedModels = Array.isArray(payload) ? payload : Array.isArray(payload?.models) ? payload.models : [];
      const relayRows = Array.isArray(payload?.rows) ? payload.rows : [];
      const modelCount = providers.reduce((total, provider) => total + Object.keys(provider.models).length, 0) || normalizedModels.length || relayRows.reduce((total, row) => total + (row.models?.length || row.model_count || 0), 0);
      const providerCount = providers.length || new Set(normalizedModels.flatMap((item) => (item.sites || []).map((site) => site.site_name || site.origin)).filter(Boolean)).size || relayRows.length;
      if (!modelCount) throw new Error("未识别到 RelayWatch/models 数据结构");
      const next = { fileName: file.name, importedAt: new Date().toISOString(), providerCount, modelCount };
      onStage(next);
      setMessage("已暂存，等待接入后台导入流程");
    } catch (error) {
      setMessage(error.message || "RelayWatch 文件无法解析");
    }
  };
  return (
    <section className="playwright-panel">
      <div className="playwright-copy"><div className="playwright-icon"><Upload size={17} /></div><div><p className="eyebrow">RelayWatch bridge</p><h2>RelayWatch 数据入口</h2><p>导入 RelayWatch 归一化或 providers JSON 快照，作为后台更新前的本地数据入口。</p></div></div>
      <div className="playwright-actions"><input ref={inputRef} type="file" accept=".json,application/json" onChange={handleFile} hidden /><Button icon={Upload} onClick={() => inputRef.current?.click()}>导入 JSON 快照</Button>{stagedImport ? <Button icon={Trash2} onClick={onClear} title="清除暂存记录">清除暂存</Button> : null}</div>
      {stagedImport ? <div className="playwright-status"><Check size={14} /><span>{stagedImport.fileName} · {stagedImport.providerCount} 个渠道 · {stagedImport.modelCount.toLocaleString()} 个模型 · {formatDate(stagedImport.importedAt)}</span></div> : null}
      {message ? <div className="playwright-message">{message}</div> : null}
    </section>
  );
}

function SuccessDialog({ dialog, onClose }) {
  if (!dialog) return null;
  const connectionLabel = dialog.connectionModeUsed === "direct" ? "直连" : dialog.connectionModeUsed === "proxy" ? "代理" : null;
  return (
    <div className="settings-success-backdrop" role="presentation" onClick={onClose}>
      <div className="settings-success-modal" role="dialog" aria-modal="true" aria-labelledby="channel-success-title" onClick={(event) => event.stopPropagation()}>
        <div className="settings-success-icon"><Check size={22} /></div>
        <p className="eyebrow">Channel record</p>
        <h2 id="channel-success-title">{dialog.title}</h2>
        <p className="settings-success-message">{dialog.message}</p>
        {connectionLabel ? <div className="settings-success-detail">抓取连接：<strong>{connectionLabel}</strong></div> : null}
        {dialog.refreshOk === true ? <div className="settings-success-status is-ok"><Check size={14} />价格数据已同步，价格对比表已刷新</div> : null}
        {dialog.refreshOk === false ? <div className="settings-success-status is-warning"><AlertTriangle size={14} />渠道已添加，但价格数据暂未同步，可稍后手动更新</div> : null}
        <div className="settings-success-actions"><Button variant="primary" icon={Check} onClick={onClose}>完成</Button></div>
      </div>
    </div>
  );
}

function OutputSpeedChart({ curve }) {
  const values = curve.map((value) => Number(value) || 0);
  if (!values.length) return null;
  const width = 720;
  const height = 190;
  const padding = { top: 18, right: 18, bottom: 28, left: 38 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = padding.left + (values.length === 1 ? chartWidth / 2 : (index / (values.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
    return { x, y, value };
  });
  const linePoints = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPoints = `${padding.left},${padding.top + chartHeight} ${linePoints} ${padding.left + chartWidth},${padding.top + chartHeight}`;
  return (
    <section className="speed-panel" aria-label="输出速度曲线">
      <div className="speed-panel-heading"><div><strong>输出速度曲线</strong><span>按秒统计生成 Token；批量检测显示各次平均值</span></div><b>{formatNumber(Math.max(...values))} token/s 峰值</b></div>
      <div className="speed-chart-wrap">
        <svg className="speed-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每秒输出 Token 速度曲线">
          {[0, 0.5, 1].map((ratio) => {
            const y = padding.top + chartHeight * ratio;
            return <line key={ratio} x1={padding.left} x2={padding.left + chartWidth} y1={y} y2={y} className="speed-grid-line" />;
          })}
          <polygon points={areaPoints} className="speed-area" />
          <polyline points={linePoints} className="speed-line" />
          {points.map(({ x, y, value }, index) => <circle key={`${index}-${value}`} cx={x} cy={y} r="3" className="speed-point"><title>{`${index + 1} 秒：${formatNumber(value)} token/s`}</title></circle>)}
          <text x={padding.left - 8} y={padding.top + 4} textAnchor="end" className="speed-axis-label">{formatNumber(maxValue)}</text>
          <text x={padding.left - 8} y={padding.top + chartHeight + 4} textAnchor="end" className="speed-axis-label">0</text>
        </svg>
      </div>
      <div className="speed-axis"><span>第 1 秒</span><span>{values.length} 秒</span></div>
    </section>
  );
}

function OutputPreviewDialog({ text, model, outputTokens, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <div className="output-preview-backdrop" role="presentation" onClick={onClose}>
      <div className="output-preview-modal" role="dialog" aria-modal="true" aria-labelledby="output-preview-title" onClick={(event) => event.stopPropagation()}>
        <div className="output-preview-heading"><div><p className="eyebrow">Response preview</p><h2 id="output-preview-title">输出预览</h2><span>{model} · {outputTokens ?? "—"} Token</span></div><Button icon={X} title="关闭输出预览" onClick={onClose} /> </div>
        <pre className="output-preview-text">{text || "渠道没有返回可展示的文本内容。"}</pre>
      </div>
    </div>
  );
}

function SettingsView({ channels, onSaveChannel, playwrightImport, onStagePlaywrightImport, onClearPlaywrightImport }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sources, setSources] = useState([]);
  const [billingUnits, setBillingUnits] = useState([]);
  const [sortDirection, setSortDirection] = useState("asc");
  const [editing, setEditing] = useState(null);
  const [successDialog, setSuccessDialog] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
  const sourceOptions = useMemo(() => [...new Set(channels.map((channel) => channel.source || "未提供"))].sort((left, right) => String(left).localeCompare(String(right), "zh-CN")), [channels]);
  const billingUnitOptions = useMemo(() => [...new Set(channels.map((channel) => channel.billingUnit || "USD"))].sort((left, right) => String(left).localeCompare(String(right), "zh-CN")), [channels]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const searchable = [channel.id, channel.name, channel.vendor, channel.source, channel.pricingUrl, channel.apiBase].filter(Boolean).join(" ").toLocaleLowerCase();
      const source = channel.source || "未提供";
      const billingUnit = channel.billingUnit || "USD";
      return (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (category === "all" || channel.category === category) &&
        (!sources.length || sources.includes(source)) &&
        (!billingUnits.length || billingUnits.includes(billingUnit));
    }).sort((left, right) => {
      const result = String(left.name || "").localeCompare(String(right.name || ""), "zh-CN", { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? result : -result;
    });
  }, [channels, query, category, sources, billingUnits, sortDirection]);
  const save = async (channel, reportProgress) => {
    const isNew = channel.id === "new";
    const result = await onSaveChannel(channel, reportProgress);
    if (result?.ok === false) return result;
    setEditing(null);
    setSuccessDialog({
      title: isNew ? "添加成功" : "渠道已保存",
      message: result?.message || (isNew ? "渠道已加入管理列表" : "渠道信息已保存"),
      refreshOk: result?.refreshOk,
      connectionModeUsed: result?.connectionModeUsed,
    });
    return result;
  };
  return (
    <div className="settings-view">
      <div className="page-heading"><div><p className="eyebrow">Configuration</p><h1>渠道管理</h1><p className="page-subtitle">维护价格来源、渠道标签、连接方式和本地导出信息</p></div><Button className="settings-add-button" variant="primary" icon={Plus} onClick={() => setEditing({ id: "new", name: "", vendor: "", source: "relaywatch爬取", pricingUrl: "", apiBase: "", exchangeRate: 6.74, billingUnit: "USD", pricingMode: "auto", priceScale: 1, category: "transit", ingestMode: "relaywatch", connectionMode: "auto" })}>新增渠道</Button></div>
      <div className="settings-layout">
        <div className="channel-list-panel">
          <div className="settings-toolbar"><div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索渠道、生产商、来源或网址" /></div><div className="settings-filter-controls"><div className="segmented"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部</button><button className={category === "official" ? "active" : ""} onClick={() => setCategory("official")}>官方</button><button className={category === "transit" ? "active" : ""} onClick={() => setCategory("transit")}>中转</button><button className={category === "unknown" ? "active" : ""} onClick={() => setCategory("unknown")}>待确认</button></div><MultiSelect menuKey="settings-source" activeMenu={activeMenu} onActiveMenuChange={setActiveMenu} label="数据来源" options={sourceOptions} selected={sources} onChange={setSources} searchPlaceholder="搜索数据来源" /><MultiSelect menuKey="settings-unit" activeMenu={activeMenu} onActiveMenuChange={setActiveMenu} label="计价单位" options={billingUnitOptions} selected={billingUnits} onChange={setBillingUnits} searchPlaceholder="搜索计价单位" /><select className="native-select settings-sort-select" value={sortDirection} onChange={(event) => setSortDirection(event.target.value)}><option value="asc">名称升序（A-Z）</option><option value="desc">名称降序（Z-A）</option></select></div><span className="settings-result-count">{filtered.length} / {channels.length} 个渠道</span></div>
           <div className="channel-list">{filtered.map((channel) => <div className="channel-row" key={channel.id}><div className="channel-main"><div className="channel-name-line"><strong>{channel.name}</strong><TagBadge category={channel.category} /></div><span>{channel.vendor} · {channel.source}</span><span className="channel-rate">计价：{channel.billingUnit || "USD"} · {formatNumber(channel.exchangeRate ?? 6.74)} CNY / 单位 · 解析：{channel.pricingMode === "billing_expr" ? "动态表达式" : channel.pricingMode === "model_ratio" ? "模型倍率" : "自动"} · 调整：×{formatNumber(channel.priceScale ?? 1)} · 连接：{connectionModeLabel(channel.connectionMode, channel.ingestMode)}</span><a href={channel.pricingUrl || "#"} target="_blank" rel="noreferrer">{channel.pricingUrl || "未配置价格网址"}{channel.pricingUrl ? <ExternalLink size={13} /> : null}</a></div><Button icon={Pencil} title={`编辑 ${channel.name}`} onClick={() => setEditing(channel)} /></div>)}{!filtered.length ? <EmptyState /> : null}</div>
        </div>
        {editing ? <ChannelEditor channel={editing} onCancel={() => setEditing(null)} onSave={save} /> : <div className="settings-note"><Server size={20} /><strong>渠道信息</strong><span>选择 RelayWatch 抓取后，保存前会先测试网址；官方渠道使用浅绿色标识，中转站使用浅黄色标识。</span></div>}
      </div>
      <PlaywrightImportPanel stagedImport={playwrightImport} onStage={onStagePlaywrightImport} onClear={onClearPlaywrightImport} />
      <SuccessDialog dialog={successDialog} onClose={() => setSuccessDialog(null)} />
    </div>
  );
}

function Pager({ page, pageCount, onChange, label }) {
  return (
    <div className="table-pager"><span>{label}</span><div className="pager-actions"><Button icon={ArrowLeft} title="上一页" onClick={() => onChange(Math.max(0, page - 1))} disabled={page === 0} /><span>第 {page + 1} / {pageCount} 页</span><Button icon={ArrowRight} title="下一页" onClick={() => onChange(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} /></div></div>
  );
}

function Overview({ data, loadedPages, onLoadPage, onRefresh, isRefreshing, status, onDetectChannel }) {
  const comparisonPages = loadedPages.comparison;
  const [filters, setFilters] = useState({ models: [], suppliers: [], vendors: [], modelSeries: [] });
  const [currency, setCurrency] = useState("usd");
  const [sortState, setSortState] = useState({ model: null, direction: "asc", type: "输入" });
  const [activeMenu, setActiveMenu] = useState(null);
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const matches = useCallback((item, skipKey = null) => {
    const selectedSuppliers = new Set(filters.suppliers);
    return (
      (skipKey === "models" || !filters.models.length || filters.models.includes(item.model)) &&
      (skipKey === "suppliers" || !filters.suppliers.length || item.suppliers.some((supplier) => selectedSuppliers.has(supplier))) &&
      (skipKey === "vendors" || !filters.vendors.length || filters.vendors.includes(item.vendor)) &&
      (skipKey === "modelSeries" || !filters.modelSeries.length || filters.modelSeries.includes(item.modelSeries || item.modelType))
    );
  }, [filters]);
  const filterOptions = useMemo(() => {
    const unique = (values) => [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
    return {
      models: unique(data.modelIndex.filter((item) => matches(item, "models")).map((item) => item.model)),
      suppliers: unique(data.modelIndex.filter((item) => matches(item, "suppliers")).flatMap((item) => item.suppliers)),
      vendors: unique(data.modelIndex.filter((item) => matches(item, "vendors")).map((item) => item.vendor)),
      modelSeries: unique(data.modelIndex.filter((item) => matches(item, "modelSeries")).map((item) => item.modelSeries || item.modelType)),
    };
  }, [data.modelIndex, matches]);
  useEffect(() => {
    setFilters((current) => {
      const next = {
        models: current.models.filter((value) => filterOptions.models.includes(value)),
        suppliers: current.suppliers.filter((value) => filterOptions.suppliers.includes(value)),
        vendors: current.vendors.filter((value) => filterOptions.vendors.includes(value)),
        modelSeries: current.modelSeries.filter((value) => filterOptions.modelSeries.includes(value)),
      };
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [filterOptions]);
  const filteredModels = useMemo(() => data.modelIndex.filter((item) => matches(item)), [data.modelIndex, matches]);
  const [page, setPage] = useState(0);
  const pageSize = data.pageSize || DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  useEffect(() => setPage(0), [filters.models, filters.suppliers, filters.vendors, filters.modelSeries]);
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);
  const visibleModelRecords = useMemo(() => filteredModels.slice(page * pageSize, (page + 1) * pageSize), [filteredModels, page, pageSize]);
  const visibleModelNames = useMemo(() => new Set(visibleModelRecords.map((item) => item.model)), [visibleModelRecords]);
  useEffect(() => {
    setSortState((current) => current.model && !visibleModelNames.has(current.model) ? { model: null, direction: "asc", type: "输入" } : current);
  }, [visibleModelNames]);
  const neededPageIds = useMemo(() => [...new Set(visibleModelRecords.map((item) => item.page))], [visibleModelRecords]);
  useEffect(() => {
    neededPageIds.forEach((pageId) => onLoadPage("comparison", pageId));
  }, [neededPageIds, onLoadPage]);
  const loadedRows = useMemo(() => neededPageIds.flatMap((pageId) => comparisonPages[pageId]?.rows || []), [comparisonPages, neededPageIds]);
  const rows = useMemo(() => {
    const selectedSuppliers = new Set(filters.suppliers);
    const order = new Map(visibleModelRecords.map((item, index) => [item.model, index]));
    const grouped = new Map();
    loadedRows
      .filter((row) => visibleModelNames.has(row.model))
      .map((row) => ({ ...row, prices: Object.fromEntries(Object.entries(row.prices).filter(([supplier]) => !filters.suppliers.length || selectedSuppliers.has(supplier))) }))
      .filter((row) => Object.keys(row.prices).length)
      .forEach((row) => {
        if (!grouped.has(row.model)) grouped.set(row.model, []);
        grouped.get(row.model).push(row);
      });
    const groups = [...grouped.entries()];
    groups.sort(([left], [right]) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
    return groups.flatMap(([, modelRows]) => modelRows);
  }, [loadedRows, visibleModelNames, visibleModelRecords, filters.suppliers, sortState, currency]);
  const visibleSupplierSet = useMemo(() => new Set(visibleModelRecords.flatMap((item) => item.suppliers)), [visibleModelRecords]);
  const visibleSuppliers = useMemo(() => {
    const available = data.filters.suppliers.filter((supplier) => visibleSupplierSet.has(supplier) && (!filters.suppliers.length || filters.suppliers.includes(supplier)));
    if (!sortState.model) return available;
    const selectedRecord = visibleModelRecords.find((item) => item.model === sortState.model);
    if (!selectedRecord) return available;
    const selectedRow = loadedRows.find((row) => row.model === sortState.model && row.type === sortState.type);
    const prices = selectedRow?.prices || {};
    return [...available].sort((left, right) => {
      const leftValue = prices[left]?.[currency];
      const rightValue = prices[right]?.[currency];
      const a = leftValue === null || leftValue === undefined ? Number.POSITIVE_INFINITY : Number(leftValue);
      const b = rightValue === null || rightValue === undefined ? Number.POSITIVE_INFINITY : Number(rightValue);
      if (a !== b) return (a - b) * (sortState.direction === "asc" ? 1 : -1);
      return left.localeCompare(right);
    });
  }, [data.filters.suppliers, visibleSupplierSet, filters.suppliers, sortState, visibleModelRecords, loadedRows, currency]);
  const loading = neededPageIds.some((pageId) => !comparisonPages[pageId]);
  const toggleSort = (model, type) => setSortState((current) => ({ model, type, direction: current.model === model && current.type === type && current.direction === "asc" ? "desc" : "asc" }));
  return (
    <div className="overview-view">
      <div className="page-heading"><div><p className="eyebrow">Price comparison</p><h1>模型渠道价格对比</h1><p className="page-subtitle">按模型系列、生产商和渠道筛选，并直接比较同一模型的渠道价格</p></div><div className="heading-actions"><Button icon={Download} title="下载当前 Excel 工作簿" onClick={() => { window.location.href = "/downloads/workbook.xlsx"; }}>导出 Excel</Button><Button variant="primary" icon={RefreshCw} title="立即运行数据更新" onClick={onRefresh} disabled={isRefreshing}>{isRefreshing ? "更新中" : "更新数据"}</Button></div></div>
      <UpdateProgress status={status} isRefreshing={isRefreshing} />
      <div className="stats-row"><Stat icon={Database} accent="accent-blue" value={data.meta.modelCount.toLocaleString()} label="模型名" detail="models 数据" /><Stat icon={Server} accent="accent-mint" value={data.meta.supplierCount.toLocaleString()} label="渠道" detail="可比较渠道" /><Stat icon={Tag} accent="accent-yellow" value={data.meta.vendorCount.toLocaleString()} label="生产商" detail="模型生产商" /><Stat icon={Clock3} accent="accent-coral" value={formatDate(data.meta.updatedAt)} label="上次更新" detail="每 3 小时自动检查" /></div>
      <section className="comparison-section"><div className="section-heading"><div><p className="eyebrow">Cross-provider matrix</p><h2>横向对比</h2></div><div className="currency-switch"><span>显示币种</span><button className={currency === "usd" ? "active" : ""} onClick={() => setCurrency("usd")}>USD / 1M</button><button className={currency === "cny" ? "active" : ""} onClick={() => setCurrency("cny")}>CNY / 1M</button></div></div>
        <div className="comparison-help"><span className="help-sort"><ArrowUpDown size={14} />点击“价格类型”右侧的排序按钮，可按当前模型的输入、输出、缓存读或缓存写价格重排渠道；再次点击切换升序/降序。</span><span className="help-color"><i className="legend-swatch low"></i>浅绿色 = 价格较低 <i className="legend-swatch high"></i>浅红色 = 价格较高</span></div>
          <div className="filter-bar"><div className="filter-label"><Filter size={16} />筛选</div><MultiSelect menuKey="overview-model" activeMenu={activeMenu} onActiveMenuChange={setActiveMenu} label="模型名" options={filterOptions.models} selected={filters.models} onChange={(value) => updateFilter("models", value)} searchPlaceholder="搜索模型名" /><MultiSelect menuKey="overview-supplier" activeMenu={activeMenu} onActiveMenuChange={setActiveMenu} label="渠道" options={filterOptions.suppliers} selected={filters.suppliers} onChange={(value) => updateFilter("suppliers", value)} searchPlaceholder="搜索渠道" /><MultiSelect menuKey="overview-vendor" activeMenu={activeMenu} onActiveMenuChange={setActiveMenu} label="生产商" options={filterOptions.vendors} selected={filters.vendors} onChange={(value) => updateFilter("vendors", value)} searchPlaceholder="搜索生产商" /><MultiSelect menuKey="overview-series" activeMenu={activeMenu} onActiveMenuChange={setActiveMenu} label="模型系列" options={filterOptions.modelSeries} selected={filters.modelSeries} onChange={(value) => updateFilter("modelSeries", value)} searchPlaceholder="搜索模型系列" /><span className="filter-result">{filteredModels.length} 个模型名 · 当前页 {visibleModelRecords.length} 个 · {visibleSuppliers.length} 个渠道{loading ? " · 正在读取分片" : ""}</span></div>
        <ComparisonTable rows={rows} suppliers={visibleSuppliers} currency={currency} loading={loading} sortState={sortState} onSortModel={toggleSort} onDetectChannel={onDetectChannel} />
        <Pager page={page} pageCount={pageCount} onChange={setPage} label={`${filteredModels.length} 个模型 · 当前页 ${visibleModelRecords.length} 个`} />
      </section>
      <BestChannelRail modelIndex={data.modelIndex} modelSeries={data.filters.modelSeries || data.filters.modelTypes} loadedPages={loadedPages.best} loadPage={onLoadPage} />
    </div>
  );
}

function ChannelCheckView({ channels, data, history, onRecord, prefill }) {
  const [channelId, setChannelId] = useState(channels[0]?.id || "");
  const [channelQuery, setChannelQuery] = useState("");
  const [model, setModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [storedApiKeys, setStoredApiKeys] = useState(() => safeStorage.get(API_KEY_STORAGE_KEY, {}));
  const [apiBase, setApiBase] = useState("");
  const [connectionMode, setConnectionMode] = useState("auto");
  const [prompt, setPrompt] = useState(LONG_OUTPUT_PROMPT);
  const [maxTokens, setMaxTokens] = useState(512);
  const [runCount, setRunCount] = useState(1);
  const [concurrency, setConcurrency] = useState(1);
  const [backgroundRun, setBackgroundRun] = useState(true);
  const [activeJob, setActiveJob] = useState(() => safeStorage.get(ACTIVE_JOB_STORAGE_KEY, null));
  const [jobProgress, setJobProgress] = useState(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [outputPreviewOpen, setOutputPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!prefill) return;
    setChannelQuery("");
    setModelQuery("");
    setCustomModel("");
    setChannelId(prefill.channelId || "");
    setModel(prefill.model || "");
    setApiBase(prefill.apiBase || "");
    setConnectionMode(prefill.connectionMode || "auto");
    setResult(null);
    setOutputPreviewOpen(false);
    setError("");
  }, [prefill]);
  const channelOptions = useMemo(() => {
    const query = channelQuery.trim().toLocaleLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => [channel.id, channel.name, channel.url, channel.apiBase, channel.pricingUrl, channel.source, categoryLabel(channel.category)].filter(Boolean).join(" ").toLocaleLowerCase().includes(query));
  }, [channels, channelQuery]);
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  useEffect(() => {
    if (!selectedChannel?.id) return;
    setApiKey(storedApiKeys[selectedChannel.id] || "");
  }, [selectedChannel?.id]);
  const updateApiKey = (value) => {
    setApiKey(value);
    if (!selectedChannel?.id) return;
    setStoredApiKeys((current) => {
      const next = { ...current, [selectedChannel.id]: value };
      safeStorage.set(API_KEY_STORAGE_KEY, next);
      return next;
    });
  };
  useEffect(() => {
    if (!channelOptions.some((channel) => channel.id === channelId)) setChannelId(channelOptions[0]?.id || "");
  }, [channelOptions, channelId]);
  const modelOptions = useMemo(() => {
    const channelModels = selectedChannel ? data.modelIndex.filter((item) => item.suppliers?.includes(selectedChannel.name)) : [];
    const source = channelModels.length ? channelModels : data.modelIndex;
    return source.filter((item) => !modelQuery || item.model.toLowerCase().includes(modelQuery.toLowerCase())).slice(0, 500);
  }, [data.modelIndex, modelQuery, selectedChannel]);
  useEffect(() => {
    if (!selectedChannel) return;
    setApiBase(selectedChannel.apiBase || selectedChannel.url || selectedChannel.pricingUrl || "");
    setConnectionMode(selectedChannel.connectionMode || "auto");
  }, [selectedChannel]);
  useEffect(() => {
    if (!modelOptions.some((item) => item.model === model)) setModel(modelOptions[0]?.model || "");
  }, [modelOptions, model]);
  useEffect(() => {
    if (!activeJob?.jobId) return undefined;
    let cancelled = false;
    let recorded = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/channel-check/jobs/${encodeURIComponent(activeJob.jobId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.message || "后台检测任务不存在或已过期");
        setJobProgress(payload);
        setChecking(payload.state === "running");
        if (payload.state === "running") return;
        if (recorded) return;
        recorded = true;
        if (payload.result) {
          const record = { ...payload.result, channelId: activeJob.channelId, channelName: activeJob.channelName, model: activeJob.model, checkedAt: new Date().toISOString(), runs: activeJob.runs, concurrency: activeJob.concurrency, background: true };
          setResult(record);
          onRecord(record);
          setError(payload.result.ok ? "" : payload.result.message || "后台检测完成，但存在失败请求");
        } else {
          setError(payload.error || payload.message || "后台检测失败");
        }
        setChecking(false);
        setActiveJob(null);
        safeStorage.set(ACTIVE_JOB_STORAGE_KEY, null);
      } catch (pollError) {
        if (cancelled) return;
        setChecking(false);
        setError(pollError.message || "读取后台检测状态失败");
        setActiveJob(null);
        safeStorage.set(ACTIVE_JOB_STORAGE_KEY, null);
      }
    };
    poll();
    const timer = window.setInterval(poll, 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeJob, onRecord]);
  const runCheck = async () => {
    const requestedModel = customModel.trim() || model;
    const totalRuns = Math.min(MAX_DETECTION_RUNS, Math.max(1, Math.floor(Number(runCount) || 1)));
    const parallelRuns = Math.min(MAX_DETECTION_CONCURRENCY, totalRuns, Math.max(1, Math.floor(Number(concurrency) || 1)));
    if (!selectedChannel) {
      setError("当前搜索条件没有匹配的渠道，请清空搜索或重新选择渠道。");
      return;
    }
    if (!apiBase.trim()) {
      setError("请填写 API Base，例如 https://example.com/v1。");
      return;
    }
    if (!apiKey.trim()) {
      setError("请填写当前渠道的 API Key。密钥会按渠道保存在本机浏览器中，不会写入项目文件。");
      return;
    }
    if (!requestedModel) {
      setError("请选择测试模型，或在“自定义模型名”中填写渠道实际支持的名称。");
      return;
    }
    setChecking(true);
    setError("");
    setResult(null);
    setOutputPreviewOpen(false);
    let startedBackground = false;
    try {
      const endpoint = totalRuns > 1 && backgroundRun ? "/api/channel-check/batch/start" : totalRuns > 1 ? "/api/channel-check/batch" : "/api/channel-check";
      const requestedMaxTokens = Math.min(4096, Math.max(16, Math.floor(Number(maxTokens) || 512)));
      setMaxTokens(requestedMaxTokens);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiBase, apiKey, model: requestedModel, prompt, connectionMode, maxTokens: requestedMaxTokens, runs: totalRuns, concurrency: parallelRuns }) });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`本地检测服务返回了无效响应（HTTP ${response.status}），请确认 API 服务正在运行。`);
      }
       if (endpoint.endsWith("/start") && payload.ok && payload.jobId) {
         const nextJob = { jobId: payload.jobId, channelId: selectedChannel.id, channelName: selectedChannel.name, model: requestedModel, runs: totalRuns, concurrency: parallelRuns };
         startedBackground = true;
         setActiveJob(nextJob);
         setJobProgress(payload);
         safeStorage.set(ACTIVE_JOB_STORAGE_KEY, nextJob);
         setError("");
         return;
       }
       const record = { ...payload, channelId: selectedChannel.id, channelName: selectedChannel.name, model: requestedModel, checkedAt: new Date().toISOString(), runs: totalRuns, concurrency: parallelRuns };
       setResult(record);
       onRecord(record);
       if (!response.ok || !payload.ok) setError(payload.message || "检测失败");
    } catch (checkError) {
      const message = checkError.message || "检测失败";
      setError(message === "Failed to fetch" ? "无法连接本地检测服务，请确认 4180 端口的 API 服务正在运行。" : message);
    } finally {
      if (!startedBackground) setChecking(false);
    }
  };
  const value = (key, fallback = "—") => result?.metrics?.[key] ?? fallback;
  const metricItems = [
    ["ttftMs", "首 Token 延迟（TTFT）", "ms"], ["ttfbMs", "首字节延迟（TTFB）", "ms"], ["totalMs", "总响应时间", "ms"], ["throughput", "输出吞吐量", "token/s"],
    ["peakThroughput", "峰值输出速度", "token/s"], ["peakTps", "单秒峰值 TPS", "token/s"], ["outputTokens", "输出 Token 数", ""], ["itlMs", "Token 间隔（ITL）", "ms"],
    ["streamStability", "流式稳定性", ""], ["successRate", "成功率", "%"], ["errorRate", "错误率", "%"],
    ["concurrency", "并发能力", ""], ["rateLimit", "限流行为", ""], ["costAccuracy", "费用准确性", ""], ["protocol", "协议兼容性", ""], ["security", "数据安全", ""],
  ];
  const resultBadge = result?.summary ? (result.summary.failureCount ? "部分成功" : "全部成功") : result?.metrics?.ok ? "请求成功" : "请求失败";
  const runResults = Array.isArray(result?.results) && result.results.length ? result.results : result ? [result] : [];
  const tpsCurve = result?.summary?.avgTpsCurve?.length ? result.summary.avgTpsCurve : (result?.metrics?.tpsCurve || []);
  const maxTps = Math.max(1, ...tpsCurve.map((item) => Number(item) || 0));
  const focusValue = (summaryKey, metricKey, fallback = "—") => result?.summary?.[summaryKey] ?? result?.metrics?.[metricKey] ?? fallback;
  const totalGeneratedTokens = result?.summary?.totalGeneratedTokens ?? result?.metrics?.outputTokens;
  return (
    <div className="check-view">
       <div className="page-heading"><div><p className="eyebrow">Channel diagnostics</p><h1>渠道检测</h1><p className="page-subtitle">使用一次短流式请求测量首 Token、响应速度和协议表现；批量检测可在服务端后台运行。</p></div><div className="check-heading-status"><ShieldCheck size={18} /><span>密钥仅保存在本机</span></div></div>
      <div className="check-layout">
        <section className="check-form-panel">
          <div className="panel-title"><div className="panel-icon"><KeyRound size={17} /></div><div><p className="eyebrow">Run a probe</p><h2>发起一次检测</h2></div></div>
          <label>搜索渠道<div className="input-with-icon"><Search size={14} /><input value={channelQuery} onChange={(event) => setChannelQuery(event.target.value)} placeholder="按名称、网址或来源搜索渠道" /></div></label>
          <label>选择渠道<select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channelOptions.length ? channelOptions.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {categoryLabel(channel.category)}</option>) : <option value="" disabled>没有匹配渠道</option>}</select>{channelQuery.trim() ? <span className="field-hint">已筛选 {channelOptions.length} / {channels.length} 个渠道</span> : null}</label>
          <label>API Base<input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://example.com/v1" /></label>
          <label>检测连接<select value={connectionMode} onChange={(event) => setConnectionMode(event.target.value)}><option value="auto">自动（先直连，失败后代理）</option><option value="direct">直连</option><option value="proxy">代理</option></select></label>
           <label><span className="field-label-row"><span>API Key</span><button className="text-action" type="button" onClick={() => updateApiKey("")} disabled={!apiKey}>清除本机 Key</button></span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => updateApiKey(event.target.value)} placeholder="按渠道保存在本机浏览器" /><span className="field-hint">密钥只发送到你填写的 API Base，不会写入项目文件；清除浏览器数据后需要重新填写。</span></label>
           <div className="check-run-settings"><label>连续检测次数<input type="number" min="1" max={MAX_DETECTION_RUNS} step="1" value={runCount} onChange={(event) => setRunCount(event.target.value === "" ? "" : Number(event.target.value))} /><span className="field-hint">最多 {MAX_DETECTION_RUNS} 次，默认 1 次</span></label><label>并发请求数<input type="number" min="1" max={MAX_DETECTION_CONCURRENCY} step="1" value={concurrency} onChange={(event) => setConcurrency(event.target.value === "" ? "" : Number(event.target.value))} /><span className="field-hint">批量检测最多 {MAX_DETECTION_CONCURRENCY} 路</span></label><label className="background-run-toggle"><span><input type="checkbox" checked={backgroundRun} onChange={(event) => setBackgroundRun(event.target.checked)} />后台运行批量检测</span><span className="field-hint">服务端继续执行，切换页面后仍可回来查看</span></label></div>
          <label>最大输出 Token<input type="number" min="16" max="4096" step="16" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value === "" ? "" : Number(event.target.value))} /><span className="field-hint">每次请求上限 16–4096，默认 512；实际数量以渠道返回为准</span></label>
          <label>搜索模型<div className="input-with-icon"><Search size={14} /><input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="输入关键词缩小模型列表" /></div></label>
          <label>测试模型<select value={model} onChange={(event) => setModel(event.target.value)}>{modelOptions.map((item) => <option key={item.model} value={item.model}>{item.model} · {item.modelSeries || item.modelType}</option>)}</select></label>
          <label>自定义模型名<input value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="可填写渠道实际支持的模型名，优先于上方选择" /></label>
           <label><span className="field-label-row"><span>测试内容</span><button className="text-action" type="button" onClick={() => setPrompt(LONG_OUTPUT_PROMPT)}>填入长输出基准</button></span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} /><span className="field-hint">短问题会让模型自然提前结束；测速建议要求连续输出较长文本。实际输出仍以模型和渠道返回为准。</span></label>
           <div className="check-form-foot"><span><Activity size={14} />{checking && activeJob ? `后台进度 ${jobProgress?.completedRuns || 0}/${activeJob.runs} 次` : runCount > 1 ? `${Math.min(MAX_DETECTION_RUNS, Math.max(1, Number(runCount) || 1))} 次请求，最多 ${Math.min(MAX_DETECTION_CONCURRENCY, Math.max(1, Number(concurrency) || 1))} 路并发` : "一次请求，流式读取"}</span><Button variant="primary" icon={Gauge} onClick={runCheck} disabled={checking}>{checking ? (activeJob ? "后台检测中…" : runCount > 1 ? "批量检测中…" : "检测中…") : runCount > 1 ? (backgroundRun ? "启动后台检测" : "开始批量检测") : "开始检测"}</Button></div>
          {error ? <div className="editor-error">{error}</div> : null}
           <div className="check-note"><ShieldCheck size={14} /><span>检测完成后只记录指标、渠道、模型和时间。API Key 按渠道保存在本机浏览器中，不会写入项目文件或上传到第三方。</span></div>
        </section>
        <section className="check-result-panel">
          <div className="panel-title"><div className="panel-icon panel-icon-mint"><BarChart3 size={17} /></div><div><p className="eyebrow">Measurement</p><h2>{result ? `${result.channelName} · ${result.model}` : "检测结果"}</h2></div>{result ? <span className={`check-result-badge ${result.metrics?.ok ? "ok" : result.summary?.successCount ? "partial" : "bad"}`}>{resultBadge}</span> : null}</div>
          {result ? <div className="focus-metrics"><div className="focus-metric focus-metric-primary"><span>TTFT</span><strong>{focusValue("avgTtftMs", "ttftMs")}<small>ms</small></strong><em>首 Token 延迟</em></div><div className="focus-metric"><span>平均 Token 速度</span><strong>{focusValue("avgThroughput", "throughput")}<small>token/s</small></strong><em>首 Token 后的生成速度</em></div><div className="focus-metric"><span>平均 ITL</span><strong>{focusValue("avgItlMs", "itlMs")}<small>ms</small></strong><em>相邻 Token 平均间隔</em></div><div className="focus-metric"><span>平均 RTM</span><strong>{focusValue("avgRtmMs", "totalMs")}<small>ms</small></strong><em>请求到完整响应</em></div><div className="focus-metric"><span>总生成 Token</span><strong>{totalGeneratedTokens ?? "—"}<small>Token</small></strong><em>{result.summary ? `${result.summary.successCount} 次成功请求合计` : "本次响应"}</em></div></div> : null}
          {result?.summary ? <div className="batch-summary"><div><span>成功次数</span><strong>{result.summary.successCount} / {result.summary.totalRuns}</strong></div><div><span>P50 TTFT</span><strong>{result.summary.p50TtftMs ?? "—"}<small>ms</small></strong></div><div><span>P95 TTFT</span><strong>{result.summary.p95TtftMs ?? "—"}<small>ms</small></strong></div><div><span>P99 TTFT</span><strong>{result.summary.p99TtftMs ?? "—"}<small>ms</small></strong></div><div><span>TTFT 标准差</span><strong>{result.summary.stdDevTtftMs ?? "—"}<small>ms</small></strong></div><div><span>峰值输出速度</span><strong>{result.summary.avgPeakThroughput ?? "—"}<small>token/s</small></strong></div><div><span>总耗时范围</span><strong>{result.summary.minTotalMs ?? "—"}–{result.summary.maxTotalMs ?? "—"}<small>ms</small></strong></div></div> : null}
          {result ? <div className="metric-grid">{metricItems.map(([key, label, unit]) => <div className="metric-card" key={key}><span>{label}</span><strong>{value(key)}{value(key) !== "—" && unit ? <small>{unit}</small> : null}</strong></div>)}</div> : <div className="check-empty"><Gauge size={28} /><strong>等待检测</strong><span>选择渠道、填写 Key 后开始，结果会显示在这里。</span></div>}
          {result && tpsCurve.length ? <OutputSpeedChart curve={tpsCurve} /> : null}
           {result?.message ? <div className="check-response-note"><strong>{result.message}</strong>{result.metrics?.endpoint ? <span>请求地址：{result.metrics.endpoint} · 连接：{result.metrics.connectionModeUsed || "自动"} · HTTP {result.metrics.statusCode ?? "—"} · 服务端模型：{result.metrics.responseModel || "未返回"}</span> : null}{result.metrics?.requestedMaxTokens ? <span>输出诊断：请求上限 {result.metrics.requestedMaxTokens} Token · 实际参数 {result.metrics.tokenParameter || "max_tokens"} · finish_reason：{result.metrics.finishReason || "渠道未返回"}</span> : null}{result.metrics?.finishReason === "stop" && result.metrics?.outputTokens < result.metrics?.requestedMaxTokens ? <span className="check-response-warning">模型以 finish_reason=stop 主动结束，仅生成 {result.metrics.outputTokens} Token；这不是页面截断。请使用“长输出基准”或在提示词中明确要求继续生成。</span> : null}{result.metrics?.finishReason === "length" && result.metrics?.outputTokens < result.metrics?.requestedMaxTokens ? <span className="check-response-warning">渠道在低于请求上限时以 length 停止，说明上游还有更低的输出限制。</span> : null}{result.metrics?.fallbackAttempted ? <span>备用参数重试：首次 {result.metrics.initialOutputTokens ?? "—"} Token · 备用 {result.metrics.fallbackOutputTokens ?? "—"} Token · {result.metrics.fallbackMessage || (result.metrics.tokenParameter === "max_completion_tokens" ? "已采用 max_completion_tokens" : "未获得更长响应")}</span> : null}{result.metrics?.fallbackAttempts?.length ? <span>参数尝试明细：{result.metrics.fallbackAttempts.map((attempt) => `${attempt.parameter}=${attempt.outputTokens ?? "失败"}`).join(" · ")}</span> : null}{result.metrics?.outputPreview ? <button className="output-preview-trigger" type="button" onClick={() => setOutputPreviewOpen(true)}><span>打开输出预览</span><span>{result.metrics.outputPreview.length} 字符 · 独立窗口查看</span><ExternalLink size={14} /></button> : null}{result.metrics?.usage ? <span>Usage：输入 {result.metrics.usage.prompt_tokens ?? "—"} · 输出 {result.metrics.usage.completion_tokens ?? "—"} · 总计 {result.metrics.usage.total_tokens ?? "—"}</span> : null}{result.metrics?.tokenCountSource ? <span>Token 统计来源：{result.metrics.tokenCountSource === "usage" ? "渠道返回 usage" : result.metrics.tokenCountSource === "文本估算" ? "根据输出文本估算" : "未收到可计数输出"}</span> : null}</div> : null}
          {result && runResults.length > 1 ? <div className="run-details"><div className="tps-panel-heading"><strong>逐次运行</strong><span>用于定位偶发超时、限流或速度波动</span></div><div className="run-details-wrap"><table className="run-details-table"><thead><tr><th>次数</th><th>状态</th><th>TTFT</th><th>总响应</th><th>输出 Token</th><th>吞吐</th><th>峰值</th><th>错误</th></tr></thead><tbody>{runResults.map((run, index) => <tr key={`${run.runIndex || index + 1}-${run.metrics?.totalMs || ""}`}><td>{run.runIndex || index + 1}</td><td><span className={`history-status ${run.ok ? "ok" : "bad"}`}>{run.ok ? "成功" : "失败"}</span></td><td>{run.metrics?.ttftMs ?? "—"} ms</td><td>{run.metrics?.totalMs ?? "—"} ms</td><td>{run.metrics?.outputTokens ?? "—"}</td><td>{run.metrics?.throughput ?? "—"} token/s</td><td>{run.metrics?.peakThroughput ?? "—"} token/s</td><td>{run.ok ? "—" : run.message || "未知错误"}</td></tr>)}</tbody></table></div></div> : null}
        </section>
      </div>
      <section className="check-history"><div className="section-heading"><div><p className="eyebrow">History</p><h2>检测记录</h2><p className="section-subtitle">仅保留最近 20 条本地记录，便于比较不同渠道。</p></div><History size={19} color="#7890a4" /></div>{history.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>时间</th><th>渠道</th><th>模型</th><th>TTFT</th><th>总响应</th><th>吞吐</th><th>结果</th></tr></thead><tbody>{history.map((item) => <tr key={`${item.checkedAt}-${item.channelName}-${item.model}`}><td>{formatDate(item.checkedAt)}</td><td>{item.channelName}</td><td>{item.model}</td><td>{item.metrics?.ttftMs ?? "—"} ms</td><td>{item.metrics?.totalMs ?? "—"} ms</td><td>{item.metrics?.throughput ?? "—"} token/s</td><td><span className={`history-status ${item.metrics?.ok ? "ok" : "bad"}`}>{item.metrics?.ok ? "成功" : "失败"}</span></td></tr>)}</tbody></table></div> : <EmptyState title="暂无检测记录" description="完成一次渠道检测后会自动记录" />}</section>
      {outputPreviewOpen ? <OutputPreviewDialog text={result?.metrics?.outputPreview} model={result?.model} outputTokens={result?.metrics?.outputTokens} onClose={() => setOutputPreviewOpen(false)} /> : null}
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [loadedPages, setLoadedPages] = useState({ comparison: {}, best: {} });
  const [view, setView] = useState("overview");
  const [status, setStatus] = useState({ state: "loading", message: "正在读取本地数据" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [overrides, setOverrides] = useState(() => safeStorage.get("model-dashboard-channel-overrides", {}));
  const [customChannels, setCustomChannels] = useState(() => safeStorage.get("model-dashboard-custom-channels", []));
  const [playwrightImport, setPlaywrightImport] = useState(() => safeStorage.get("model-dashboard-playwright-import", null));
  const [detectionHistory, setDetectionHistory] = useState(() => safeStorage.get("model-dashboard-channel-checks", []));
  const [checkPrefill, setCheckPrefill] = useState(null);
  const pageRequests = useRef(new Set());

  const loadData = useCallback(async () => {
    try {
      const [dataResponse, statusResponse] = await Promise.all([fetch("/api/data"), fetch("/api/status")]);
      if (!dataResponse.ok) throw new Error("本地数据尚未准备好");
      const nextData = await dataResponse.json();
      setData((current) => current?.meta?.updatedAt === nextData.meta?.updatedAt ? current : nextData);
      if (statusResponse.ok) setStatus(await statusResponse.json());
    } catch (error) {
      setStatus({ state: "error", message: error.message });
    }
  }, []);
  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (response.ok) setStatus(await response.json());
    } catch {
      // The main update request reports the final error; transient status polling failures are ignored.
    }
  }, []);
  useEffect(() => { loadData(); const timer = setInterval(loadData, 30000); return () => clearInterval(timer); }, [loadData]);
  useEffect(() => {
    if (!isRefreshing) return undefined;
    loadStatus();
    const timer = setInterval(loadStatus, 800);
    return () => clearInterval(timer);
  }, [isRefreshing, loadStatus]);
  useEffect(() => {
    pageRequests.current.clear();
    setLoadedPages({ comparison: {}, best: {} });
  }, [data?.meta?.updatedAt]);

  const loadPage = useCallback(async (kind, page) => {
    const file = data?.files?.[kind]?.[page];
    if (!file) return;
    const key = `${kind}:${page}`;
    if (pageRequests.current.has(key)) return;
    pageRequests.current.add(key);
    try {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`本地数据分片加载失败: ${file}`);
      const payload = await response.json();
      setLoadedPages((current) => ({ ...current, [kind]: { ...current[kind], [page]: payload } }));
    } catch (error) {
      pageRequests.current.delete(key);
      setStatus({ state: "error", message: error.message });
    }
  }, [data]);

  const refresh = async (reportProgress) => {
    setIsRefreshing(true);
    setStatus({ state: "running", message: "准备更新", progress: { value: 2, label: "准备更新", detail: "等待后端开始处理" } });
    try {
      const response = await fetch("/api/update", { method: "POST" });
      const result = await response.json();
      if (!result.ok) throw new Error(result.message || "更新失败");
      await loadData();
      return { ok: true, message: result.message || "数据已更新", finishedAt: result.finishedAt };
    } catch (error) {
      const message = error.message || "更新失败";
      setStatus({ state: "error", message });
      return { ok: false, message };
    } finally { setIsRefreshing(false); }
  };

  const channels = useMemo(() => {
    if (!data) return [];
    const base = data.channels.map((channel) => ({
      ...channel,
      ingestMode: channel.ingestMode || (String(channel.source || "").toLowerCase().startsWith("relaywatch") ? "relaywatch" : "manual"),
      ...(overrides[channel.id] || {}),
    }));
    const merged = new Map(base.map((channel) => [channel.id, channel]));
    customChannels.forEach((channel) => {
      if (!merged.has(channel.id)) merged.set(channel.id, channel);
    });
    return [...merged.values()];
  }, [data, overrides, customChannels]);
  const openChannelCheck = useCallback((detail) => {
    const supplier = String(detail?.supplier || "").trim().toLocaleLowerCase();
    const channel = channels.find((item) => String(item.name || item.id || "").trim().toLocaleLowerCase() === supplier);
    setCheckPrefill({
      channelId: channel?.id || "",
      model: detail?.model || detail?.originalModelName || "",
      apiBase: channel?.apiBase || "",
      connectionMode: channel?.connectionMode || "auto",
    });
    setView("check");
  }, [channels]);
  const saveChannel = async (channel, reportProgress) => {
    const isNew = channel.id === "new";
    let nextChannel = { ...channel };
    let relayMessage = "";
    let refreshResult = null;
    let connectionModeUsed = null;
    reportProgress?.({ value: 12, label: channel.ingestMode === "relaywatch" ? "正在测试渠道连接" : "正在保存渠道配置" });
    if (channel.ingestMode === "relaywatch") {
      const response = await fetch("/api/relaywatch/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channel),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) return { ok: false, message: result.message || "RelayWatch 访问失败" };
      nextChannel = { ...channel, ...(result.site || {}) };
      relayMessage = result.message || "RelayWatch 访问成功";
      connectionModeUsed = result.connectionModeUsed || null;
      if (isNew) nextChannel.id = result.site?.name || channel.name || `custom-${Date.now()}`;
      reportProgress?.({ value: 34, label: `渠道访问成功（${connectionModeUsed === "proxy" ? "代理" : "直连"}），正在更新数据` });
      refreshResult = await refresh(reportProgress);
    }
    if (isNew) {
      const created = { ...nextChannel, id: nextChannel.name || `custom-${Date.now()}` };
      const next = [...customChannels.filter((item) => item.id !== created.id), created];
      setCustomChannels(next); safeStorage.set("model-dashboard-custom-channels", next);
      reportProgress?.({ value: 100, label: refreshResult?.ok === false ? "渠道已添加，数据更新失败" : "渠道和价格数据已完成" });
      return {
        ok: true,
        message: channel.ingestMode === "relaywatch" ? `${relayMessage}，已添加成功` : "渠道已保存",
        refreshOk: channel.ingestMode === "relaywatch" ? refreshResult?.ok !== false : undefined,
        connectionModeUsed,
      };
    }
    const next = { ...overrides, [nextChannel.id]: nextChannel };
    setOverrides(next); safeStorage.set("model-dashboard-channel-overrides", next);
    reportProgress?.({ value: 100, label: "渠道配置已保存" });
    return {
      ok: true,
      message: channel.ingestMode === "relaywatch" ? `${relayMessage}，已更新渠道` : "渠道已保存",
      refreshOk: channel.ingestMode === "relaywatch" ? refreshResult?.ok !== false : undefined,
      connectionModeUsed,
    };
  };
  const stagePlaywrightImport = (next) => { setPlaywrightImport(next); safeStorage.set("model-dashboard-playwright-import", next); };
  const clearPlaywrightImport = () => { setPlaywrightImport(null); safeStorage.set("model-dashboard-playwright-import", null); };
  const recordDetection = useCallback((record) => {
    setDetectionHistory((current) => {
      const next = [record, ...current].slice(0, 20);
      safeStorage.set("model-dashboard-channel-checks", next);
      return next;
    });
  }, []);

  if (!data) return <div className="loading-screen"><div className="loading-mark"><Database size={21} /></div><strong>Model Ledger</strong><span>{status.message}</span></div>;
  return (
    <div className="app-shell">
      <aside className="sidebar"><div className="brand-mark"><div className="brand-symbol"><span></span><span></span><span></span></div><div><strong>Model Ledger</strong><small>API price intelligence</small></div></div><nav className="primary-nav"><button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><LayoutDashboard size={18} />模型渠道价格对比</button><button className={view === "check" ? "active" : ""} onClick={() => { setCheckPrefill(null); setView("check"); }}><Gauge size={18} />渠道检测</button><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings2 size={18} />渠道管理</button></nav><div className="sidebar-bottom"><DataConnectionStatus status={status} data={data} /><div className="sidebar-note"><SlidersHorizontal size={15} /><span>代理只用于后台抓取，页面保持本地直连</span></div></div></aside>
      <main className="main-content"><header className="mobile-header"><div className="brand-symbol"><span></span><span></span><span></span></div><strong>Model Ledger</strong><div className="mobile-nav"><button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")} title="模型渠道价格对比"><LayoutDashboard size={17} /></button><button className={view === "check" ? "active" : ""} onClick={() => { setCheckPrefill(null); setView("check"); }} title="渠道检测"><Gauge size={17} /></button><button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")} title="渠道管理"><Settings2 size={17} /></button></div></header><div className="content-wrap">{view === "overview" ? <Overview data={data} loadedPages={loadedPages} onLoadPage={loadPage} onRefresh={refresh} isRefreshing={isRefreshing} status={status} onDetectChannel={openChannelCheck} /> : view === "check" ? <ChannelCheckView channels={channels} data={data} history={detectionHistory} onRecord={recordDetection} prefill={checkPrefill} /> : <SettingsView channels={channels} onSaveChannel={saveChannel} playwrightImport={playwrightImport} onStagePlaywrightImport={stagePlaywrightImport} onClearPlaywrightImport={clearPlaywrightImport} />}</div></main>
    </div>
  );
}

export default App;

createRoot(document.getElementById("root")).render(<App />);
