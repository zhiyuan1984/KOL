import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  type AdminEmployeeContext,
  type AdminEmployeeTool,
  type AdminEmployeeMailbox,
  type AdminEmployeeKol,
} from "../../api";
import { employeeToolGrantsConfirm, userDeactivateConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { useFocusLock } from "../../hooks/useFocusLock";
import type { OrganizationUnit } from "../../runtimeConnectorUi";
import "./employee-directory.css";

export type DirectoryEmployee = Record<string, unknown> & {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  site?: string;
  position?: string;
  manager_user_id?: string;
  brands?: string[];
  roles?: string[];
  skill_grants?: string[];
  active?: boolean;
  updated_at?: string;
  mailbox_count?: number;
  kol_count?: number;
};

type Employee = DirectoryEmployee;

type EmployeeDialogKind = "edit" | "create" | "tools";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function userEmail(user: Employee): string {
  return text(user.email || user.username);
}

function formatTime(value: unknown): string {
  const raw = text(value);
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function orgLabel(site: unknown, units: OrganizationUnit[]): string {
  const value = text(site);
  return units.find((unit) => unit.id === value)?.display_name || value || "未分配";
}

function employeeLabel(user: Employee): string {
  return text(user.name) || userEmail(user) || "未命名员工";
}

function compactList(items: string[], fallback = "未设置"): string {
  return items.length ? items.join("、") : fallback;
}

function EmployeeModal({
  kind,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  kind: EmployeeDialogKind;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusLock({ open: true, rootRef, onEscape: onClose, lockBody: true, restore: true });
  return createPortal(
    <div className="employee-dialog-layer" data-employee-dialog={kind}>
      <div className="employee-dialog-backdrop" onClick={onClose} />
      <section ref={rootRef} className="employee-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="employee-dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" data-employee-dialog-close onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="employee-dialog-body">{children}</div>
        {footer ? <footer className="employee-dialog-foot">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

function BindingList({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="employee-binding-list">
      <div className="employee-binding-list-head"><h3>{title}</h3><span>{count}</span></div>
      {count ? <ul>{children}</ul> : <p className="muted">{empty}</p>}
    </section>
  );
}

function MailboxBinding({ mailbox }: { mailbox: AdminEmployeeMailbox }) {
  return (
    <li data-employee-mailbox={mailbox.mailbox_email}>
      <div><strong>{mailbox.mailbox_email}</strong><p>{mailbox.owner_name || "未记录邮箱归属人"}</p></div>
      <span className={`admin-status is-${mailbox.status === "connected" ? "configured" : "unattached"}`}>{mailbox.status === "connected" ? "已连接" : mailbox.status}</span>
    </li>
  );
}

function KolBinding({ kol }: { kol: AdminEmployeeKol }) {
  return (
    <li data-employee-kol={kol.kol_uid}>
      <div><strong>{kol.display_name}</strong><p>{kol.kol_uid} · {kol.scope_brand || "未设置品牌"}</p></div>
      <span>{kol.stage_code || "未记录阶段"}</span>
    </li>
  );
}

function EmployeeEditDialog({
  employee,
  allEmployees,
  units,
  brands,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  allEmployees: Employee[];
  units: OrganizationUnit[];
  brands: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = Boolean(employee);
  const [context, setContext] = useState<AdminEmployeeContext | null>(null);
  const [loading, setLoading] = useState(existing);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(text(employee?.name));
  const [email, setEmail] = useState(userEmail(employee || { id: "" }));
  const [password, setPassword] = useState("");
  const [site, setSite] = useState(text(employee?.site));
  const [position, setPosition] = useState(text(employee?.position));
  const [managerId, setManagerId] = useState(text(employee?.manager_user_id));
  const [active, setActive] = useState(employee?.active !== false);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(asList(employee?.brands));

  useEffect(() => {
    if (!employee) return;
    let live = true;
    api.adminEmployeeContext(employee.id).then((data) => {
      if (!live) return;
      const user = data.user as Employee;
      setContext(data);
      setName(text(user.name));
      setEmail(userEmail(user));
      setSite(text(user.site));
      setPosition(text(user.position));
      setManagerId(text(user.manager_user_id));
      setActive(user.active !== false);
      setSelectedBrands(asList(user.brands));
      setLoading(false);
    }).catch((cause) => {
      if (!live) return;
      setError(errorText(cause, "无法读取员工详情"));
      setLoading(false);
    });
    return () => { live = false; };
  }, [employee]);

  const toggleBrand = (brand: string) => {
    setSelectedBrands((current) => current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand]);
  };

  const save = async () => {
    setError("");
    if (!name || !email) {
      setError("请填写员工姓名和登录邮箱。");
      return;
    }
    setSaving(true);
    try {
      if (employee) {
        await api.adminSave(`/api/admin/users/${encodeURIComponent(employee.id)}`, {
          name,
          site,
          position,
          manager_user_id: managerId || null,
          brands: selectedBrands,
          active,
        }, "PATCH");
      } else {
        if (password.length < 8) {
          setError("初始密码至少需要 8 个字符。");
          return;
        }
        await api.adminSave("/api/admin/users", {
          name,
          username: email,
          password,
          site,
          position,
          manager_user_id: managerId || null,
          brands: selectedBrands,
          roles: ["employee"],
        }, "POST");
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause, existing ? "保存员工资料失败" : "创建员工失败"));
    } finally {
      setSaving(false);
    }
  };

  const loadedUser = (context?.user as Employee | undefined) || employee;
  const mailboxes = context?.mailboxes || [];
  const kols = context?.kols || [];
  return (
    <EmployeeModal
      kind={existing ? "edit" : "create"}
      title={existing ? "编辑员工" : "新增员工"}
      subtitle={existing ? "更新组织资料，并查看该员工当前绑定的邮箱和 KOL。" : "新建的员工默认作为普通员工；工具权限可在创建后单独配置。"}
      onClose={onClose}
      footer={<><p className="employee-dialog-note">{existing ? "保存后立即更新员工资料；工具权限不会随本次编辑改变。" : "创建后可继续在授权面板配置工具权限。"}</p><button type="button" className="btn work" data-employee-edit-save disabled={saving || loading} onClick={() => void save()}>{saving ? "保存中…" : existing ? "保存资料" : "创建员工"}</button></>}
    >
      {loading ? <p className="muted">正在读取员工资料…</p> : <>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <section className="employee-form-section">
          <h3>账号与组织</h3>
          <div className="employee-form-grid">
            <label className="field">员工姓名<input data-employee-field="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field">登录邮箱<input data-employee-field="email" value={email} readOnly={existing} onChange={(event) => setEmail(event.target.value)} /></label>
            {!existing ? <label className="field">初始密码<input data-employee-field="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label> : null}
            <label className="field">所属组织<select data-employee-field="organization" value={site} onChange={(event) => setSite(event.target.value)}><option value="">未分配</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.display_name}</option>)}</select></label>
            <label className="field">岗位<input data-employee-field="position" value={position} placeholder="例如：商务拓展" onChange={(event) => setPosition(event.target.value)} /></label>
            <label className="field">直属上级<select data-employee-field="manager" value={managerId} onChange={(event) => setManagerId(event.target.value)}><option value="">未设置</option>{allEmployees.filter((candidate) => candidate.id !== employee?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{employeeLabel(candidate)}</option>)}</select></label>
            {existing ? <label className="field">账号状态<select data-employee-field="active" value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">启用</option><option value="inactive">停用</option></select></label> : null}
          </div>
          <fieldset className="employee-brand-field"><legend>品牌范围</legend><div>{brands.map((brand) => <label key={brand}><input type="checkbox" checked={selectedBrands.includes(brand)} onChange={() => toggleBrand(brand)} />{brand}</label>)}</div></fieldset>
        </section>
        {existing ? <section className="employee-form-section employee-bindings" data-employee-bindings>
          <h3>业务绑定</h3>
          <p className="muted">邮箱凭据和令牌不会在管理端展示。</p>
          <div className="employee-bindings-grid">
            <BindingList title="绑定邮箱" count={mailboxes.length} empty="暂未绑定邮箱。">{mailboxes.map((mailbox) => <MailboxBinding key={mailbox.mailbox_email} mailbox={mailbox} />)}</BindingList>
            <BindingList title="负责 KOL" count={kols.length} empty="暂无负责中的 KOL。">{kols.map((kol) => <KolBinding key={kol.id || kol.kol_uid} kol={kol} />)}</BindingList>
          </div>
          {loadedUser ? <p className="employee-binding-summary">当前共绑定 {mailboxes.length} 个邮箱，负责 {kols.length} 个 KOL。</p> : null}
        </section> : null}
      </>}
    </EmployeeModal>
  );
}

function EmployeeToolDialog({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const { ask, dialog } = useAdminConfirm();
  const [tools, setTools] = useState<AdminEmployeeTool[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.adminEmployeeTools(employee.id).then((result) => {
      if (!live) return;
      setTools(result.tools);
      setSelected(new Set(result.tools.filter((tool) => tool.granted).map((tool) => tool.id)));
      setLoading(false);
    }).catch((cause) => {
      if (!live) return;
      setError(errorText(cause, "无法读取工具列表"));
      setLoading(false);
    });
    return () => { live = false; };
  }, [employee.id]);

  const initial = useMemo(() => new Set(tools.filter((tool) => tool.granted).map((tool) => tool.id)), [tools]);
  const shown = useMemo(() => tools.filter((tool) => {
    const needle = query.trim().toLowerCase();
    if (needle && !`${tool.label} ${tool.category} ${tool.summary}`.toLowerCase().includes(needle)) return false;
    if (filter === "enabled") return selected.has(tool.id);
    if (filter === "disabled") return !selected.has(tool.id);
    return true;
  }), [filter, query, selected, tools]);
  const added = tools.filter((tool) => selected.has(tool.id) && !initial.has(tool.id));
  const revoked = tools.filter((tool) => !selected.has(tool.id) && initial.has(tool.id));

  const toggle = (tool: AdminEmployeeTool) => {
    if (!tool.assignable && !tool.granted) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tool.id)) next.delete(tool.id);
      else next.add(tool.id);
      return next;
    });
  };

  const save = () => {
    setError("");
    ask(employeeToolGrantsConfirm({
      name: employeeLabel(employee),
      email: userEmail(employee),
      added: added.map((tool) => tool.label),
      revoked: revoked.map((tool) => tool.label),
    }), async () => {
      setSaving(true);
      try {
        await api.adminSave(`/api/admin/users/${encodeURIComponent(employee.id)}/skills`, { skills: [...selected] }, "PUT");
        onSaved();
        onClose();
      } catch (cause) {
        setError(errorText(cause, "保存工具授权失败"));
      } finally {
        setSaving(false);
      }
    });
  };

  return <>
    <EmployeeModal
      kind="tools"
      title="授权工具"
      subtitle={`${employeeLabel(employee)} · 仅显示可在员工端使用的已发布工具。`}
      onClose={onClose}
      footer={<><p className="employee-dialog-note">新增 {added.length} 项 · 停用 {revoked.length} 项</p><button type="button" className="btn work" data-employee-tools-save disabled={loading || saving} onClick={save}>{saving ? "保存中…" : "保存授权"}</button></>}
    >
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="employee-tools-toolbar">
        <input data-employee-tool-search value={query} placeholder="搜索工具名称或分类" aria-label="搜索工具" onChange={(event) => setQuery(event.target.value)} />
        <select data-employee-tool-filter value={filter} onChange={(event) => setFilter(event.target.value as "all" | "enabled" | "disabled")}><option value="all">全部状态</option><option value="enabled">已授权</option><option value="disabled">未授权</option></select>
      </div>
      {loading ? <p className="muted">正在读取已发布工具…</p> : <ul className="employee-tool-list" data-employee-tool-list>
        {shown.map((tool) => {
          const checked = selected.has(tool.id);
          const unavailable = !tool.assignable && !tool.granted;
          return <li key={tool.id} data-employee-tool={tool.id} data-state={checked ? "enabled" : "disabled"}>
            <label><input type="checkbox" checked={checked} disabled={unavailable} onChange={() => toggle(tool)} /><span><strong>{tool.label}</strong><small>{tool.category || "未分类"} · {tool.summary || "未填写说明"}</small></span></label>
            <span className={`admin-status is-${checked ? "configured" : "unattached"}`}>{checked ? "已授权" : unavailable ? "未发布" : "未授权"}</span>
          </li>;
        })}
        {!shown.length ? <li className="employee-tool-empty">没有符合条件的工具。</li> : null}
      </ul>}
    </EmployeeModal>
    {dialog}
  </>;
}

