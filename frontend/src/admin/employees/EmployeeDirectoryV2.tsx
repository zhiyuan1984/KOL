import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type AdminAgentAccessSource, type AdminAgentRow, type AdminAgentsResponse, type AdminBindingPreview, type AdminEmployeeAgent } from "../../api";
import { EmployeeEditDialog, type DirectoryEmployee } from "./EmployeeDirectory";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { agentBindingRevokeConfirm, userDeactivateConfirm } from "../../adminConfirm";
import { useFocusLock } from "../../hooks/useFocusLock";
import "../governance-layout.css";
import "./employee-directory.css";

type Employee = DirectoryEmployee;
/** 平台系统智能体不对应人员，员工页不提供绑定。 */
const PLATFORM_SYNC_AGENT = "agent:platform-sync";
const label = (employee: Employee) => String(employee.name || employee.email || employee.username || employee.id);
const email = (employee: Employee) => String(employee.email || (String(employee.username || "").includes("@") ? employee.username : "") || "未登记邮箱");
const names = (employee: Employee) => Array.isArray(employee.brands) ? employee.brands : [];
/** 管理目录的组织筛选包含该组织的全部下级；这里只决定列表呈现，不计算使用授权。 */
function belongsToOrganization(employee: Employee, selectedId: string, parents: Map<string, string | null>): boolean {
  const starts = employee.org_unit_ids?.length ? employee.org_unit_ids : [employee.site || ""];
  return starts.some((start) => {
    let current = start;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === selectedId) return true;
      visited.add(current);
      current = parents.get(current) || "";
    }
    return false;
  });
}
const VIA_LABEL: Record<AdminEmployeeAgent["via"], string> = {
  binding_target: "直接绑定",
  unit_head: "部门负责人",
  unit_member: "部门成员",
  ancestor_head: "上级负责人",
};
const agentStatus = (status: AdminAgentRow["status"]) => status === "published" ? "已发布" : status === "disabled" ? "已停用" : "草稿";
/** 一个 Agent 可能经多个绑定点覆盖同一人；逐条列出，不只显示优先级最高的那条。 */
const accessSources = (row: AdminEmployeeAgent): AdminAgentAccessSource[] => row.sources?.length ? row.sources : [{
  via: row.via, via_unit_id: row.via_unit_id, via_unit_display_name: row.via_unit_display_name, binding_id: row.binding_id,
  binding_target_type: row.via === "binding_target" ? "person" : "organization_unit", binding_target_id: "", binding_target_display_name: null,
}];
const sourceText = (source: AdminAgentAccessSource) => {
  const unit = source.via_unit_display_name ? ` · ${source.via_unit_display_name}` : "";
  const point = source.binding_target_type === "organization_unit" && source.binding_target_id && source.binding_target_id !== source.via_unit_id
    ? `（绑定点：${source.binding_target_display_name || source.binding_target_id}）` : "";
  return `${VIA_LABEL[source.via] || source.via}${unit}${point}`;
};

