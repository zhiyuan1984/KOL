import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Dropdown } from "antd";
import { api } from "../../api";
import { auditTouchesConnector, governanceStatus, type AdminRow } from "../../adminGovernance";
import { connectorDisableConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { useTransientReceipt } from "../../components/useTransientReceipt";
import { ProjectTheme } from "../../components/ProjectTheme";
import { auditEventLabel } from "../../labels";
import { errorMessage, remoteFailureMessage, type RuntimeConnectorConfig } from "../../runtimeConnectorUi";
import { ConnectorConfigCard } from "./ConnectorConfigCard";
import { ConnectorCredentialBindings } from "./ConnectorCredentialBindings";
import { ConnectorMark } from "./ConnectorMark";
import { ConnectorToolsCard } from "./ConnectorToolsCard";
import { friendlyEnableFailure } from "./connectorSetup";
import { connectorCardView, kindLabel } from "./entity";
import "./connectorAdmin.css";
import "./connectorDetail.css";

type ProbeRecord = {
  id: number;
  config_version?: number;
  checked_at: string;
  status: string;
  probe_kind: "mcp_tools_list" | "http_definition" | "mediacrawler_start";
  tool_count: number;
  duration_ms: number;
  error_code?: string | null;
};
type RunEvent = { id: number; ts: string; actor: string; event_type: string; payload: Record<string, unknown> };
type DetailProps = { connectorId: string; connectors: AdminRow[]; auditRows: AdminRow[]; reload: () => void };
const DETAIL_TABS = [
  { id: "config", label: "接入配置" },
  { id: "tools", label: "工具目录" },
  { id: "credentials", label: "凭据引用" },
  { id: "audit", label: "测试与审计" },
] as const;
type DetailTab = typeof DETAIL_TABS[number]["id"];
function isDetailTab(value: string | null): value is DetailTab {
  return DETAIL_TABS.some((tab) => tab.id === value);
}
// 时间统一 YYYY-MM-DD HH:mm（与向导、工具抽屉同一口径，不用斜杠与秒）。
function recordTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function codeOf(cause: unknown): string {
  const payload = (cause as { payload?: { code?: unknown; error_code?: unknown } } | null)?.payload;
  if (typeof payload?.code === "string") return payload.code;
  if (typeof payload?.error_code === "string") return payload.error_code;
  return "";
}
function friendlyProbeFailure(code: string): string {
  if (code === "AbortError" || code === "request_aborted") return "测试已取消或连接中断；请确认服务可访问后重试。";
  if (code === "runtime_connector_disabled") return "连接器已停用，无法测试。请在完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先保存连接草稿。";
  if (code === "runtime_endpoint_invalid") return "尚未填写 Base URL，或端点无效；请在接入配置中补齐后再测试。";
  const remote = remoteFailureMessage(code);
  if (remote) return remote;
  return code ? `测试未通过；请检查已保存配置后重试（错误码：${code}）。` : "测试未通过；请检查已保存配置后重试。";
}

// A different connector gets its own form, navigation and discovery state.
export function ConnectorDetail(props: DetailProps) {
  return <ProjectTheme><ConnectorDetailContent key={props.connectorId} {...props} /></ProjectTheme>;
}
function ConnectorDetailContent({ connectorId, connectors, auditRows, reload }: DetailProps) {
  const raw = connectors.find((row) => String(row.id) === connectorId);
  const card = raw ? connectorCardView(raw) : null;
  const { ask, dialog } = useAdminConfirm();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { receipt, showReceipt, clearReceipt } = useTransientReceipt();

  const [activity, setActivity] = useState<{ probes: ProbeRecord[]; events: RunEvent[] } | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(true);
  const [config, setConfig] = useState<RuntimeConnectorConfig | null>(null);
  const [configVersion, setConfigVersion] = useState<number | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [needsTest, setNeedsTest] = useState(false);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useRef({ searchParams, setSearchParams });
  navigation.current = { searchParams, setSearchParams };
  const defaultResolved = useRef(false);
  const requestedTab = searchParams.get("tab");
  const defaultTab: DetailTab = card && governanceStatus(card).key !== "draft" ? "tools" : "config";
  const activeTab: DetailTab = isDetailTab(requestedTab) ? requestedTab : defaultTab;
  const [visited, setVisited] = useState<Set<DetailTab>>(() => new Set([activeTab]));
  const root = useRef<HTMLElement | null>(null);
  const tabButtons = useRef<Partial<Record<DetailTab, HTMLButtonElement | null>>>({});
  const scrollPositions = useRef<Partial<Record<DetailTab, number>>>({});
  const previousTab = useRef(activeTab);
  const scrollHost = useRef<HTMLElement | null>(null);

  const onConfigLoaded = useCallback((saved: RuntimeConnectorConfig | null, version: number) => {
    setConfig(saved);
    setConfigVersion(version);
    if (!defaultResolved.current) {
      defaultResolved.current = true;
      const current = navigation.current;
      if (!isDetailTab(current.searchParams.get("tab"))) {
        const params = new URLSearchParams(current.searchParams);
        params.set("tab", version > 0 ? "tools" : "config");
        current.setSearchParams(params, { replace: true });
      }
    }
  }, []);
  useEffect(() => { setVisited((current) => current.has(activeTab) ? current : new Set([...current, activeTab])); }, [activeTab]);
  useEffect(() => {
    const tab = tabButtons.current[activeTab];
    const rail = tab?.parentElement;
    if (!tab || !rail) return;
    const button = tab.getBoundingClientRect();
    const viewport = rail.getBoundingClientRect();
    // Reveal only the horizontal tab strip; do not disturb the panel's saved scroll.
    if (button.left < viewport.left) rail.scrollLeft += button.left - viewport.left;
    else if (button.right > viewport.right) rail.scrollLeft += button.right - viewport.right;
  }, [activeTab]);
  // Keep each panel mounted after its first visit, including secret drafts in memory only.
  // Scroll belongs to the existing admin scroll container, not the document/iframe.
  useLayoutEffect(() => {
    let host = root.current?.parentElement || null;
    while (host && !/auto|scroll/.test(getComputedStyle(host).overflowY)) host = host.parentElement;
    scrollHost.current = host;
    if (previousTab.current !== activeTab && host) {
      host.scrollTop = scrollPositions.current[activeTab] || 0;
    }
    previousTab.current = activeTab;
    const remember = () => { if (host) scrollPositions.current[activeTab] = host.scrollTop; };
    host?.addEventListener("scroll", remember, { passive: true });
    return () => host?.removeEventListener("scroll", remember);
  }, [activeTab]);
  useEffect(() => {
    if (!configDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [configDirty]);

  const selectTab = (id: DetailTab, focus = false) => {
    if (id !== activeTab) {
      if (scrollHost.current) scrollPositions.current[activeTab] = scrollHost.current.scrollTop;
      setVisited((current) => new Set([...current, id]));
      const params = new URLSearchParams(searchParams);
      params.set("tab", id);
      setSearchParams(params);
    }
    if (focus) requestAnimationFrame(() => tabButtons.current[id]?.focus({ preventScroll: true }));
  };
  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try { setActivity(await api.runtimeConnectorActivity(connectorId)); }
    catch (cause) { setActivityError(errorMessage(cause, "无法读取测试与治理记录")); }
    finally { setActivityLoading(false); }
  }, [connectorId]);
  useEffect(() => { void loadActivity(); }, [loadActivity]);

  if (!card) return (
    <section className="admin-govern" data-admin-page="connector-detail">
      <p className="muted">未找到这条连接器。</p><Link to="/admin/connectors">返回连接器目录</Link>
    </section>
  );
  const status = governanceStatus(card);
  const recentGovernance = auditRows.filter((row) => auditTouchesConnector(row, card.id)).slice(-8).reverse();
  const latestProbe = activity?.probes[0];
  const outdatedProbe = needsTest || (latestProbe?.config_version !== undefined && configVersion !== null && latestProbe.config_version !== configVersion);
  const testStatus = outdatedProbe ? "配置已更新，待重新测试"
    : activityError ? "测试记录读取失败"
    : latestProbe ? latestProbe.status === "succeeded" ? "最近测试通过" : "最近测试失败"
    : activityLoading ? "测试记录读取中" : "尚未测试";
  const probe = async () => {
    if (configDirty && !window.confirm("接入配置有未保存改动。本次测试只使用服务端已保存配置，不包含当前草稿。是否继续测试？")) return;
    setBusy("probe"); setError(""); clearReceipt();
    try {
      const result = await api.probeRuntimeConnector(connectorId);
      setNeedsTest(false);
      showReceipt(result.notice || "测试完成。");
      reload();
    } catch (cause) { setError(friendlyProbeFailure(codeOf(cause))); }
    finally { setBusy(""); void loadActivity(); }
  };
  const setEnabled = async (enabled: boolean) => {
    setBusy("enable"); setError(""); clearReceipt();
    try {
      await api.adminSave(`/api/admin/connectors/${encodeURIComponent(card.id)}`, { enabled }, "PATCH");
      showReceipt(enabled ? "连接器已启用。" : "连接器已停用。");
      reload();
    } catch (cause) {
      const code = codeOf(cause);
      setError(friendlyEnableFailure(code) || errorMessage(cause, "连接器状态未更新"));
    } finally { setBusy(""); }
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(card.id); showReceipt(`已复制标识 ${card.id}。`); }
    catch { setError(`复制失败；请手动记录标识 ${card.id}。`); }
  };
  const panelProps = (id: DetailTab) => ({
    id: `connector-panel-${card.id}-${id}`,
    role: "tabpanel",
    "aria-labelledby": `connector-tab-${card.id}-${id}`,
    hidden: activeTab !== id,
    className: "connector-detail-panel",
    tabIndex: 0,
    "data-connector-detail-panel": id,
  });

  return (
    <section ref={root} className="connector-detail" data-admin-page="connector-detail" data-connector-id={card.id} data-governance-status={status.key}>
      {dialog}
      <p className="admin-crumb"><Link to="/admin/connectors">连接器目录</Link> / {card.label}</p>
      <header className="panel connector-detail-hero">
        <ConnectorMark id={card.id} label={card.label} iconUrl={card.iconUrl} />
        <div className="connector-detail-title">
          <h2>{card.label}</h2>
          <p className="muted">{kindLabel(card.kind)} · 标识 <code>{card.id}</code> · {card.protocol === "mcp" ? "MCP" : "HTTP"}</p>
          <p>{card.purpose || "未填写业务用途"}</p>
          <p className="connector-detail-test-status muted" data-connector-status-note>
            <span className={`admin-status is-${card.enabled ? "enabled" : "disabled"}`}>{card.enabled ? "已启用" : "未启用"}</span>
            <span data-connector-test-status>{testStatus}</span>
            {latestProbe && !outdatedProbe && <small>{recordTime(latestProbe.checked_at)} · {latestProbe.duration_ms}ms</small>}
          </p>
        </div>
        <div className="connector-detail-actions">
          <button type="button" className={activeTab === "config" || (!card.enabled && status.key === "verified") ? "btn text" : "btn work"} data-connector-probe disabled={busy !== ""} aria-busy={busy === "probe"} onClick={() => void probe()}>{busy === "probe" ? "测试中…" : "测试连接"}</button>
          {!card.enabled && status.key === "verified" && <button type="button" className={activeTab === "config" ? "btn text" : "btn work"} data-connector-enable disabled={busy !== "" || needsTest} onClick={() => void setEnabled(true)}>启用连接器</button>}
          <Dropdown trigger={["click"]} menu={{ items: [
            { key: "copy", label: <span data-connector-copy-id>复制标识</span>, onClick: () => void copyId() },
            ...(card.enabled ? [{ key: "disable", danger: true, disabled: busy !== "", label: <span data-connector-disable>停用连接器</span>, onClick: () => ask(connectorDisableConfirm(card.label, card.id), async () => { await setEnabled(false); }) }] : []),
          ] }}>
            <button type="button" className="btn text" aria-label="连接器更多操作" data-connector-more>更多操作</button>
          </Dropdown>
        </div>
      </header>
      {error && <p className="error" role="alert" data-connector-detail-error>{error}</p>}
      {receipt.text && (
        <p
          className={"admin-receipt is-transient" + (receipt.visible ? " is-visible" : "") + " status-ok"}
          role="status"
          aria-live="polite"
          data-connector-detail-notice
        >
          {receipt.text}
        </p>
      )}
      {configDirty && activeTab !== "config" && <p className="connector-config-dirty-note muted" role="status">接入配置有未保存改动，草稿已保留；测试使用已保存配置。<button type="button" className="btn text" onClick={() => selectTab("config")}>返回配置</button></p>}
      <p className="muted" data-connector-usage-note>启用只代表连接器可用；人员资格由 Agent 绑定决定，哪些技能能调用由技能页的挂载决定。</p>
      <div className="connector-detail-tabs" role="tablist" aria-label="连接器管理导航" data-connector-detail-tabs>
        {DETAIL_TABS.map((tab, index) => <button
          key={tab.id} ref={(node) => { tabButtons.current[tab.id] = node; }}
          type="button" role="tab" id={`connector-tab-${card.id}-${tab.id}`}
          aria-selected={activeTab === tab.id} aria-controls={`connector-panel-${card.id}-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1} data-connector-detail-tab={tab.id}
          onClick={() => selectTab(tab.id)}
          onKeyDown={(event) => {
            let target: DetailTab | null = null;
            if (event.key === "ArrowRight") target = DETAIL_TABS[(index + 1) % DETAIL_TABS.length].id;
            if (event.key === "ArrowLeft") target = DETAIL_TABS[(index - 1 + DETAIL_TABS.length) % DETAIL_TABS.length].id;
            if (event.key === "Home") target = DETAIL_TABS[0].id;
            if (event.key === "End") target = DETAIL_TABS[DETAIL_TABS.length - 1].id;
            if (target) { event.preventDefault(); selectTab(target, true); }
          }}
        >
          <span className="connector-detail-tab-label">{tab.label}</span>
          {tab.id === "tools" && toolCount !== null && <span className="connector-detail-tab-count" aria-label={`${toolCount} 个工具`}>{toolCount}</span>}
          {tab.id === "config" && configDirty && <span className="connector-detail-tab-count">未保存</span>}
        </button>)}
      </div>
      <div {...panelProps("config")}>
        <ConnectorConfigCard card={card} reload={reload} onConfigLoaded={onConfigLoaded} onDirtyChange={setConfigDirty} onSaved={() => { setNeedsTest(true); void loadActivity(); }} />
      </div>
      <div {...panelProps("tools")}>
        {(visited.has("tools") || activeTab === "tools") && <ConnectorToolsCard connectorId={card.id} onToolCountChange={setToolCount} />}
      </div>
      <div {...panelProps("credentials")}>
        {(visited.has("credentials") || activeTab === "credentials") && <ConnectorCredentialBindings config={config} configVersion={configVersion} configLoaded={configVersion !== null} onOpenConfig={() => selectTab("config")} />}
      </div>
      <div {...panelProps("audit")}>
        <section className="panel connector-detail-card" data-connector-audit>
          <div className="connector-card-head"><div><h3>测试与审计</h3><p className="muted">测试只验证目录或已定义接口，不代表业务动作可用；记录不显示秘密或凭据原值。</p></div><button type="button" className="btn text" disabled={activityLoading} aria-busy={activityLoading} data-connector-audit-refresh onClick={() => void loadActivity()}>{activityLoading ? "读取中…" : "刷新记录"}</button></div>
          {activityLoading && <p className="muted" role="status">正在读取测试与治理记录…</p>}
          {activityError && <div role="alert"><p className="error">{activityError}</p><button type="button" className="btn text" disabled={activityLoading} onClick={() => void loadActivity()}>重试读取记录</button></div>}
          {activityError && activity && <p className="muted">以下为上一次成功读取的记录，可能已过期。</p>}
          <div className="connector-audit-grid">
            <section className="connector-audit-section" aria-label="连接测试记录"><h4>连接测试记录</h4>
              {activity && !activity.probes.length && <p className="muted">尚无测试记录。</p>}
              <ul className="connector-audit-list">{activity?.probes.slice(0, 6).map((record) => <li key={record.id}>
                <div className="connector-audit-record-head"><span className={"connector-audit-result " + (record.status === "succeeded" ? "status-ok" : "status-warn")}>{record.status === "succeeded" ? "通过" : "失败"}</span><span>{record.probe_kind === "mediacrawler_start" ? "MediaCrawler 实际采集" : record.probe_kind === "mcp_tools_list" ? "MCP 工具目录" : "HTTP 动作定义"}</span></div>
                <div className="connector-audit-record-meta muted"><time dateTime={record.checked_at}>{recordTime(record.checked_at)}</time><span>{record.probe_kind === "mediacrawler_start" ? "历史采集测试" : `${record.tool_count} 个工具`}</span><span>{record.duration_ms} ms</span>{record.config_version !== undefined && <span>配置 v{record.config_version}</span>}</div>
                {record.error_code && <code className="connector-audit-error-code">{record.error_code}</code>}
              </li>)}</ul>
            </section>
            <section className="connector-audit-section" aria-label="配置与治理记录"><h4>配置与治理记录</h4>
              {!recentGovernance.length && activity && !activity.events.length && <p className="muted">暂无本连接器的治理记录。</p>}
              <ul className="connector-audit-list">
                {recentGovernance.map((row) => <li key={`gov-${String(row.id)}`}><div className="connector-audit-record-head">{auditEventLabel(String(row.event_type))}</div><div className="connector-audit-record-meta muted"><time dateTime={String(row.ts || "")}>{recordTime(String(row.ts || ""))}</time><span>{String(row.actor || "系统")}</span></div></li>)}
                {activity?.events.slice(0, 8).map((event) => <li key={`run-${event.id}`}><div className="connector-audit-record-head">{auditEventLabel(event.event_type)}</div><div className="connector-audit-record-meta muted"><time dateTime={event.ts}>{recordTime(event.ts)}</time><span>{event.actor === "usr_sriphy" ? "sriphy" : event.actor || "系统"}</span></div></li>)}
              </ul>
            </section>
          </div>
        </section>
      </div>
    </section>
  );
}
