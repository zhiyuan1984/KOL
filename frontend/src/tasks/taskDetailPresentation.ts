const DEFAULT_BUSINESS_TIMEZONE = "Asia/Shanghai";

/**
 * Root business-task labels. Work-order statuses intentionally use their own
 * vocabulary because they describe a different object in the execution chain.
 */
const BUSINESS_TASK_STATUS_LABELS: Record<string, string> = {
  open: "待启动",
  queued: "待启动",
  pending: "待启动",
  running: "进行中",
  starting: "进行中",
  in_progress: "进行中",
  waiting: "等待处理",
  waiting_external: "等待外部",
  needs_clarification: "待补充",
  waiting_approval: "待确认",
  blocked: "已阻塞",
  ready_for_review: "待复核",
  needs_review: "待复核",
  completed: "已完成",
  done: "已完成",
  success: "已完成",
  succeeded: "已完成",
  failed: "失败",
  error: "失败",
  cancelled: "已取消",
  canceled: "已取消",
};

export function businessTaskStatusLabel(status: string): string {
  const raw = String(status || "").trim();
  return BUSINESS_TASK_STATUS_LABELS[raw.toLowerCase()] || raw || "—";
}

function businessTimezone(timezone?: string | null): string {
  const candidate = String(timezone || "").trim();
  if (!candidate) return DEFAULT_BUSINESS_TIMEZONE;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_BUSINESS_TIMEZONE;
  }
}

/**
 * Formats valid timestamps in the server-selected business timezone. Invalid
 * source values remain visible verbatim for traceability rather than becoming
 * an empty placeholder.
 */
export function formatDetailTime(value?: string | null, timezone?: string | null): string {
  if (!value) return "—";
  const raw = String(value);
  if (!Number.isFinite(new Date(raw).getTime())) return raw;
  return new Date(raw).toLocaleString("zh-CN", {
    timeZone: businessTimezone(timezone), month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
