import type { CSSProperties, ReactNode } from "react";
import type { AiTaskWorkOrderDashboard, TaskOperationsDashboard, TaskOperationsPeriod } from "../api";

export type TaskOperationsStatusFilter = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type TaskOperationsFilter = "in_progress" | TaskOperationsStatusFilter | "overdue" | null;

const PERIODS: Array<{ value: TaskOperationsPeriod; label: string }> = [
  { value: "realtime", label: "实时" }, { value: "today", label: "今日" }, { value: "week", label: "本周" },
  { value: "month", label: "本月" }, { value: "year", label: "全年" },
];

const STATUS_SEGMENTS: Array<{ key: keyof TaskOperationsDashboard["status_distribution"]; label: string; filter: TaskOperationsStatusFilter }> = [
  { key: "queued", label: "待启动", filter: "queued" }, { key: "running", label: "执行中", filter: "running" },
  { key: "waiting", label: "等待处理", filter: "waiting" }, { key: "completed", label: "已完成", filter: "completed" },
  { key: "failed", label: "失败", filter: "failed" }, { key: "cancelled", label: "已取消", filter: "cancelled" },
];

function count(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

function segmentStyle(value: number): CSSProperties {
  return { flexBasis: 0, flexGrow: value };
}

function formatAsOf(asOf: string, timezone: string) {
  const date = new Date(asOf);
  if (Number.isNaN(date.valueOf())) return asOf;
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return asOf;
  }
}

export type TaskOperationsReportProps = {
  dashboard: TaskOperationsDashboard | null;
  workOrders: AiTaskWorkOrderDashboard | null;
  period: TaskOperationsPeriod;
  loading: boolean;
  workOrdersLoading: boolean;
  error: string;
  workOrdersError: string;
  activeFilter: TaskOperationsFilter;
  activeStatus?: TaskOperationsStatusFilter | null;
  filteredRangeLabel?: string;
  onPeriod: (period: TaskOperationsPeriod) => void;
  onFilter: (filter: Exclude<TaskOperationsFilter, null>) => void;
  onClearFilter: () => void;
  onRetry: () => void;
  onRetryWorkOrders: () => void;
  headerAction?: ReactNode;
};

export function TaskOperationsReport({ dashboard, workOrders, period, loading, workOrdersLoading, error, workOrdersError, activeFilter, activeStatus, filteredRangeLabel, onPeriod, onFilter, onClearFilter, onRetry, onRetryWorkOrders, headerAction }: TaskOperationsReportProps) {
  const metrics = dashboard?.metrics;
  const distribution = dashboard?.status_distribution;
  const workOrderCounts = workOrders?.summary.work_orders;
  return <section className="task-operations-report" aria-label="任务运营" aria-busy={loading || workOrdersLoading}>
    <header className="task-operations-head">
      <div className="task-operations-title"><h2>任务运营</h2><p className="muted">Agent／系统任务 · {filteredRangeLabel || (period === "realtime" ? "当前快照" : "周期口径")}</p>{dashboard ? <span className="task-operations-as-of">更新于 {formatAsOf(dashboard.as_of, dashboard.timezone)} · {dashboard.timezone}</span> : null}</div>
      <div className="task-operations-controls"><div className="task-period-segmented" role="group" aria-label="报表时间维度">{PERIODS.map((item) => <button key={item.value} type="button" className={period === item.value ? "is-active" : ""} aria-pressed={period === item.value} onClick={() => onPeriod(item.value)}>{item.label}</button>)}</div>{headerAction}</div>
    </header>
    {loading && !dashboard ? <div className="task-report-skeleton" aria-label="正在读取任务运营数据"><span /><span /><span /><span /><span /><span /></div> : <>
      {error ? <div className="task-report-warning" role="alert"><span>{dashboard ? "任务运营更新失败，当前显示上次成功数据。" : "运营报表暂时无法读取。"}</span><button type="button" onClick={onRetry}>重试</button></div> : null}
      {dashboard && metrics && distribution ? <>
        <section className="task-operations-summary" aria-label="任务汇总">
          <button type="button" className={`task-operations-summary-total${activeFilter === null && activeStatus == null ? " is-active" : ""}`} aria-pressed={activeFilter === null && activeStatus == null} onClick={onClearFilter}><span>任务总量</span><strong>{count(metrics.total)}</strong></button>
          {metrics.overdue > 0 ? <div className="task-report-warning" role="alert"><span>有 {count(metrics.overdue)} 个逾期任务需要处理</span><button type="button" onClick={() => onFilter("overdue")}>查看逾期任务</button></div> : null}
          {metrics.failed > 0 ? <div className="task-report-warning" role="alert"><span>有 {count(metrics.failed)} 个失败任务需要复核</span><button type="button" onClick={() => onFilter("failed")}>查看失败任务</button></div> : null}
        </section>
        <section className="task-operations-lifecycle" aria-label="Agent／系统任务生命周期分布">
          <div className="task-status-track" role="img" aria-label={STATUS_SEGMENTS.map((segment) => `${segment.label} ${count(distribution[segment.key])}`).join("，")}>
            {STATUS_SEGMENTS.map((segment) => {
              const value = distribution[segment.key];
              return Number.isFinite(value) && value > 0 ? <span key={segment.key} className={`task-status-track-segment task-status-track-segment-${segment.key}`} style={segmentStyle(value)} aria-hidden="true" /> : null;
            })}
          </div>
          <div className="task-operations-status-bar" role="group" aria-label="按生命周期状态筛选">{STATUS_SEGMENTS.map((segment) => {
            const selected = activeStatus === undefined ? activeFilter === segment.filter : activeStatus === segment.filter;
            return <button key={segment.key} type="button" className={`task-operation-status task-operation-status-${segment.key}${selected ? " is-active" : ""}`} onClick={() => onFilter(segment.filter)} aria-pressed={selected}><b>{count(distribution[segment.key])}</b><span>{segment.label}</span></button>;
          })}</div>
        </section>
      </> : <p className="task-operations-empty muted">暂无可用的任务运营数据。</p>}
      <section className="task-work-order-summary" aria-label="工单汇总" aria-busy={workOrdersLoading}>
        <span>子工单 · {filteredRangeLabel ? "工单仍按周期口径" : "只读汇总"}</span>
        <dl><div><dt>工单总量</dt><dd>{count(workOrderCounts?.total)}</dd></div><div><dt>开放工单</dt><dd>{count(workOrderCounts?.open)}</dd></div><div><dt>阻塞工单</dt><dd>{count(workOrderCounts?.blocked)}</dd></div></dl>
        {workOrdersLoading && !workOrders ? <p className="muted">正在读取工单汇总…</p> : null}
        {workOrdersError ? <p className="task-report-warning" role="alert">{workOrders ? "工单汇总更新失败，当前显示上次成功数据。" : "工单指标暂时无法读取。"}<button type="button" onClick={onRetryWorkOrders}>重试</button></p> : null}
      </section>
    </>}
  </section>;
}
