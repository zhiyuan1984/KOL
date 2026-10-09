const TASK_LIST_SNAPSHOT_KEY = "kol:task-list-return:v1";
const TASK_LIST_PATH = "/tasks";
const MAX_ID_COUNT = 500;
const TASK_LIST_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1_000;

/**
 * The task list only needs a small amount of UI state when a detail page is
 * opened. Task rows, descriptions, events, and any other task body are
 * intentionally not part of this shape.
 */
export type TaskListSnapshot<TFilter = string> = {
  originalUrl: string;
  query: string;
  from: string;
  to: string;
  operationsFilter: TFilter | null;
  expandedSystemTasks: string[];
  selectedIds: string[];
  loadedAgentPages: number;
  loadedBusinessPages: number;
  scrollPosition: number;
};

export type TaskListSnapshotInput<TFilter = string> = Partial<Omit<TaskListSnapshot<TFilter>, "originalUrl" | "expandedSystemTasks" | "selectedIds">> & {
  /** Canonical list URL at the point the detail page was opened. */
  originalUrl?: string;
  /** Alias for callers that already call this value `url`. */
  url?: string;
  expandedSystemTasks?: Iterable<string> | null;
  selectedIds?: Iterable<string> | null;
  /** Alias for `scrollPosition` when sourced from `window.scrollY`. */
  scrollY?: number;
};

/** State deliberately passed by the task list when opening a detail route. */
export type TaskDetailNavigationState = {
  taskListPath?: string;
};

type StoredTaskListSnapshot = {
  version: 1;
  capturedAt: number;
  snapshot: TaskListSnapshot<unknown>;
};

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Accept only the canonical task-list route. This prevents a detail deep link
 * from becoming an open redirect and removes the business-task drawer query
 * parameter, which is itself a detail state rather than list state.
 */
function safeTaskListUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(TASK_LIST_PATH) || value.length > 2_048) return null;
  try {
    const base = "https://task-list.local";
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname !== TASK_LIST_PATH) return null;
    url.searchParams.delete("businessTask");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function currentTaskListUrl(): string | null {
  if (typeof window === "undefined") return null;
  return safeTaskListUrl(`${window.location.pathname}${window.location.search}`);
}

function text(value: unknown, maxLength = 2_048): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function ids(value: unknown): string[] {
  if (!value || typeof value === "string" || typeof (value as Iterable<unknown>)[Symbol.iterator] !== "function") return [];
  const next: string[] = [];
  for (const item of value as Iterable<unknown>) {
    if (typeof item !== "string" || !item || next.length >= MAX_ID_COUNT) continue;
    next.push(item);
  }
  return [...new Set(next)];
}

function snapshotFrom<TFilter>(value: unknown, useCurrentLocation = false): TaskListSnapshot<TFilter> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as TaskListSnapshotInput<TFilter>;
  const originalUrl = safeTaskListUrl(input.originalUrl ?? input.url) ?? (useCurrentLocation ? currentTaskListUrl() : null);
  if (!originalUrl) return null;

  return {
    originalUrl,
    query: text(input.query, 500),
    from: text(input.from, 32),
    to: text(input.to, 32),
    operationsFilter: (input.operationsFilter ?? null) as TFilter | null,
    expandedSystemTasks: ids(input.expandedSystemTasks),
    selectedIds: ids(input.selectedIds),
    loadedAgentPages: nonNegativeInteger(input.loadedAgentPages),
    loadedBusinessPages: nonNegativeInteger(input.loadedBusinessPages),
    scrollPosition: nonNegativeInteger(input.scrollPosition ?? input.scrollY),
  };
}

/**
 * Save only allowlisted task-list UI state in browser-session storage. The
 * browser's sessionStorage boundary keeps it out of other tabs and future
 * browser sessions; callers should also clear it on an explicit account
 * logout via `clearTaskListSnapshot`.
 */
export function captureTaskListSnapshot<TFilter = string>(input: TaskListSnapshotInput<TFilter>): TaskListSnapshot<TFilter> | null {
  const snapshot = snapshotFrom<TFilter>(input, true);
  const storage = sessionStore();
  if (!snapshot || !storage) return snapshot;
  try {
    const stored: StoredTaskListSnapshot = { version: 1, capturedAt: Date.now(), snapshot };
    storage.setItem(TASK_LIST_SNAPSHOT_KEY, JSON.stringify(stored));
  } catch {
    // Storage is an optional progressive enhancement; list navigation remains usable.
  }
  return snapshot;
}

/** Read a validated snapshot; malformed or out-of-scope values are discarded. */
export function readTaskListSnapshot<TFilter = string>(): TaskListSnapshot<TFilter> | null {
  const storage = sessionStore();
  if (!storage) return null;
  try {
    const raw = storage.getItem(TASK_LIST_SNAPSHOT_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredTaskListSnapshot;
    if (stored.version !== 1) throw new Error("Unsupported task-list snapshot");
    if (!Number.isFinite(stored.capturedAt) || stored.capturedAt < 0 || Date.now() - stored.capturedAt > TASK_LIST_SNAPSHOT_MAX_AGE_MS) {
      throw new Error("Expired task-list snapshot");
    }
    const snapshot = snapshotFrom<TFilter>(stored.snapshot);
    if (!snapshot) throw new Error("Invalid task-list snapshot");
    return snapshot;
  } catch {
    clearTaskListSnapshot();
    return null;
  }
}

/** Remove the session-local restore state after it has been consumed or on logout. */
export function clearTaskListSnapshot() {
  try {
    sessionStore()?.removeItem(TASK_LIST_SNAPSHOT_KEY);
  } catch {
    // Storage cleanup must not block navigation.
  }
}

function explicitTaskListPath(from: unknown): unknown {
  if (typeof from === "string") return from;
  if (!from || typeof from !== "object") return undefined;
  return (from as TaskDetailNavigationState).taskListPath;
}

/**
 * Resolve a safe task-list destination. A deliberate state path takes
 * precedence; deep links and invalid state always fall back to the latest
 * validated session snapshot, then to the canonical task list.
 */
export function taskListReturnUrl(from?: unknown): string {
  return safeTaskListUrl(explicitTaskListPath(from))
    ?? safeTaskListUrl(readTaskListSnapshot()?.originalUrl)
    ?? TASK_LIST_PATH;
}
