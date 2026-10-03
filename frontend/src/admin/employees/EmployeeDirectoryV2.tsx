import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type AdminAgentRow, type AdminAgentsResponse, type AdminBindingPreview, type AdminEmployeeAgent } from "../../api";
import { EmployeeEditDialog, type DirectoryEmployee } from "./EmployeeDirectory";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { agentBindingRevokeConfirm, userDeactivateConfirm } from "../../adminConfirm";
import { useFocusLock } from "../../hooks/useFocusLock";
import "../governance-layout.css";
import "./employee-directory.css";

type Employee = DirectoryEmployee;
const label = (employee: Employee) => String(employee.name || employee.email || employee.username || employee.id);
const email = (employee: Employee) => String(employee.email || employee.username || "");
const names = (employee: Employee) => Array.isArray(employee.brands) ? employee.brands : [];
const VIA_LABEL: Record<AdminEmployeeAgent["via"], string> = {
  binding_target: "直接绑定",
  unit_head: "部门负责人",
  unit_member: "部门成员",
  ancestor_head: "上级负责人",
};
const agentStatus = (status: AdminAgentRow["status"]) => status === "published" ? "已发布" : status === "disabled" ? "已停用" : "草稿";

function EmployeeBindingDialog({
  employee,
  agents,
  agentsLoading,
  onClose,
  onChanged,
}: {
  employee: Employee;
  agents: AdminAgentRow[];
  agentsLoading: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const previewToken = useRef(0);
  const [rows, setRows] = useState<AdminEmployeeAgent[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [preview, setPreview] = useState<AdminBindingPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [bindBusy, setBindBusy] = useState(false);
  const [bindError, setBindError] = useState("");
  const [revokeBusyId, setRevokeBusyId] = useState("");
  const { ask, dialog } = useAdminConfirm();

  const loadRows = useCallback(async () => {
    try {
      const response = await api.adminEmployeeAgents(employee.id);
      setRows(response.agents);
      setLoadError("");
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "无法读取该员工的可用 Agent"); }
  }, [employee.id]);
  useEffect(() => { void loadRows(); }, [loadRows]);
  useFocusLock({
    open: true,
    rootRef,
    onEscape: () => { if (!bindBusy && !previewBusy && !revokeBusyId) onClose(); },
    lockBody: true,
    restore: true,
  });

  const chooseCandidate = async (id: string) => {
    const token = ++previewToken.current;
    setCandidateId(id);
    setPreview(null);
    setPreviewError("");
    setBindError("");
    if (!id) return;
    setPreviewBusy(true);
    try {
      const result = await api.adminAgentBindingsPreview(id, { target_type: "person", user_id: employee.id });
      if (previewToken.current === token) setPreview(result);
    } catch (cause) {
      if (previewToken.current === token) setPreviewError(cause instanceof Error ? cause.message : "无法预览绑定覆盖");
    } finally { if (previewToken.current === token) setPreviewBusy(false); }
  };
  const confirmBind = async () => {
    if (!candidateId || !preview) return;
    setBindBusy(true);
    setBindError("");
    try {
      await api.adminAgentBind(candidateId, { target_type: "person", user_id: employee.id, reason: "管理侧员工页绑定" });
      setStatus(`已将 ${label(employee)} 绑定到 Agent；覆盖范围已按组织树重算。`);
      setCandidateId("");
      setPreview(null);
      await loadRows();
      onChanged();
    } catch (cause) { setBindError(cause instanceof Error ? cause.message : "绑定失败"); }
    finally { setBindBusy(false); }
  };
  const revoke = async (row: AdminEmployeeAgent) => {
    setRevokeBusyId(row.binding_id);
    setLoadError("");
    try {
      const revokePreview = await api.adminAgentRevokePreview(row.id, row.binding_id);
      const removed = revokePreview.removed.map((entry) => entry.display_name || entry.person_ref);
      ask(agentBindingRevokeConfirm({
        agentName: row.name,
        agentId: row.id,
        targetLabel: `人员 · ${row.display_name || label(employee)}`,
        removed,
      }), async (reason) => {
        await api.adminAgentUnbind(row.id, row.binding_id, reason || "管理侧员工页撤销");
        setStatus("直接绑定已撤销；覆盖范围已按组织树重算。");
        await loadRows();
        onChanged();
      });
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "无法读取撤销预览"); }
    finally { setRevokeBusyId(""); }
  };

  const candidate = agents.find((agent) => agent.id === candidateId) || null;
  const orgVersion = preview?.org_version ?? candidate?.coverage.org_version;
  const added = preview?.added || [];

  return createPortal(
    <div className="employee-dialog-layer" data-employee-dialog="bind">
      <div className="employee-dialog-backdrop" onClick={() => { if (!bindBusy) onClose(); }} />
      <section ref={rootRef} className="employee-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="employee-dialog-head">
          <div>
            <h2 id={titleId}>{label(employee)} · 管理绑定</h2>
            <p className="muted">个人绑定可直接撤销；部门负责人、部门成员、上级负责人来源由组织树继承，需在 Agent 页调整绑定点。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" data-employee-dialog-close onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="employee-dialog-body">
          {loadError && <p className="error" role="alert">{loadError}</p>}
          {status && <p className="governance-notice" role="status">{status}</p>}
          <section className="employee-form-section">
            <h3>可用 Agent 与来源</h3>
            {!rows && !loadError && <p className="muted">正在读取…</p>}
            {rows && !rows.length && <p className="muted">该员工当前没有可用的 Agent。</p>}
            {rows && rows.length > 0 && <div className="employee-binding-list"><ul>{rows.map((row) => <li key={`${row.id}:${row.binding_id}`} data-employee-agent={row.id}>
              <div><strong>{row.name}</strong><p>{agentStatus(row.status)} · {VIA_LABEL[row.via] || row.via}{row.via_unit_display_name ? ` · ${row.via_unit_display_name}` : ""}</p></div>
              {row.via === "binding_target" ? <button type="button" className="governance-minor" disabled={Boolean(revokeBusyId) || bindBusy} onClick={() => void revoke(row)}>{revokeBusyId === row.binding_id ? "读取中…" : "撤销"}</button> : <span>继承来源</span>}
            </li>)}</ul></div>}
          </section>
          <section className="employee-form-section">
            <h3>绑定新 Agent</h3>
            <p className="muted">单选 Agent 后先试算覆盖，再确认绑定。个人绑定同时授予所属二级及一级部门负责人使用权限。</p>
            <div className="governance-checkbox-list">{agents.map((agent) => <label key={agent.id}><input type="radio" name="employee-agent-candidate" checked={candidateId === agent.id} disabled={bindBusy} onChange={() => void chooseCandidate(agent.id)} />{agent.name} · {agentStatus(agent.status)}</label>)}</div>
            {agentsLoading && <p className="muted">正在读取 Agent 列表…</p>}
            {!agentsLoading && !agents.length && <p className="muted">没有可绑定的 Agent。</p>}
            {previewBusy && <p className="muted">正在试算覆盖…</p>}
            {previewError && <p className="error" role="alert">{previewError}</p>}
            {preview && <div className="employee-binding-list" data-employee-binding-preview>
              <p>{orgVersion === undefined ? "组织版本 —" : `组织版本 ${orgVersion}`} · 将新增覆盖 {added.length} 人{added.length ? `（绑定后共 ${preview.after.user_ids.length} 人）` : "，覆盖名单不变"}</p>
              {added.length > 0 && <ul>{added.map((entry) => <li key={`${entry.person_ref}:${entry.via}`}><div><strong>{entry.display_name || entry.person_ref}</strong><p>{VIA_LABEL[entry.via] || entry.via}{entry.via_unit_display_name ? ` · ${entry.via_unit_display_name}` : ""}</p></div></li>)}</ul>}
            </div>}
            {bindError && <p className="error" role="alert">{bindError}</p>}
          </section>
        </div>
        <footer className="employee-dialog-foot">
          <p className="employee-dialog-note">试算只展示将变化的人员名单，不写入数据。</p>
          <button type="button" className="btn work" disabled={!preview || bindBusy || previewBusy} onClick={() => void confirmBind()}>{bindBusy ? "绑定中…" : "确认绑定"}</button>
        </footer>
      </section>
      {dialog}
    </div>,
    document.body,
  );
}

