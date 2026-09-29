import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Task, type TaskDetail, type TaskEvent } from "../api";

type View = "active" | "history";
type TaskStatusTab = "queued" | "running" | "waiting_approval" | "failed" | "completed" | "cancelled";

const STATUS_TABS: Array<{ value: TaskStatusTab; label: string }> = [
  { value: "queued", label: "排队中" },
  { value: "running", label: "执行中" },
  { value: "waiting_approval", label: "待确认" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];
const ACTIVE = new Set(["pending", "queued", "running", "starting", "in_progress", "waiting", "waiting_approval"]);
const CLOSED = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);
const QUEUED = new Set(["pending", "queued"]);
const RUNNING = new Set(["running", "starting", "in_progress"]);
const WAITING = new Set(["waiting", "waiting_approval"]);
const COMPLETED = new Set(["completed", "done", "success", "succeeded"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

function isStatusTab(value: string | null): value is TaskStatusTab {
  return STATUS_TABS.some((tab) => tab.value === value);
}

function unwrap(value: Task[] | { tasks?: Task[] }): Task[] {
  return Array.isArray(value) ? value : value.tasks || [];
}

function normalizedStatus(task: Task) {
  return String(task.status || task.display_status || "pending").toLowerCase();
}

function statusOf(task: Task) {
  const value = normalizedStatus(task);
  if (value === "waiting_approval") return "待确认";
  if (value === "queued" || value === "pending") return "排队中";
  if (value === "running" || value === "starting" || value === "in_progress") return "执行中";
  if (CLOSED.has(value)) return value === "failed" ? "失败" : value === "cancelled" || value === "canceled" ? "已取消" : "已完成";
  return task.display_status_label || value;
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function taskSummary(task: Task) {
  return task.wait_reason || task.last_error || task.history_summary || task.next_action || task.description || task.content || "—";
}

function taskSignature(task: Task) {
  return [
    task.id,
    normalizedStatus(task),
    task.title,
    task.skill,
    task.skill_id,
    task.source,
    task.created_at,
    task.started_at,
    task.queued_at,
    task.queue_position,
    task.session_id,
    task.retryable,
    task.cancelable,
    taskSummary(task),
  ].map((value) => String(value ?? "")).join("\u001f");
}

function sameTaskRows(current: Task[], next: Task[]) {
  if (current.length !== next.length) return false;
  const currentById = new Map(current.map((task) => [task.id, task]));
  return next.every((task) => currentById.has(task.id) && taskSignature(currentById.get(task.id)!) === taskSignature(task));
}

function canSelect(task: Task) {
  return QUEUED.has(normalizedStatus(task)) || normalizedStatus(task) === "needs_clarification";
}

function canCancel(task: Task) {
  return task.cancelable !== false && canSelect(task);
}

function actionLabel(task: Task, view: View) {
  if (view === "history") return "查看结果";
  if (normalizedStatus(task) === "waiting_approval") return "继续处理";
  return "查看进度";
}

function belongsToTab(task: Task, tab: TaskStatusTab) {
  const value = normalizedStatus(task);
  if (tab === "queued") return QUEUED.has(value);
  if (tab === "running") return RUNNING.has(value);
  if (tab === "waiting_approval") return WAITING.has(value);
  if (tab === "failed") return value === "failed";
  if (tab === "completed") return COMPLETED.has(value);
  return CANCELLED.has(value);
}

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const selectedStatus: TaskStatusTab = isStatusTab(params.get("status")) ? params.get("status") as TaskStatusTab : "running";
  const view: View = ACTIVE.has(selectedStatus) ? "active" : "history";
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [actionBusy, setActionBusy] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const requestRef = useRef<Promise<void> | null>(null);
  const rowsRef = useRef<Task[]>([]);

  const load = useCallback((background = false) => {
    if (requestRef.current) return requestRef.current;
    const request = (async () => {
      if (!background) setLoading(true);
      setError("");
      try {
        const response = await api.tasks({ view, q: query, from, to });
        const nextRows = unwrap(response);
        if (!sameTaskRows(rowsRef.current, nextRows)) {
          rowsRef.current = nextRows;
          setRows(nextRows);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "任务列表加载失败");
      } finally {
        if (!background) setLoading(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, [view, query, from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (view !== "active") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, view]);

  const openDetail = async (task: Task) => {
    setActionBusy(`detail:${task.id}`);
    try {
      const [detailResponse, eventResponse] = await Promise.all([api.task(task.id), api.taskEvents(task.id)]);
      setSelected(("task" in detailResponse ? detailResponse.task : detailResponse) as TaskDetail);
      setEvents(Array.isArray(eventResponse) ? eventResponse : eventResponse.events || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务详情加载失败");
    } finally {
      setActionBusy("");
    }
  };

  const cancel = async (task: Task) => {
    if (!window.confirm("确认取消这个尚未开始执行的任务？")) return;
    setActionBusy(`cancel:${task.id}`);
    try {
      await api.cancelTask(task.id);
      await load();
      if (selected?.id === task.id) setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败");
    } finally {
      setActionBusy("");
    }
  };

  const retry = async (task: Task) => {
    setActionBusy(`retry:${task.id}`);
    try {
      await api.runTask(task.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重试失败");
    } finally {
      setActionBusy("");
    }
  };

  const visible = useMemo(() => rows.filter((task) => belongsToTab(task, selectedStatus)), [rows, selectedStatus]);
  const selectableRows = useMemo(() => visible.filter(canSelect), [visible]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((task) => selectedIds.has(task.id));
  const hasFilters = Boolean(query || from || to);

  useEffect(() => {
    const visibleIds = new Set(selectableRows.map((task) => task.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [selectableRows]);

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectableRows.map((task) => task.id)) : new Set());
  };

  const clearFilters = () => {
    setQuery("");
    setFrom("");
    setTo("");
  };

  const cancelSelected = async () => {
    if (!selectedIds.size || !window.confirm(`确认取消 ${selectedIds.size} 个排队任务？`)) return;
    setActionBusy("bulk-cancel");
    try {
      await Promise.all([...selectedIds].map((id) => api.cancelTask(id)));
      setSelectedIds(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量取消失败");
    } finally {
      setActionBusy("");
    }
  };

  return (
    <main className="tasks-page" data-task-center>
      <header className="tasks-page-head">
        <Link className="button button-primary task-center-create-action" to="/">新建任务</Link>
      </header>

      <nav className="tasks-tabs" aria-label="任务状态">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" className={selectedStatus === tab.value ? "is-active" : ""} aria-pressed={selectedStatus === tab.value} onClick={() => setParams({ status: tab.value })}>{tab.label}</button>
        ))}
      </nav>

      <div className="task-center-filters" role="search" aria-label="筛选任务">
        <label className="task-filter-search">
          <span className="sr-only">搜索任务</span>
          <span className="task-filter-search-wrap">
            <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
            <input aria-label="搜索任务名称、内容或技能" placeholder="搜索任务名称、内容或技能" value={query} onChange={(event) => setQuery(event.target.value)} />
          </span>
        </label>
        <fieldset className="task-filter-date-range">
          <legend>时间范围</legend>
          <input type="date" aria-label="开始日期" value={from} onChange={(event) => setFrom(event.target.value)} />
          <span aria-hidden="true">至</span>
          <input type="date" aria-label="结束日期" value={to} onChange={(event) => setTo(event.target.value)} />
        </fieldset>
        <div className="task-filter-actions">
          <button type="button" onClick={clearFilters} disabled={!hasFilters}>重置</button>
          {view === "active" && selectedIds.size ? <button type="button" onClick={() => void cancelSelected()} disabled={Boolean(actionBusy)}>取消选中 ({selectedIds.size})</button> : null}
        </div>
      </div>

      {error && <p className="surface-error" role="alert">{error} <button type="button" onClick={() => void load()}>重试</button></p>}

      {loading ? <p className="muted">正在读取任务状态…</p> : visible.length === 0 ? (
        <section className="task-center-empty">
          <strong>当前没有{STATUS_TABS.find((tab) => tab.value === selectedStatus)?.label}任务</strong>
          <p>任务状态变化后会自动更新。</p>
        </section>
      ) : (
        <div className="task-center-table-wrap">
          <table className="task-center-table">
            <colgroup>
              <col className="task-center-col-select" />
              <col className="task-center-col-task" />
              <col className="task-center-col-status" />
              <col className="task-center-col-time" />
              <col className="task-center-col-summary" />
              <col className="task-center-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th className="task-center-select">{view === "active" && selectableRows.length ? <input type="checkbox" aria-label="全选可取消任务" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} /> : null}</th>
                <th>任务</th>
                <th>状态</th>
                <th>时间</th>
                <th>结果摘要</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => {
                const summary = taskSummary(task);
                return (
                  <tr key={task.id}>
                    <td className="task-center-select">{view === "active" && canSelect(task) ? <input type="checkbox" aria-label={`选择 ${task.title || "未命名任务"}`} checked={selectedIds.has(task.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(task.id) : next.delete(task.id); return next; })} /> : null}</td>
                    <td className="task-center-task-cell"><strong title={task.title || "未命名任务"}>{task.title || "未命名任务"}</strong><small>{task.skill || task.skill_id || task.source || "Agent 任务"}</small></td>
                    <td className="task-center-status-cell"><span className={`task-center-status status-${normalizedStatus(task)}`}>{statusOf(task)}</span>{task.queue_position ? <small>队列第 {task.queue_position} 位</small> : null}</td>
                    <td className="task-center-time-cell"><small>创建 {formatTime(task.created_at)}</small>{task.started_at ? <small>开始 {formatTime(task.started_at)}</small> : task.queued_at ? <small>入队 {formatTime(task.queued_at)}</small> : null}</td>
                    <td className="task-center-summary-cell" title={summary}><span>{summary}</span></td>
                    <td className="task-center-actions"><button type="button" onClick={() => void openDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>{task.session_id ? <Link to={`/s/${task.session_id}`}>{actionLabel(task, view)}</Link> : null}{view === "active" && canCancel(task) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}{view === "history" && normalizedStatus(task) === "failed" && task.retryable !== false ? <button type="button" onClick={() => void retry(task)} disabled={Boolean(actionBusy)}>重试</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
        <header><div><p className="eyebrow">任务详情</p><h2>{selected.title}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header>
        <dl className="task-detail-meta"><div><dt>状态</dt><dd>{statusOf(selected)}</dd></div><div><dt>任务 ID</dt><dd>{selected.id}</dd></div><div><dt>创建时间</dt><dd>{formatTime(selected.created_at)}</dd></div><div><dt>说明</dt><dd>{taskSummary(selected)}</dd></div></dl>
        <p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p>
        <section><h3>执行事件</h3>{events.length ? <ol className="task-detail-events">{events.map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><strong>{event.title || event.type || "任务事件"}</strong><small>{formatTime(event.created_at)}</small><p>{event.summary || event.message || "—"}</p></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section>
        <div className="task-detail-actions">{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>{selected.status === "waiting" || selected.status === "waiting_approval" ? "继续处理" : "查看任务"}</Link> : null}{selected.status === "failed" ? <button className="button button-primary" type="button" onClick={() => void retry(selected)} disabled={Boolean(actionBusy)}>重试任务</button> : null}</div>
      </aside></div> : null}
    </main>
  );
}
