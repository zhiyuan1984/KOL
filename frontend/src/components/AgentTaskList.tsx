import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Task } from "../api";
import {
  AGENT_TASK_STATUSES,
  AGENT_TASK_STATUS_LABEL,
  agentTaskUxStatus,
  taskTriggerLabel,
  type AgentTaskUxStatus,
} from "../agentUx";

const WIDTH_KEY = "lingong.tasklistWidth";
const MIN_WIDTH = 168;
const MAX_WIDTH = 420;
export const DEFAULT_TASKLIST_WIDTH = 220;
const PULL_THRESHOLD = 48;

function unwrapTasks(value: Task[] | { tasks: Task[] }): Task[] {
  return Array.isArray(value) ? value : value.tasks || [];
}

function clampWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

export function readTaskListWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) ? clampWidth(raw) : DEFAULT_TASKLIST_WIDTH;
  } catch {
    return DEFAULT_TASKLIST_WIDTH;
  }
}

function persistWidth(value: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(value));
  } catch {
    /* ignore quota / private mode */
  }
}

function taskTime(task: Task): string {
  const raw = String(task.updated_at || task.created_at || task.due_at || "");
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function taskObject(task: Task): string {
  return String(task.kol_name || task.collab_summary || task.project || "").replace(/^@/, "");
}

export type SessionMailRow = {
  id?: string;
  conversation_id?: string;
  subject?: string;
  direction?: string;
  occurred_at?: string;
  unread?: boolean;
  snippet?: string;
  summary?: string;
  summary_source?: string;
  preview?: string;
  body?: string;
};

function mailTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AgentTaskList({
  sessionId,
  currentTask,
  running = false,
  width,
  onWidthChange,
  mails,
  selectedMailId,
  onSelectMail,
  onRefreshMails,
  mailSyncing = false,
  mailSyncFailed = false,
}: {
  sessionId?: string;
  currentTask?: Task | null;
  running?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  mails?: SessionMailRow[];
  selectedMailId?: string;
  onSelectMail?: (mail: SessionMailRow) => void;
  onRefreshMails?: () => void | Promise<void>;
  mailSyncing?: boolean;
  mailSyncFailed?: boolean;
}) {
  const nav = useNavigate();
  const widthRef = useRef(width);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const pullRef = useRef<{ startY: number } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AgentTaskUxStatus | "">("");
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);

  widthRef.current = width;

  const applyWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    onWidthChange(clamped);
  }, [onWidthChange]);

  const mailMode = Array.isArray(mails);
  const refreshMailsRef = useRef(onRefreshMails);
  refreshMailsRef.current = onRefreshMails;

  const load = useCallback(async () => {
    if (mailMode) {
      await refreshMailsRef.current?.();
      return;
    }
    try {
      const rows = await api.tasks();
      setTasks(unwrapTasks(rows));
    } catch {
      setTasks([]);
    }
  }, [mailMode]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, [load, refreshing]);

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      if (!dragRef.current) return;
      applyWidth(dragRef.current.startW + (event.clientX - dragRef.current.startX));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      persistWidth(widthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyWidth]);

  useEffect(() => {
    if (mailMode) return;
    let cancelled = false;
    load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [load, mailMode, sessionId, currentTask?.id, currentTask?.status]);

  const mailRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (mails || []).filter((mail) => {
      if (!needle) return true;
      const blob = `${mail.subject || ""} ${mail.direction || ""} ${mail.snippet || ""}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [mails, q]);

  const rows = useMemo(() => {
    const merged = currentTask && !tasks.some((item) => item.id === currentTask.id)
      ? [currentTask, ...tasks]
      : tasks;
    const needle = q.trim().toLowerCase();
    return merged.filter((task) => {
      const ux = agentTaskUxStatus(task, currentTask?.id === task.id && running);
      if (status && ux !== status) return false;
      if (!needle) return true;
      const blob = `${task.title || ""} ${taskObject(task)} ${task.skill_id || task.skill || ""}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [tasks, currentTask, q, status, running]);

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { startX: event.clientX, startW: widthRef.current };
    setDragging(true);
  };

  const onScrollWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (refreshing) return;
    if (event.currentTarget.scrollTop > 0) return;
    if (event.deltaY >= 0) return;
    event.preventDefault();
    void refresh();
  };

  const onScrollPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop > 0 || refreshing) return;
    pullRef.current = { startY: event.clientY };
  };

  const onScrollPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pullRef.current || refreshing) return;
    const dy = event.clientY - pullRef.current.startY;
    setPull(dy > 0 ? Math.min(80, dy) : 0);
  };

  const onScrollPointerUp = () => {
    if (!pullRef.current) return;
    const shouldRefresh = pull >= PULL_THRESHOLD && !refreshing;
    pullRef.current = null;
    if (shouldRefresh) void refresh();
    else setPull(0);
  };

  return (
    <aside
      className={"agent-task-list" + (dragging ? " is-resizing" : "")}
      data-agent-task-list
      data-tasklist-mode={mailMode ? "mail" : "tasks"}
      data-tasklist-width={width}
      data-refreshing={refreshing ? "true" : undefined}
      data-mail-syncing={mailMode && mailSyncing ? "true" : undefined}
      data-mail-sync-failed={mailMode && mailSyncFailed ? "true" : undefined}
    >
      <div
        className="tasklist-resizer"
        data-tasklist-resizer
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-label="拖动调整任务栏宽度"
        title="左右拖动调整任务栏宽度"
        onPointerDown={onResizePointerDown}
      />
      <header>
        <strong>{mailMode ? "往来邮件" : "任务列表"}</strong>
        {mailMode && mailSyncing ? <small data-mail-sync-status>正在同步往来</small> : null}
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={mailMode ? "搜索邮件" : "搜索任务"}
          aria-label={mailMode ? "搜索邮件" : "搜索任务"}
        />
      </header>
      {!mailMode ? (
      <div className="agent-task-filters" data-task-status-filters>
        <button type="button" className={!status ? "is-on" : ""} onClick={() => setStatus("")}>全部</button>
        {AGENT_TASK_STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            className={status === item ? "is-on" : ""}
            data-filter-status={item}
            onClick={() => setStatus(item)}
          >
            {AGENT_TASK_STATUS_LABEL[item]}
          </button>
        ))}
      </div>
      ) : null}
      <div
        className={"tasklist-refresh-hint" + (refreshing || pull > 8 ? " is-on" : "")}
        data-tasklist-refresh
        style={{ height: refreshing ? 28 : Math.max(0, pull * 0.4) }}
      >
        {refreshing ? "正在刷新…" : pull >= PULL_THRESHOLD ? "松开刷新" : "下拉刷新"}
      </div>
      <div
        className="agent-task-scroll"
        data-tasklist-scroll
        onWheel={onScrollWheel}
        onPointerDown={onScrollPointerDown}
        onPointerMove={onScrollPointerMove}
        onPointerUp={onScrollPointerUp}
        onPointerCancel={onScrollPointerUp}
      >
        {mailMode ? (
          <>
            {mailSyncing && !mailRows.length ? (
              <ol data-session-mail-list data-mail-skeleton>
                {[0, 1, 2, 3].map((index) => (
                  <li key={`skel-${index}`} className="mail-skeleton-row" data-mail-skeleton-row />
                ))}
              </ol>
            ) : (
              <ol data-session-mail-list>
                {mailRows.map((mail, index) => {
                  const inbound = String(mail.direction || "inbound") !== "outbound";
                  const selected = Boolean(selectedMailId && mail.id === selectedMailId);
                  return (
                    <li
                      key={mail.id || `${mail.conversation_id || "mail"}-${mail.occurred_at || index}`}
                      data-mail-row
                      data-mail-id={mail.id || ""}
                      data-mail-direction={inbound ? "inbound" : "outbound"}
                      data-mail-unread={mail.unread ? "true" : undefined}
                      data-mail-selected={selected ? "true" : undefined}
                      className={(mail.unread ? "is-unread" : "") + (selected ? " is-current" : "")}
                    >
                      <button type="button" onClick={() => onSelectMail?.(mail)}>
                        {mail.unread ? <span className="mail-unread-dot" data-mail-unread-dot aria-label="未读" /> : null}
                        <strong>{mail.subject || "无主题"}</strong>
                        <em>{inbound ? "来信" : "去信"}</em>
                        <small>{mailTime(mail.occurred_at) || "时间未同步"}</small>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {mailSyncing && mailRows.length ? (
              <p className="muted" data-mail-sync-hint>正在同步往来</p>
            ) : null}
            {mailSyncFailed && !mailSyncing ? (
              <p className="muted" data-mail-sync-failed>未能同步，下拉重试</p>
            ) : null}
            {!mailSyncing && !mailSyncFailed && !mailRows.length && <p className="muted">还没有往来邮件。</p>}
          </>
        ) : (
          <>
            <ol>
              {rows.map((task) => {
                const ux = agentTaskUxStatus(task, currentTask?.id === task.id && running);
                const href = task.session_id ? `/s/${task.session_id}` : "";
                const object = taskObject(task);
                return (
                  <li key={task.id} data-task-id={task.id} data-task-ux-status={ux} className={task.session_id === sessionId ? "is-current" : ""}>
                    {href ? (
                      <Link to={href}>
                        <span className={`task-ux-badge is-${ux.toLowerCase()}`}>{AGENT_TASK_STATUS_LABEL[ux]}</span>
                        <strong>{task.title || "未命名任务"}</strong>
                        {object ? <em>@{object}</em> : null}
                        <small>
                          {taskTriggerLabel(task)}
                          {taskTime(task) ? ` · ${taskTime(task)}` : ""}
                        </small>
                      </Link>
                    ) : (
                      <button type="button" onClick={() => nav("/")}>
                        <span className={`task-ux-badge is-${ux.toLowerCase()}`}>{AGENT_TASK_STATUS_LABEL[ux]}</span>
                        <strong>{task.title || "未命名任务"}</strong>
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {!rows.length && <p className="muted">还没有可展示的任务。</p>}
          </>
        )}
      </div>
    </aside>
  );
}
