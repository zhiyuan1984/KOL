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

type SaveFn = (path: string, body: AdminRow, message: string, method?: string) => Promise<void>;

export function AdminConnectorsHub({
  connectors,
  users,
  hiddenConnectors,
  onSave,
}: {
  connectors: AdminRow[];
  users: AdminRow[];
  hiddenConnectors: string[];
  onSave: SaveFn;
}) {
  const rows = useMemo(() => connectors.map(publicConnectorView).filter((row) => row.id), [connectors]);

  return (
    <section className="admin-govern" data-admin-page="connectors">
      <div className="panel">
        <div className="admin-section-head">
          <div>
            <h2>连接器枢纽</h2>
            <p className="muted">组织现在挂了哪些连接器、是否启用、凭据是否已登记。秘密原值永不回显。</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="muted" data-admin-empty="connectors">尚未挂接</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-connectors-table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>业务用途</th>
                  <th>状态</th>
                  <th>凭据</th>
                  <th>授权人数</th>
                  <th>最近错误</th>
                  <th>启用</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((connector) => (
                  <ConnectorHubRow key={connector.id} connector={connector} users={users} onSave={onSave} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted admin-note">进程级 URL / API Key 仍在 Host 环境变量，不在本页粘贴。用户 JWT 不要填进凭据位置。</p>
        {hiddenConnectors.length > 0 && (
          <div className="admin-todo" data-admin-hidden-connectors>
            <strong>本期不挂接</strong>
            {hiddenConnectors.map((name) => (
              <p key={name} className="muted" data-hidden-connector={name}>{name} · 本期隐藏</p>
            ))}
          </div>
        )}
      </div>
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void onSave("/api/admin/connectors", {
            id: d.get("id"),
            label: d.get("label"),
            credential_ref: d.get("credential_ref"),
          }, "连接器已创建", "POST");
          e.currentTarget.reset();
        }}
      >
        <h2>新增连接器</h2>
        <label className="field">显示名<input name="label" required /></label>
        <label className="field">短名称<input name="id" pattern="[a-z0-9_-]+" required placeholder="仅英文小写，创建后员工看不到" /></label>
        <label className="field">凭据位置<input name="credential_ref" placeholder="选填，位置不是原值，提交后不回显" autoComplete="off" /></label>
        <button className="btn work">创建</button>
      </form>
    </section>
  );
}

