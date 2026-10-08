import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type AiTaskWorkOrderList, type OrganizationTicketRawCountReport, type OrganizationTicketStageRawReport, type TicketAccountBindingOptions, type TicketOrganizationQualityReport, type WorkOrderAutomationRelease, type WorkOrderTemplate, type WorkOrderTemplateDraftInput } from "../api";
import { useAccount } from "../components/AuthGate";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { LifecycleNavigation } from "../components/LifecycleNavigation";
import { LifecycleWorkspace } from "../components/LifecycleWorkspace";
import { randomUuid } from "../uuid";

function time(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(parsed);
}
const issueLabel: Record<string, string> = { person_without_account: "账号缺失", person_without_org: "组织缺失", unit_head_without_account: "负责人账号缺失" };
// Display labels only. Transitions and authorization remain server-owned.
const statusLabels: Record<string, string> = { pending: "待受理", accepted: "已受理", in_progress: "处理中", completed: "已完成", cancelled: "已取消", failed: "失败", queued: "排队中", waiting: "等待中", waiting_approval: "待审批", needs_clarification: "待补充", blocked: "阻塞", ready_for_review: "待复核" };
const templateLabels: Record<string, string> = { draft: "草稿", published: "已发布", disabled: "已停用", retired: "已退役" };
const safeError = (cause: unknown, fallback: string) => {
  const message = cause instanceof Error ? cause.message : String(cause || "");
  return /[\u4e00-\u9fff]/.test(message) && !/PostgreSQL|SELECT |transactions|serialization/i.test(message) ? message : fallback;
};
type ReadState<T> = { status: "loading" | "ready" | "error"; data: T | null; error: string };
type Data = {
  quality: TicketOrganizationQualityReport;
  binding: TicketAccountBindingOptions;
  counts: OrganizationTicketRawCountReport;
  stages: OrganizationTicketStageRawReport;
  templates: { templates: WorkOrderTemplate[] };
  releases: { releases: WorkOrderAutomationRelease[] };
  tasks: AiTaskWorkOrderList;
};
type Reads = { [K in keyof Data]: ReadState<Data[K]> };
const pending = { status: "loading" as const, data: null, error: "" };
const initialReads = (): Reads => ({ quality: pending, binding: pending, counts: pending, stages: pending, templates: pending, releases: pending, tasks: pending });

function ReadBlock({ read, label, retry, children, empty }: { read: ReadState<unknown>; label: string; retry: () => void; children: ReactNode; empty?: string }) {
  if (read.status === "loading") return <div className="lifecycle-resource-state" data-state="loading" role="status">正在读取{label}…</div>;
  if (read.status === "error") return <div className="lifecycle-resource-state" data-state="error" role="alert">
    <span>{label}读取失败</span><button type="button" className="lifecycle-text-action" onClick={retry}>重试</button>
    <details><summary>诊断详情</summary><pre>{read.error}</pre></details>
  </div>;
  return empty ? <p className="lifecycle-help" role="status">{empty}</p> : <>{children}</>;
}

