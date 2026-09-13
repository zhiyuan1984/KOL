import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "../components/AuthGate";
import { Admin as LegacyAdmin } from "./SimplePages";
import { Admin as SkillAdmin } from "./Admin";
import AdminKnowledge from "./AdminKnowledge";
import { AdminAgents } from "./AdminAgents";
import { AdminConnectorDetail, AdminConnectorsHub } from "./AdminConnectors";
import {
  governanceStatus,
  isBindAudit,
  isConnectorAudit,
  isGrantAudit,
  publicConnectorView,
  rowTitle,
  type AdminRow,
} from "../adminGovernance";
import { APPROVAL_ROLE_OPTIONS, auditEventLabel, roleLabel, userStatusLabel } from "../labels";
import { SKILL_OPTIONS } from "../knowledgeCopy";

const TABS: [string, string][] = [
  ["employees", "员工"],
  ["agents", "数字员工"],
  ["connectors", "连接器"],
  ["skills", "技能"],
  ["approvals", "审批角色"],
  ["exams", "考试与分配"],
  ["data", "数据 / 留存 / 审计"],
  ["knowledge", "知识"],
  ["kol", "KOL 配置"],
];

function parseAdminPath(pathname: string): { section: string; detailId: string } {
  const rest = pathname.replace(/^\/admin\/?/, "");
  if (!rest) return { section: "employees", detailId: "" };
  const [section, ...parts] = rest.split("/").filter(Boolean);
  return { section: section || "employees", detailId: parts.map(decodeURIComponent).join("/") };
}

