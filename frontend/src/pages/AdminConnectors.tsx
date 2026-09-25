import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  accessFor,
  auditTouchesConnector,
  connectorPurpose,
  governanceStatus,
  grantCountFor,
  isStarryConnector,
  publicConnectorView,
  rowTitle,
  type AdminRow,
  type PublicConnector,
} from "../adminGovernance";
import { auditEventLabel } from "../labels";
import { connectorDisableConfirm, credentialRefConfirm, grantReadConfirm, grantRevokeConfirm, grantWriteConfirm } from "../adminConfirm";
import { useAdminConfirm, type AskAdminConfirm } from "../components/ConfirmDialog";
import { ConnectorRuntimeSettings } from "../components/ConnectorRuntimeSettings";
import { ConnectorCredentialVault } from "../components/ConnectorCredentialVault";

type SaveFn = (path: string, body: AdminRow, message: string, method?: string) => Promise<void>;

const MANAGED_ORDER = ["claw", "starrykol"];

function displayActor(value: unknown): string {
  const actor = String(value || "").trim();
  if (!actor || actor === "system") return "系统";
  return actor === "usr_sriphy" ? "sriphy" : actor;
}

function verificationCopy(connector: PublicConnector): string {
  const status = governanceStatus(connector).key;
  if (status === "enabled") return "已启用；保留最近验证记录，异常时请重新测试。";
  if (status === "verified") return "测试已通过。确认访问控制后即可启用。";
  if (status === "error") return "最近一次验证未通过。请检查已保存配置后重新测试。";
  if (status === "pending") return "配置已保存，下一步请测试连接。";
  return "尚未保存接入配置。先完成连接草稿。";
}