/** Governance view of existing authorized reports, never a second employee work queue. */
export default function AdminWorkOrders() {
  const { account } = useAccount();
  const { ask, dialog, open: confirming } = useAdminConfirm();
  const [reads, setReads] = useState<Reads>(initialReads);
  const generation = useRef(0);
  const [view, setView] = useState("overview");
  const [orderState, setOrderState] = useState("all");
  const [templateState, setTemplateState] = useState("all");
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [level, setLevel] = useState<WorkOrderTemplateDraftInput["automation_level"]>("A1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const current = ++generation.current;
    setReads(initialReads());
    const read = async <K extends keyof Data>(key: K, fetcher: () => Promise<Data[K]>) => {
      try {
        const data = await fetcher();
        if (generation.current === current) setReads(previous => ({ ...previous, [key]: { status: "ready", data, error: "" } }));
      } catch (cause) {
        if (generation.current === current) setReads(previous => ({ ...previous, [key]: { status: "error", data: null, error: cause instanceof Error ? cause.message : "读取未完成" } }));
      }
    };
    await Promise.all([
      read("quality", api.adminTicketOrganizationQuality), read("binding", api.adminTicketAccountBindingOptions),
      read("counts", () => api.organizationTicketRawCountReport()), read("stages", () => api.organizationTicketStageRawReport()),
      read("templates", () => api.adminWorkOrderTemplates()), read("releases", api.adminWorkOrderAutomationReleases),
      read("tasks", () => api.aiTaskWorkOrders()),
    ]);
  }, []);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const retry = () => { void load(); };
  const loading = Object.values(reads).some(read => read.status === "loading");
  const quality = reads.quality.data;
  const counts = reads.counts.data;
  const stages = reads.stages.data;
  const templates = reads.templates.data?.templates || [];
  const releases = reads.releases.data?.releases || [];
  const tasks = reads.tasks.data?.items || [];
  const unbound = (reads.binding.data?.accounts || []).filter(item => !item.bound_person_ref);
  const templateOptions = ["draft", "published", "disabled", "retired", ...templates.map(template => template.status).filter(status => !(status in templateLabels))];
  const uniqueStates = [...new Set(templateOptions)];
  const filteredTemplates = templates.filter(template => (templateState === "all" || template.status === templateState) && `${template.title} ${template.template_code}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedCount = (row: { total: number; by_status: Record<string, number> }) => orderState === "all" ? row.total : row.by_status[orderState] || 0;
  const metric = (key: "quality" | "counts", value: number | undefined) => reads[key].status === "ready" ? value ?? "—" : reads[key].status === "loading" ? "读取中" : "读取失败";
  const idempotency = () => `wot-${randomUuid()}`;

  async function write(run: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await run(); setNotice(success); await load(); }
    catch (cause) { throw new Error(safeError(cause, "操作未完成，请重试或查看审计记录。")); }
    finally { setBusy(false); }
  }
  function bind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const person_ref = String(data.get("person_ref") || ""), account_id = String(data.get("account_id") || ""), reason = String(data.get("reason") || "").trim();
    if (!person_ref || !account_id || reason.length < 2) return;
    const accountName = unbound.find(item => item.id === account_id)?.name || account_id;
    const personName = reads.binding.data?.people.find(item => item.person_ref === person_ref)?.display_name || person_ref;
    ask({ kind: "work-order-binding", title: "确认人员绑定", object: `${accountName} → ${personName}`, scope: "当前工作台账号与受控组织人员", consequence: "绑定将用于正式工单授权，并记录原因与不可变审计。", note: reason, confirmLabel: "确认绑定", confirmTone: "work" }, async () => {
      await write(async () => { await api.bindTicketAccountToOrganizationPerson({ person_ref, account_id, reason }); form.reset(); }, "人员绑定已保存，操作已记录审计。");
    });
  }
  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const split = (name: string) => String(data.get(name) || "").split(/[\n,]/).map(item => item.trim()).filter(Boolean);
    const targets = split("stage_target_stages");
    const input: WorkOrderTemplateDraftInput = {
      template_code: String(data.get("template_code") || "").trim(), title: String(data.get("title") || "").trim(),
      description: String(data.get("description") || "").trim(), automation_level: level,
      trigger_event_types: split("trigger_event_types"), acceptance_criteria: split("acceptance_criteria"),
      routing_policy_code: String(data.get("routing_policy_code") || "").trim() || undefined,
      input_schema: {}, fill_policy: {}, stage_policy: level === "A3" ? { allowed_target_stages: targets, targets: Object.fromEntries(targets.map(stage => [stage, { required_event_types: split("stage_event_types"), required_evidence_keys: split("stage_evidence_keys"), allow_cross_stage: data.get("stage_allow_cross") === "on" }])) } : {},
      idempotency_key: idempotency(),
    };
    try {
      await write(async () => { await api.createWorkOrderTemplateDraft(input); form.reset(); setLevel("A1"); setEditorOpen(false); setTemplateState("draft"); setQuery(""); }, "模板草稿已创建；发布和启用自动执行仍需分别操作。");
    } catch (cause) { setError(safeError(cause, "模板草稿未保存，请重试。")); }
  }
  function templateAction(template: WorkOrderTemplate, action: "publish" | "disable" | "automation") {
    const enabled = releases.find(release => release.template_id === template.id)?.status === "enabled";
    const label = action === "publish" ? "发布模板" : action === "disable" ? "停用模板" : enabled ? "停止自动执行" : "启用自动执行";
    ask({ kind: action === "publish" ? "work-order-publish" : action === "disable" ? "work-order-disable" : "work-order-automation",
      title: `确认${label}`, object: `${template.title} · ${template.template_code}.v${template.version}`, scope: "当前模板版本",
      consequence: action === "publish" ? "发布后可参与候选判断，自动执行仍由独立开关控制。" : action === "disable" ? "该版本将停止参与后续候选判断。" : enabled ? "停止该版本后续的自动执行。" : `${template.automation_level} 自动执行将按已配置路由、置信度与证据约束运行。`,
      confirmLabel: label, confirmTone: action === "disable" || enabled ? "danger" : "work", requireReason: action === "disable" || action === "automation",
    }, async reason => {
      await write(() => action === "publish" ? api.publishWorkOrderTemplate(template.id, { expected_version: template.version, idempotency_key: idempotency() })
        : action === "disable" ? api.disableWorkOrderTemplate(template.id, { reason, idempotency_key: idempotency() })
        : api.setWorkOrderAutomationRelease(template.id, { action: enabled ? "disabled" : "enabled", minimum_confidence: 0.92, routing_policy_code: template.routing_policy_code || undefined, reason, idempotency_key: idempotency() }), `${label}已完成，操作已记录。`);
    });
  }
  const distribution = (byStatus: Record<string, number>) => Object.entries(byStatus).map(([state, count]) => `${statusLabels[state] || state} ${count}`).join(" · ") || "—";
  const links = <><Link className="lifecycle-text-action" to="/admin/audit">查看审计</Link><Link className="lifecycle-text-action" to="/admin/scheduling">查看调度</Link></>;
  const qualitySection = <section className="lifecycle-section" data-organization-quality>
    <div className="lifecycle-section-head"><h3>组织数据质量</h3>{view !== "binding" ? <button type="button" className="lifecycle-text-action" onClick={() => setView("binding")}>管理人员绑定</button> : null}</div>
    <ReadBlock read={reads.quality} label="组织数据质量" retry={retry} empty={quality?.issues.length === 0 ? "当前组织、账号与负责人绑定没有已知阻断项。" : undefined}>
      <table className="lifecycle-table"><thead><tr><th>人员／组织</th><th>阻断原因</th><th>说明</th></tr></thead><tbody>{quality?.issues.map((issue, index) => <tr key={`${issue.type}:${issue.subject_ref}:${index}`} data-ticket-org-quality={issue.type}>
        <td>{issue.display_name}<p className="lifecycle-help">{issue.subject_ref} · {issue.org_unit_id || "未绑定组织"}</p></td><td>{issueLabel[issue.type] || issue.type}</td><td>{issue.message}</td>
      </tr>)}</tbody></table>
    </ReadBlock>
  </section>;
  const overview = <>
    <div className="lifecycle-metrics" data-work-order-metrics>
      <div className="lifecycle-metric"><span>有效组织</span><strong>{metric("quality", quality?.active_unit_count)}</strong></div>
      <div className="lifecycle-metric"><span>有效人员</span><strong>{metric("quality", quality?.active_person_count)}</strong></div>
      <div className="lifecycle-metric"><span>阻断项</span><button type="button" className="lifecycle-text-action" onClick={() => setView("binding")}><strong>{metric("quality", quality?.issue_count)}</strong></button></div>
      <div className="lifecycle-metric"><span>授权工单存量</span><strong>{metric("counts", counts?.total_authorized)}</strong></div>
    </div>
    {quality && quality.issue_count > 0 ? qualitySection : null}
    <section className="lifecycle-section" data-organization-ticket-report>
      <div className="lifecycle-section-head"><h3>工单生命周期</h3><span className="lifecycle-help">{counts ? `${counts.authorization.mode === "company_admin" ? "公司管理员" : "组织负责人"}范围 · ${counts.authorization.root_units.map(unit => unit.display_name).join("、") || "公司级"}` : "授权范围待读取"}</span></div>
      <ReadBlock read={reads.counts} label="组织工单存量" retry={retry}>
        <LifecycleNavigation label="工单状态筛选" idPrefix="order-state" value={orderState} onChange={setOrderState} options={[{ id: "all", label: "全部", count: counts?.total_authorized }, ...Object.entries(counts?.by_status || {}).map(([id, count]) => ({ id, label: statusLabels[id] || id, count }))]} />
        <p className="lifecycle-help">数据时间：{time(counts?.as_of)} · 时区：{counts?.timezone || "—"} · 当前存量，不包含 SLA 或绩效结论。</p>
        {counts?.total_authorized === 0 ? <p className="lifecycle-help">当前授权范围没有正式工单。</p> : <table className="lifecycle-table"><thead><tr><th>受理组织</th><th className="lifecycle-number">{orderState === "all" ? "工单存量" : statusLabels[orderState] || orderState}</th><th>状态分布</th></tr></thead><tbody>
          {counts?.by_assignee_unit.filter(unit => orderState === "all" || selectedCount(unit) > 0).map(unit => <tr key={unit.org_unit_id}><td>{unit.display_name}<p className="lifecycle-help">{unit.type} · {unit.org_unit_id}</p></td><td className="lifecycle-number">{selectedCount(unit)}</td><td>{distribution(unit.by_status)}</td></tr>)}
        </tbody></table>}
      </ReadBlock>
    </section>
    <section className="lifecycle-section" data-organization-ticket-stage-report><h3>分类与阶段原始存量</h3>
      <ReadBlock read={reads.stages} label="分类与阶段存量" retry={retry} empty={stages?.total_authorized === 0 ? "当前授权范围没有可按分类或阶段统计的正式工单。" : undefined}>
        <p className="lifecycle-help">数据时间：{time(stages?.as_of)} · {stages?.note || "仅展示当前存量，不推导转化、时效或绩效。"}</p>
        <p className="lifecycle-help">分类分布：{stages?.by_business_category.map(item => `${item.business_category} ${item.total}`).join(" · ") || "—"} · 总存量 {stages?.total_authorized ?? "—"}</p>
        <table className="lifecycle-table"><thead><tr><th>分类</th><th>阶段</th><th className="lifecycle-number">存量</th><th>状态分布</th></tr></thead><tbody>{stages?.by_stage.map(item => <tr key={`${item.business_category}:${item.stage_group}:${item.stage_code}`}><td>{item.business_category}</td><td>{item.stage_group} / {item.stage_code}</td><td className="lifecycle-number">{item.total}</td><td>{distribution(item.by_status)}</td></tr>)}</tbody></table>
      </ReadBlock>
    </section>
    <section className="lifecycle-section" data-ai-work-order-work-report><div className="lifecycle-section-head"><h3>AI 工单任务工作战报</h3>{reads.tasks.status === "ready" ? <span className="lifecycle-help">本次返回任务根 {tasks.length}</span> : null}</div>
      <ReadBlock read={reads.tasks} label="任务工作战报" retry={retry} empty={tasks.length === 0 ? "本次读取没有返回已授权的 AI 工单任务根。" : undefined}>
        <p className="lifecycle-help">任务是业务目标，工单是执行单元；子工单完成不代表任务完成，不作个人绩效结论。</p>
        <table className="lifecycle-table"><thead><tr><th>任务与目标</th><th>任务状态</th><th className="lifecycle-number">开放／总工单</th><th>阻塞与待复核</th></tr></thead><tbody>{tasks.map(item => <tr key={item.task.task_id}><td>{item.task.title}<p className="lifecycle-help">{item.task.goal}</p></td><td>{statusLabels[item.task.status] || item.task.status}</td><td className="lifecycle-number">{item.counts.open} / {item.counts.total}</td><td>阻塞 {item.counts.blocked} · 待复核 {item.counts.waiting_review}{item.current_blocking_work_order ? <p className="lifecycle-help">当前：{item.current_blocking_work_order.title}</p> : null}</td></tr>)}</tbody></table>
      </ReadBlock>
    </section>
  </>;
  const binding = <>
    {qualitySection}
    <section className="lifecycle-section"><h3>工作台账号与组织人员绑定</h3><p className="lifecycle-help">仅选择已同步的工作台账号与受控组织人员；变更必须填写原因并记录审计。</p>
      <ReadBlock read={reads.binding} label="人员绑定选项" retry={retry}>
        <form className="lifecycle-form" onSubmit={bind}>
          <label className="field">工作台账号<select name="account_id" required defaultValue="" disabled={busy || confirming || !unbound.length}><option value="">{unbound.length ? "选择未绑定工作台账号" : "没有待绑定工作台账号"}</option>{unbound.map(item => <option key={item.id} value={item.id}>{item.name} · {item.username} · {item.id}</option>)}</select></label>
          <label className="field">组织人员<select name="person_ref" required defaultValue="" disabled={busy || confirming || !reads.binding.data?.people.length}><option value="">选择组织人员</option>{reads.binding.data?.people.map(item => <option key={item.person_ref} value={item.person_ref}>{item.display_name} · {item.org_unit_id || "未绑定组织"}{item.user_id ? " · 当前已有账号" : ""}</option>)}</select></label>
          <label className="field lifecycle-wide">绑定原因<textarea name="reason" rows={2} minLength={2} maxLength={500} required placeholder="例如：已核验员工账号与组织人员身份" /></label>
          <div className="lifecycle-form-footer lifecycle-wide"><button className="btn work" disabled={busy || confirming || !unbound.length}>确认绑定并记录审计</button></div>
        </form>
      </ReadBlock>
    </section>
  </>;
  const templateView = <section data-work-order-template-governance>
    <div className="lifecycle-section-head"><h3>AI 工单模板</h3>{!editorOpen ? <button type="button" className="btn work" disabled={busy} onClick={() => setEditorOpen(true)}>新建模板草稿</button> : null}</div>
    <p className="lifecycle-help">先保存草稿，再发布模板；发布和启用自动执行是两个独立操作。状态数量按本次返回模板统计。</p>
    <ReadBlock read={reads.releases} label="自动执行状态" retry={retry}><p className="lifecycle-help">自动化发布：{releases.some(release => release.status === "enabled") ? "部分已启用" : "未启用"}</p></ReadBlock>
    <div hidden={!editorOpen} className="lifecycle-editor" data-template-editor>
      <form className="lifecycle-form" onSubmit={event => { void createTemplate(event); }}>
        <label className="field">模板编码<input name="template_code" required pattern="[a-z][a-z0-9_]{2,119}" placeholder="quote_deadline_followup" disabled={busy} /></label>
        <label className="field">模板名称<input name="title" required maxLength={200} placeholder="报价期限跟进" disabled={busy} /></label>
        <label className="field">自动化等级<select name="automation_level" value={level} disabled={busy} onChange={event => setLevel(event.target.value as typeof level)}><option value="A0">A0 · 仅观察</option><option value="A1">A1 · 自动生成草稿</option><option value="A2">A2 · 自动建单与分派</option><option value="A3">A3 · 证据核验后的自动阶段</option><option value="L3">L3 · 始终人工确认</option></select></label>
        <label className="field">路由策略编码<input name="routing_policy_code" placeholder="task_owner（A2/A3 发布必填）" disabled={busy} /></label>
        <label className="field">触发事件<textarea name="trigger_event_types" rows={2} placeholder={"deadline.quote\nmail.reply_verified"} disabled={busy} /></label>
        <label className="field">验收条件<textarea name="acceptance_criteria" required rows={2} placeholder={"报价期限已核验\n下一步商务动作已记录"} disabled={busy} /></label>
        <label className="field lifecycle-wide">模板说明<textarea name="description" rows={2} maxLength={2000} placeholder="仅描述标准动作，不填写未经核验的业务事实。" disabled={busy} /></label>
        <fieldset className="lifecycle-wide" hidden={level !== "A3"} disabled={level !== "A3" || busy}><legend>A3 阶段与证据配置</legend>
          <div className="lifecycle-form">
            <label className="field">目标阶段（每行一个）<textarea name="stage_target_stages" rows={2} placeholder={"SHIPPED\nTESTING\nPUBLISHED"} /><small>仅接受事实可自动写入的正式阶段；合同、审核、结算和终态不能配置。</small></label>
            <label className="field">阶段事件（每行一个）<textarea name="stage_event_types" rows={2} placeholder="mail.reply_verified" /><small>必须同时列在上方“触发事件”中。</small></label>
            <label className="field lifecycle-wide">必需证据键（每行一个）<textarea name="stage_evidence_keys" rows={2} placeholder={"receipt_verified\ncompleted_stages"} /><small>登记事件时必须具备这些经过核验的事实键。</small></label>
            <label className="lifecycle-check lifecycle-wide"><input type="checkbox" name="stage_allow_cross" />允许跨阶段</label>
            <p className="lifecycle-help lifecycle-wide">必须证明每一个被跳过的中间阶段；不是无条件跳档。</p>
          </div>
        </fieldset>
        <div className="lifecycle-form-footer lifecycle-wide"><button type="button" className="lifecycle-text-action" disabled={busy} onClick={() => setEditorOpen(false)}>收起编辑</button><button className="btn work" disabled={busy}>{busy ? "正在保存…" : "创建模板草稿"}</button></div>
      </form>
    </div>
    <ReadBlock read={reads.templates} label="工单模板" retry={retry}>
      <LifecycleNavigation label="模板生命周期筛选" idPrefix="template-state" value={templateState} onChange={setTemplateState} options={[{ id: "all", label: "全部", count: templates.length }, ...uniqueStates.map(id => ({ id, label: templateLabels[id] || id, count: templates.filter(template => template.status === id).length }))]} />
      <div className="lifecycle-tools"><label className="lifecycle-search">搜索模板<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="名称或编码" /></label><span className="lifecycle-help">当前 {filteredTemplates.length} 项</span></div>
      {filteredTemplates.length === 0 ? <p className="lifecycle-help">{templates.length ? "当前筛选没有匹配的模板。" : "尚无 AI 工单模板；可先创建模板草稿。"}</p> : <table className="lifecycle-table" data-template-table><thead><tr><th>模板与版本</th><th>等级</th><th>发布状态</th><th>自动执行</th><th>操作</th></tr></thead><tbody>{filteredTemplates.map(template => <tr key={template.id} data-work-order-template={template.template_code}>
        <td><strong>{template.title}</strong><p className="lifecycle-help">{template.template_code}.v{template.version}</p><details><summary>查看配置</summary><p>{template.description || "—"}</p><p>触发事件：{template.trigger_event_types.join("、") || "—"}</p><p>验收条件：{template.acceptance_criteria.join("、") || "—"}</p><p>路由策略：{template.routing_policy_code || "—"}</p></details></td><td>{template.automation_level}</td><td><span className="lifecycle-status">{templateLabels[template.status] || template.status}</span></td><td>{reads.releases.status === "ready" ? releases.find(release => release.template_id === template.id)?.status === "enabled" ? "已启用" : "未启用" : "待读取"}</td>
        <td><div className="lifecycle-actions">{template.status === "draft" ? <button type="button" className="lifecycle-text-action" disabled={busy || confirming} onClick={() => templateAction(template, "publish")}>发布</button> : null}{template.status === "published" && ["A1", "A2", "A3"].includes(template.automation_level) ? <button type="button" className="lifecycle-text-action" disabled={busy || confirming || reads.releases.status !== "ready"} onClick={() => templateAction(template, "automation")}>{releases.find(release => release.template_id === template.id)?.status === "enabled" ? "停止自动执行" : "启用自动执行"}</button> : null}{template.status === "published" ? <button type="button" className="lifecycle-text-action danger" disabled={busy || confirming} onClick={() => templateAction(template, "disable")}>停用</button> : null}</div></td>
      </tr>)}</tbody></table>}
    </ReadBlock>
  </section>;
  return <div data-admin-work-orders className="work-order-governance">
    {dialog}
    <LifecycleWorkspace title="工单治理" value={view} onChange={setView}
      meta={<>{account?.name || account?.handle || account?.email || "—"} · 数据时间 {time(quality?.as_of)}<details><summary>数据来源</summary>组织来源版本：{quality?.registry_revision || "—"} · 最近同步：{time(quality?.seeded_at)} · PostgreSQL 正式工单与组织授权数据；缺失信息阻止正式建单。</details></>}
      actions={<>{links}<button type="button" className="lifecycle-text-action" disabled={loading || busy} onClick={retry}>{loading ? "读取中…" : "刷新"}</button></>}
      feedback={<>{notice ? <p role="status" className="status-ok" data-admin-receipt>{notice}</p> : null}{error ? <p role="alert" className="error">{error}</p> : null}</>}
      views={[{ id: "overview", label: "治理概览", content: overview }, { id: "binding", label: "人员绑定", content: binding }, { id: "templates", label: "AI 工单模板", count: reads.templates.status === "ready" ? templates.length : null, content: templateView }]} />
  </div>;
}
