import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Task, type TaskEvent, type Ticket } from "../api";
import TicketCreateDialog from "./TicketCreateDialog";
import TicketEditDialog from "./TicketEditDialog";
import "./task-detail-rail.css";

export type TaskDetailFocus = "history" | "tickets";

type TaskDetailRailProps = {
  task: Task;
  sessionId?: string;
  available: boolean;
  focus?: TaskDetailFocus;
  focusToken?: number;
  starting?: boolean;
  onClose: () => void;
  onStartExecution: (task: Task) => Promise<void> | void;
};

type DetailStatus = { label: "待处理" | "进行中" | "已完成"; tone: "pending" | "running" | "completed" };

export function taskDetailStatus(task: Task): DetailStatus {
  const status = String(task.status || "").trim().toLowerCase();
  if (["completed", "done"].includes(status)) return { label: "已完成", tone: "completed" };
  if (["running", "in_progress", "queued", "waiting", "waiting_approval"].includes(status)) return { label: "进行中", tone: "running" };
  return { label: "待处理", tone: "pending" };
}

function eventsOf(value: TaskEvent[] | { events?: TaskEvent[] }): TaskEvent[] {
  return Array.isArray(value) ? value : Array.isArray(value.events) ? value.events : [];
}

function eventTime(event: TaskEvent): string {
  const raw = String(event.created_at || event.time || event.updated_at || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" }).format(date);
}

function eventTitle(event: TaskEvent): string {
  return String(event.title || event.label || event.summary || event.message || "执行记录").trim() || "执行记录";
}

function ticketStatus(ticket: Ticket): string {
  const status = String(ticket.status || "").trim();
  const labels: Record<string, string> = {
    pending: "待受理",
    accepted: "已受理",
    in_progress: "进行中",
    waiting: "等待中",
    waiting_approval: "待审批",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
  };
  return labels[status] || status || "待处理";
}

/**
 * Shared right rail for the Today and Todo task projections. Reading task
 * history is intentionally side-effect free; an execution is started only by
 * the explicit empty-state action.
 */
export default function TaskDetailRail({
  task,
  sessionId,
  available,
  focus = "history",
  focusToken = 0,
  starting = false,
  onClose,
  onStartExecution,
}: TaskDetailRailProps) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState<Ticket | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const historyRef = useRef<HTMLElement | null>(null);
  const ticketsRef = useRef<HTMLElement | null>(null);
  const [ticketsHighlighted, setTicketsHighlighted] = useState(false);
  const status = taskDetailStatus(task);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError("");
    try {
      const next = await api.taskEvents(task.id);
      setEvents(eventsOf(next));
    } catch (cause) {
      setEventsError(cause instanceof Error ? cause.message : "执行历史读取失败");
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [task.id]);

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    setTicketsError("");
    try {
      const next = await api.tickets({ task_id: task.id, limit: 100 });
      setTickets(next.items || []);
    } catch (cause) {
      setTicketsError(cause instanceof Error ? cause.message : "工单读取失败");
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    void loadEvents();
    void loadTickets();
    setCreateOpen(false);
    setEditing(null);
    setDeleting(null);
    setDeleteError("");
  }, [loadEvents, loadTickets]);

  useEffect(() => {
    const target = focus === "tickets" ? ticketsRef.current : historyRef.current;
    target?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (focus !== "tickets") return;
    setTicketsHighlighted(true);
    const timer = window.setTimeout(() => setTicketsHighlighted(false), 600);
    return () => window.clearTimeout(timer);
  }, [focus, focusToken]);

  const orderedEvents = useMemo(
    () => [...events].sort((a, b) => String(b.created_at || b.time || "").localeCompare(String(a.created_at || a.time || ""))),
    [events],
  );

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api.deleteFormalTicket(deleting.id, { expected_version: Math.max(1, Number(deleting.data_version || 1)) });
      setTickets((current) => current.filter((ticket) => ticket.id !== deleting.id));
      setDeleting(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "工单删除失败");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <section className="task-detail-rail" data-task-detail-rail={task.id} aria-label={`${task.title}任务明细`}>
      <header className="task-detail-head">
        <div className="task-detail-heading" title={task.title}>
          <span className={`task-status-dot is-${status.tone}`} aria-hidden />
          <strong>{task.title}</strong>
        </div>
        <button type="button" className="task-detail-close" aria-label="关闭任务明细" onClick={onClose}>×</button>
      </header>

      {!available ? (
        <div className="task-detail-filtered" data-task-detail-filtered>
          <p>该任务不在当前筛选结果中。</p>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      ) : null}

      <section className="task-detail-section" ref={historyRef} data-task-detail-history>
        <div className="task-detail-section-head">
          <h2>历史</h2>
          <span className={`task-detail-status is-${status.tone}`}><i aria-hidden />{status.label}</span>
        </div>
        {eventsLoading ? <p className="task-detail-muted">正在读取执行历史…</p> : null}
        {eventsError ? <p className="task-detail-error" role="alert">{eventsError} <button type="button" onClick={() => void loadEvents()}>重试</button></p> : null}
        {!eventsLoading && !eventsError && orderedEvents.length ? (
          <ol className="task-detail-timeline">
            {orderedEvents.map((event, index) => (
              <li key={String(event.id || event.item_key || `${eventTitle(event)}-${index}`)}>
                <i aria-hidden />
                <div><strong title={eventTitle(event)}>{eventTitle(event)}</strong>{eventTime(event) ? <time>{eventTime(event)}</time> : null}</div>
              </li>
            ))}
          </ol>
        ) : null}
        {!eventsLoading && !eventsError && !orderedEvents.length ? (
          <div className="task-detail-empty" data-task-detail-empty>
            <span className="task-detail-empty-icon" aria-hidden>○</span>
            <strong>尚无执行记录</strong>
            <p>查看任务不会触发执行；需要时可手动开始。</p>
            <button type="button" className="task-detail-start" disabled={starting} onClick={() => void onStartExecution(task)}>
              {starting ? "正在开始…" : "开始执行"}
            </button>
          </div>
        ) : null}
        {sessionId ? <Link className="task-detail-session-link" to={`/s/${encodeURIComponent(sessionId)}`}>进入完整会话 →</Link> : null}
      </section>

      <section
        className={`task-detail-section task-detail-tickets${ticketsHighlighted ? " is-highlighted" : ""}`}
        ref={ticketsRef}
        data-task-detail-tickets
      >
        <div className="task-detail-section-head"><h2>工单（{tickets.length}）</h2></div>
        {ticketsLoading ? <p className="task-detail-muted">正在读取工单…</p> : null}
        {ticketsError ? <p className="task-detail-error" role="alert">{ticketsError} <button type="button" onClick={() => void loadTickets()}>重试</button></p> : null}
        {!ticketsLoading && !ticketsError && tickets.length ? (
          <ul className="task-detail-ticket-list">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <div className="task-detail-ticket-copy"><strong title={ticket.title}>{ticket.title}</strong><span>{ticketStatus(ticket)}</span></div>
                {deleting?.id === ticket.id ? (
                  <div className="task-detail-delete-confirm" data-ticket-delete-confirm>
                    <span>确认删除该工单？</span>
                    <button type="button" className="is-danger" disabled={deleteBusy} onClick={() => void confirmDelete()}>{deleteBusy ? "删除中…" : "删除"}</button>
                    <button type="button" disabled={deleteBusy} onClick={() => { setDeleting(null); setDeleteError(""); }}>取消</button>
                  </div>
                ) : (
                  <div className="task-detail-ticket-actions">
                    <button type="button" disabled={!ticket.allowed_actions?.includes("edit")} onClick={() => setEditing(ticket)}>编辑</button>
                    <button type="button" className="is-danger" disabled={!ticket.allowed_actions?.includes("edit")} onClick={() => { setDeleting(ticket); setDeleteError(""); }}>删除</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {deleteError ? <p className="task-detail-error" role="alert">{deleteError}</p> : null}
        <button type="button" className="task-detail-new-ticket" onClick={() => setCreateOpen(true)}>+ 新建工单</button>
      </section>

      <TicketCreateDialog open={createOpen} taskId={task.id} onClose={() => setCreateOpen(false)} onCreated={() => void loadTickets()} />
      <TicketEditDialog ticket={editing} onClose={() => setEditing(null)} onSaved={(ticket) => setTickets((current) => current.map((row) => row.id === ticket.id ? ticket : row))} />
    </section>
  );
}
