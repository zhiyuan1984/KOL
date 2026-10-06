import type { CSSProperties } from "react";
import type { TaskOperationsDashboard, TaskOperationsPeriod } from "../api";
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

function formatValue(value: number | null | undefined, kind: "count" | "rate" | "duration") {
  if (value == null || !Number.isFinite(value)) return kind === "count" ? "0" : "—";
  if (kind === "rate") return `${value.toFixed(1)}%`;
  if (kind === "duration") return `${value.toFixed(1)}h`;
  return String(Math.round(value));
}

function segmentStyle(value: number): CSSProperties {
  return { flexGrow: Math.max(value, 1) };
}

type TaskOperationsReportProps = {
  dashboard: TaskOperationsDashboard | null;
  period: TaskOperationsPeriod;
  loading: boolean;
  error: string;
  activeFilter: TaskOperationsFilter;
  onPeriod: (period: TaskOperationsPeriod) => void;
  onFilter: (filter: Exclude<TaskOperationsFilter, null>) => void;
  onClearFilter: () => void;
  onRetry: () => void;
};

export function TaskOperationsReport({ dashboard, period, loading, error, activeFilter, onPeriod, onFilter, onClearFilter, onRetry }: TaskOperationsReportProps) {
  const metrics = dashboard?.metrics;
  const deltas = dashboard?.comparison?.deltas;
  const trends = dashboard?.trends;
  const distribution = dashboard?.status_distribution;
  const hasWarning = Boolean(metrics && (metrics.overdue > 0 || metrics.failed > 0));
  return <section className="panel task-operations-report" aria-label="任务运营概览" aria-busy={loading}>
    <header className="task-operations-head">
      <div className="task-operations-title"><span className="task-operations-eyebrow">TASK OPERATIONS</span><h2>任务运营概览</h2><p className="muted">当前账户范围内的 Agent 与系统任务；指标、状态分布和明细保持同一数据范围。</p></div>
      <div className="task-operations-controls"><div className="task-period-segmented" role="group" aria-label="报表时间维度">{PERIODS.map((item) => <button key={item.value} type="button" className={period === item.value ? "is-active" : ""} aria-pressed={period === item.value} onClick={() => onPeriod(item.value)}>{item.label}</button>)}</div></div>
    </header>
    {loading ? <div className="task-report-skeleton" aria-label="正在读取任务运营数据"><span /><span /><span /><span /><span /><span /></div> : error ? <p className="task-center-load-error" role="alert">运营报表暂时无法读取。<button className="task-center-text-action" type="button" onClick={onRetry}>重试</button></p> : <>
      {hasWarning ? <div className="task-report-warning" role="alert"><span>{metrics!.overdue > 0 ? `有 ${metrics!.overdue} 个逾期任务需要处理` : `有 ${metrics!.failed} 个失败任务需要复核`}</span><button type="button" onClick={() => onFilter(metrics!.overdue > 0 ? "overdue" : "failed")}>查看任务</button></div> : null}
      <div className="task-operations-status-bar" aria-label="任务状态分布">{STATUS_SEGMENTS.map((segment) => {
        const value = distribution?.[segment.key] || 0;
        const interactive = Boolean(segment.filter);
        const selected = interactive && activeFilter === segment.filter;
        const Tag = interactive ? "button" : "span";
        return <Tag key={segment.key} className={`task-operation-status task-operation-status-${segment.key}${selected ? " is-active" : ""}`} style={segmentStyle(value)} {...(interactive ? { type: "button" as const, onClick: () => selected ? onClearFilter() : onFilter(segment.filter!), "aria-pressed": selected } : {})}><b>{value}</b><span>{segment.label}</span></Tag>;
      })}</div>
      <div className="task-report-kpis task-operations-kpis" aria-label="任务运营关键指标">
        <KpiCard label="任务总量" value={formatValue(metrics?.total, "count")} trend={trends?.total} realtime={period === "realtime"} />
        <KpiCard label="执行中" value={formatValue(metrics?.in_progress, "count")} delta={deltas?.in_progress} trend={trends?.in_progress} realtime={period === "realtime"} active={activeFilter === "in_progress"} onClick={() => onFilter("in_progress")} />
        <KpiCard label="等待处理" value={formatValue(metrics?.waiting, "count")} trend={trends?.in_progress} realtime={period === "realtime"} active={activeFilter === "waiting"} onClick={() => onFilter("waiting")} />
        <KpiCard label="完成率" value={formatValue(metrics?.completion_rate, "rate")} delta={deltas?.completion_rate} deltaUnit="pp" trend={trends?.completion_rate} realtime={period === "realtime"} active={activeFilter === "completed"} onClick={() => onFilter("completed")} />
        <KpiCard label="逾期任务" value={formatValue(metrics?.overdue, "count")} delta={deltas?.overdue_rate} deltaUnit="pp" trend={trends?.overdue_rate} realtime={period === "realtime"} invertedGood alert={Boolean(metrics?.overdue)} active={activeFilter === "overdue"} onClick={() => onFilter("overdue")} />
        <KpiCard label="中位处理时长" value={formatValue(metrics?.median_processing_hours, "duration")} delta={deltas?.median_processing_hours} deltaUnit="h" trend={trends?.median_processing_hours} realtime={period === "realtime"} />
      </div>
      <div className="task-operations-breakdown">
        <div className="split-head"><div><h3>任务类型分布</h3><p className="muted">按当前周期内创建或完成的任务汇总。</p></div>{activeFilter ? <button className="task-center-text-action" type="button" onClick={onClearFilter}>清除明细筛选</button> : null}</div>
        {dashboard?.task_types.length ? <div className="task-operations-table-wrap"><table className="task-operations-table"><thead><tr><th>任务类型</th><th>任务数</th><th>执行中</th><th>已完成</th><th>失败</th><th>趋势</th></tr></thead><tbody>{dashboard.task_types.map((taskType) => <tr key={taskType.task_type}><td><strong>{taskType.title}</strong></td><td>{taskType.total}</td><td>{taskType.in_progress || "—"}</td><td>{taskType.completed || "—"}</td><td>{taskType.failed || "—"}</td><td><Sparkline values={taskType.trend} label={`${taskType.title}趋势`} /></td></tr>)}</tbody></table></div> : <p className="muted task-operations-empty">当前周期内没有 Agent 或系统任务。</p>}
      </div>
      <p className="muted task-operations-as-of">数据源：现有 Agent／系统任务投影 · 截止 {dashboard ? new Date(dashboard.as_of).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"} · 时区 {dashboard?.timezone || "Asia/Shanghai"}</p>
    </>}
  </section>;
}
