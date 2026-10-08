import type { CrawlJob, Message, RuntimeActionView, Task } from "./api";

/**
 * 「这一件任务现在到哪了」的统一状态：会话右栏是它唯一的表达处（DESIGN §8.6），
 * 不再让会话 agent_status、任务 status 与最后一条事件各说各话。
 */
export type TaskRunKey =
  | "uncertain"
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
  uncertain: "结果待核实",
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

/** 语气 → DESIGN §3.1 的四职责色：中性 `--ds-text-dim`、执行中 `--accent`、待确认 `--warning`、完成 `--success`、失败 `--danger`。 */
export type TaskStatusTone = "neutral" | "live" | "confirm" | "done" | "failed";
/** 形状：颜色之外的第二条表达通道（DESIGN §1 不变量 4）。 */
export type TaskStatusShape = "dot" | "pulse" | "alert" | "hollow" | "check" | "cross" | "square";

export type TaskStatusView = TaskRunView & {
  /** 员工面完整状态文案：脱离颜色也能读懂，并说清下一步等谁。 */
  copy: string;
  tone: TaskStatusTone;
  shape: TaskStatusShape;
  /** 需要人做高风险确认（R3）才为 true；「结果已出、等你标记完成」不算待确认。 */
  needsConfirm: boolean;
};

/**
 * 状态文案对照表。`awaiting_acceptance` / `result_ready` 是「等你标记完成」，
 * 与需要人确认后才执行的高风险 `awaiting_confirm`（待确认）分开表述，
 * 不把「待确认」挪用成「等你标记完成」；结果未出时也不谎称已有结果。
 */
const TASK_STATUS_PRESENTATION: Record<TaskRunKey, { copy: string; tone: TaskStatusTone; shape: TaskStatusShape }> = {
  uncertain: { copy: "结果待核实", tone: "confirm", shape: "alert" },
  idle: { copy: "待命", tone: "neutral", shape: "dot" },
  queued: { copy: "已排队 · 等待开始", tone: "neutral", shape: "dot" },
  running: { copy: "执行中", tone: "live", shape: "pulse" },
  awaiting_confirm: { copy: "待确认 · 需要你确认后才会执行", tone: "confirm", shape: "alert" },
  awaiting_acceptance: { copy: "执行已结束 · 待你核对结果", tone: "neutral", shape: "hollow" },
  result_ready: { copy: "结果已生成 · 待你标记完成", tone: "done", shape: "check" },
  stopped: { copy: "已停止", tone: "neutral", shape: "square" },
  cancelled: { copy: "已取消", tone: "neutral", shape: "cross" },
  failed: { copy: "失败", tone: "failed", shape: "cross" },
  completed: { copy: "已完成", tone: "done", shape: "check" },
};

/** 会话右栏唯一的任务状态：与运行投影共用同一个 taskRunView 口径，不另算一套。 */
export function taskStatusView(task: Task | null | undefined, agentStatus?: string): TaskStatusView {
  const view = taskRunView(task, agentStatus);
  return {
    ...view,
    ...TASK_STATUS_PRESENTATION[view.key],
    needsConfirm: view.key === "awaiting_confirm",
  };
}

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

/** One projection for conversation and result status. Result readiness remains
 * distinct from formal work order acceptance. */
export function sessionRunView(task: Task | null, agentStatus: string, messages: Message[], actions: RuntimeActionView[], crawl?: CrawlJob | null): TaskRunView {
  if (actions.some(action => action.state === "pending" && !action.execution)) return view("awaiting_confirm", false, false);
  const active = actions.some(action => ["dispatching", "running", "starting", "stopping", "queued"]
    .includes(String(action.crawl?.state || action.execution?.status || action.state)));
  if (active || agentStatus === "running") return view("running", true, false);
  const action = actions.at(-1);
  const state = action?.crawl?.state || action?.execution?.status || action?.state;
  if (state === "uncertain") return view("uncertain", false, false);
  if (state === "failed") return view("failed", false, true);
  if (state === "cancelled" || state === "rejected") return view("stopped", false, true);
  if (crawl && ["running", "uploading", "starting", "pending"].includes(crawl.status)) return view("running", true, false);
  if (crawl?.status === "failed") return view("failed", false, true);
  const taskView = taskRunView(task, agentStatus);
  if (taskView.key !== "idle") return taskView;
  if (agentStatus === "stopped") return view("stopped", false, true);
  if (agentStatus === "failed" || messages.at(-1)?.kind === "error_card") return view("failed", false, true);
  if (state === "succeeded" || messages.some(message => ["task_result_card", "email_card"].includes(message.kind))) return view("result_ready", false, false);
  return taskView;
}
