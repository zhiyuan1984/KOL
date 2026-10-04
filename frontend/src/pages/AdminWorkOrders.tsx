import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type OrganizationTicketRawCountReport, type OrganizationTicketStageRawReport, type TicketAccountBindingOptions, type TicketOrganizationQualityReport } from "../api";
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
  const [loading, setLoading] = useState(true);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [quality, bindingOptions, rawReport, stageRawReport] = await Promise.all([
        api.adminTicketOrganizationQuality(),
        api.adminTicketAccountBindingOptions(),
        api.organizationTicketRawCountReport(),
        api.organizationTicketStageRawReport(),
      ]);
      setReport(quality);
      setOptions(bindingOptions);
      setOrganizationReport(rawReport);
      setStageReport(stageRawReport);
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
