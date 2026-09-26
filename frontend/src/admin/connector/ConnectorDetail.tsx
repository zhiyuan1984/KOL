import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { auditTouchesConnector, governanceStatus, type AdminRow } from "../../adminGovernance";
import { connectorDisableConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { ConnectorCredentialVault } from "../../components/ConnectorCredentialVault";
import { auditEventLabel } from "../../labels";
import { errorMessage } from "../../runtimeConnectorUi";
import { ConnectorConfigCard } from "./ConnectorConfigCard";
import { ConnectorGrantsCard } from "./ConnectorGrantsCard";
import { ConnectorMark } from "./ConnectorMark";
import { ConnectorScopeCard } from "./ConnectorScopeCard";
import { ConnectorToolsCard } from "./ConnectorToolsCard";
import { connectorCardView, connectorStatusNote, kindLabel } from "./entity";
import "./connectorAdmin.css";

type ProbeRecord = {
  id: number;
  checked_at: string;
  status: string;
  probe_kind: "mcp_tools_list" | "http_definition";
  tool_count: number;
  duration_ms: number;
  error_code?: string | null;
};
type RunEvent = { id: number; ts: string; actor: string; event_type: string; payload: Record<string, unknown> };

function codeOf(cause: unknown): string {
  const payload = (cause as { payload?: { code?: unknown; error_code?: unknown } } | null)?.payload;
  if (typeof payload?.code === "string") return payload.code;
  if (typeof payload?.error_code === "string") return payload.error_code;
  return "";
}

function friendlyEnableFailure(code: string): string {
  if (code === "connector_verification_required") return "先完成一次通过的测试，连接器才会被允许启用。";
  if (code === "connector_tool_scope_required") return "先在接口或可用范围中设置至少一项范围授权，再启用。";
  return "";
}

function friendlyProbeFailure(code: string): string {
  if (code === "AbortError" || code === "request_aborted") return "测试已取消或连接中断；请确认服务可访问后重试。";
  if (code === "runtime_connector_disabled") return "连接器已停用，无法测试。请在完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先保存连接草稿。";
  return code ? `测试未通过；请检查已保存配置后重试（错误码：${code}）。` : "测试未通过；请检查已保存配置后重试。";
}

export function ConnectorDetail({ connectorId, connectors, users, auditRows, reload }: {
  connectorId: string;
  connectors: AdminRow[];
  users: AdminRow[];
  auditRows: AdminRow[];
  reload: () => void;
}) {
  const raw = connectors.find((row) => String(row.id) === connectorId);
  const card = raw ? connectorCardView(raw) : null;
  const { ask, dialog } = useAdminConfirm();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activity, setActivity] = useState<{ probes: ProbeRecord[]; events: RunEvent[] } | null>(null);
  const [activityError, setActivityError] = useState("");

  const loadActivity = useCallback(async () => {
    setActivityError("");
    try {
      setActivity(await api.runtimeConnectorActivity(connectorId));
    } catch (cause) {
      setActivityError(errorMessage(cause, "无法读取测试与治理记录"));
    }
  }, [connectorId]);
  useEffect(() => { void loadActivity(); }, [loadActivity]);

  if (!card) {
    return (
      <section className="admin-govern" data-admin-page="connector-detail">
        <p className="muted">未找到这条连接器。</p>
        <Link to="/admin/connectors">返回连接器目录</Link>
      </section>
    );
  }

  const status = governanceStatus(card);
  const recentGovernance = auditRows.filter((row) => auditTouchesConnector(row, card.id)).slice(-8).reverse();

  const probe = async () => {
    setBusy("probe");
    setError("");
    setNotice("");
    try {
      const result = await api.probeRuntimeConnector(connectorId);
      setNotice(result.notice || "测试完成。");
      reload();
    } catch (cause) {
      setError(friendlyProbeFailure(codeOf(cause)));
    } finally {
      setBusy("");
      void loadActivity();
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setBusy("enable");
    setError("");
    setNotice("");
    try {
      await api.adminSave(`/api/admin/connectors/${encodeURIComponent(card.id)}`, { enabled }, "PATCH");
      setNotice(enabled ? "连接器已启用。" : "连接器已停用。");
      reload();
    } catch (cause) {
      setError(friendlyEnableFailure(codeOf(cause)) || errorMessage(cause, "连接器状态未更新"));
    } finally {
      setBusy("");
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(card.id);
      setNotice(`已复制短名 ${card.id}。`);
    } catch {
      setError(`复制失败；请手动记录短名 ${card.id}。`);
    }
  };

  return (
    <section className="connector-detail" data-admin-page="connector-detail" data-connector-id={card.id} data-governance-status={status.key}>
      {dialog}
      <p className="admin-crumb"><Link to="/admin/connectors">连接器目录</Link> / {card.label}</p>
      <header className="panel connector-detail-hero">
        <ConnectorMark id={card.id} label={card.label} iconUrl={card.iconUrl} />
        <div className="connector-detail-title">
          <h2>{card.label}</h2>
          <p className="muted">
            {kindLabel(card.kind)} · 短名 <code>{card.id}</code> · {card.protocol === "mcp" ? "MCP" : "HTTP"}
          </p>
          <p>{card.purpose || "未填写业务用途"}</p>
          <p className="muted" data-connector-status-note>{connectorStatusNote(card)}</p>
        </div>
        <div className="connector-detail-actions">
          <span className={`admin-status is-${status.key}`}>{status.label}</span>
          <button type="button" className="btn" data-connector-copy-id onClick={() => void copyId()}>复制 ID</button>
          <button type="button" className="btn" data-connector-probe disabled={busy !== ""} onClick={() => void probe()}>
            {busy === "probe" ? "测试中…" : "测试连接"}
          </button>
          {card.enabled ? (
            <button
              type="button"
              className="btn danger"
              data-connector-disable
              disabled={busy !== ""}
              onClick={() => ask(connectorDisableConfirm(card.label, card.id), async () => { await setEnabled(false); })}
            >
              停用
            </button>
          ) : status.key === "verified" ? (
            <button type="button" className="btn work" data-connector-enable disabled={busy !== ""} onClick={() => void setEnabled(true)}>
              启用连接器
            </button>
          ) : null}
        </div>
      </header>

      {error && <p className="error" role="alert" data-connector-detail-error>{error}</p>}
      {notice && <p className="admin-receipt status-ok" role="status" data-connector-detail-notice>{notice}</p>}

      <ConnectorConfigCard card={card} reload={reload} />
      <ConnectorToolsCard connectorId={card.id} users={users} />
      <ConnectorScopeCard connectorId={card.id} users={users} />
      <ConnectorGrantsCard connector={{ id: card.id, label: card.label }} users={users} reload={reload} />

      <details className="panel connector-detail-card connector-disclosure">
        <summary><b>凭据引用</b><span className="muted">全局安全资产；秘密只在写入时提交，不能读取、复制或回显。</span></summary>
        <ConnectorCredentialVault />
      </details>

      <details className="panel connector-detail-card connector-disclosure" data-connector-audit>
        <summary><b>审计</b><span className="muted">本连接器的测试与治理记录；不显示秘密或凭据原值。</span></summary>
        {activityError && <p className="error" role="alert">{activityError}</p>}
        <div className="connector-audit-grid">
          <div>
            <strong>最近测试</strong>
            {activity && !activity.probes.length && <p className="muted">尚无测试记录。</p>}
            <ul className="connector-audit-list">
              {activity?.probes.slice(0, 6).map((record) => (
                <li key={record.id}>
                  <span>{record.status === "succeeded" ? "通过" : "失败"} · {record.probe_kind === "mcp_tools_list" ? "MCP 工具目录" : "HTTP 动作定义"}</span>
                  <small>{record.checked_at} · {record.tool_count} 个工具 · {record.duration_ms}ms{record.error_code ? ` · ${record.error_code}` : ""}</small>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong>治理与运行记录</strong>
            {!recentGovernance.length && activity && !activity.events.length && <p className="muted">暂无本连接器的治理记录。</p>}
            <ul className="connector-audit-list">
              {recentGovernance.map((row) => (
                <li key={`gov-${String(row.id)}`}>
                  <span>{auditEventLabel(String(row.event_type))}</span>
                  <small>{String(row.ts || "")} · {String(row.actor || "系统")}</small>
                </li>
              ))}
              {activity?.events.slice(0, 8).map((event) => (
                <li key={`run-${event.id}`}>
                  <span>{event.event_type}</span>
                  <small>{event.ts} · {event.actor === "usr_sriphy" ? "sriphy" : event.actor || "系统"}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
