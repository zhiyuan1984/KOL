export const TASK_SEARCH_DEBOUNCE_MS = 300;

const TERMINAL_TASK_STATUSES = new Set(["completed", "done", "success", "succeeded", "failed", "cancelled", "canceled"]);
const NOT_STARTED_TASK_STATUSES = new Set(["open", "queued", "pending"]);

type BusinessTaskStatusInput = {
  status?: string | null;
  counts: { waiting_review: number };
};

export function isAgentTaskInProgress(status: string | null | undefined): boolean {
  const normalized = String(status || "pending").toLowerCase();
  return !TERMINAL_TASK_STATUSES.has(normalized) && !NOT_STARTED_TASK_STATUSES.has(normalized);
}

export function businessTaskStatus(task: BusinessTaskStatusInput): "queued" | "running" | "waiting_approval" | "completed" | "cancelled" {
  const normalized = String(task.status || "open").toLowerCase();
  if (["completed", "done", "success", "succeeded"].includes(normalized)) return "completed";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (task.counts.waiting_review > 0 || ["waiting", "waiting_approval", "blocked", "ready_for_review"].includes(normalized)) return "waiting_approval";
  if (NOT_STARTED_TASK_STATUSES.has(normalized)) return "queued";
  return "running";
}

export function sortTaskRowsByUpdatedAt<T extends { key: string; updatedAt?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || "") || 0;
    const rightTime = Date.parse(right.updatedAt || "") || 0;
    return rightTime - leftTime || left.key.localeCompare(right.key);
  });
}

export function createTaskSearchDebouncer<T>(callback: (value: T) => void, delay = TASK_SEARCH_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(value: T) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        callback(value);
      }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
