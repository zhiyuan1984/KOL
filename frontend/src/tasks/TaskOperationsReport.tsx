import type { CSSProperties } from "react";
import type { AiTaskWorkOrderDashboard, TaskOperationsDashboard, TaskOperationsPeriod } from "../api";
import { KpiCard } from "./KpiCard";
import { Sparkline } from "./Sparkline";

export type TaskOperationsFilter = "in_progress" | "waiting" | "completed" | "overdue" | "failed" | null;

const PERIODS: Array<{ value: TaskOperationsPeriod; label: string }> = [
  { value: "realtime", label: "实时" }, { value: "today", label: "今日" }, { value: "week", label: "本周" },
  { value: "month", label: "本月" }, { value: "year", label: "全年" },
];

const STATUS_SEGMENTS: Array<{ key: keyof TaskOperationsDashboard["status_distribution"]; label: string; filter: TaskOperationsFilter }> = [
  { key: "queued", label: "待启动", filter: null }, { key: "running", label: "执行中", filter: "in_progress" },
  { key: "waiting", label: "等待处理", filter: "waiting" }, { key: "completed", label: "已完成", filter: "completed" },
  { key: "failed", label: "失败", filter: "failed" }, { key: "cancelled", label: "已取消", filter: null },
];

function count(value: number | null | undefined, unavailable = false) {
  if (unavailable || value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

function segmentStyle(value: number): CSSProperties {
  return { flexGrow: Math.max(value, 1) };
}

type TaskOperationsReportProps = {
  dashboard: TaskOperationsDashboard | null;
  workOrders: AiTaskWorkOrderDashboard | null;
  period: TaskOperationsPeriod;
  loading: boolean;
  workOrdersLoading: boolean;
  error: string;
  workOrdersError: string;
  activeFilter: TaskOperationsFilter;
  onPeriod: (period: TaskOperationsPeriod) => void;
  onFilter: (filter: Exclude<TaskOperationsFilter, null>) => void;
  onClearFilter: () => void;
  onRetry: () => void;
  onRetryWorkOrders: () => void;
};

export function TaskOperationsReport({ dashboard, workOrders, period, loading, workOrdersLoading, error, workOrdersError, activeFilter, onPeriod, onFilter, onClearFilter, onRetry, onRetryWorkOrders }: TaskOperationsReportProps) {
  const metrics = dashboard?.metrics;
  const distribution = dashboard?.status_distribution;
  const workOrderCounts = workOrders?.summary.work_orders;
  const hasWarning = Boolean(metrics && (metrics.overdue > 0 || metrics.failed > 0));
  const hasTypes = Boolean(dashboard?.task_types.length);
  return <section className="task-operations-report" aria-label="任务运营" aria-busy={loading || workOrdersLoading}>
    <header className="task-operations-head">
      <div className="task-operations-title"><h2>任务运营</h2><p className="muted">Agent／系统任务 · {period === "realtime" ? "实时口径" : "周期口径"}</p></div>
      <div className="task-operations-controls"><div className="task-period-segmented" role="group" aria-label="报表时间维度">{PERIODS.map((item) => <button key={item.value} type="button" className={period === item.value ? "is-active" : ""} aria-pressed={period === item.value} onClick={() => onPeriod(item.value)}>{item.label}</button>)}</div></div>
    </header>
    {loading ? <div className="task-report-skeleton" aria-label="正在读取任务运营数据"><span /><span /><span /><span /><span /><span /></div> : error ? <p className="task-center-load-error" role="alert">运营报表暂时无法读取。<button className="task-center-text-action" type="button" onClick={onRetry}>重试</button></p> : <>
      {hasWarning ? <div className="task-report-warning" role="alert"><span>{metrics!.overdue > 0 ? `有 ${metrics!.overdue} 个逾期任务需要处理` : `有 ${metrics!.failed} 个失败任务需要复核`}</span><button type="button" onClick={() => onFilter(metrics!.overdue > 0 ? "overdue" : "failed")}>查看任务</button></div> : null}
      <div className="task-operations-status-bar" aria-label="Agent／系统任务状态分布">{STATUS_SEGMENTS.map((segment) => {
        const value = distribution?.[segment.key] || 0;
        const interactive = Boolean(segment.filter);
        const selected = interactive && activeFilter === segment.filter;
        const Tag = interactive ? "button" : "span";
        return <Tag key={segment.key} className={`task-operation-status task-operation-status-${segment.key}${selected ? " is-active" : ""}`} style={segmentStyle(value)} {...(interactive ? { type: "button" as const, onClick: () => selected ? onClearFilter() : onFilter(segment.filter!), "aria-pressed": selected } : {})}><b>{value}</b><span>{segment.label}</span></Tag>;
      })}</div>
      <div className="task-report-kpis task-operations-kpis" aria-label="任务与工单关键指标">
        <KpiCard label="任务总量" value={count(metrics?.total)} />
        <KpiCard label="执行中" value={count(metrics?.in_progress)} active={activeFilter === "in_progress"} onClick={() => onFilter("in_progress")} />
        <KpiCard label="等待处理" value={count(metrics?.waiting)} active={activeFilter === "waiting"} onClick={() => onFilter("waiting")} />
        <KpiCard label="工单总量" value={count(workOrderCounts?.total, Boolean(workOrdersError) || workOrdersLoading)} />
        <KpiCard label="开放工单" value={count(workOrderCounts?.open, Boolean(workOrdersError) || workOrdersLoading)} />
        <KpiCard label="阻塞工单" value={count(workOrderCounts?.blocked, Boolean(workOrdersError) || workOrdersLoading)} alert={Boolean(workOrderCounts?.blocked)} />
      </div>
      {workOrdersError ? <p className="task-work-order-kpi-error" role="alert">工单指标暂时无法读取。<button className="task-center-text-action" type="button" onClick={onRetryWorkOrders}>重试</button></p> : null}
      {hasTypes ? <details className="task-operations-breakdown" open><summary>任务类型分布 <span>{dashboard!.task_types.length} 种类型</span></summary><div className="task-operations-table-wrap"><table className="task-operations-table"><thead><tr><th>任务类型</th><th>任务数</th><th>执行中</th><th>已完成</th><th>失败</th><th>趋势</th></tr></thead><tbody>{dashboard!.task_types.map((taskType) => <tr key={taskType.task_type}><td><strong>{taskType.title}</strong></td><td>{taskType.total}</td><td>{taskType.in_progress || "—"}</td><td>{taskType.completed || "—"}</td><td>{taskType.failed || "—"}</td><td><Sparkline values={taskType.trend} label={`${taskType.title}趋势`} /></td></tr>)}</tbody></table></div></details> : <p className="task-operations-empty muted">当前周期暂无可归类的任务。</p>}
      <p className="muted task-operations-as-of">更新于 {dashboard ? new Date(dashboard.as_of).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"} · Asia/Shanghai</p>
    </>}
  </section>;
}
