import type { TaskOperationsDashboard, TaskOperationsPeriod } from "../api";
import { Sparkline } from "./Sparkline";

export type TaskTypeBreakdownProps = {
  dashboard: TaskOperationsDashboard | null;
  period: TaskOperationsPeriod;
  loading: boolean;
  error: string;
  onTypeFilter?: (type: string) => void;
  activeType?: string;
};

const TREND_WINDOWS: Record<TaskOperationsPeriod, string> = {
  today: "今日 24 小时",
  week: "本周 7 日",
  month: "本月 30 日",
  year: "全年 12 月",
  realtime: "实时近 7 日",
};

function displayCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

export function TaskTypeBreakdown({ dashboard, period, loading, error, onTypeFilter, activeType }: TaskTypeBreakdownProps) {
  if (loading && !dashboard) return <p className="task-operations-empty muted">正在读取任务类型分析…</p>;
  if (!dashboard) return <p className="task-operations-empty muted" role={error ? "alert" : undefined}>{error ? "任务类型分析暂时无法读取。" : "暂无可用的任务类型分析。"}</p>;
  const taskTypes = dashboard.task_types;
  if (!taskTypes.length) return <p className="task-operations-empty muted">当前周期暂无可归类的任务。</p>;

  return <>
    {error ? <p className="task-report-warning" role="alert">任务类型分析更新失败，当前显示上次成功数据。</p> : null}
    <details className="task-operations-breakdown">
      <summary>任务类型分布 <span>{taskTypes.length} 种类型</span></summary>
      <p className="task-operations-trend-window">趋势窗口：{TREND_WINDOWS[period]}</p>
      <div className="task-operations-table-wrap">
        <table className="task-operations-table">
          <thead>
            <tr><th scope="col">任务类型</th><th scope="col">任务数</th><th scope="col">处理中（含等待）</th><th scope="col">已完成</th><th scope="col">失败</th><th scope="col">趋势</th></tr>
          </thead>
          <tbody>
            {taskTypes.map((taskType) => <tr key={taskType.task_type}>
              <td>{onTypeFilter ? <button type="button" className={`task-operations-type-filter${activeType === taskType.task_type ? " is-active" : ""}`} aria-pressed={activeType === taskType.task_type} onClick={() => onTypeFilter(taskType.task_type)}><strong>{taskType.title}</strong></button> : <strong>{taskType.title}</strong>}</td>
              <td>{displayCount(taskType.total)}</td>
              <td>{displayCount(taskType.in_progress)}</td>
              <td>{displayCount(taskType.completed)}</td>
              <td>{displayCount(taskType.failed)}</td>
              <td><Sparkline values={taskType.trend} label={`${taskType.title}趋势，${TREND_WINDOWS[period]}`} /></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </details>
  </>;
}