/** 只折叠服务端给出的覆盖结果；展开不读取或写入新的权限。 */
function EmployeeAgentSummary({ names, loading }: { names: string[]; loading: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [previewCount, setPreviewCount] = useState(2);
  const [clipped, setClipped] = useState(false);
  const signature = names.join("、");

  useEffect(() => {
    const root = rootRef.current;
    if (!root || loading || !names.length) return;
    const measure = () => {
      const samples = root.querySelectorAll<HTMLElement>("[data-agent-measure]");
      const toggle = root.querySelector<HTMLElement>("[data-agent-toggle-measure]");
      if (!samples.length || !toggle) return;
      const width = root.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(root).columnGap) || 0;
      const first = samples[0].getBoundingClientRect().width;
      const pair = samples[samples.length - 1].getBoundingClientRect().width;
      const needsToggle = names.length > 2 || pair > width;
      const available = width - (needsToggle ? toggle.getBoundingClientRect().width + gap : 0);
      setPreviewCount(pair <= available ? Math.min(2, names.length) : 1);
      setClipped(first > available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll<HTMLElement>(".employee-agent-measure > span").forEach((sample) => observer.observe(sample));
    return () => observer.disconnect();
  }, [signature, loading, names.length]);

  const canExpand = names.length > previewCount || clipped;
  const hiddenCount = Math.max(0, names.length - previewCount);
  return <div ref={rootRef} className="employee-agent-summary" data-expanded={expanded && canExpand}>
    <span id={listId} className={`employee-agent${expanded && canExpand ? " is-expanded" : ""}`}>
      {loading ? "读取中…" : !names.length ? "未绑定 Agent" : expanded && canExpand ? signature : names.slice(0, previewCount).join("、")}
    </span>
    {canExpand && <button type="button" className="employee-agent-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "收起" : `展开更多智能体${hiddenCount ? `（+${hiddenCount}）` : ""}`}
    </button>}
    {!!names.length && <div className="employee-agent-measure" aria-hidden="true">
      <span data-agent-measure>{names[0]}</span><span data-agent-measure>{names.slice(0, 2).join("、")}</span>
      <span data-agent-toggle-measure>展开更多智能体{names.length > 1 ? `（+${names.length - 1}）` : ""}</span>
    </div>}
  </div>;
}

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
  const revoke = async (row: AdminEmployeeAgent, bindingId: string) => {
    setRevokeBusyId(bindingId);
    setLoadError("");
    try {
      const revokePreview = await api.adminAgentRevokePreview(row.id, bindingId);
      const removed = revokePreview.removed.map((entry) => entry.display_name || entry.person_ref);
      ask(agentBindingRevokeConfirm({
        agentName: row.name,
        agentId: row.id,
        targetLabel: `人员 · ${row.display_name || label(employee)}`,
        removed,
      }), async (reason) => {
        await api.adminAgentUnbind(row.id, bindingId, reason || "管理侧员工页撤销");
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
            {rows && rows.length > 0 && <div className="employee-binding-list"><ul>{rows.map((row) => <li key={row.id} data-employee-agent={row.id}>
              <div><strong>{row.name}</strong><p>{agentStatus(row.status)}</p>{accessSources(row).map((source) => <p key={source.binding_id} data-employee-agent-source={source.binding_id}>{sourceText(source)}</p>)}</div>
              {accessSources(row).some((source) => source.via === "binding_target") ? <button type="button" className="governance-minor" disabled={Boolean(revokeBusyId) || bindBusy} onClick={() => void revoke(row, accessSources(row).find((source) => source.via === "binding_target")!.binding_id)}>{revokeBusyId ? "读取中…" : "撤销"}</button> : <span>继承来源</span>}
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
  const [departments, setDepartments] = useState(["", "", ""]);
  const [person, setPerson] = useState("");
  const [personQuery, setPersonQuery] = useState("");
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
  const unitParents = useMemo(() => new Map(units.map((unit) => [unit.id, unit.parent_id])), [units]);
  const brands = useMemo(() => [...new Set(users.flatMap(names))].sort(), [users]);
  const orgs = useMemo(() => units.filter((unit) => users.some((user) => belongsToOrganization(user, unit.id, unitParents))), [units, users, unitParents]);
  const org = departments[2] || departments[1] || departments[0];
  const people = users.filter((user) => !org || belongsToOrganization(user, org, unitParents));
  const changeDepartment = (index: number, value: string) => {
    setDepartments((current) => {
      const next = current.map((id, position) => position === index ? value : position > index ? "" : id);
      let parentId = unitParents.get(value);
      for (let position = index - 1; value && position >= 0; position--) {
        next[position] = parentId || "";
        parentId = parentId ? unitParents.get(parentId) : null;
      }
      return next;
    });
    setPerson("");
    setPersonQuery("");
  };
  const visible = useMemo(() => users.filter((user) => {
    const search = query.trim().toLowerCase();
    if (search && ![label(user), email(user), String(user.position || ""), String(user.employee_no || "")].join(" ").toLowerCase().includes(search)) return false;
    if (org && !belongsToOrganization(user, org, unitParents)) return false;
    if (person && user.id !== person) return false;
    if (brand && !names(user).includes(brand)) return false;
    if (account === "active" && user.active === false) return false;
    if (account === "disabled" && user.active !== false) return false;
    return true;
  }), [users, query, org, person, brand, account, unitParents]);
  const agentNames = (user: Employee) => (data?.agents || [])
    .filter((agent) => agent.coverage.user_ids.includes(user.id))
    .map((agent) => `${agent.name}${agent.status === "published" ? "" : agent.status === "draft" ? "（草稿）" : "（停用）"}`);
  const changeActive = (user: Employee) => {
    const act = async () => {
      await api.adminSave(`/api/admin/users/${encodeURIComponent(user.id)}`, { active: user.active === false }, "PATCH");
      setNotice(`${label(user)} 的账号已${user.active === false ? "启用" : "停用"}。`);
      onReload();
    };
    if (user.active === false) {
      void act().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "账号操作失败"));
      return;
    }
    // 停用失败不落页面：异常交给确认卡显示，弹窗保持打开等待重试或取消。
    ask(userDeactivateConfirm(label(user), email(user)), act);
  };
  return <section className="governance-workspace" data-admin-employees>
    <aside className="governance-rail">
      <div className="governance-scroll">
        <div className="governance-search-wrap employee-search-wrap"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg><input className="governance-search" aria-label="搜索员工" data-employee-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、邮箱、岗位、工号" /></div>
        <div className="governance-filter-group"><strong>品牌</strong><div className="governance-filter-options"><button type="button" aria-pressed={!brand} onClick={() => setBrand("")}>全部</button>{brands.map((item) => <button type="button" key={item} aria-pressed={brand === item} onClick={() => setBrand(item)}>{item}</button>)}</div></div>
        <div className="governance-filter-group"><strong>状态</strong><div className="governance-filter-options">{([["all", "全部"], ["active", "启用"], ["disabled", "停用"]] as const).map(([id, name]) => <button type="button" key={id} aria-pressed={account === id} onClick={() => setAccount(id)}>{name}</button>)}</div></div>
        <section className="employee-organization-filter" aria-label="组织筛选"><h3>组织</h3>{["一级部门", "二级部门", "三级部门"].map((title, index) => {
          const parent = index ? departments[index - 1] : "";
          const options = orgs.filter((unit) => unit.level === index + 1 && (!parent || unit.parent_id === parent));
          return <label key={title}>{title}<select value={departments[index]} onChange={(event) => changeDepartment(index, event.target.value)} disabled={!data || !options.length} data-employee-department={index + 1}><option value="">{!data ? "正在读取组织…" : options.length ? "全部" : "无下级部门"}</option>{options.map((unit) => <option key={unit.id} value={unit.id}>{unit.display_name}</option>)}</select></label>;
        })}<label>人员<input type="search" aria-label="搜索组织内人员" placeholder="搜索姓名或邮箱" value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} /><select aria-label="人员" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">全部</option>{people.filter((user) => user.id === person || `${label(user)} ${email(user)}`.toLowerCase().includes(personQuery.trim().toLowerCase())).map((user) => <option key={user.id} value={user.id}>{label(user)} · {email(user)}</option>)}</select></label></section>
      </div>
      <div className="governance-rail-footer"><button type="button" className="governance-text-action" data-employee-create onClick={() => setEditing(null)}>新增员工</button></div>
    </aside>
    <div className="governance-main" role="region" aria-label="员工列表">
      <div className="governance-scroll">
        {notice && <p className="governance-notice" role="status">{notice}</p>}
        {loadError && <p className="error" role="alert">{loadError}</p>}
        <div className="governance-list">
          {visible.map((user) => <div className="governance-list-row governance-employee-row" key={user.id} data-employee-row={user.id}>
            <div className="employee-card">
              <div className="employee-avatar" aria-hidden="true">
                {user.avatar_url ? <img data-employee-avatar src={String(user.avatar_url)} alt="" /> : <span>{label(user).slice(0, 1)}</span>}
              </div>
              <div className="employee-main">
                <div className="employee-row employee-row-primary">
                  <div className="employee-profile">
                    <div className="employee-identity">
                      <strong className="employee-name" title={user.employee_no ? `${label(user)} · 工号 ${user.employee_no}` : label(user)}>{label(user)}</strong>{user.employee_no ? <><span className="employee-dot" aria-hidden="true">·</span><span className="employee-no" title={String(user.employee_no)}>{user.employee_no}</span></> : null}
                    </div>
                    <span className="employee-divider" aria-hidden="true" />
                    <EmployeeAgentSummary names={agentNames(user)} loading={!data} />
                  </div>
                </div>
                <div className="employee-row employee-row-secondary">
                  <div className="employee-email" title={email(user)}>{email(user)}</div>
                  <div className="employee-actions">
                    <button type="button" onClick={() => setEditing(user)}>编辑</button>
                    <span className="action-divider" aria-hidden="true" />
                    <button type="button" onClick={() => setManaging(user)}>管理绑定</button>
                    <span className="action-divider" aria-hidden="true" />
                    <button type="button" data-employee-action={user.active === false ? "enable" : "deactivate"} className={user.active === false ? undefined : "employee-danger-action"} onClick={() => changeActive(user)}>{user.active === false ? "启用" : "停用"}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>)}
          {!visible.length && <p className="governance-empty">没有符合筛选条件的员工。</p>}
        </div>
      </div>
    </div>
    {editing !== undefined && <EmployeeEditDialog key={editing?.id || "new"} employee={editing} allEmployees={users} units={units.map((unit) => ({ ...unit, type: "", parent: unit.parent_id, level: unit.level }))} brands={brands} onClose={() => setEditing(undefined)} onSaved={() => { onReload(); void reload(); }} />}
    {managing && <EmployeeBindingDialog key={managing.id} employee={managing} agents={(data?.agents || []).filter((agent) => agent.id !== PLATFORM_SYNC_AGENT)} agentsLoading={!data} onClose={() => setManaging(null)} onChanged={() => { void reload(); onReload(); }} />}
    {dialog}
  </section>;
}
