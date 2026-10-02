import { useCallback, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "../components/AuthGate";
import { Admin as LegacyAdmin } from "./SimplePages";
import AdminKnowledge from "./AdminKnowledge";
import AdminExams from "./AdminExams";
import { AdminAgents } from "./AdminAgents";
import AdminCosts from "./AdminCosts";
import AdminScheduling from "./AdminScheduling";
import { ConnectorDetail } from "../admin/connector/ConnectorDetail";
import { ConnectorHub } from "../admin/connector/ConnectorHub";
import { EmployeeDirectory, type DirectoryEmployee } from "../admin/employees/EmployeeDirectory";
import {
  isBindAudit,
  isConnectorAudit,
  isGrantAudit,
  rowTitle,
  type AdminRow,
} from "../adminGovernance";
import {
  APPROVAL_ROLE_OPTIONS,
  auditEventLabel,
} from "../labels";
import { SKILL_OPTIONS } from "../knowledgeCopy";
import { approvalRoleSaveConfirm, retentionPolicyConfirm } from "../adminConfirm";
import { useAdminConfirm } from "../components/ConfirmDialog";
import SkillLifecycle from "./SkillLifecycle";
import { adminSectionOf, adminTabOf } from "../layout/adminNav";

/** 分节归一化与侧栏条目同一份（`/admin` → employees，未知段回落 employees），详情 id 仍取自路径。 */
function parseAdminPath(pathname: string): { section: string; detailId: string } {
  const rest = pathname.replace(/^\/admin\/?/, "");
  const [, ...parts] = rest.split("/").filter(Boolean);
  return { section: adminSectionOf(pathname), detailId: parts.map(decodeURIComponent).join("/") };
}

export default function AdminConsole() {
  const { account } = useAccount();
  const location = useLocation();
  const { section, detailId } = parseAdminPath(location.pathname);
  const [users, setUsers] = useState<AdminRow[]>([]);
  const [connectors, setConnectors] = useState<AdminRow[]>([]);
  const [exams, setExams] = useState<AdminRow[]>([]);
  const [assignments, setAssignments] = useState<AdminRow[]>([]);
  const [auditRows, setAuditRows] = useState<AdminRow[]>([]);
  const [policy, setPolicy] = useState<AdminRow>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    void Promise.all([
      api.adminUsers().then(setUsers),
      api.adminConnectors().then(setConnectors),
      api.adminExams().then(setExams),
      api.adminAssignments().then(setAssignments),
      api.adminDataPolicy().then(setPolicy),
      api.adminAudit().then(setAuditRows),
    ]).catch((e) => setError(e instanceof Error ? e.message : "无法加载管理数据"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const save = async (path: string, body: AdminRow, message: string, method = "PUT") => {
    setError("");
    try {
      await api.adminSave(path, body, method);
      setNotice(message);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };
  if (!account?.available_modes?.includes("admin")) return <Navigate to="/" replace />;
  if (section === "starry") return <Navigate to="/settings?tab=starry" replace />;

  const tab = adminTabOf(location.pathname);

  return (
    <div className="admin-shell" data-admin-ia="governance">
      <div className="admin-body">
        {notice && <p className="admin-receipt status-ok" data-admin-receipt role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {tab === "employees" && <EmployeeDirectory users={users as DirectoryEmployee[]} onReload={load} />}
        {tab === "agents" && (
          <AdminAgents exams={exams} assignments={assignments} />
        )}
        {tab === "connectors" && (
          detailId
            ? <ConnectorDetail connectorId={detailId} connectors={connectors} auditRows={auditRows} reload={load} />
            : <ConnectorHub connectors={connectors} loading={loading} onSave={save} reload={load} />
        )}
        {tab === "skills" && <SkillLifecycle />}
        {tab === "approvals" && (
          <GrantEditor kind="approval-roles" label="审批角色" users={users} options={[...APPROVAL_ROLE_OPTIONS]} onSave={save} />
        )}
        {tab === "exams" && <AdminExams exams={exams} assignments={assignments} users={users} onReload={load} />}
        {tab === "data" && <DataPanel policy={policy} auditRows={auditRows} onSave={save} />}
        {tab === "cost" && <AdminCosts />}
        {tab === "scheduling" && <AdminScheduling />}
        {tab === "knowledge" && <AdminKnowledge />}
        {tab === "kol" && <LegacyAdmin />}
      </div>
    </div>
  );
}

function DataPanel({
  policy,
  auditRows,
  onSave,
}: {
  policy: AdminRow;
  auditRows: AdminRow[];
  onSave: SaveFn;
}) {
  const { ask, dialog } = useAdminConfirm();
  const [slice, setSlice] = useState<"all" | "connector" | "grant" | "bind">("all");
  const filtered = auditRows.filter((row) => {
    const eventType = String(row.event_type || "");
    if (slice === "connector") return isConnectorAudit(eventType);
    if (slice === "grant") return isGrantAudit(eventType);
    if (slice === "bind") return isBindAudit(eventType);
    return true;
  });

  return (
    <section className="admin-grid">
      {dialog}
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const sessionDays = Number(d.get("session_days"));
          const auditDays = Number(d.get("audit_days"));
          ask(retentionPolicyConfirm(sessionDays, auditDays), () =>
            onSave("/api/admin/retention-policy", {
              session_days: sessionDays,
              audit_days: auditDays,
            }, "数据策略已保存", "PATCH"),
          );
        }}
      >
        <h2>数据与留存策略</h2>
        <label className="field">会话留存天数<input name="session_days" type="number" min="1" defaultValue={Number(policy.session_days || 365)} /></label>
        <label className="field">审计留存天数<input name="audit_days" type="number" min="1" defaultValue={Number(policy.audit_days || 730)} /></label>
        <p className="muted">当前策略：{String(policy.summary || "分享链接默认 24 小时过期；私有数据默认排除。")}</p>
        <button className="btn work" data-admin-retention-save>保存策略</button>
      </form>
      <div className="panel">
        <h2>治理审计切片</h2>
        <div className="chip-row" role="tablist" aria-label="审计切片">
          {([["all", "全部"], ["connector", "连接器"], ["grant", "授权"], ["bind", "绑定"]] as const).map(([id, label]) => (
            <button key={id} type="button" className={"hub-chip" + (slice === id ? " on" : "")} data-audit-slice={id} onClick={() => setSlice(id)}>
              {label}
            </button>
          ))}
        </div>
        {slice === "bind" && !filtered.length && (
          <div className="admin-todo" data-todo="bind-audit">
            TODO：个人 Starry 绑定/解绑审计若未写入 <code>/api/audit</code>，本切片为空。不把 Pipeline 事件当审计。
          </div>
        )}
        {filtered.slice(-20).reverse().map((row) => (
          <div className="admin-row" key={String(row.id)}>
            <div>
              <strong>{auditEventLabel(String(row.event_type))}</strong>
              <p className="muted">{String(row.ts)} · {String(row.actor)}</p>
            </div>
          </div>
        ))}
        {!filtered.length && slice !== "bind" && <p className="muted">此切片暂无记录。</p>}
      </div>
    </section>
  );
}

type SaveFn = (path: string, body: AdminRow, message: string, method?: string) => Promise<void>;

function GrantEditor({ kind, label, users, options, onSave }: {
  kind: string;
  label: string;
  users: AdminRow[];
  options: { id: string; label: string }[];
  onSave: SaveFn;
}) {
  const { ask, dialog } = useAdminConfirm();
  const [userId, setUserId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]);
  const items = options.length ? options : SKILL_OPTIONS;
  const user = users.find((row) => String(row.id) === userId);
  const roleLabels = picked.map((id) => items.find((item) => item.id === id)?.label || id);
  return (
    <form
      className="panel settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!userId || !picked.length) return;
        ask(approvalRoleSaveConfirm(rowTitle(user || {}), roleLabels), () =>
          onSave(`/api/admin/users/${userId}/${kind}`, { [kind === "approval-roles" ? "roles" : kind]: picked }, `${label}授权已保存`),
        );
      }}
    >
      {dialog}
      <h2>{label}授权</h2>
      <label className="field">
        员工
        <select name="user_id" required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">选择员工</option>
          {users.map((u) => <option key={String(u.id)} value={String(u.id)}>{rowTitle(u)}</option>)}
        </select>
      </label>
      <fieldset className="field">
        <legend>选择{label}</legend>
        <div className="chip-row">
          {items.map((item) => (
            <label key={item.id} className="check">
              <input type="checkbox" checked={picked.includes(item.id)} onChange={() => toggle(item.id)} />
              {item.label}
            </label>
          ))}
        </div>
        {!items.length && <p className="muted">暂无可选项。</p>}
      </fieldset>
      <button className="btn work" data-admin-approval-save disabled={!userId || !picked.length}>保存授权</button>
    </form>
  );
}
