export type TaskSource = "all" | "agent" | "business";
export type TaskLifecycle = "all" | "queued" | "running" | "waiting" | "failed" | "completed" | "cancelled";
export const TASK_LIFECYCLES: Array<{ value: TaskLifecycle; label: string }> = [
  { value: "all", label: "全部" }, { value: "queued", label: "待启动" },
  { value: "running", label: "执行中" }, { value: "waiting", label: "等待处理" },
  { value: "failed", label: "失败" }, { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

// Display/query grouping mirrors the operations contract. No permissions or actions are inferred here.
export function agentLifecycle(status: string | null | undefined): Exclude<TaskLifecycle, "all"> {
  const value = String(status || "pending").toLowerCase();
  if (["completed", "done", "success", "succeeded"].includes(value)) return "completed";
  if (value === "failed") return "failed";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (["running", "starting", "in_progress"].includes(value)) return "running";
  if (["waiting", "waiting_approval", "needs_clarification", "waiting_external", "needs_review"].includes(value)) return "waiting";
  return "queued";
}

export function readTaskQuery(params: URLSearchParams) {
  const rawStatus = params.get("status");
  const legacyFilter = params.get("filter");
  const status: TaskLifecycle = rawStatus === "waiting_approval" ? "waiting"
    : TASK_LIFECYCLES.some(item => item.value === rawStatus) ? rawStatus as TaskLifecycle
    : legacyFilter === "in_progress" ? "running" : "all";
  const rawSource = params.get("source");
  const source: TaskSource = rawSource === "agent" || rawSource === "business" ? rawSource : "all";
  return { status, source, overdue: params.get("attention") === "overdue", taskType: params.get("task_type") || "",
    q: params.get("q") || "", from: params.get("from") || "", to: params.get("to") || "" };
}

export function patchTaskQuery(current: URLSearchParams, values: Record<string, string | null>): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "" || (key === "status" && value === "all") || (key === "source" && value === "all")) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function formatTaskTime(value: string | null | undefined, timeZone = "Asia/Shanghai") {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  try { return date.toLocaleString("zh-CN", { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); }
  catch { return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); }
}
