import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TicketOrganizationQualityReport } from "../api";

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
  const [report, setReport] = useState<TicketOrganizationQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await api.adminTicketOrganizationQuality());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取工单组织数据质量");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="admin-grid" data-admin-work-orders>
      <header className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head">
          <div><h2>工单治理</h2><p className="muted">正式工单只使用 PostgreSQL 的组织、人员、受理和关注事实。缺失信息会阻止建单，不做猜测性兜底。</p></div>
          <button type="button" className="btn ghost" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : "刷新"}</button>
        </div>
        <p className="muted">组织来源版本：{report?.registry_revision || "—"} · 最近同步：{time(report?.seeded_at)} · 数据时间：{time(report?.as_of)}</p>
      </header>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <article className="panel"><h3>有效组织</h3><strong className="admin-metric">{report?.active_unit_count ?? "—"}</strong><p className="muted">中心、部门与三级受理组的权威投影。</p></article>
      <article className="panel"><h3>有效人员</h3><strong className="admin-metric">{report?.active_person_count ?? "—"}</strong><p className="muted">已进入组织投影的人员事实。</p></article>
      <article className="panel"><h3>阻断项</h3><strong className={report?.issue_count ? "admin-metric status-warn" : "admin-metric status-ok"}>{report?.issue_count ?? "—"}</strong><p className="muted">缺少账号、组织或负责人账号时，正式建单会明确阻断。</p></article>
      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head"><div><h3>组织数据质量</h3><p className="muted">先修复人员/组织绑定，再创建、分派或自动关注；此处不提供旁路写入。</p></div><div className="row-actions"><Link className="btn ghost" to="/admin/audit">查看审计</Link><Link className="btn ghost" to="/admin/scheduling">查看调度</Link></div></div>
        {loading && !report ? <p className="muted">正在读取 PostgreSQL 权威组织投影…</p> : null}
        {!loading && report?.issues.length === 0 ? <p className="status-ok">当前组织、账号与负责人绑定没有已知阻断项。</p> : null}
        {report?.issues.map((issue, index) => <div className="admin-row" key={`${issue.type}:${issue.subject_ref}:${index}`} data-ticket-org-quality={issue.type}><div><strong>{issue.display_name}</strong><p className="muted">{issue.subject_ref} · 组织 {issue.org_unit_id || "未绑定"}</p></div><div><strong className="status-warn">{issueLabel[issue.type] || issue.type}</strong><p className="muted">{issue.message}</p></div></div>)}
      </article>
    </section>
  );
}