export function EmployeeDirectoryV2({ users, onReload }: { users: Employee[]; onReload: () => void }) {
  const [data, setData] = useState<AdminAgentsResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [org, setOrg] = useState("");
  const [brand, setBrand] = useState("");
  const [account, setAccount] = useState<"all" | "active" | "disabled">("all");
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);
  const [managing, setManaging] = useState<Employee | null>(null);
  const { ask, dialog } = useAdminConfirm();
  const reload = useCallback(async () => {
    try { setData(await api.adminAgents()); setLoadError(""); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : "Agent 数据读取失败"); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const units = useMemo(() => data?.units || [], [data]);
  const brands = useMemo(() => [...new Set(users.flatMap(names))].sort(), [users]);
  const orgs = useMemo(() => units.filter((unit) => users.some((user) => user.site === unit.id)), [units, users]);
  const visible = useMemo(() => users.filter((user) => {
    const search = query.trim().toLowerCase();
    if (search && ![label(user), email(user), String(user.position || "")].join(" ").toLowerCase().includes(search)) return false;
    if (org && user.site !== org) return false;
    if (brand && !names(user).includes(brand)) return false;
    if (account === "active" && user.active === false) return false;
    if (account === "disabled" && user.active !== false) return false;
    return true;
  }), [users, query, org, brand, account]);
  const agentNames = (user: Employee) => (data?.agents || [])
    .filter((agent) => agent.coverage.user_ids.includes(user.id))
    .map((agent) => `${agent.name}${agent.status === "published" ? "" : agent.status === "draft" ? "（草稿）" : "（停用）"}`);
  const changeActive = (user: Employee) => {
    const act = async () => {
      try {
        await api.adminSave(`/api/admin/users/${encodeURIComponent(user.id)}`, { active: user.active === false }, "PATCH");
        setNotice(`${label(user)} 的账号已${user.active === false ? "启用" : "停用"}。`);
        onReload();
      } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "账号操作失败"); }
    };
    if (user.active === false) void act();
    else ask(userDeactivateConfirm(label(user), email(user)), act);
  };
  return <section className="governance-workspace" data-admin-employees>
    <aside className="governance-rail">
      <div className="governance-scroll">
        <input className="governance-search" aria-label="搜索员工" data-employee-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、邮箱、岗位" />
        <p className="governance-count">{visible.length} / {users.length} 名员工</p>
        <div className="governance-filter-group"><strong>品牌</strong><div className="governance-filter-options"><button type="button" aria-pressed={!brand} onClick={() => setBrand("")}>全部</button>{brands.map((item) => <button type="button" key={item} aria-pressed={brand === item} onClick={() => setBrand(item)}>{item}</button>)}</div></div>
        <div className="governance-filter-group"><strong>账号</strong><div className="governance-filter-options">{([["all", "全部"], ["active", "启用"], ["disabled", "停用"]] as const).map(([id, name]) => <button type="button" key={id} aria-pressed={account === id} onClick={() => setAccount(id)}>{name}</button>)}</div></div>
        <div className="governance-filter-group"><strong>组织</strong><div className="governance-filter-options"><button type="button" aria-pressed={!org} onClick={() => setOrg("")}>全部</button>{orgs.map((unit) => <button type="button" key={unit.id} aria-pressed={org === unit.id} onClick={() => setOrg(unit.id)}>{unit.display_name}</button>)}</div></div>
      </div>
      <div className="governance-rail-footer"><button type="button" className="btn work" data-employee-create onClick={() => setEditing(null)}>新增员工</button></div>
    </aside>
    <div className="governance-main">
      <header className="governance-main-head"><h2>员工列表</h2><span className="governance-count">{visible.length} 人</span></header>
      <div className="governance-scroll">
        {notice && <p className="governance-notice" role="status">{notice}</p>}
        {loadError && <p className="error" role="alert">{loadError}</p>}
        <div className="governance-list">
          {visible.map((user) => <div className="governance-list-row governance-employee-row" key={user.id} data-employee-row={user.id}>
            <strong>{user.avatar_url ? <img className="employee-row-avatar" data-employee-avatar src={String(user.avatar_url)} alt="" aria-hidden /> : null}{label(user)}</strong><span className="muted">{email(user)}</span>
            <span>{units.find((unit) => unit.id === user.site)?.display_name || user.site || "未分配"}</span>
            <span>{names(user).join("、") || "—"}</span>
            <span>{user.position || "—"}</span>
            <span>{data ? agentNames(user).join("、") || "未绑定 Agent" : "读取中…"}</span>
            <span className="governance-inline-actions"><button type="button" onClick={() => setEditing(user)}>编辑</button><button type="button" onClick={() => setManaging(user)}>管理绑定</button><button type="button" onClick={() => changeActive(user)}>{user.active === false ? "启用" : "停用"}</button></span>
          </div>)}
          {!visible.length && <p className="governance-empty">没有符合筛选条件的员工。</p>}
        </div>
      </div>
    </div>
    {editing !== undefined && <EmployeeEditDialog key={editing?.id || "new"} employee={editing} allEmployees={users} units={units.map((unit) => ({ ...unit, type: "", parent: unit.parent_id, level: unit.level }))} brands={brands} onClose={() => setEditing(undefined)} onSaved={() => { onReload(); void reload(); }} />}
    {managing && <EmployeeBindingDialog key={managing.id} employee={managing} agents={data?.agents || []} agentsLoading={!data} onClose={() => setManaging(null)} onChanged={() => { void reload(); onReload(); }} />}
    {dialog}
  </section>;
}
