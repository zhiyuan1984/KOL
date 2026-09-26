import { useMemo, useState } from "react";
import { api } from "../../api";
import { connectorGrantsOf, type AdminRow } from "../../adminGovernance";
import { grantReadConfirm, grantRevokeConfirm, grantWriteConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";

function userLabel(user: AdminRow): string {
  return String(user.name || user.username || user.id || "未命名");
}

export function ConnectorGrantsCard({ connector, users, reload }: {
  connector: { id: string; label: string };
  users: AdminRow[];
  reload: () => void;
}) {
  const { ask, dialog } = useAdminConfirm();
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const accessOf = (user: AdminRow) =>
    connectorGrantsOf(user).find((grant) => grant.connectorId === connector.id)?.access || "";
  const activeUsers = useMemo(() => users.filter((user) => user.active !== false && user.active !== 0), [users]);
  const granted = activeUsers.filter((user) => accessOf(user));
  const needle = q.trim().toLowerCase();
  const visible = activeUsers.filter((user) => !needle || `${userLabel(user)} ${String(user.position || "")}`.toLowerCase().includes(needle));

  const apply = (user: AdminRow, next: "read" | "write" | "") => {
    setError("");
    const label = userLabel(user);
    const path = `/api/admin/users/${encodeURIComponent(String(user.id))}/connectors/${encodeURIComponent(connector.id)}`;
    if (next === "") {
      ask(grantRevokeConfirm(label, connector.label), async () => {
        await api.adminSave(path, {}, "DELETE");
        reload();
      });
      return;
    }
    const copy = next === "write" ? grantWriteConfirm(label, connector.label) : grantReadConfirm(label, connector.label);
    ask(copy, async () => {
      await api.adminSave(path, { access: next }, "PUT");
      reload();
    });
  };

  return (
    <details className="panel connector-detail-card connector-disclosure" data-admin-grants>
      {dialog}
      <summary>
        <b>访问控制</b>
        <span className="muted">员工 read / write 逐人授权；与可用范围取并集。write 不等于发送、改阶段或解密旁路。</span>
      </summary>
      {error && <p className="error" role="alert">{error}</p>}
      {granted.length > 0 && (
        <p className="muted" data-connector-granted-summary>
          已授权 {granted.length} 人：{granted.map((user) => `${userLabel(user)}（${accessOf(user)}）`).join("、")}
        </p>
      )}
      <label className="field">查找员工
        <input value={q} placeholder="按姓名或岗位过滤" onChange={(event) => setQ(event.target.value)} />
      </label>
      <div className="connector-grant-list">
        {visible.map((user) => {
          const current = accessOf(user);
          return (
            <div className="connector-grant-row" key={String(user.id)} data-connector-grant-row={String(user.id)}>
              <span>{userLabel(user)}{user.position ? ` · ${String(user.position)}` : ""}</span>
              <select
                value={current}
                aria-label={`${userLabel(user)} 对此连接器的权限`}
                data-connector-grant-select={String(user.id)}
                onChange={(event) => apply(user, event.target.value as "read" | "write" | "")}
              >
                <option value="">未授予</option>
                <option value="read">read</option>
                <option value="write">write</option>
              </select>
            </div>
          );
        })}
        {!visible.length && <p className="muted">没有匹配的员工。</p>}
      </div>
      <p className="muted">改动会立即生效并写入审计；范围（部门/组/个人）见上方「可用范围」。</p>
    </details>
  );
}
