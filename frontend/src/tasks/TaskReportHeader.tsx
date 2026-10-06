import type { AiTaskWorkOrderDashboard } from "../api";
import { Sparkline } from "./Sparkline";

export type TaskReportPeriod = "realtime" | "today" | "week" | "month" | "year";

type TaskReportHeaderProps = {
  dashboard: AiTaskWorkOrderDashboard | null;
  period: TaskReportPeriod;
  loading: boolean;
  error: string;
  activeTemplate: string | null;
  exporting: boolean;
  onTemplate: (template: string) => void;
  onClearTemplate: () => void;
  onRetry: () => void;
  onExport: () => void;
  onCreateBusinessTask: () => void;
};

export function TaskReportHeader({ dashboard, period, loading, error, activeTemplate, exporting, onTemplate, onClearTemplate, onRetry, onExport, onCreateBusinessTask }: TaskReportHeaderProps) {
  const taskCount = dashboard?.summary.tasks.total || 0;
  const workOrderCount = dashboard?.summary.work_orders.total || 0;
  return <section className="panel task-business-work-orders" aria-label="业务工单" aria-busy={loading}>
    <header className="task-business-work-order-head">
      <div><span className="task-operations-eyebrow">BUSINESS WORK ORDERS</span><h2>业务工单</h2><p className="muted">业务任务与标准执行工单独立统计，不与上方 Agent／系统任务混合。</p></div>
      <div className="task-business-work-order-actions"><button className="task-center-text-action" type="button" onClick={onCreateBusinessTask}>新建业务任务</button><button className="task-center-text-action" type="button" onClick={onExport} disabled={exporting || loading}>{exporting ? "正在导出…" : "导出业务任务 CSV"}</button></div>
    </header>
    {loading ? <p className="muted">正在读取业务工单…</p> : error ? <p className="task-center-load-error" role="alert">业务工单暂时无法读取。<button className="task-center-text-action" type="button" onClick={onRetry}>重试</button></p> : <>
      {(taskCount || workOrderCount) ? <dl className="task-business-work-order-summary"><div><dt>业务任务</dt><dd>{taskCount}</dd></div><div><dt>标准工单</dt><dd>{workOrderCount}</dd></div><div><dt>自动创建</dt><dd>{dashboard?.summary.work_orders.automatic_created || 0}</dd></div><div><dt>周期完成</dt><dd>{dashboard?.by_template.reduce((total, item) => total + (item.period_completed ?? item.completed), 0) || 0}</dd></div></dl> : <div className="task-business-empty"><strong>尚无业务任务或标准工单</strong><p>上方运营统计仍会展示已有 Agent／系统任务；需要以目标驱动标准执行时，可在此创建业务任务。</p><button className="task-center-text-action" type="button" onClick={onCreateBusinessTask}>创建业务任务</button></div>}
      {dashboard?.by_template.length ? <div className="task-report-template-wrap"><div className="split-head"><h3>标准工单模板</h3>{activeTemplate ? <button className="task-center-text-action" type="button" onClick={onClearTemplate}>清除模板筛选</button> : null}</div><table className="task-report-template-table"><thead><tr><th>标准模板</th><th>等级</th><th>总数</th><th>自动生成</th><th>周期完成</th><th>趋势</th></tr></thead><tbody>{dashboard.by_template.map((template) => <tr key={`${template.template_code}:${template.template_version}:${template.automation_level}`} className={activeTemplate === template.template_code ? "is-active" : ""} role="button" tabIndex={0} onClick={() => onTemplate(template.template_code)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onTemplate(template.template_code); } }}><td><strong>{template.template_title}</strong><small>{template.template_code}.v{template.template_version}</small></td><td>{template.automation_level}</td><td>{template.total}</td><td>{template.automatic_created}</td><td>{template.period_completed ?? template.completed}</td><td><Sparkline values={template.trend} label={`${template.template_title}趋势`} /></td></tr>)}</tbody></table></div> : null}
      <p className="muted task-work-order-as-of">业务工单口径 · {period === "realtime" ? "实时" : "周期"} · 截止 {dashboard ? new Date(dashboard.as_of).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
    </>}
  </section>;
}
