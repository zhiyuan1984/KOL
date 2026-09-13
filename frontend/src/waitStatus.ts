import type { Task, TaskEvent } from "./api";

/** Employee-facing work-item wait copy. `waiting` is result-awaiting-confirm, not still running. */
export type WaitDisplay =
  | "recognizing"
  | "queued"
  | "running"
  | "awaiting_review"
  | "awaiting_approval"
  | "failed"
  | "completed"
  | "open";

export const WAIT_DISPLAY_LABEL: Record<WaitDisplay, string> = {
  recognizing: "识别中",
  queued: "已入队",
  running: "执行中",
  awaiting_review: "结果待确认",
  awaiting_approval: "等审批",
  failed: "失败",
  completed: "已完成",
  open: "待处理",
};

export const HOME_TASK_POLL_MS = 4_000;

const RECOGNIZE_TIMEOUT_MS = 12_000;

export function recognizeTimeoutMs(): number {
  return RECOGNIZE_TIMEOUT_MS;
}

export function waitDisplayOf(status?: string): WaitDisplay {
  const value = String(status || "").toLowerCase();
  if (value === "completed" || value === "done" || value === "success") return "completed";
  if (value === "failed" || value === "error") return "failed";
  if (value === "waiting_approval") return "awaiting_approval";
  if (value === "waiting" || value === "pending_approve") return "awaiting_review";
  if (value === "running" || value === "in_progress" || value === "starting") return "running";
  if (value === "pending" || value === "queued") return "queued";
  return "open";
}

export function waitStatusLabel(status?: string): string {
  return WAIT_DISPLAY_LABEL[waitDisplayOf(status)];
}

export function isAwaitingReview(task: { status?: string }): boolean {
  return waitDisplayOf(task.status) === "awaiting_review";
}

export function isAwaitingApproval(task: { status?: string }): boolean {
  return waitDisplayOf(task.status) === "awaiting_approval";
}

export function isActiveRun(task: { status?: string }): boolean {
  const display = waitDisplayOf(task.status);
  return display === "running" || display === "queued";
}

export function lastSafeSummary(task: Task): string {
  const history = Array.isArray(task.history) ? task.history : [];
  const last = history[history.length - 1];
  return String(
    last?.safe_summary || last?.summary || task.next_action || task.history_summary || "",
  ).trim();
}

export function failureHint(task: Task): string {
  if (waitDisplayOf(task.status) !== "failed") return "";
  return lastSafeSummary(task) || "执行失败";
}

export function unwrapTaskList(value: Task[] | { tasks?: Task[] } | null | undefined): Task[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Array.isArray(value.tasks) ? value.tasks : [];
}

export function enrichTask(board: Task, detail?: Task): Task {
  if (!detail) return board;
  return {
    ...board,
    ...detail,
    kol_name: board.kol_name || detail.kol_name,
    collab_summary: board.collab_summary || detail.collab_summary,
    recent_followup: board.recent_followup || detail.recent_followup,
    current_stage: board.current_stage || detail.current_stage,
    suggested_stage: board.suggested_stage || detail.suggested_stage,
    suggested_stage_code: board.suggested_stage_code || detail.suggested_stage_code,
    history: detail.history?.length ? detail.history : board.history,
    history_summary: detail.history_summary || board.history_summary,
    session_id: detail.session_id || board.session_id,
    collaboration_id: detail.collaboration_id || board.collaboration_id,
  };
}

export function mergeTaskDetails(boardTasks: Task[], catalog: Task[]): Task[] {
  const extra = new Map(catalog.map((row) => [row.id, row]));
  return boardTasks.map((board) => enrichTask(board, extra.get(board.id)));
}

function eventTime(event?: TaskEvent): string {
  if (!event) return "";
  return String(event.created_at || event.time || event.updated_at || "");
}

export function lastEventAt(task: Task): string {
  const history = Array.isArray(task.history) ? task.history : [];
  const last = history[history.length - 1];
  return eventTime(last) || String(task.updated_at || task.started_at || "");
}

export function formatElapsed(from?: string, now = Date.now()): string {
  if (!from) return "";
  const start = Date.parse(String(from));
  if (!Number.isFinite(start)) return "";
  const ms = now - start;
  if (ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `已进行 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `已进行 ${hours} 小时` : `已进行 ${Math.floor(hours / 24)} 天`;
}

export function waitProgressHint(task: Task, now = Date.now()): string {
  const display = waitDisplayOf(task.status);
  if (display === "failed") return failureHint(task);
  if (display === "running") {
    const elapsed = formatElapsed(String(task.started_at || lastEventAt(task) || ""), now);
    const summary = String(task.history_summary || lastSafeSummary(task) || "").trim();
    return [summary, elapsed].filter(Boolean).join(" · ");
  }
  const summary = String(task.history_summary || lastSafeSummary(task) || "").trim();
  const at = lastEventAt(task);
  if (!at) return summary;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return summary;
  const stamp = when.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return summary ? `${summary} · ${stamp}` : stamp;
}

export function recognizeElapsedSeconds(startedAt: number | null, now = Date.now()): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function recognizeTimedOut(startedAt: number | null, now = Date.now()): boolean {
  return Boolean(startedAt && now - startedAt >= RECOGNIZE_TIMEOUT_MS);
}
