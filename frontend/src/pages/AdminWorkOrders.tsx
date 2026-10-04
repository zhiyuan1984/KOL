import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type AiTaskWorkOrderList, type OrganizationTicketRawCountReport, type OrganizationTicketStageRawReport, type TicketAccountBindingOptions, type TicketOrganizationQualityReport, type WorkOrderAutomationRelease, type WorkOrderTemplate } from "../api";
import { useAccount } from "../components/AuthGate";

function time(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false }).format(parsed);
}

const issueLabel: Record<string, string> = {
  person_without_account: "账号缺失",
  person_without_org: "组织缺失",
  unit_head_without_account: "负责人账号缺失",
};

/** Governance-only surface: quality evidence and links, not a second employee task list. */
export default function AdminWorkOrders() {
  return <AdminWorkOrdersContent />;
}

function AdminWorkOrdersContent() {
  const { account } = useAccount();
  const [report, setReport] = useState<TicketOrganizationQualityReport | null>(null);
  const [organizationReport, setOrganizationReport] = useState<OrganizationTicketRawCountReport | null>(null);
  const [stageReport, setStageReport] = useState<OrganizationTicketStageRawReport | null>(null);
  const [options, setOptions] = useState<TicketAccountBindingOptions | null>(null);
  const [templates, setTemplates] = useState<WorkOrderTemplate[]>([]);
  const [automationReleases, setAutomationReleases] = useState<WorkOrderAutomationRelease[]>([]);
  const [aiTaskRoots, setAiTaskRoots] = useState<AiTaskWorkOrderList["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [quality, bindingOptions, rawReport, stageRawReport, templateRows, releaseRows, aiTaskRows] = await Promise.all([
        api.adminTicketOrganizationQuality(),
        api.adminTicketAccountBindingOptions(),
        api.organizationTicketRawCountReport(),
        api.organizationTicketStageRawReport(),
        api.adminWorkOrderTemplates(),
        api.adminWorkOrderAutomationReleases(),
        api.aiTaskWorkOrders(),
      ]);
      setReport(quality);
      setOptions(bindingOptions);
      setOrganizationReport(rawReport);
      setStageReport(stageRawReport);
      setTemplates(templateRows.templates);
      setAutomationReleases(releaseRows.releases);
      setAiTaskRoots(aiTaskRows.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取工单组织数据质量");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bind = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const person_ref = String(data.get("person_ref") || "");
    const account_id = String(data.get("account_id") || "");
    const reason = String(data.get("reason") || "").trim();
    if (!person_ref || !account_id || reason.length < 2) return;
    setBindingBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.bindTicketAccountToOrganizationPerson({ person_ref, account_id, reason });
      setNotice(result.changed ? `已绑定 ${result.username} 与 ${result.person_ref}；操作已写入不可变审计。` : "该账号与人员已是当前绑定，无需重复变更。");
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账号人员绑定失败");
    } finally {
      setBindingBusy(false);
    }
  };

  const unboundAccounts = (options?.accounts || []).filter((item) => !item.bound_person_ref);
  const idempotency = () => `wot-${crypto.randomUUID()}`;

  const createTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const split = (name: string) => String(data.get(name) || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const template_code = String(data.get("template_code") || "").trim();
    const title = String(data.get("title") || "").trim();
    const automation_level = String(data.get("automation_level") || "A1") as "A0" | "A1" | "A2" | "A3" | "L3";
    if (!template_code || !title) return;
    const stageTargets = split("stage_target_stages");
    const stageEventTypes = split("stage_event_types");
    const stageEvidenceKeys = split("stage_evidence_keys");
    const stagePolicy = automation_level === "A3"
      ? {
        allowed_target_stages: stageTargets,
        targets: Object.fromEntries(stageTargets.map((stage) => [stage, {
          required_event_types: stageEventTypes,
          required_evidence_keys: stageEvidenceKeys,
          allow_cross_stage: data.get("stage_allow_cross") === "on",
        }])),
      }
      : {};
    setTemplateBusy(true); setError(""); setNotice("");
    try {
      const result = await api.createWorkOrderTemplateDraft({
        template_code, title, description: String(data.get("description") || "").trim(), automation_level,
        business_category: String(data.get("business_category") || "").trim() || undefined,
        trigger_event_types: split("trigger_event_types"), acceptance_criteria: split("acceptance_criteria"),
        routing_policy_code: String(data.get("routing_policy_code") || "").trim() || undefined,
        input_schema: {}, fill_policy: {}, stage_policy: stagePolicy, idempotency_key: idempotency(),
      });
      setNotice(`已创建模板草稿 ${result.template.template_code}.v${result.template.version}；发布前仍不会进入 AI 自动化。`);
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建工单模板草稿失败");
    } finally { setTemplateBusy(false); }
  };

  const publishTemplate = async (template: WorkOrderTemplate) => {
    setTemplateBusy(true); setError(""); setNotice("");
    try {
      const result = await api.publishWorkOrderTemplate(template.id, { expected_version: template.version, idempotency_key: idempotency() });
      setNotice(`已发布 ${result.template.template_code}.v${result.template.version}。发布仅允许它被影子判断选择，尚未启用自动执行。`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发布工单模板失败"); }
    finally { setTemplateBusy(false); }
  };

  const disableTemplate = async (template: WorkOrderTemplate) => {
    setTemplateBusy(true); setError(""); setNotice("");
    try {
      const result = await api.disableWorkOrderTemplate(template.id, { reason: "管理员从工单治理界面停用模板", idempotency_key: idempotency() });
      setNotice(`已停用 ${result.template.template_code}.v${result.template.version}；后续 Jev 判断不会再选择该版本。`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "停用工单模板失败"); }
    finally { setTemplateBusy(false); }
  };

  const toggleAutomationRelease = async (template: WorkOrderTemplate) => {
    const current = automationReleases.find((release) => release.template_id === template.id);
    const action = current?.status === "enabled" ? "disabled" as const : "enabled" as const;
    setTemplateBusy(true); setError(""); setNotice("");
    try {
      const result = await api.setWorkOrderAutomationRelease(template.id, {
        action, minimum_confidence: 0.92, routing_policy_code: template.routing_policy_code || undefined,
        reason: action === "enabled" ? "管理员从工单治理界面启用经模板和路由约束的自动物化" : "管理员从工单治理界面停止该模板的自动物化",
        idempotency_key: idempotency(),
      });
      setNotice(action === "enabled"
        ? `已启用 ${template.template_code}.v${template.version} 的 ${result.release.automation_level} 执行开关（最低置信度 ${result.release.minimum_confidence}）。`
        : `已停用 ${template.template_code}.v${template.version} 的自动物化开关。`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "更新自动化发布开关失败"); }
    finally { setTemplateBusy(false); }
  };

  return (
    <section className="admin-grid" data-admin-work-orders>
      <header className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head">
          <div><h2>工单治理</h2><p className="muted">复用当前工作台登录。PostgreSQL 保存正式工单、组织、人员、受理和关注事实；缺失信息会阻止建单，不做猜测性兜底。</p></div>
          <div className="row-actions"><span className="muted">当前工作台用户：{account?.name || account?.handle || account?.email || "—"}</span><button type="button" className="btn ghost" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : "刷新"}</button></div>
        </div>
        <p className="muted">组织来源版本：{report?.registry_revision || "—"} · 最近同步：{time(report?.seeded_at)} · 数据时间：{time(report?.as_of)}</p>
      </header>
      {notice ? <p className="admin-receipt status-ok" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <article className="panel"><h3>有效组织</h3><strong className="admin-metric">{report?.active_unit_count ?? "—"}</strong><p className="muted">中心、部门与三级受理组的权威投影。</p></article>
      <article className="panel"><h3>有效人员</h3><strong className="admin-metric">{report?.active_person_count ?? "—"}</strong><p className="muted">已进入组织投影的人员事实。</p></article>
      <article className="panel"><h3>阻断项</h3><strong className={report?.issue_count ? "admin-metric status-warn" : "admin-metric status-ok"}>{report?.issue_count ?? "—"}</strong><p className="muted">缺少账号、组织或负责人账号时，正式建单会明确阻断。</p></article>
      <article className="panel"><h3>授权工单存量</h3><strong className="admin-metric">{organizationReport?.total_authorized ?? "—"}</strong><p className="muted">按 {organizationReport?.authorization.mode === "company_admin" ? "公司管理员" : "组织负责人"}授权范围汇总；不包含 SLA 或绩效结论。</p></article>
      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head"><div><h3>工作台主体—组织人员绑定</h3><p className="muted">仅绑定已进入工作台并同步到 PostgreSQL 的主体与受控组织人员。每一次变更必须写明原因，并保留不可变审计。</p></div></div>
        <form className="ticket-binding-form" onSubmit={(event) => void bind(event)}>
          <label className="field">工作台主体
            <select name="account_id" required defaultValue="" disabled={loading || !unboundAccounts.length}>
              <option value="">{unboundAccounts.length ? "选择未绑定工作台主体" : "没有待绑定工作台主体"}</option>
              {unboundAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.username} · {item.id}</option>)}
            </select>
          </label>
          <label className="field">受控组织人员
            <select name="person_ref" required defaultValue="" disabled={loading || !(options?.people.length)}>
              <option value="">选择组织人员</option>
              {(options?.people || []).map((item) => <option key={item.person_ref} value={item.person_ref}>{item.display_name} · {item.org_unit_id || "未绑定组织"}{item.user_id ? " · 当前已有账号" : ""}</option>)}
            </select>
          </label>
          <label className="field ticket-binding-reason">绑定原因<textarea name="reason" minLength={2} maxLength={500} required placeholder="例如：已核验员工账号与组织人员身份" /></label>
          <div className="ticket-binding-action"><button className="btn work" disabled={bindingBusy || loading || !unboundAccounts.length}>{bindingBusy ? "正在写入审计…" : "确认绑定并记录审计"}</button></div>
        </form>
      </article>
      <article className="panel" style={{ gridColumn: "1 / -1" }} data-work-order-template-governance>
          <div className="split-head"><div><h3>AI 工单模板治理</h3><p className="muted">模板先保存为草稿，再由管理员发布。A1/A2 必须再单独启用执行开关；A3 还必须配置可自动写入的事实阶段、事件和证据键。跨阶段不是禁用项，但必须在模板中显式允许并由同一核验事件证明每个中间阶段。</p></div><span className={automationReleases.some((release) => release.status === "enabled") ? "status-ok" : "status-warn"}>自动化发布：{automationReleases.some((release) => release.status === "enabled") ? "部分已启用" : "未启用"}</span></div>
        <form className="ticket-binding-form" onSubmit={(event) => void createTemplate(event)}>
          <label className="field">模板编码<input name="template_code" required pattern="[a-z][a-z0-9_]{2,119}" placeholder="quote_deadline_followup" /></label>
          <label className="field">模板名称<input name="title" required maxLength={200} placeholder="报价期限跟进" /></label>
          <label className="field">自动化等级<select name="automation_level" defaultValue="A1"><option value="A0">A0 · 仅观察</option><option value="A1">A1 · 自动生成草稿</option><option value="A2">A2 · 自动建单与分派（尚未启用）</option><option value="A3">A3 · 证据闸门后的自动阶段</option><option value="L3">L3 · 始终人工确认</option></select></label>
          <label className="field">路由策略编码<input name="routing_policy_code" placeholder="task_owner（A2/A3 发布必填）" /></label>
          <label className="field ticket-binding-reason">触发事件<textarea name="trigger_event_types" placeholder={"deadline.quote\nmail.reply_verified"} /></label>
          <label className="field ticket-binding-reason">验收条件<textarea name="acceptance_criteria" required placeholder={"报价期限已核验\n下一步商务动作已记录"} /></label>
          <label className="field ticket-binding-reason">模板说明<textarea name="description" maxLength={2000} placeholder="仅描述标准动作，不填写未经核验的业务事实。" /></label>
          <label className="field ticket-binding-reason">A3 目标阶段（每行一个）<textarea name="stage_target_stages" placeholder={"SHIPPED\nTESTING\nPUBLISHED"} /><small className="muted">仅接受事实可自动写入的正式阶段；合同、审核、结算和终态不能配置。</small></label>
          <label className="field ticket-binding-reason">A3 阶段事件（每行一个）<textarea name="stage_event_types" placeholder="mail.reply_verified" /><small className="muted">必须同时列在上方“触发事件”中。</small></label>
          <label className="field ticket-binding-reason">A3 必需证据键（每行一个）<textarea name="stage_evidence_keys" placeholder={"receipt_verified\ncompleted_stages"} /><small className="muted">登记事件时必须具备这些经过核验的事实键。</small></label>
          <label className="field"><span>A3 允许跨阶段</span><input type="checkbox" name="stage_allow_cross" /><small className="muted">仍需证明每一个被跳过的中间阶段；不是无条件跳档。</small></label>
          <div className="ticket-binding-action"><button className="btn work" disabled={loading || templateBusy}>{templateBusy ? "正在写入治理记录…" : "创建模板草稿"}</button></div>
        </form>
        {!loading && templates.length === 0 ? <p className="muted">尚无 AI 工单模板。创建并发布低风险模板后，才可进行 Jev 影子判断。</p> : null}
        {templates.map((template) => <div className="admin-row" key={template.id} data-work-order-template={template.template_code}>
          <div><strong>{template.title}</strong><p className="muted">{template.template_code}.v{template.version} · {template.automation_level} · {template.status} · 事件：{template.trigger_event_types.join("、") || "—"}</p></div>
          <div className="row-actions"><span className={template.status === "published" ? "status-ok" : template.status === "draft" ? "status-warn" : "muted"}>{template.status}</span>{template.status === "draft" ? <button className="btn ghost" type="button" disabled={templateBusy} onClick={() => void publishTemplate(template)}>发布</button> : null}{template.status === "published" && ["A1", "A2", "A3"].includes(template.automation_level) ? <button className="btn ghost" type="button" disabled={templateBusy} onClick={() => void toggleAutomationRelease(template)}>{automationReleases.find((release) => release.template_id === template.id)?.status === "enabled" ? template.automation_level === "A3" ? "停止自动阶段" : "停止自动物化" : template.automation_level === "A3" ? "启用阶段闸门" : "启用自动物化"}</button> : null}{template.status === "published" ? <button className="btn ghost danger" type="button" disabled={templateBusy} onClick={() => void disableTemplate(template)}>停用</button> : null}</div>
        </div>)}
      </article>
      <article className="panel" style={{ gridColumn: "1 / -1" }} data-ai-work-order-work-report>
        <div className="split-head"><div><h3>AI 工单任务工作战报</h3><p className="muted">任务是业务目标根，AI 标准工单是其执行单元；这里只显示当前任务根、子工单存量和阻塞，不把子工单完成误报为任务完成或个人绩效。</p></div><span className="status-ok">任务根 {aiTaskRoots.length}</span></div>
        {!loading && aiTaskRoots.length === 0 ? <p className="muted">当前没有已授权的 PostgreSQL AI 工单任务根。</p> : null}
        {aiTaskRoots.map((item) => <div className="admin-row" key={item.task.task_id}><div><strong>{item.task.title}</strong><p className="muted">任务状态：{item.task.status} · 目标：{item.task.goal}</p></div><div><strong>{item.counts.open}/{item.counts.total} 开放/总工单</strong><p className={item.counts.blocked ? "status-warn" : "muted"}>阻塞 {item.counts.blocked} · 待复核 {item.counts.waiting_review}{item.current_blocking_work_order ? ` · 当前：${item.current_blocking_work_order.title}` : ""}</p></div></div>)}
      </article>
      <article className="panel" style={{ gridColumn: "1 / -1" }} data-organization-ticket-report>
        <div className="split-head"><div><h3>组织工单原始计数</h3><p className="muted">数据时间：{time(organizationReport?.as_of)} · 时区：{organizationReport?.timezone || "—"} · 来源：PostgreSQL 正式工单。只展示受控组织范围内的当前数量。</p></div></div>
        {!loading && organizationReport?.total_authorized === 0 ? <p className="muted">当前授权范围没有正式工单。</p> : null}
        <div className="admin-row"><div><strong>状态分布</strong><p className="muted">{Object.entries(organizationReport?.by_status || {}).map(([status, count]) => `${status} ${count}`).join(" · ") || "—"}</p></div><div><strong className="status-ok">{organizationReport?.authorization.mode === "company_admin" ? "公司管理员范围" : "组织负责人范围"}</strong><p className="muted">根组织：{organizationReport?.authorization.root_units.map((unit) => unit.display_name).join("、") || "公司级"}</p></div></div>
        {organizationReport?.by_assignee_unit.map((unit) => <div className="admin-row" key={unit.org_unit_id}><div><strong>{unit.display_name}</strong><p className="muted">{unit.type} · {unit.org_unit_id}</p></div><div><strong>{unit.total}</strong><p className="muted">{Object.entries(unit.by_status).map(([status, count]) => `${status} ${count}`).join(" · ")}</p></div></div>)}
      </article>
      <article className="panel" style={{ gridColumn: "1 / -1" }} data-organization-ticket-stage-report>
        <div className="split-head"><div><h3>分类与阶段原始存量</h3><p className="muted">数据时间：{time(stageReport?.as_of)} · {stageReport?.note || "仅展示当前原始存量。"}</p></div></div>
        {!loading && stageReport?.total_authorized === 0 ? <p className="muted">当前授权范围没有可按分类或阶段统计的正式工单。</p> : null}
        <div className="admin-row"><div><strong>分类分布</strong><p className="muted">{stageReport?.by_business_category.map((item) => `${item.business_category} ${item.total}`).join(" · ") || "—"}</p></div><div><strong>{stageReport?.total_authorized ?? "—"}</strong><p className="muted">仅当前存量；不推导漏斗转化、时效或绩效。</p></div></div>
        {stageReport?.by_stage.map((item) => <div className="admin-row" key={`${item.business_category}:${item.stage_group}:${item.stage_code}`}><div><strong>{item.business_category} · {item.stage_group} / {item.stage_code}</strong><p className="muted">分类与阶段为工单当前投影</p></div><div><strong>{item.total}</strong><p className="muted">{Object.entries(item.by_status).map(([status, count]) => `${status} ${count}`).join(" · ")}</p></div></div>)}
      </article>
      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head"><div><h3>组织数据质量</h3><p className="muted">先修复人员/组织绑定，再创建、分派或自动关注；此处不提供旁路写入。</p></div><div className="row-actions"><Link className="btn ghost" to="/admin/audit">查看审计</Link><Link className="btn ghost" to="/admin/scheduling">查看调度</Link></div></div>
        {loading && !report ? <p className="muted">正在读取正式工单组织数据…</p> : null}
        {!loading && report?.issues.length === 0 ? <p className="status-ok">当前组织、账号与负责人绑定没有已知阻断项。</p> : null}
        {report?.issues.map((issue, index) => <div className="admin-row" key={`${issue.type}:${issue.subject_ref}:${index}`} data-ticket-org-quality={issue.type}><div><strong>{issue.display_name}</strong><p className="muted">{issue.subject_ref} · 组织 {issue.org_unit_id || "未绑定"}</p></div><div><strong className="status-warn">{issueLabel[issue.type] || issue.type}</strong><p className="muted">{issue.message}</p></div></div>)}
      </article>
    </section>
  );
}
