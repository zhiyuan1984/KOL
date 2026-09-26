import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auditTouchesConnector, connectorPurpose, governanceStatus, publicConnectorView, rowTitle, type AdminRow, type PublicConnector } from "../adminGovernance";
import { connectorDisableConfirm } from "../adminConfirm";
import { useAdminConfirm, type AskAdminConfirm } from "../components/ConfirmDialog";
import { ConnectorRuntimeSettings } from "../components/ConnectorRuntimeSettings";
import { auditEventLabel } from "../labels";

type SaveFn = (path: string, body: AdminRow, message: string, method?: string) => Promise<void>;

function statusNote(connector: PublicConnector): string {
  const status = governanceStatus(connector).key;
  if (status === "enabled") return "连接已启用；工具仍受逐项范围约束。";
  if (status === "verified") return "连接已验证；完成工具治理与范围后可启用。";
  if (status === "pending") return "连接信息已保存；下一步测试工具目录。";
  if (status === "error") return "最近测试未通过；修正连接信息后重试。";
  return "尚未接入；先完成连接与测试。";
}

function actionLabel(connector: PublicConnector): string {
  const status = governanceStatus(connector).key;
  if (status === "draft") return "开始接入";
  if (status === "pending" || status === "error") return "继续配置";
  if (status === "verified") return "审阅工具并启用";
  return "查看治理";
}

export function AdminConnectorsHub({ connectors, onSave }: { connectors: AdminRow[]; users: AdminRow[]; onSave: SaveFn }) {
  const rows = useMemo(() => connectors.map(publicConnectorView)
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")), [connectors]);
  const [openCreate, setOpenCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("id") || "").trim();
    const label = String(form.get("label") || "").trim();
    const purpose = String(form.get("purpose") || "").trim();
    setCreating(true); setCreateError("");
    try { await onSave("/api/admin/connectors", { id, label, purpose }, `已将“${label}”加入连接器目录`, "POST"); setOpenCreate(false); }
    catch (error) { setCreateError(error instanceof Error ? error.message : "新增连接器失败"); }
    finally { setCreating(false); }
  };
  return <section className="admin-govern connector-directory" data-admin-page="connectors">
    <div className="connector-directory-head">
      <div><p className="page-kicker">连接器治理</p><h2>连接器目录</h2><p className="muted">当前显示已加入组织目录的 MCP。可继续新增受管 MCP；每一条都必须依次完成连接验证、工具治理和组织范围设置后才可启用。</p></div>
      <button type="button" className="btn" onClick={() => setOpenCreate((value) => !value)}>{openCreate ? "收起新增表单" : "从目录新增 MCP"}</button>
    </div>
    <div className="connector-directory-notice"><strong>管理员负责治理</strong><span>配置权限不等于工具调用权限；调用仍要求员工当前连接器授权与工具范围。L3 动作继续经过确认与 Host Gateway。</span></div>
    {openCreate && <form className="connector-create-form" onSubmit={(event) => void add(event)}><div><h3>新增受管 MCP</h3><p className="muted">先加入目录，再完成连接、测试、工具与范围治理。短名称创建后不可修改。</p></div><label className="field">显示名称<input name="label" required maxLength={120} placeholder="例如：供应链 MCP" /></label><label className="field">短名称<input name="id" required pattern="[a-z][a-z0-9_-]{2,63}" placeholder="supply_chain" /><small>仅小写字母、数字、连字符或下划线。</small></label><label className="field connector-create-purpose">业务用途<textarea name="purpose" required maxLength={280} placeholder="说明此 MCP 提供的组织业务能力" /></label>{createError && <p className="error">{createError}</p>}<div className="admin-actions"><button className="btn work" disabled={creating}>{creating ? "正在加入…" : "加入目录"}</button></div></form>}
    {!rows.length ? <div className="panel connector-loading" role="status">正在读取连接器目录…</div> : <div className="connector-directory-list" data-admin-connectors-table>{rows.map((connector) => <ConnectorDirectoryRow key={connector.id} connector={connector} />)}</div>}
  </section>;
}

function ConnectorDirectoryRow({ connector }: { connector: PublicConnector }) {
  const status = governanceStatus(connector);
  return <article className="connector-directory-row" data-connector={connector.id} data-governance-status={status.key}>
    <div className="connector-directory-mark">MCP</div>
    <div className="connector-directory-title"><strong>{connector.label}</strong><p>{connectorPurpose(connector.purpose)}</p></div>
    <div><span className={`admin-status is-${status.key}`}>{status.label}</span><p className="muted">{statusNote(connector)}</p></div>
    <div className="connector-directory-fact"><strong>{connector.lastVerifiedAt ? "已验证" : "尚未测试"}</strong><p>{connector.lastVerifiedAt || "读取工具清单后显示验证记录"}</p></div>
    <div className="connector-directory-fact"><strong>适用范围</strong><p>在工具治理中按部门、岗位或个人设置</p></div>
    <Link className="btn" to={`/admin/connectors/${encodeURIComponent(connector.id)}`}>{actionLabel(connector)}</Link>
  </article>;
}

export function AdminConnectorDetail({ connectorId, connectors, users, auditRows, onSave }: { connectorId: string; connectors: AdminRow[]; users: AdminRow[]; auditRows: AdminRow[]; onSave: SaveFn }) {
  const raw = connectors.find((row) => String(row.id) === connectorId);
  const connector = raw ? publicConnectorView(raw) : null;
  const { ask, dialog } = useAdminConfirm();
  if (!connector) return <section className="admin-govern" data-admin-page="connector-detail"><p className="muted">未找到这条连接器。</p><Link to="/admin/connectors">返回连接器目录</Link></section>;
  const status = governanceStatus(connector);
  const recent = auditRows.filter((row) => auditTouchesConnector(row, connector.id)).slice(-12).reverse();
  const enable = () => void onSave(`/api/admin/connectors/${connector.id}`, { enabled: true }, "连接器已启用", "PATCH");
  return <section className="admin-govern connector-detail" data-admin-page="connector-detail" data-connector-id={connector.id}>
    {dialog}<p className="admin-crumb"><Link to="/admin/connectors">连接器目录</Link> / {connector.label}</p>
    <header className="connector-detail-hero"><div><p className="page-kicker">受管 MCP 连接器</p><h2>{connector.label}</h2><p>{connectorPurpose(connector.purpose)}</p></div><div className="connector-detail-actions"><span className={`admin-status is-${status.key}`}>{status.label}</span>{connector.enabled ? <button type="button" className="btn danger" onClick={() => ask(connectorDisableConfirm(connector.label, connector.id), () => onSave(`/api/admin/connectors/${connector.id}`, { enabled: false }, "连接器已停用", "PATCH"))}>停用</button> : status.key === "verified" ? <button type="button" className="btn work" onClick={enable}>启用连接器</button> : null}</div></header>
    <section className="panel connector-generic-setup"><ConnectorRuntimeSettings connectorId={connector.id} users={users} /></section>
    <details className="panel connector-disclosure"><summary><strong>技术与审计</strong><span>仅在需要排障时查看；不显示秘密或凭据原值。</span></summary><div className="connector-disclosure-body">{!recent.length ? <p className="muted">暂无本连接器的治理记录。</p> : recent.map((row) => <article className="admin-row" key={String(row.id)}><div><strong>{auditEventLabel(String(row.event_type))}</strong><p className="muted">{String(row.ts || "")} · {rowTitle(row.actor ? { name: row.actor } : row)}</p></div></article>)}</div></details>
  </section>;
}