export default function AdminConsole() {
  const { account } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const { section, detailId } = parseAdminPath(location.pathname);
  const [users, setUsers] = useState<AdminRow[]>([]);
  const [connectors, setConnectors] = useState<AdminRow[]>([]);
  const [exams, setExams] = useState<AdminRow[]>([]);
  const [assignments, setAssignments] = useState<AdminRow[]>([]);
  const [auditRows, setAuditRows] = useState<AdminRow[]>([]);
  const [policy, setPolicy] = useState<AdminRow>({});
  const [hiddenConnectors, setHiddenConnectors] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    void Promise.all([
      api.adminUsers().then(setUsers),
      api.adminConnectors().then(setConnectors),
      api.adminExams().then(setExams),
      api.adminAssignments().then(setAssignments),
      api.adminDataPolicy().then(setPolicy),
      api.adminAudit().then(setAuditRows),
      api.admin().then((pack) => {
        const hidden = (pack as { hidden_connectors?: string[] }).hidden_connectors;
        setHiddenConnectors(Array.isArray(hidden) ? hidden : []);
      }).catch(() => setHiddenConnectors([])),
    ]).catch((e) => setError(e instanceof Error ? e.message : "无法加载管理数据"));
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

  const tab = TABS.some(([id]) => id === section) ? section : "employees";

  return (
    <div className="admin-shell" data-admin-ia="governance" data-visual="docs20">
      <header className="admin-header">
        <div>
          <div className="page-kicker">管理控制台</div>
          <h1>组织管理</h1>
        </div>
        <div className="admin-header-actions">
          <Link className="btn ghost sm nowrap" to="/admin/agents" data-admin-agents-link>数字员工治理</Link>
          <Link className="btn work admin-return nowrap" to="/">← 返回员工工作台</Link>
        </div>
      </header>
      <AdminHealth connectors={connectors} />
      <nav className="settings-tabs admin-tabs" aria-label="管理分类">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            data-admin-tab={id}
            onClick={() => {
              navigate(id === "employees" ? "/admin" : `/admin/${id}`);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {notice && <p className="status-ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {tab === "employees" && <EmployeesPanel users={users} onSave={save} />}
      {tab === "agents" && (
        <AdminAgents users={users} connectors={connectors} exams={exams} assignments={assignments} />
      )}
      {tab === "connectors" && (
        detailId
          ? <AdminConnectorDetail connectorId={detailId} connectors={connectors} users={users} auditRows={auditRows} onSave={save} />
          : <AdminConnectorsHub connectors={connectors} users={users} hiddenConnectors={hiddenConnectors} onSave={save} />
      )}
      {tab === "skills" && <SkillAdmin embedded />}
      {tab === "approvals" && (
        <GrantEditor kind="approval-roles" label="审批角色" users={users} options={[...APPROVAL_ROLE_OPTIONS]} onSave={save} />
      )}
      {tab === "exams" && <ExamsPanel exams={exams} assignments={assignments} users={users} onSave={save} />}
      {tab === "data" && <DataPanel policy={policy} auditRows={auditRows} onSave={save} />}
      {tab === "knowledge" && <AdminKnowledge />}
      {tab === "kol" && <LegacyAdmin />}
    </div>
  );
}

function AdminHealth({ connectors }: { connectors: AdminRow[] }) {
  const rows = connectors.map(publicConnectorView).filter((row) => row.id);
  const counts = { total: rows.length, enabled: 0, registered: 0, unattached: 0, errors: 0 };
  for (const row of rows) {
    const status = governanceStatus(row);
    if (row.enabled) counts.enabled += 1;
    if (row.credentialRegistered) counts.registered += 1;
    if (status.key === "unattached") counts.unattached += 1;
    if (status.key === "error") counts.errors += 1;
  }

  return (
    <div className="admin-health" data-admin-health aria-label="连接器治理状态">
      <span>已挂接 <b>{counts.total}</b></span>
      <span>已启用 <b>{counts.enabled}</b></span>
      <span>凭据已登记 <b>{counts.registered}</b></span>
      <span>未挂接 <b>{counts.unattached}</b></span>
      {counts.errors > 0 && <span data-health="error">异常 <b>{counts.errors}</b></span>}
    </div>
  );
}

function EmployeesPanel({ users, onSave }: { users: AdminRow[]; onSave: SaveFn }) {
  return (
    <section className="admin-grid">
      <AdminList
        title="员工目录"
        empty="暂无员工"
        rows={users}
        render={(user) => (
          <>
            <p className="muted">{String(user.email || user.username || "")}</p>
            <span className="chip">{userStatusLabel(String(user.status || (user.active === false ? "inactive" : "active")))}</span>
            <p className="muted">{Array.isArray(user.roles) ? user.roles.map((role) => roleLabel(String(role))).join(" / ") : ""}</p>
            <button className="btn" onClick={() => void onSave(`/api/admin/users/${user.id}`, { active: user.active === false }, "员工状态已更新", "PATCH")}>
              {user.active === false ? "启用" : "停用"}
            </button>
          </>
        )}
      />
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void onSave("/api/admin/users", {
            username: d.get("email"), name: d.get("name"), password: d.get("password"),
            site: d.get("site"), roles: ["employee"], brands: ["LT"],
          }, "员工已创建", "POST");
        }}
      >
        <h2>新增员工</h2>
        <label className="field">姓名<input name="name" required /></label>
        <label className="field">邮箱/账号<input name="email" required /></label>
        <label className="field">临时密码<input name="password" type="password" minLength={10} required /></label>
        <label className="field">站点<input name="site" /></label>
        <button className="btn work">创建员工</button>
      </form>
    </section>
  );
}

function ExamsPanel({
  exams,
  assignments,
  users,
  onSave,
}: {
  exams: AdminRow[];
  assignments: AdminRow[];
  users: AdminRow[];
  onSave: SaveFn;
}) {
  return (
    <section className="admin-grid">
      <AdminList title="考试" empty="暂无考试" rows={exams} render={(exam) => <p className="muted">{String(exam.description || exam.status || "")}</p>} />
      <AdminList
        title="分配记录"
        empty="暂无分配"
        rows={assignments}
        render={(assignment) => (
          <p className="muted">
            {assignment.passed ? "已通过" : String(assignment.status) === "completed" ? "已完成" : "待完成"}
            {assignment.due_at ? ` · 截止 ${assignment.due_at}` : ""}
          </p>
        )}
      />
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void onSave("/api/admin/exam-assignments", { exam_id: d.get("exam_id"), user_id: d.get("user_id") }, "考试已分配", "POST");
        }}
      >
        <h2>分配考试</h2>
        <label className="field">
          考试
          <select name="exam_id" required>
            <option value="">选择考试</option>
            {exams.map((exam) => <option key={String(exam.id)} value={String(exam.id)}>{rowTitle(exam)}</option>)}
          </select>
        </label>
        <label className="field">
          员工
          <select name="user_id" required>
            <option value="">选择员工</option>
            {users.map((user) => <option key={String(user.id)} value={String(user.id)}>{rowTitle(user)}</option>)}
          </select>
        </label>
        <button className="btn work">分配</button>
      </form>
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void onSave("/api/admin/exams", { title: d.get("title"), description: d.get("description") }, "考试已创建", "POST");
        }}
      >
        <h2>创建考试</h2>
        <label className="field">名称<input name="title" required /></label>
        <label className="field">说明<textarea name="description" rows={3} /></label>
        <button className="btn work">创建</button>
      </form>
    </section>
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
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void onSave("/api/admin/retention-policy", {
            session_days: Number(d.get("session_days")),
            audit_days: Number(d.get("audit_days")),
          }, "数据策略已保存", "PATCH");
        }}
      >
        <h2>数据与留存策略</h2>
        <label className="field">会话留存天数<input name="session_days" type="number" min="1" defaultValue={Number(policy.session_days || 365)} /></label>
        <label className="field">审计留存天数<input name="audit_days" type="number" min="1" defaultValue={Number(policy.audit_days || 730)} /></label>
        <p className="muted">当前策略：{String(policy.summary || "分享链接默认 24 小时过期；私有数据默认排除。")}</p>
        <button className="btn work">保存策略</button>
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

function AdminList({ title: heading, rows, empty, render }: { title: string; rows: AdminRow[]; empty: string; render: (row: AdminRow) => React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{heading}</h2>
      {rows.map((row, i) => (
        <article className="admin-row" key={String(row.id || i)}>
          <div>
            <strong>{rowTitle(row)}</strong>
            {render(row)}
          </div>
        </article>
      ))}
      {!rows.length && <p className="muted">{empty}</p>}
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
  const [userId, setUserId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]);
  const items = options.length ? options : SKILL_OPTIONS;
  return (
    <form
      className="panel settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!userId || !picked.length) return;
        void onSave(`/api/admin/users/${userId}/${kind}`, { [kind === "approval-roles" ? "roles" : kind]: picked }, `${label}授权已保存`);
      }}
    >
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
      <button className="btn work" disabled={!userId || !picked.length}>保存授权</button>
    </form>
  );
}
