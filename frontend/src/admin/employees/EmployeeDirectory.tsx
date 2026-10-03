import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  type AdminEmployeeContext,
  type AdminEmployeeMailbox,
  type AdminEmployeeKol,
} from "../../api";
import { useFocusLock } from "../../hooks/useFocusLock";
import type { OrganizationUnit } from "../../runtimeConnectorUi";
import "./employee-directory.css";

export type DirectoryEmployee = Record<string, unknown> & {
  id: string;
  name?: string;
  avatar_url?: string | null;
  username?: string;
  email?: string;
  site?: string;
  position?: string;
  manager_user_id?: string;
  brands?: string[];
  roles?: string[];
  active?: boolean;
  updated_at?: string;
  mailbox_count?: number;
  kol_count?: number;
};

type Employee = DirectoryEmployee;

type EmployeeDialogKind = "edit" | "create" | "tools" | "bind";

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

export function EmployeeEditDialog({
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
      subtitle={existing ? "更新组织资料，并查看该员工当前绑定的邮箱和 KOL。" : "新建的员工默认作为普通员工；创建后可绑定 Agent。"}
      onClose={onClose}
      footer={<><p className="employee-dialog-note">{existing ? "保存后立即更新员工资料；Agent 绑定单独管理。" : "创建后可继续绑定 Agent。"}</p><button type="button" className="btn work" data-employee-edit-save disabled={saving || loading} onClick={() => void save()}>{saving ? "保存中…" : existing ? "保存资料" : "创建员工"}</button></>}
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
