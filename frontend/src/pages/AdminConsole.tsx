import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "../components/AuthGate";
import StarryBindForm from "../components/StarryBindForm";
import { Admin as LegacyAdmin } from "./SimplePages";
import { Admin as SkillAdmin } from "./Admin";
import AdminKnowledge from "./AdminKnowledge";
import { APPROVAL_ROLE_OPTIONS, auditEventLabel, connectorStatusLabel, roleLabel, userStatusLabel } from "../labels";
import { SKILL_OPTIONS } from "../knowledgeCopy";
import { REMOTE_BACKEND_LABEL, remoteForConnector } from "../agentConfig";

type Row = Record<string, unknown>;

function title(row: Row) {
  return String(row.name || row.title || row.label || row.email || row.id || "未命名");
}

export default function AdminConsole() {
  const { account, refresh } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const routeTab = location.pathname.split("/admin/")[1] || "employees";
  const [tab, setTab] = useState(routeTab);
  const [users, setUsers] = useState<Row[]>([]);
  const [connectors, setConnectors] = useState<Row[]>([]);
  const [exams, setExams] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [auditRows, setAuditRows] = useState<Row[]>([]);
  const [policy, setPolicy] = useState<Row>({});
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
    ]).catch((e) => setError(e instanceof Error ? e.message : "无法加载管理数据"));
  }, []);

  useEffect(load, [load]);
  useEffect(() => setTab(routeTab), [routeTab]);

  const save = async (path: string, body: Row, message: string, method = "PUT") => {
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

  const tabs = [
    ["employees", "员工"], ["skills", "技能"], ["connectors", "连接器"], ["starry", "连接 Starry"],
    ["approvals", "审批角色"], ["exams", "考试与分配"], ["data", "数据 / 留存 / 审计"], ["knowledge", "知识"], ["kol", "KOL 配置"],
  ];
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div><div className="page-kicker">管理控制台</div><h1>组织管理</h1></div>
        <div className="admin-header-actions">
          <Link className="btn ghost sm nowrap" to="/agents">员工 · 智能体</Link>
          <Link className="btn work admin-return nowrap" to="/">← 返回员工工作台</Link>
        </div>
      </header>
      <div className="remote-legend admin-remote-legend" aria-label="远端连接">
        {Object.entries(REMOTE_BACKEND_LABEL).filter(([id]) => id !== "host").map(([id, label]) => {
          const live = connectors.find((row) => remoteForConnector(String(row.id || "")) === id);
          return (
            <span key={id} className="remote-pill" data-remote={id} data-live={live && live.enabled !== false ? "on" : "off"}>
              <i className="live-dot" aria-hidden />
              {label}
              <em>{live ? connectorStatusLabel(String(live.status || "configured")) : "未挂接"}</em>
            </span>
          );
        })}
      </div>
      <nav className="settings-tabs admin-tabs" aria-label="管理分类">
        {tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} data-admin-tab={id} onClick={() => {
          setTab(id);
          navigate(id === "employees" ? "/admin" : `/admin/${id}`);
        }}>{label}</button>)}
      </nav>
      {notice && <p className="status-ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {tab === "employees" && <section className="admin-grid">
        <AdminList title="员工目录" empty="暂无员工" rows={users} render={(user) => <><p className="muted">{String(user.email || user.username || "")}</p><span className="chip">{userStatusLabel(String(user.status || (user.active === false ? "inactive" : "active")))}</span><p className="muted">{Array.isArray(user.roles) ? user.roles.map((role) => roleLabel(String(role))).join(" / ") : ""}</p><button className="btn" onClick={() => void save(`/api/admin/users/${user.id}`, { active: user.active === false }, "员工状态已更新", "PATCH")}>{user.active === false ? "启用" : "停用"}</button></>} />
        <form className="panel settings-form" onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void save("/api/admin/users", {
            username: d.get("email"), name: d.get("name"), password: d.get("password"),
            site: d.get("site"), roles: ["employee"], brands: ["LT"],
          }, "员工已创建", "POST");
        }}>
          <h2>新增员工</h2>
          <label className="field">姓名<input name="name" required /></label>
          <label className="field">邮箱/账号<input name="email" required /></label>
          <label className="field">临时密码<input name="password" type="password" minLength={10} required /></label>
          <label className="field">站点<input name="site" /></label>
          <button className="btn work">创建员工</button>
        </form>
      </section>}
      {tab === "skills" && <SkillAdmin embedded />}
      {tab === "starry" && <StarryBindForm onSaved={() => void refresh()} />}
      {tab === "approvals" && <GrantEditor kind="approval-roles" label="审批角色" users={users} options={[...APPROVAL_ROLE_OPTIONS]} onSave={save} />}
      {tab === "connectors" && (
        <section className="admin-grid">
          <div className="panel"><h2>连接器配置</h2>
            <p className="muted">凭据值永不回显；这里只显示状态和安全引用。</p>
            <p className="muted">这里只启用连接器、给员工授 read/write。跟进邮箱在本页「连接 Starry」或「个人设置 → 连接 Starry」按人绑定（例如 larry.zhao）。进程级 URL / API Key 仍在 Host 环境变量；用户 JWT 不要填进连接器凭据位置。</p>
            {connectors.map((connector) => <article className="admin-row" key={String(connector.id)}><div><strong>{title(connector)}</strong><p className="muted">{connectorStatusLabel(String(connector.status || connector.credential_status || "未配置"))}{connector.credential_reference || connector.reference ? " · 凭据已登记" : " · 尚未登记凭据"}</p></div><button className="btn" onClick={() => void save(`/api/admin/connectors/${connector.id}`, { enabled: !connector.enabled }, "连接器已更新", "PATCH")}>{connector.enabled === false ? "启用" : "停用"}</button></article>)}
            {!connectors.length && <p className="muted">新连接器 API 暂不可用；KOL 配置仍可在对应标签查看。</p>}
            <form className="settings-form" onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void save("/api/admin/connectors", {
                id: d.get("id"), label: d.get("label"), credential_ref: d.get("credential_ref"),
              }, "连接器已创建", "POST");
            }}>
              <h3>新增连接器</h3>
              <label className="field">名称<input name="label" required /></label>
              <label className="field">短名称<input name="id" pattern="[a-z0-9_-]+" required placeholder="仅英文小写，创建后员工看不到" /></label>
              <label className="field">凭据位置<input name="credential_ref" placeholder="选填，原值不会回显" /></label>
              <button className="btn work">创建</button>
            </form>
          </div>
          <GrantEditor kind="connectors" label="连接器" users={users} options={connectors.map((connector) => ({ id: String(connector.id), label: title(connector) }))} onSave={save} />
        </section>
      )}
      {tab === "exams" && (
        <section className="admin-grid">
          <AdminList title="考试" empty="暂无考试" rows={exams} render={(exam) => <p className="muted">{String(exam.description || exam.status || "")}</p>} />
          <AdminList title="分配记录" empty="暂无分配" rows={assignments} render={(assignment) => <p className="muted">{assignment.passed ? "已通过" : String(assignment.status) === "completed" ? "已完成" : "待完成"}{assignment.due_at ? ` · 截止 ${assignment.due_at}` : ""}</p>} />
          <form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void save("/api/admin/exam-assignments", { exam_id: d.get("exam_id"), user_id: d.get("user_id") }, "考试已分配", "POST"); }}><h2>分配考试</h2><label className="field">考试<select name="exam_id" required><option value="">选择考试</option>{exams.map((exam) => <option key={String(exam.id)} value={String(exam.id)}>{title(exam)}</option>)}</select></label><label className="field">员工<select name="user_id" required><option value="">选择员工</option>{users.map((user) => <option key={String(user.id)} value={String(user.id)}>{title(user)}</option>)}</select></label><button className="btn work">分配</button></form>
          <form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void save("/api/admin/exams", { title: d.get("title"), description: d.get("description") }, "考试已创建", "POST"); }}>
            <h2>创建考试</h2><label className="field">名称<input name="title" required /></label><label className="field">说明<textarea name="description" rows={3} /></label><button className="btn work">创建</button>
          </form>
        </section>
      )}
      {tab === "data" && (
        <section className="admin-grid"><form className="panel settings-form" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void save("/api/admin/retention-policy", { session_days: Number(d.get("session_days")), audit_days: Number(d.get("audit_days")) }, "数据策略已保存", "PATCH"); }}>
          <h2>数据与留存策略</h2>
          <label className="field">会话留存天数<input name="session_days" type="number" min="1" defaultValue={Number(policy.session_days || 365)} /></label>
          <label className="field">审计留存天数<input name="audit_days" type="number" min="1" defaultValue={Number(policy.audit_days || 730)} /></label>
          <p className="muted">当前策略：{String(policy.summary || "分享链接默认 24 小时过期；私有数据默认排除。")}</p>
          <button className="btn work">保存策略</button>
        </form>
        <div className="panel"><h2>最近管理审计</h2>{auditRows.slice(-20).reverse().map((row) => <div className="admin-row" key={String(row.id)}><div><strong>{auditEventLabel(String(row.event_type))}</strong><p className="muted">{String(row.ts)} · {String(row.actor)}</p></div></div>)}</div></section>
      )}
      {tab === "knowledge" && <AdminKnowledge />}
      {tab === "kol" && <LegacyAdmin />}
    </div>
  );
}

function AdminList({ title: heading, rows, empty, render }: { title: string; rows: Row[]; empty: string; render: (row: Row) => React.ReactNode }) {
  return <section className="panel"><h2>{heading}</h2>{rows.map((row, i) => <article className="admin-row" key={String(row.id || i)}><div><strong>{title(row)}</strong>{render(row)}</div></article>)}{!rows.length && <p className="muted">{empty}</p>}</section>;
}

function GrantEditor({ kind, label, users, options, onSave }: {
  kind: string;
  label: string;
  users: Row[];
  options: { id: string; label: string }[];
  onSave: (path: string, body: Row, message: string, method?: string) => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]);
  const items = options.length ? options : SKILL_OPTIONS;
  return (
    <form className="panel settings-form" onSubmit={(e) => {
      e.preventDefault();
      if (!userId || !picked.length) return;
      void onSave(`/api/admin/users/${userId}/${kind}`, { [kind === "approval-roles" ? "roles" : kind]: picked }, `${label}授权已保存`);
    }}>
      <h2>{label}授权</h2>
      <label className="field">员工
        <select name="user_id" required value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">选择员工</option>
          {users.map((u) => <option key={String(u.id)} value={String(u.id)}>{title(u)}</option>)}
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
