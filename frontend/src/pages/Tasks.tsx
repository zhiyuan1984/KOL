import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Task, type TaskDetail, type TaskEvent, type Ticket } from "../api";
import { useTaskRunEventStream } from "../hooks/useTaskRunEventStream";
import TicketCreateDialog from "../home/TicketCreateDialog";
import TicketEditDialog from "../home/TicketEditDialog";

type View = "active" | "history";
type TaskStatusTab = "authorized" | "assigned" | "created" | "watching" | "completed";

const STATUS_TABS: Array<{ value: TaskStatusTab; label: string }> = [
  { value: "assigned", label: "我受理" },
  { value: "created", label: "我创建" },
  { value: "watching", label: "我关注" },
  { value: "completed", label: "已完成" },
  { value: "authorized", label: "全部授权" },
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
  return Array.isArray(task.allowed_actions) && task.allowed_actions.includes("cancel");
}

function canCancel(task: Task) {
  return canSelect(task);
}

function actionLabel(task: Task, view: View) {
  if (view === "history") return "查看结果";
  if (normalizedStatus(task) === "waiting_approval") return "继续处理";
  return "查看进度";
}

function belongsToTab(task: Task, tab: TaskStatusTab) {
  void task;
  void tab;
  // PostgreSQL applies the authorization view before pagination. Client-side
  // status filtering would make page counts and cursor traversal inaccurate.
  return true;
}

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const selectedStatus: TaskStatusTab = isStatusTab(params.get("view")) ? params.get("view") as TaskStatusTab : "assigned";
  const view: View = selectedStatus === "completed" ? "history" : "active";
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
  const nextCursorRef = useRef<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdTicketId, setCreatedTicketId] = useState("");
  const [editTarget, setEditTarget] = useState<Task | null>(null);
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
        const response = await api.tickets({
          view: selectedStatus, q: query, from, to, limit: 100,
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
        setTotal(0);
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
  }, [selectedStatus, query, from, to]);

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
      const [detail, timeline] = await Promise.all([api.ticket(task.id), api.ticketTimeline(task.id)]);
      setSelected(detail as TaskDetail);
      setEvents(timeline.items.map((event) => ({
        id: event.event_id,
        type: event.type,
        title: event.type,
        status: event.status,
        created_at: event.occurred_at,
        summary: event.safe_summary || undefined,
      })) as TaskEvent[]);
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

  const submitTicketCommand = async (task: Task, action: "accept" | "complete" | "reopen") => {
    const version = Math.max(1, Number(task.data_version || 1));
    if (action === "accept" && !window.confirm("确认受理该工单？受理不会自动完成工单。")) return;
    let acceptanceEvidence: Record<string, unknown> | undefined;
    if (action === "complete") {
      const note = window.prompt("请填写验收证据或完成说明：");
      if (!note?.trim()) return;
      if (!window.confirm("确认以这条证据完成验收？完成后将形成不可变验收事实。")) return;
      acceptanceEvidence = { note: note.trim(), submitted_from: "ticket_center" };
    }
    const reopenReason = action === "reopen" ? window.prompt("请填写重开原因：") : undefined;
    if (action === "reopen" && !reopenReason?.trim()) return;
    if (action === "reopen" && !window.confirm("确认重开工单？当前验收投影将被撤销，但历史验收事实会保留。")) return;
    setActionBusy(`${action}:${task.id}`);
    try {
      const result = await api.ticketCommand(task.id, action === "complete"
        ? { action, expected_version: version, idempotency_key: `ticket-complete-${crypto.randomUUID()}`, acceptance_evidence: acceptanceEvidence! }
        : action === "reopen"
          ? { action, expected_version: version, idempotency_key: `ticket-reopen-${crypto.randomUUID()}`, reason: reopenReason!.trim() }
          : { action, expected_version: version, idempotency_key: `ticket-accept-${crypto.randomUUID()}` });
      await load();
      await openDetail({ ...task, ...(result.ticket || {}), data_version: result.version });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : action === "accept" ? "受理失败" : action === "reopen" ? "重开失败" : "验收失败");
    } finally {
      setActionBusy("");
    }
  };

  const visible = useMemo(() => rows.filter((task) => belongsToTab(task, selectedStatus)), [rows, selectedStatus]);
  const counts = useMemo(() => {
    const next = new Map<TaskStatusTab, number>();
    STATUS_TABS.forEach((tab) => next.set(tab.value, tab.value === selectedStatus ? rows.length : 0));
    return next;
  }, [rows, selectedStatus]);
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

  const saveEditedTicket = (ticket: Ticket) => {
    const next = rowsRef.current.map((row) => row.id === ticket.id ? { ...row, ...ticket } : row);
    rowsRef.current = next;
    setRows(next);
    setSelected((current) => current?.id === ticket.id ? { ...current, ...ticket } : current);
  };

  return (
    <main className="tasks-page" data-task-center>
      <nav className="tasks-tabs" aria-label="任务状态">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" className={selectedStatus === tab.value ? "is-active" : ""} aria-pressed={selectedStatus === tab.value} onClick={() => setParams({ view: tab.value })}>{tab.label}<span className="tasks-tab-count" aria-label={selectedStatus === tab.value ? `${counts.get(tab.value) || 0} 个已加载工单` : "切换后读取"}>{selectedStatus === tab.value ? counts.get(tab.value) || 0 : "—"}</span></button>
        ))}
        <button type="button" className="button button-primary task-center-create-action" onClick={() => setCreateOpen(true)}>新建工单</button>
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

      {error && <p className="surface-error" role="alert">{hidesSignalTimeout(error) ? "任务暂时无法读取，请稍后查看。" : error}</p>}
      {createdTicketId ? <p className="task-center-created" role="status">正式工单已创建：{createdTicketId}</p> : null}

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
                    <td className="task-center-actions"><button type="button" onClick={() => void openDetail(task)} disabled={actionBusy === `detail:${task.id}`}>详情</button>{Array.isArray(task.allowed_actions) && task.allowed_actions.includes("accept") ? <button type="button" onClick={() => void submitTicketCommand(task, "accept")} disabled={Boolean(actionBusy)}>受理</button> : null}{Array.isArray(task.allowed_actions) && task.allowed_actions.includes("edit") ? <button type="button" onClick={() => setEditTarget(task)}>编辑</button> : null}{task.session_id ? <Link to={`/s/${task.session_id}`}>{actionLabel(task, view)}</Link> : null}{view === "active" && canCancel(task) ? <button type="button" onClick={() => void cancel(task)} disabled={Boolean(actionBusy)}>取消</button> : null}</td>
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

      <TicketCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(ticketId) => {
          setCreatedTicketId(ticketId);
          void load();
        }}
      />
      <TicketEditDialog ticket={editTarget} onClose={() => setEditTarget(null)} onSaved={saveEditedTicket} />

      {selected ? <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="task-detail-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
        <header><div><p className="eyebrow">任务详情</p><h2>{safeTaskText(selected.title, "未命名任务")}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header>
        <dl className="task-detail-meta"><div><dt>状态</dt><dd>{statusOf(selected)}</dd></div><div><dt>任务 ID</dt><dd>{selected.id}</dd></div><div><dt>创建时间</dt><dd>{formatTime(selected.created_at)}</dd></div><div><dt>说明</dt><dd>{taskSummary(selected)}</dd></div></dl>
        <p className="muted">已尝试 {selected.runs?.length || 0} 次{selected.runs?.length ? `；最近一次：${String(selected.runs[selected.runs.length - 1]?.status || "未知")}` : ""}</p>
        {Array.isArray(selected.assignments) && selected.assignments.length ? <section className="task-detail-facts"><h3>责任与关注</h3><dl><div><dt>当前主受理人</dt><dd>{String(selected.assignments.find((item) => item.status === "active" && item.role === "primary")?.assignee_person_ref || "—")}</dd></div><div><dt>关注人</dt><dd>{Array.isArray(selected.watchers) && selected.watchers.length ? selected.watchers.filter((item) => item.status === "active").map((item) => String(item.watcher_person_ref || item.watcher_user_id || "")).filter(Boolean).join("、") || "—" : "—"}</dd></div></dl></section> : null}
        {Array.isArray(selected.basis_refs) && selected.basis_refs.length ? <section className="task-detail-facts"><h3>来源依据</h3><ul>{selected.basis_refs.map((item, index) => <li key={`${String(item.source_type || "basis")}-${String(item.source_id || index)}`}>{String(item.source_type || "来源")} · {String(item.source_id || "—")}{item.occurred_at ? ` · ${formatTime(String(item.occurred_at))}` : ""}</li>)}</ul></section> : null}
        {selected.acceptance ? <section className="task-detail-facts"><h3>验收事实</h3><p>验收人：{String(selected.acceptance.accepted_by_user_id || "—")} · {formatTime(String(selected.acceptance.accepted_at || ""))}</p></section> : null}
        {Array.isArray(selected.acceptance_history) && selected.acceptance_history.length ? <section className="task-detail-facts"><h3>验收历史</h3><ul>{selected.acceptance_history.map((item, index) => <li key={`${String(item.acceptance_version || index)}-${String(item.accepted_at || "")}`}>第 {String(item.acceptance_version || index + 1)} 次 · {String(item.accepted_by_user_id || "—")} · {formatTime(String(item.accepted_at || ""))}</li>)}</ul></section> : null}
        <section><h3>执行事件 {liveRunEvents.connected ? <small className="muted">实时更新中</small> : liveRunEvents.fallback ? <small className="muted">正在以安全补读更新</small> : null}</h3>{(liveRunEvents.events.length ? liveRunEvents.events : events).length ? <ol className="task-detail-events">{(liveRunEvents.events.length ? liveRunEvents.events : events).map((event, index) => <li key={event.id || `${event.created_at}-${index}`}><strong>{safeTaskText(event.title || event.type, "任务事件")}</strong><small>{formatTime(event.created_at)}</small><p>{safeTaskText(event.summary || event.message)}</p></li>)}</ol> : <p className="muted">暂无执行事件。</p>}</section>
        <div className="task-detail-actions">{Array.isArray(selected.allowed_actions) && selected.allowed_actions.includes("accept") ? <button type="button" className="button" onClick={() => void submitTicketCommand(selected, "accept")} disabled={Boolean(actionBusy)}>受理工单</button> : null}{Array.isArray(selected.allowed_actions) && selected.allowed_actions.includes("complete") ? <button type="button" className="button" onClick={() => void submitTicketCommand(selected, "complete")} disabled={Boolean(actionBusy)}>提交验收完成</button> : null}{Array.isArray(selected.allowed_actions) && selected.allowed_actions.includes("reopen") ? <button type="button" className="button" onClick={() => void submitTicketCommand(selected, "reopen")} disabled={Boolean(actionBusy)}>重开工单</button> : null}{Array.isArray(selected.allowed_actions) && selected.allowed_actions.includes("edit") ? <button type="button" className="button" onClick={() => setEditTarget(selected)}>编辑业务字段</button> : null}{selected.session_id ? <Link className="button" to={`/s/${selected.session_id}`}>{selected.status === "waiting" || selected.status === "waiting_approval" ? "继续处理" : "查看任务"}</Link> : null}</div>
      </aside></div> : null}
    </main>
  );
}