function ConnectorHubRow({
  connector,
  users,
  onSave,
}: {
  connector: PublicConnector;
  users: AdminRow[];
  onSave: SaveFn;
}) {
  const status = governanceStatus(connector);
  const purpose = connectorPurpose(connector.id);
  const grants = grantCountFor(connector.id, users);
  return (
    <tr data-connector={connector.id} data-governance-status={status.key}>
      <td><strong>{connector.label}</strong></td>
      <td>{purpose || <span className="muted">未登记用途（connectors 表无 purpose 字段）</span>}</td>
      <td><span className={"admin-status is-" + status.key}>{status.label}</span></td>
      <td>{connector.credentialRegistered ? "已登记" : "未登记"}</td>
      <td>{grants}</td>
      <td>
        {connector.lastError
          ? connector.lastError
          : <span className="muted" data-todo="connector-last-error">— · TODO：后端尚未提供 last_error</span>}
      </td>
      <td>
        <button
          type="button"
          className="btn sm"
          onClick={() => void onSave(`/api/admin/connectors/${connector.id}`, { enabled: !connector.enabled }, "连接器已更新", "PATCH")}
        >
          {connector.enabled ? "停用" : "启用"}
        </button>
      </td>
      <td><Link className="btn ghost sm" to={`/admin/connectors/${encodeURIComponent(connector.id)}`}>详情</Link></td>
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

  if (!connector) {
    return (
      <section className="admin-govern" data-admin-page="connector-detail">
        <p className="muted">未找到连接器「{connectorId}」。</p>
        <Link to="/admin/connectors">返回枢纽</Link>
      </section>
    );
  }

  const status = governanceStatus(connector);
  const purpose = connectorPurpose(connector.id);
  const recent = auditRows.filter((row) => auditTouchesConnector(row, connector.id)).slice(-12).reverse();
  const starry = isStarryConnector(connector.id);

  const submitRef = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = refDraft.trim();
    if (!next) return;
    void onSave(`/api/admin/connectors/${connector.id}`, { credential_ref: next }, "凭据引用已更新", "PATCH");
    setRefDraft("");
  };

  return (
    <section className="admin-govern" data-admin-page="connector-detail" data-connector-id={connector.id}>
      <p className="admin-crumb"><Link to="/admin/connectors">连接器枢纽</Link> / {connector.label}</p>
      <div className="panel">
        <div className="admin-section-head">
          <div>
            <h2>{connector.label}</h2>
            <p className="muted">{purpose || "业务用途未登记（无 purpose 字段）"}</p>
          </div>
          <span className={"admin-status is-" + status.key}>{status.label}</span>
        </div>
        <dl className="admin-kv">
          <div><dt>短名称</dt><dd>{connector.id}</dd></div>
          <div><dt>凭据引用</dt><dd>{connector.credentialRegistered ? "已登记（原值不回显）" : "尚未登记"}</dd></div>
          <div><dt>最近更新</dt><dd>{connector.updatedAt || "—"}</dd></div>
        </dl>
        <div className="admin-actions">
          <button
            type="button"
            className="btn work"
            onClick={() => void onSave(`/api/admin/connectors/${connector.id}`, { enabled: !connector.enabled }, "连接器已更新", "PATCH")}
          >
            {connector.enabled ? "停用" : "启用"}
          </button>
        </div>
        <p className="muted admin-note">启用不等于远端已通，也不绕过 Gateway。</p>
      </div>

      <form className="panel settings-form" onSubmit={submitRef}>
        <h2>凭据引用</h2>
        <p className="muted">只写新的位置标识。JWT、API Key、Bearer 不得填在这里；提交后输入框清空，本页永不回显原值。</p>
        <label className="field">
          新引用
          <input
            value={refDraft}
            onChange={(e) => setRefDraft(e.target.value)}
            autoComplete="off"
            placeholder="credential 位置，不是秘密原值"
          />
        </label>
        <button className="btn work" disabled={!refDraft.trim()}>更新引用</button>
      </form>

      <ConnectorGrantTable connectorId={connector.id} users={users} onSave={onSave} />

      {starry && (
        <div className="panel" data-admin-starry-policy>
          <h2>组织 Starry 策略</h2>
          <p className="muted">跟进邮箱在个人设置按人绑定；本页只定组织策略。</p>
          <div className="admin-todo" data-todo="org-starry-policy">
            TODO：组织是否允许绑定、谁可绑、跟进范围是否受本组织约束 — 后端尚无独立策略字段，本页不编造 PATCH。
          </div>
          <div className="admin-todo" data-todo="starry-bound-roster">
            TODO：管理员查看「谁已绑定哪只邮箱」需要 GET 组织绑定名单；现有 API 只有 <code>/api/me/starry-binding</code>（当前账号）。本页不代替个人绑定。
          </div>
          <Link className="btn ghost sm" to="/settings?tab=starry">去个人设置绑定自己的发件箱</Link>
        </div>
      )}

      <div className="panel">
        <h2>本条最近治理变更</h2>
        {recent.length === 0 && <p className="muted">暂无本连接器的启用、引用或授权记录。</p>}
        {recent.map((row) => (
          <article className="admin-row" key={String(row.id)}>
            <div>
              <strong>{auditEventLabel(String(row.event_type))}</strong>
              <p className="muted">{String(row.ts || "")} · {String(row.actor || "")}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConnectorGrantTable({
  connectorId,
  users,
  onSave,
}: {
  connectorId: string;
  users: AdminRow[];
  onSave: SaveFn;
}) {
  const setAccess = (userId: string, access: "read" | "write" | "") => {
    if (!access) {
      void onSave(`/api/admin/users/${userId}/connectors/${connectorId}`, {}, "连接器授权已收回", "DELETE");
      return;
    }
    void onSave(`/api/admin/users/${userId}/connectors/${connectorId}`, { access }, "连接器授权已保存");
  };

  return (
    <div className="panel">
      <h2>员工 read / write</h2>
      <p className="muted">write 不等于发送、阶段或解密旁路。授权按人落在已有 <code>/api/admin/users/:uid/connectors/:id</code>。</p>
      <div className="admin-table-wrap">
        <table className="admin-table" data-admin-grants={connectorId}>
          <thead>
            <tr>
              <th>员工</th>
              <th>read</th>
              <th>write</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const access = accessFor(user, connectorId);
              const uid = String(user.id || "");
              return (
                <tr key={uid} data-grant-user={uid}>
                  <td>
                    <strong>{rowTitle(user)}</strong>
                    <p className="muted">{String(user.email || user.username || "")}</p>
                  </td>
                  <td>{access === "read" || access === "write" || access === "admin" ? "已授" : "—"}</td>
                  <td>{access === "write" || access === "admin" ? "已授" : "—"}</td>
                  <td className="admin-inline-actions">
                    <button type="button" className="btn sm" onClick={() => setAccess(uid, "read")}>授予 read</button>
                    <button type="button" className="btn sm" onClick={() => setAccess(uid, "write")}>授予 write</button>
                    <button type="button" className="btn sm" disabled={!access} onClick={() => setAccess(uid, "")}>收回</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!users.length && <p className="muted">暂无员工。</p>}
    </div>
  );
}
