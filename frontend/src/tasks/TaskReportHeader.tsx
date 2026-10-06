import type { AiTaskWorkOrderDashboard } from "../api";
import { KpiCard } from "./KpiCard";
import { Sparkline } from "./Sparkline";

export type TaskReportPeriod = "realtime" | "today" | "week" | "month" | "year";
export type KpiFilter = "all" | "in_progress" | "completed" | "overdue" | "automatic" | "duration" | null;

const PERIODS: Array<{ value: TaskReportPeriod; label: string }> = [
  { value: "realtime", label: "实时" }, { value: "today", label: "今日" }, { value: "week", label: "本周" },
  { value: "month", label: "本月" }, { value: "year", label: "全年" },
];

function formatValue(value: number | null | undefined, kind: "count" | "rate" | "duration") {
  if (value == null || !Number.isFinite(value)) return kind === "count" ? "0" : "—";
  if (kind === "rate") return `${value.toFixed(1)}%`;
  if (kind === "duration") return `${value.toFixed(1)}h`;
  return String(Math.round(value));
}

type TaskReportHeaderProps = {
  dashboard: AiTaskWorkOrderDashboard | null;
  period: TaskReportPeriod;
  loading: boolean;
  error: string;
  flash: boolean;
  activeFilter: KpiFilter;
  activeTemplate: string | null;
  exporting: boolean;
  onPeriod: (period: TaskReportPeriod) => void;
  onKpi: (filter: Exclude<KpiFilter, null>) => void;
  onTemplate: (template: string) => void;
  onClearTemplate: () => void;
  onRetry: () => void;
  onExport: () => void;
};

export function TaskReportHeader({ dashboard, period, loading, error, flash, activeFilter, activeTemplate, exporting, onPeriod, onKpi, onTemplate, onClearTemplate, onRetry, onExport }: TaskReportHeaderProps) {
  const metrics = dashboard?.metrics;
  const deltas = dashboard?.comparison?.deltas;
  const trends = dashboard?.trends;
  const hasWarning = Boolean(metrics && (metrics.overdue > 0 || metrics.blocked >= 3));
  return <section className="panel task-report-header" aria-label="任务运营报表" aria-busy={loading}>
    <header className="task-report-head">
      <div><h2>运营报表</h2><p className="muted">当前授权范围内的任务与标准工单运营事实</p></div>
      <div className="task-report-actions">
        <div className="task-period-segmented" role="group" aria-label="报表时间维度">
          {PERIODS.map((item) => <button key={item.value} type="button" className={period === item.value ? "is-active" : ""} aria-pressed={period === item.value} onClick={() => onPeriod(item.value)}>{item.label}</button>)}
        </div>
        <button className="task-center-text-action" type="button" onClick={onExport} disabled={exporting || loading}>{exporting ? "正在导出…" : "导出 CSV"}</button>
      </div>
    </header>
    {hasWarning ? <div className="task-report-warning" role="alert"><span>{metrics!.overdue > 0 ? `有 ${metrics!.overdue} 个逾期任务` : `有 ${metrics!.blocked} 个阻塞任务`}</span><button type="button" onClick={() => onKpi(metrics!.overdue > 0 ? "overdue" : "in_progress")}>查看</button></div> : null}
    {loading ? <div className="task-report-skeleton" aria-label="正在切换报表口径"><span /><span /><span /><span /><span /><span /></div> : error ? <p className="task-center-load-error" role="alert">报表暂时无法读取。<button className="task-center-text-action" type="button" onClick={onRetry}>重试</button></p> : <>
      <div className="task-report-kpis" aria-label="任务运营关键指标">
        <KpiCard label="任务总数" value={formatValue(metrics?.total, "count")} delta={deltas?.total} trend={trends?.total} realtime={period === "realtime"} flash={flash} onClick={() => onKpi("all")} />
        <KpiCard label="进行中" value={formatValue(metrics?.in_progress, "count")} delta={deltas?.in_progress} trend={trends?.in_progress} realtime={period === "realtime"} flash={flash} active={activeFilter === "in_progress"} onClick={() => onKpi("in_progress")} />
        <KpiCard label="完成率" value={formatValue(metrics?.completion_rate, "rate")} delta={deltas?.completion_rate} deltaUnit="pp" trend={trends?.completion_rate} realtime={period === "realtime"} flash={flash} active={activeFilter === "completed"} onClick={() => onKpi("completed")} />
        <KpiCard label="逾期率" value={formatValue(metrics?.overdue_rate, "rate")} delta={deltas?.overdue_rate} deltaUnit="pp" trend={trends?.overdue_rate} realtime={period === "realtime"} invertedGood alert={Boolean(metrics?.overdue)} flash={flash} active={activeFilter === "overdue"} onClick={() => onKpi("overdue")} />
        <KpiCard label="自动生成率" value={formatValue(metrics?.automatic_rate, "rate")} delta={deltas?.automatic_rate} deltaUnit="pp" trend={trends?.automatic_rate} realtime={period === "realtime"} flash={flash} active={activeFilter === "automatic"} onClick={() => onKpi("automatic")} />
        <KpiCard label="平均处理时长" value={formatValue(metrics?.median_processing_hours, "duration")} delta={deltas?.median_processing_hours} deltaUnit="h" trend={trends?.median_processing_hours} realtime={period === "realtime"} invertedGood flash={flash} active={activeFilter === "duration"} onClick={() => onKpi("duration")} />
      </div>
      <div className="task-report-template-wrap">
        <div className="split-head"><h3>标准工单模板</h3>{activeTemplate ? <button className="task-center-text-action" type="button" onClick={onClearTemplate}>清除模板筛选</button> : null}</div>
        {dashboard?.by_template.length ? <table className="task-report-template-table"><thead><tr><th>标准模板</th><th>等级</th><th>总数</th><th>自动生成</th><th>周期完成数</th><th>趋势</th></tr></thead><tbody>{dashboard.by_template.map((template) => <tr key={`${template.template_code}:${template.template_version}:${template.automation_level}`} className={activeTemplate === template.template_code ? "is-active" : ""} onClick={() => onTemplate(template.template_code)}>
          <td><strong>{template.template_title}</strong><small>{template.template_code}.v{template.template_version}</small></td><td>{template.automation_level}</td><td>{template.total}</td><td>{template.automatic_created}</td><td>{template.period_completed ?? template.completed}</td><td><Sparkline values={template.trend} label={`${template.template_title}趋势`} /></td>
        </tr>)}</tbody></table> : <p className="muted">当前授权范围内尚无标准工单。</p>}
      </div>
      <p className="muted task-work-order-as-of">口径：{dashboard?.source || "postgresql_task_work_orders"} · 截止 {dashboard ? new Date(dashboard.as_of).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"} · 时区 {dashboard?.timezone || "Asia/Shanghai"}</p>
    </>}
  </section>;
}
