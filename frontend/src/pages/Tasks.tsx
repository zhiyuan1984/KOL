import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type AiTaskWorkOrderAggregate, type AiTaskWorkOrderList, type Task, type TaskDetail, type TaskEvent } from "../api";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";

type View = "active" | "history";
type TaskStatusTab = "all" | "queued" | "running" | "waiting_approval" | "failed" | "completed" | "cancelled";

const STATUS_TABS: Array<{ value: TaskStatusTab; label: string }> = [
  { value: "all", label: "全部" },
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

function hidesSignalTimeout(value?: unknown) {
  return typeof value === "string" && /signal\s+timed\s+out/i.test(value);
}

function safeTaskText(value?: unknown, fallback = "—") {
  if (value == null || String(value).trim() === "") return fallback;
  const cleaned = String(value).replace(/signal\s+timed\s+out/gi, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || fallback;
}

function taskSummary(task: Task) {
  return safeTaskText(task.wait_reason || task.last_error || task.history_summary || task.next_action || task.description || task.content);
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

function mergeTaskRows(head: Task[], tail: Task[]): Task[] {
  const seen = new Set(head.map((task) => task.id));
  return [...head, ...tail.filter((task) => !seen.has(task.id))];
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
  if (tab === "all") return true;
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
  const view: View = selectedStatus === "all" || ACTIVE.has(selectedStatus) ? "active" : "history";
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [aiTaskRoots, setAiTaskRoots] = useState<AiTaskWorkOrderList["items"]>([]);
  const [selectedAiTask, setSelectedAiTask] = useState<AiTaskWorkOrderAggregate | null>(null);
  const [showAiTaskCreate, setShowAiTaskCreate] = useState(false);
  const [aiTaskDraft, setAiTaskDraft] = useState({ title: "", goal: "", due_at: "", priority: "normal" });
  const [showAiEventCreate, setShowAiEventCreate] = useState(false);
  const [aiEventDraft, setAiEventDraft] = useState({ event_type: "mail.reply_verified", summary: "", evidence_ref: "", occurred_at: "" });
  const [aiEventNotice, setAiEventNotice] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const requestRef = useRef<Promise<void> | null>(null);
  const rowsRef = useRef<Task[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedRunId = useMemo(() => {
    const runs = selected?.runs || [];
    const latest = [...runs].reverse().find((run) => typeof run.id === "string" || typeof run.run_id === "string");
    return latest ? String(latest.id || latest.run_id || "") || null : null;
  }, [selected]);
  const liveRunEvents = useTaskRunEventStream(selectedRunId);

  const load = useCallback((background = false, append = false) => {
    if (requestRef.current) return requestRef.current;
    if (append && !nextCursorRef.current) return Promise.resolve();
    const request = (async () => {
      if (!background && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setError("");
      try {
        const response = await api.taskPage({
          view: "history", q: query, from, to, limit: 100,
          cursor: append ? nextCursorRef.current || undefined : undefined,
        });
        const nextRows = response.items || [];
        const merged = append
          ? mergeTaskRows(rowsRef.current, nextRows)
          : background
            ? mergeTaskRows(nextRows, rowsRef.current)
            : nextRows;
        if (!sameTaskRows(rowsRef.current, merged)) {
          rowsRef.current = merged;
          setRows(merged);
        }
        setTotal(Number(response.page?.total || 0));
        if (!background || append || rowsRef.current.length <= 100) {
          nextCursorRef.current = response.page?.next_cursor || null;
          setNextCursor(nextCursorRef.current);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "任务列表加载失败");
      } finally {
        if (!background && !append) setLoading(false);
        if (append) setLoadingMore(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, [view, query, from, to]);

  useEffect(() => { void load(); }, [load]);
  const loadAiTaskRoots = useCallback(async () => {
    try {
      const response = await api.aiTaskWorkOrders();
      setAiTaskRoots(response.items || []);
    } catch {
      // The legacy task center remains usable while PostgreSQL AI task roots are unavailable.
      setAiTaskRoots([]);
    }
  }, []);
  useEffect(() => { void loadAiTaskRoots(); }, [loadAiTaskRoots]);
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
      await api.cancelTask(task);
      await load();
      if (selected?.id === task.id) setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败");
    } finally {
      setActionBusy("");
    }
  };

  const openAiTask = async (taskId: string) => {
    setActionBusy(`ai-task:${taskId}`);
    try {
      setSelectedAiTask(await api.aiTaskWorkOrder(taskId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 工单任务详情加载失败");
    } finally {
      setActionBusy("");
    }
  };

  const createAiTask = async () => {
    if (!aiTaskDraft.title.trim()) {
      setError("请填写业务任务标题。");
      return;
    }
    setActionBusy("ai-task:create");
    setError("");
    try {
      const created = await api.createAiTaskWorkOrderRoot({
        title: aiTaskDraft.title.trim(),
        goal: aiTaskDraft.goal.trim() || undefined,
        due_at: aiTaskDraft.due_at ? new Date(`${aiTaskDraft.due_at}T23:59:59`).toISOString() : undefined,
        priority: aiTaskDraft.priority as "important_urgent" | "important" | "urgent" | "normal" | "low",
        idempotency_key: `ai-task-root-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      });
      setAiTaskDraft({ title: "", goal: "", due_at: "", priority: "normal" });
      setShowAiTaskCreate(false);
      await loadAiTaskRoots();
      setSelectedAiTask(await api.aiTaskWorkOrder(created.task.task_id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 业务任务创建失败");
    } finally {
      setActionBusy("");
    }
  };

  const recordAiVerifiedEvent = async () => {
    if (!selectedAiTask) return;
    if (!aiEventDraft.summary.trim() || !aiEventDraft.evidence_ref.trim()) {
      setError("请填写已核验事实摘要和证据引用。");
      return;
    }
    const taskId = selectedAiTask.task.task_id;
    setActionBusy("ai-task:verified-event");
    setError("");
    setAiEventNotice("");
    try {
      const stamp = Date.now();
      const result = await api.recordAiTaskVerifiedEvent(taskId, {
        source_system: "workbench_human_verification",
        source_event_id: `workbench:${taskId}:${stamp}`,
        source_version: "workbench.v1",
        event_type: aiEventDraft.event_type,
        occurred_at: aiEventDraft.occurred_at ? new Date(aiEventDraft.occurred_at).toISOString() : new Date().toISOString(),
        summary: aiEventDraft.summary.trim(),
        evidence_ref: aiEventDraft.evidence_ref.trim(),
        evidence: { verified_in: "workbench", actor_action: "human_verified_event" },
        payload: {},
        idempotency_key: `workbench-verified-event-${taskId}-${stamp}`,
      });
      setAiEventDraft({ event_type: "mail.reply_verified", summary: "", evidence_ref: "", occurred_at: "" });
      setShowAiEventCreate(false);
      setAiEventNotice(`已核验事件已进入 Jev → Outbox → Worker 管道（决策：${result.decision.outcome}；作业：${result.execution_job.status}）。`);
      await loadAiTaskRoots();
      setSelectedAiTask(await api.aiTaskWorkOrder(taskId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "已核验事件登记失败");
    } finally {
      setActionBusy("");
    }
  };

  const visible = useMemo(() => rows.filter((task) => belongsToTab(task, selectedStatus)), [rows, selectedStatus]);
  const counts = useMemo(() => {
    const next = new Map<TaskStatusTab, number>();
    STATUS_TABS.forEach((tab) => next.set(tab.value, tab.value === "all" ? rows.length : rows.filter((task) => belongsToTab(task, tab.value)).length));
    return next;
  }, [rows]);
  const selectableRows = useMemo(() => visible.filter(canSelect), [visible]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((task) => selectedIds.has(task.id));
  useEffect(() => {
    const visibleIds = new Set(selectableRows.map((task) => task.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [selectableRows]);

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectableRows.map((task) => task.id)) : new Set());
  };

  const cancelSelected = async () => {
    if (!selectedIds.size || !window.confirm(`确认取消 ${selectedIds.size} 个排队任务？`)) return;
    setActionBusy("bulk-cancel");
    try {
      const selectedTasks = rows.filter((task) => selectedIds.has(task.id));
      await Promise.all(selectedTasks.map((task) => api.cancelTask(task)));
      setSelectedIds(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量取消失败");
    } finally {
      setActionBusy("");
    }
  };

  const loadMore = () => { void load(false, true); };

  return (
    <main className="tasks-page" data-task-center>
      <nav className="tasks-tabs" aria-label="任务状态">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" className={selectedStatus === tab.value ? "is-active" : ""} aria-pressed={selectedStatus === tab.value} onClick={() => setParams({ status: tab.value })}>{tab.label}<span className="tasks-tab-count" aria-label={`${counts.get(tab.value) || 0} 个任务`}>{counts.get(tab.value) || 0}</span></button>
        ))}
        {selectedStatus === "cancelled" ? <Link className="button button-primary task-center-create-action" to="/">新建任务</Link> : null}
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
          <span className="task-filter-date-label">时间范围</span>
          <input type="date" aria-label="开始日期" value={from} onChange={(event) => setFrom(event.target.value)} />
          <span aria-hidden="true">至</span>
          <input type="date" aria-label="结束日期" value={to} onChange={(event) => setTo(event.target.value)} />
        </fieldset>
        <div className="task-filter-actions">
          {view === "active" && selectedIds.size ? <button type="button" onClick={() => void cancelSelected()} disabled={Boolean(actionBusy)}>取消选中 ({selectedIds.size})</button> : null}
        </div>
      </div>

      <section className="panel task-work-order-summary" aria-label="AI 标准工单任务">
        <div className="split-head"><div><h2>AI 标准工单任务</h2><p className="muted">先建立业务目标，再由已核验事件、已发布模板和受控 Jev 判断生成标准执行工单。下方工作台运行任务和今日/待办投影保持原有语义；子工单不会自动完成任务根。</p></div><div className="row-actions"><span className="status-ok">{aiTaskRoots.length} 个任务根</span><button className="btn ghost" type="button" onClick={() => setShowAiTaskCreate((current) => !current)}>{showAiTaskCreate ? "收起" : "新建业务任务"}</button></div></div>
        {showAiTaskCreate && <form className="task-work-order-create" onSubmit={(event) => { event.preventDefault(); void createAiTask(); }}>
          <label>任务标题<input value={aiTaskDraft.title} maxLength={200} placeholder="例如：推进 KOL 报价确认" onChange={(event) => setAiTaskDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label>业务目标<textarea value={aiTaskDraft.goal} maxLength={4000} placeholder="说明要达成的业务结果；工单将围绕该目标生成。" onChange={(event) => setAiTaskDraft((current) => ({ ...current, goal: event.target.value }))} /></label>
          <label>优先级<select value={aiTaskDraft.priority} onChange={(event) => setAiTaskDraft((current) => ({ ...current, priority: event.target.value }))}><option value="important_urgent">重要且紧急</option><option value="important">重要</option><option value="urgent">紧急</option><option value="normal">普通</option><option value="low">低</option></select></label>
          <label>截止日期<input type="date" value={aiTaskDraft.due_at} onChange={(event) => setAiTaskDraft((current) => ({ ...current, due_at: event.target.value }))} /></label>
          <div className="row-actions"><button className="btn primary" type="submit" disabled={actionBusy === "ai-task:create"}>{actionBusy === "ai-task:create" ? "创建中…" : "创建业务任务"}</button></div>
        </form>}
        {aiTaskRoots.length ? aiTaskRoots.map((item) => <div className="admin-row" key={item.task.task_id}>
          <div><strong>{item.task.title}</strong><p className="muted">开放工单 {item.counts.open}/{item.counts.total} · 阻塞 {item.counts.blocked} · 待复核 {item.counts.waiting_review}{item.current_blocking_work_order ? ` · 当前阻塞：${item.current_blocking_work_order.title}` : ""}</p></div>
          <div className="row-actions"><span className="muted">任务：{item.task.status}</span><button className="btn ghost" type="button" disabled={actionBusy === `ai-task:${item.task.task_id}`} onClick={() => void openAiTask(item.task.task_id)}>查看工单</button></div>
        </div>) : <p className="muted">尚未建立 AI 业务任务。创建任务后，只有已核验事件和已发布的自动化规则才能生成或分派标准工单。</p>}
      </section>

      {error && <p className="surface-error" role="alert">{hidesSignalTimeout(error) ? "任务暂时无法读取，请稍后查看。" : error}</p>}

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
                    <td className="task-center-task-cell"><strong title={safeTaskText(task.title, "未命名任务")}>{safeTaskText(task.title, "未命名任务")}</strong><small>{task.skill || task.skill_id || task.source || "Agent 任务"}</small></td>
                    <td className="task-center-status-cell"><span className={`task-center-status status-${normalizedStatus(task)}`}>{statusOf(task)}</span>{task.queue_position ? <small>队列第 {task.queue_position} 位</small> : null}</td>
                    <td className="task-center-time-cell"><small>创建 {formatTime(task.created_at)}</small>{task.started_at ? <small>开始 {formatTime(task.started_at)}</small> : task.queued_at ? <small>入队 {formatTime(task.queued_at)}</small> : null}</td>
                    <td className="task-center-summary-cell" title={summary}><span>{summary}</span></td>
                    <td className="task-center-actions"><button type="button" onClick={() => void openDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>{task.session_id ? <Link to={`/s/${task.session_id}`}>{actionLabel(task, view)}</Link> : null}{view === "active" && canCancel(task) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 ? <div className="row-actions task-center-pagination" aria-live="polite">
        <span className="muted">已载入 {rows.length} / {total || rows.length} 个任务</span>
        {nextCursor ? <button type="button" className="btn ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多任务"}</button> : <span className="muted">已显示全部匹配任务</span>}
      </div> : null}

      {selected ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
        <header><div><p className="eyebrow">任务详情</p><h2>{safeTaskText(selected.title, "未命名任务")}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header>
        <dl className="task-detail-meta"><div><dt>状态</dt><dd>{statusOf(selected)}</dd></div><div><dt>任务 ID</dt><dd>{selected.id}</dd></div><div><dt>创建时间</dt><dd>{formatTime(selected.created_at)}</dd></div><div><dt>说明</dt><dd>{taskSummary(selected)}</dd></div></dl>
        <p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p>
        <section><h3>执行事件 {liveRunEvents.connected ? <small className="muted">实时更新中</small> : liveRunEvents.fallback ? <small className="muted">正在以安全补读更新</small> : null}</h3>{(liveRunEvents.events.length ? liveRunEvents.events : events).length ? <ol className="task-detail-events">{(liveRunEvents.events.length ? liveRunEvents.events : events).map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><strong>{safeTaskText(event.title || event.type, "任务事件")}</strong><small>{formatTime(event.created_at)}</small><p>{safeTaskText(event.summary || event.message)}</p></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section>
        <div className="task-detail-actions">{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>{selected.status === "waiting" || selected.status === "waiting_approval" ? "继续处理" : "查看任务"}</Link> : null}</div>
      </aside></div> : null}
      {selectedAiTask ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAiTask(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="AI 标准工单任务详情">
        <header><div><p className="eyebrow">业务任务 · AI 标准工单</p><h2>{selectedAiTask.task.title}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelectedAiTask(null)}>×</button></header>
        <dl className="task-detail-meta"><div><dt>任务状态</dt><dd>{selectedAiTask.task.status}</dd></div><div><dt>业务目标</dt><dd>{selectedAiTask.task.goal}</dd></div><div><dt>任务截止</dt><dd>{formatTime(selectedAiTask.task.due_at)}</dd></div><div><dt>子工单</dt><dd>{selectedAiTask.counts.open} 开放 / {selectedAiTask.counts.total} 总计 / {selectedAiTask.counts.blocked} 阻塞</dd></div></dl>
        <section><div className="split-head"><div><h3>登记已核验业务事件</h3><p className="muted">只登记已核验事实，不填写推测或结论。提交后才会触发受控 Jev 判断与异步工单管道；运行成功不代表工单或任务完成。</p></div><button className="btn ghost sm" type="button" onClick={() => setShowAiEventCreate((current) => !current)}>{showAiEventCreate ? "收起" : "登记事件"}</button></div>{showAiEventCreate && <form className="task-work-order-create task-work-order-event-create" onSubmit={(event) => { event.preventDefault(); void recordAiVerifiedEvent(); }}><label>事件类型<select value={aiEventDraft.event_type} onChange={(event) => setAiEventDraft((current) => ({ ...current, event_type: event.target.value }))}><option value="mail.reply_verified">已验证邮件回复</option><option value="mail.commitment_verified">已验证邮件承诺</option><option value="deadline.quote">报价期限</option><option value="deadline.contract">合同期限</option><option value="deadline.sample">样品期限</option><option value="deadline.content">内容期限</option></select></label><label>事实摘要<textarea value={aiEventDraft.summary} maxLength={1000} placeholder="仅写已经确认的事实，例如：已确认报价回复截止时间为…" onChange={(event) => setAiEventDraft((current) => ({ ...current, summary: event.target.value }))} /></label><label>证据引用<input value={aiEventDraft.evidence_ref} maxLength={1000} placeholder="例如：mail:thread/123 或 contract:version/2" onChange={(event) => setAiEventDraft((current) => ({ ...current, evidence_ref: event.target.value }))} /></label><label>发生时间<input type="datetime-local" value={aiEventDraft.occurred_at} onChange={(event) => setAiEventDraft((current) => ({ ...current, occurred_at: event.target.value }))} /></label><div className="row-actions"><button className="btn primary" type="submit" disabled={actionBusy === "ai-task:verified-event"}>{actionBusy === "ai-task:verified-event" ? "提交中…" : "提交已核验事件"}</button></div></form>}{aiEventNotice && <p className="muted" role="status">{aiEventNotice}</p>}</section>
        <section><h3>已核验业务事件</h3>{selectedAiTask.verified_events.length ? <ol className="task-detail-events">{selectedAiTask.verified_events.map((event) => <li key={event.id}><strong>{event.event_type}</strong><small>{formatTime(event.occurred_at)} · 核验 {formatTime(event.verified_at)}</small><p>{event.summary}</p><p className="muted">证据：{event.evidence_ref}</p></li>)}</ol> : <p className="muted">尚未记录可用于自动化判断的已核验业务事件。</p>}</section>
        <section><h3>标准执行工单</h3>{selectedAiTask.work_orders.length ? <ol className="task-detail-events">{selectedAiTask.work_orders.map((order) => <li key={order.work_order_id}><strong>{order.title}</strong><small>{order.template_code}.v{order.template_version} · {order.automation_level} · {order.status}</small><p>{order.objective}</p><p className="muted">主受理：{order.primary_assignee?.person_ref || order.primary_assignee?.principal_id || "尚未分派"} · 决策：{order.latest_decision ? `${order.latest_decision.outcome}（${order.latest_decision.confidence ?? "—"}）` : "—"}</p></li>)}</ol> : <p className="muted">该业务任务尚未物化标准执行工单。</p>}</section>
        <p className="muted">数据来源：PostgreSQL 任务—工单关系；子工单终态不会直接改变任务根状态。</p>
      </aside></div> : null}
    </main>
  );
}