export function AdminConnectorsHub({
  connectors,
  users,
  onSave,
}: {
  connectors: AdminRow[];
  users: AdminRow[];
  onSave: SaveFn;
}) {
  const rows = useMemo(() => connectors
    .map(publicConnectorView)
    .filter((row) => MANAGED_ORDER.includes(row.id))
    .sort((a, b) => MANAGED_ORDER.indexOf(a.id) - MANAGED_ORDER.indexOf(b.id)), [connectors]);
  const { ask, dialog } = useAdminConfirm();

  return (
    <section className="admin-govern" data-admin-page="connectors">
      {dialog}
      <div className="panel connector-hub-intro">
        <div className="admin-section-head">
          <div>
            <h2>连接器枢纽</h2>
            <p className="muted">仅管理两条已批准的 MCP。秘密原值不会在此显示；状态以最近一次已保存配置的验证结果为准。</p>
          </div>
        </div>
        <ol className="connector-stepper" aria-label="连接器启用流程">
          <li>保存接入</li><li>测试连接</li><li>审阅工具</li><li>设置访问</li><li>启用</li>
        </ol>
      </div>

      {!rows.length ? (
        <div className="panel connector-loading" role="status" data-admin-connectors-loading>
          正在读取受管连接器目录与最近验证状态…
        </div>
      ) : (
        <div className="panel">
          <div className="admin-section-head">
            <div>
              <h2>受管目录</h2>
              <p className="muted">状态、最近验证与授权人数支持快速排查；错误详情只在各连接器的技术记录中按需查看。</p>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table connector-catalog-table" data-admin-connectors-table>
              <thead>
                <tr>
                  <th>连接器</th>
                  <th>接入状态</th>
                  <th>最近验证</th>
                  <th>工具治理</th>
                  <th>授权人数</th>
                  <th>最近变更</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((connector) => (
                  <ConnectorHubRow key={connector.id} connector={connector} users={users} onSave={onSave} ask={ask} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted admin-note">环境变量、Secret 引用和工具审批均在详情内受控维护；不接受在浏览器粘贴 API Key、JWT 或 Bearer。</p>
        </div>
      )}
    </section>
  );
}

function ConnectorHubRow({
  connector,
  users,
  onSave,
  ask,
}: {
  connector: PublicConnector;
  users: AdminRow[];
  onSave: SaveFn;
  ask: AskAdminConfirm;
}) {
  const status = governanceStatus(connector);
  const grants = grantCountFor(connector.id, users);
  const enable = () => void onSave(`/api/admin/connectors/${connector.id}`, { enabled: true }, "连接器已启用", "PATCH");
  return (
    <tr data-connector={connector.id} data-governance-status={status.key}>
      <td><strong>{connector.label}</strong><p className="muted">{connectorPurpose(connector.id)}</p></td>
      <td><span className={`admin-status is-${status.key}`}>{status.label}</span><p className="muted">{verificationCopy(connector)}</p></td>
      <td>{connector.lastVerifiedAt || "尚未验证"}</td>
      <td>{status.key === "pending" || status.key === "draft" ? "待审阅" : "在详情中管理"}</td>
      <td>{grants}</td>
      <td>{connector.updatedAt || "—"}</td>
      <td className="admin-inline-actions">
        {connector.enabled ? (
          <button type="button" className="btn sm danger" data-admin-connector-action="disable" onClick={() => ask(
            connectorDisableConfirm(connector.label, connector.id),
            () => onSave(`/api/admin/connectors/${connector.id}`, { enabled: false }, "连接器已停用", "PATCH"),
          )}>停用</button>
        ) : status.key === "verified" ? (
          <button type="button" className="btn sm work" data-admin-connector-action="enable" onClick={enable}>启用</button>
        ) : null}
        <Link className="btn ghost sm" to={`/admin/connectors/${encodeURIComponent(connector.id)}`}>查看并配置</Link>
      </td>
    </tr>
  );
}

export function AdminConnectorDetail({
  connectorId,
  connectors,
  users,
  auditRows,
  onSave,
}: {
  connectorId: string;
  connectors: AdminRow[];
  users: AdminRow[];
  auditRows: AdminRow[];
  onSave: SaveFn;
}) {
  const raw = connectors.find((row) => String(row.id) === connectorId);
  const connector = raw ? publicConnectorView(raw) : null;
  const [refDraft, setRefDraft] = useState("");
  const { ask, dialog } = useAdminConfirm();

  if (!connector) {
    return <section className="admin-govern" data-admin-page="connector-detail"><p className="muted">未找到这条受管连接器。</p><Link to="/admin/connectors">返回连接器枢纽</Link></section>;
  }

  const status = governanceStatus(connector);
  const recent = auditRows.filter((row) => auditTouchesConnector(row, connector.id)).slice(-12).reverse();
  const submitRef = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = refDraft.trim();
    if (!next) return;
    ask(credentialRefConfirm(connector.label, connector.id), () =>
      onSave(`/api/admin/connectors/${connector.id}`, { credential_ref: next }, "凭据引用已更新", "PATCH").then(() => setRefDraft("")),
    );
  };

  return (
    <section className="admin-govern" data-admin-page="connector-detail" data-connector-id={connector.id}>
      {dialog}
      <p className="admin-crumb"><Link to="/admin/connectors">连接器枢纽</Link> / {connector.label}</p>
      <div className="panel connector-detail-summary">
        <div className="admin-section-head">
          <div><h2>{connector.label}</h2><p className="muted">{connectorPurpose(connector.id)}</p></div>
          <span className={`admin-status is-${status.key}`}>{status.label}</span>
        </div>
        <dl className="admin-kv">
          <div><dt>当前下一步</dt><dd>{verificationCopy(connector)}</dd></div>
          <div><dt>最近验证</dt><dd>{connector.lastVerifiedAt || "尚未验证"}</dd></div>
          <div><dt>凭据引用</dt><dd>{connector.credentialRegistered ? "已登记（原值不回显）" : "尚未登记"}</dd></div>
        </dl>
        <div className="admin-actions">
          {connector.enabled && <button type="button" className="btn danger" data-admin-connector-action="disable" onClick={() => ask(
            connectorDisableConfirm(connector.label, connector.id),
            () => onSave(`/api/admin/connectors/${connector.id}`, { enabled: false }, "连接器已停用", "PATCH"),
          )}>停用</button>}
          {!connector.enabled && status.key === "verified" && <button type="button" className="btn work" data-admin-connector-action="enable" onClick={() => void onSave(`/api/admin/connectors/${connector.id}`, { enabled: true }, "连接器已启用", "PATCH")}>启用连接器</button>}
        </div>
      </div>

      <details className="panel connector-disclosure" open>
        <summary><strong>1. 接入、测试与工具治理</strong><span>保存配置后测试；工具默认不获批。</span></summary>
        <div id="connector-connection" className="connector-disclosure-body"><ConnectorRuntimeSettings connectorId={connector.id} /></div>
      </details>

      <details className="panel connector-disclosure">
        <summary><strong>安全与凭据</strong><span>仅维护引用和保险库元数据，秘密不会回显。</span></summary>
        <div className="connector-disclosure-body">
          <form className="settings-form connector-reference-form" onSubmit={submitRef}>
            <h3>当前连接器的凭据引用</h3>
            <p className="muted">填写引用位置而非 Token。更新后需重新测试，才能再次启用。</p>
            <label className="field">新引用<input value={refDraft} onChange={(event) => setRefDraft(event.target.value)} autoComplete="off" placeholder="credential 位置，不是秘密原值" /></label>
            <button className="btn work" data-admin-credential-ref disabled={!refDraft.trim()}>更新引用</button>
          </form>
          <ConnectorCredentialVault />
        </div>
      </details>

      <details className="panel connector-disclosure">
        <summary><strong>访问控制</strong><span>{grantCountFor(connector.id, users)} 名员工已获授权。</span></summary>
        <div className="connector-disclosure-body"><ConnectorGrantTable connectorId={connector.id} connectorLabel={connector.label} users={users} onSave={onSave} ask={ask} /></div>
      </details>

      {isStarryConnector(connector.id) && <div className="panel connector-context-note" data-admin-starry-policy>
        <h2>个人邮箱绑定边界</h2>
        <p className="muted">组织管理员只管理本连接器的接入、工具和人员访问；每位员工的跟进邮箱在个人设置中自行绑定，管理员不会在此查看或编辑个人密钥。</p>
        <Link className="btn ghost sm" to="/settings?tab=starry">查看个人绑定入口</Link>
      </div>}

      <details className="panel connector-disclosure">
        <summary><strong>历史与审计</strong><span>显示这条连接器最近的治理变更。</span></summary>
        <div className="connector-disclosure-body">
          {!recent.length && <p className="muted">暂无本连接器的启用、验证、引用或授权记录。</p>}
          {recent.map((row) => <article className="admin-row" key={String(row.id)}>
            <div><strong>{auditEventLabel(String(row.event_type))}</strong><p className="muted">{String(row.ts || "")} · {displayActor(row.actor)}</p></div>
          </article>)}
        </div>
      </details>
    </section>
  );
}

function ConnectorGrantTable({
  connectorId,
  connectorLabel,
  users,
  onSave,
  ask,
}: {
  connectorId: string;
  connectorLabel: string;
  users: AdminRow[];
  onSave: SaveFn;
  ask: AskAdminConfirm;
}) {
  const setAccess = (user: AdminRow, access: "read" | "write" | "") => {
    const userId = String(user.id || "");
    if (!access) {
      ask(grantRevokeConfirm(rowTitle(user), connectorLabel), () => onSave(`/api/admin/users/${userId}/connectors/${connectorId}`, {}, "连接器授权已收回", "DELETE"));
      return;
    }
    const confirm = access === "write" ? grantWriteConfirm(rowTitle(user), connectorLabel) : grantReadConfirm(rowTitle(user), connectorLabel);
    ask(confirm, () => onSave(`/api/admin/users/${userId}/connectors/${connectorId}`, { access }, "连接器授权已保存"));
  };
  return <section className="connector-grants">
    <h3>员工访问级别</h3>
    <p className="muted">选择“无访问 / 只读 / 可写”。可写不等于发信、改阶段或绕过 Gateway。</p>
    <div className="admin-table-wrap"><table className="admin-table" data-admin-grants={connectorId}><thead><tr><th>员工</th><th>有效权限</th><th scope="col">访问级别</th></tr></thead><tbody>
      {users.map((user) => {
        const access = accessFor(user, connectorId);
        const value = access === "write" || access === "admin" ? "write" : access === "read" ? "read" : "";
        const uid = String(user.id || "");
        return <tr key={uid} data-grant-user={uid}><td><strong>{rowTitle(user)}</strong><p className="muted">{String(user.email || user.username || "")}</p></td><td>{value === "write" ? "可写（含只读）" : value === "read" ? "只读" : "无访问"}</td><td><label className="sr-only" htmlFor={`grant-${connectorId}-${uid}`}>{rowTitle(user)} 的访问级别</label><select id={`grant-${connectorId}-${uid}`} value={value} onChange={(event) => setAccess(user, event.target.value as "read" | "write" | "")}><option value="">无访问</option><option value="read">只读</option><option value="write">可写</option></select></td></tr>;
      })}
    </tbody></table></div>
    {!users.length && <p className="muted">暂无员工。</p>}
  </section>;
}