export function EmployeeDirectory({ users, onReload }: { users: Employee[]; onReload: () => void }) {
  const { ask, dialog } = useAdminConfirm();
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [query, setQuery] = useState("");
  const [org, setOrg] = useState("");
  const [brand, setBrand] = useState("");
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);
  const [toolEmployee, setToolEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    let live = true;
    api.adminOrganizationUnits().then((data) => { if (live) setUnits(data.units || []); }).catch(() => { if (live) setUnits([]); });
    return () => { live = false; };
  }, []);

  const brands = useMemo(() => [...new Set(users.flatMap((user) => asList(user.brands)))].sort(), [users]);
  const organizations = useMemo(() => {
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    for (const user of users) {
      const value = text(user.site);
      if (value && !byId.has(value)) byId.set(value, { id: value, display_name: value, type: "", parent: null, level: 1 });
    }
    return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, "zh-CN"));
  }, [units, users]);
  const filtered = useMemo(() => users.filter((user) => {
    const needle = query.trim().toLowerCase();
    const haystack = `${employeeLabel(user)} ${userEmail(user)} ${text(user.position)} ${orgLabel(user.site, units)} ${asList(user.brands).join(" ")}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (org && text(user.site) !== org) return false;
    if (brand && !asList(user.brands).includes(brand)) return false;
    return true;
  }), [brand, org, query, units, users]);

  const deactivate = (user: Employee) => {
    ask(userDeactivateConfirm(employeeLabel(user), userEmail(user)), async () => {
      await api.adminSave(`/api/admin/users/${encodeURIComponent(user.id)}`, { active: false }, "PATCH");
      onReload();
    });
  };

  const activate = async (user: Employee) => {
    await api.adminSave(`/api/admin/users/${encodeURIComponent(user.id)}`, { active: true }, "PATCH");
    onReload();
  };

  return <section className="employee-directory" data-admin-employees>
    <header className="employee-directory-head">
      <div><p className="page-kicker">组织治理</p><h1>员工目录</h1><p className="muted">维护组织归属、业务绑定与个人工具权限。</p></div>
      <button type="button" className="btn work" data-employee-create onClick={() => setEditing(null)}>新增员工</button>
    </header>
    <div className="employee-directory-toolbar">
      <label className="employee-search"><span className="sr-only">搜索员工</span><input data-employee-search value={query} placeholder="搜索姓名、邮箱或岗位" onChange={(event) => setQuery(event.target.value)} /></label>
      <select data-employee-filter="organization" value={org} onChange={(event) => setOrg(event.target.value)}><option value="">全部组织</option>{organizations.map((unit) => <option key={unit.id} value={unit.id}>{unit.display_name}</option>)}</select>
      <select data-employee-filter="brand" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">全部品牌</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <p className="employee-result-count">{filtered.length} / {users.length} 名员工</p>
    </div>
    <div className="admin-table-wrap employee-directory-table-wrap">
      <table className="admin-table employee-directory-table">
        <thead><tr><th>员工</th><th>组织 / 品牌</th><th>业务绑定</th><th>工具权限</th><th className="employee-updated-cell">最近变更</th><th>操作</th></tr></thead>
        <tbody>{filtered.map((user) => {
          const inactive = user.active === false;
          const skills = asList(user.skill_grants);
          return <tr key={user.id} data-employee-row={user.id} data-state={inactive ? "inactive" : "active"}>
            <td><div className="employee-person"><span aria-hidden>{employeeLabel(user).slice(0, 1)}</span><div><strong>{employeeLabel(user)}</strong><p className="muted">{userEmail(user)}{text(user.position) ? ` · ${text(user.position)}` : ""}</p></div></div></td>
            <td><strong>{orgLabel(user.site, units)}</strong><p className="muted">{compactList(asList(user.brands))}</p></td>
            <td><p>{Number(user.mailbox_count || 0)} 个邮箱 · {Number(user.kol_count || 0)} 个 KOL</p><p className="muted">{inactive ? "账号已停用" : "账号正常"}</p></td>
            <td><strong>{skills.length} 项已授权</strong><p className="muted">{compactList(skills.slice(0, 2), "暂未授权")}{skills.length > 2 ? " …" : ""}</p></td>
            <td className="employee-updated-cell">{formatTime(user.updated_at)}</td>
            <td><div className="admin-inline-actions"><button type="button" className="btn sm" data-employee-action="edit" onClick={() => setEditing(user)}>编辑</button><button type="button" className="btn sm" data-employee-action="tools" onClick={() => setToolEmployee(user)}>授权</button><button type="button" className="btn sm danger" data-employee-action={inactive ? "activate" : "deactivate"} data-admin-user-action={inactive ? "activate" : "deactivate"} onClick={() => inactive ? void activate(user) : deactivate(user)}>{inactive ? "启用" : "停用"}</button></div></td>
          </tr>;
        })}</tbody>
      </table>
      {!filtered.length ? <p className="employee-empty">没有符合当前筛选条件的员工。</p> : null}
    </div>
    {editing !== undefined ? <EmployeeEditDialog key={editing?.id || "new"} employee={editing} allEmployees={users} units={organizations} brands={brands} onClose={() => setEditing(undefined)} onSaved={onReload} /> : null}
    {toolEmployee ? <EmployeeToolDialog employee={toolEmployee} onClose={() => setToolEmployee(null)} onSaved={onReload} /> : null}
    {dialog}
  </section>;
}
