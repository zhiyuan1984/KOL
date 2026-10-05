import type { Task } from "./api";

/**
 * 「这一件任务现在到哪了」的统一状态：RunHud、任务徽章与右栏共用一个口径，
 * 不再让会话 agent_status、任务 status 与最后一条事件各说各话。
 */
export type TaskRunKey =
  | "idle"
  | "queued"
  | "running"
  | "awaiting_confirm"
  | "awaiting_acceptance"
  | "result_ready"
  | "stopped"
  | "cancelled"
  | "failed"
  | "completed";

export type TaskRunView = {
  key: TaskRunKey;
  label: string;
  /** 有排队/执行中的工作时为 true（决定「刷新页面不会取消后台执行」等提示）。 */
  live: boolean;
  /** 终态且可重新执行。 */
  canRerun: boolean;
};

export const TASK_RUN_LABEL: Record<TaskRunKey, string> = {
  idle: "待命",
  queued: "已排队",
  running: "执行中",
  awaiting_confirm: "待你确认",
  awaiting_acceptance: "结果待验收",
  result_ready: "结果已生成",
  stopped: "已停止",
  cancelled: "已取消",
  failed: "失败",
  completed: "已完成",
};

const TERMINAL_TASK_STATUSES = new Set(["completed", "success", "failed", "error", "stopped", "cancelled"]);

export function isTerminalTaskStatus(status?: string): boolean {
  return TERMINAL_TASK_STATUSES.has(String(status || "").toLowerCase());
}

export function taskRunView(task: Task | null | undefined, agentStatus?: string): TaskRunView {
  const status = String(task?.status || "").toLowerCase();
  if (status === "completed" || status === "success") return view("completed", false, false);
  if (status === "failed" || status === "error") return view("failed", false, true);
  if (status === "stopped") return view("stopped", false, true);
  if (status === "cancelled") return view("cancelled", false, false);
  if (status === "waiting_approval" || status === "pending_approve" || agentStatus === "waiting_approval") {
    return view("awaiting_confirm", false, false);
  }
  if (status === "waiting") {
    return task?.execution?.result_ready
      ? view("result_ready", false, false)
      : view("awaiting_acceptance", false, false);
  }
  if (status === "running" || status === "in_progress" || status === "starting") return view("running", true, false);
  if (status === "queued" || status === "pending") return view("queued", true, false);
  if (agentStatus === "running") return view("running", true, false);
  return view("idle", false, false);
}

function view(key: TaskRunKey, live: boolean, canRerun: boolean): TaskRunView {
  return { key, label: TASK_RUN_LABEL[key], live, canRerun };
}
