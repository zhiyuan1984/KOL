const TASK_LIST_SNAPSHOT_KEY = "kol:task-list-return:v1";
const TASK_LIST_PATH = "/tasks";
export const TASK_LIST_ANCHOR = "task-details";
const MAX_ID_COUNT = 500;
const MAX_RESTORE_PAGES = 50;
const TASK_LIST_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1_000;

/** UI context only: never persist task rows, facts, events, or response bodies. */
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
  outerScrollPosition?: number;
  shellScrollPosition?: number;
  openedTaskId?: string;
  scopeKey?: string;
};

export type TaskListSnapshotInput<TFilter = string> = Partial<Omit<TaskListSnapshot<TFilter>, "originalUrl" | "expandedSystemTasks" | "selectedIds">> & {
  originalUrl?: string;
  url?: string;
  expandedSystemTasks?: Iterable<string> | null;
  selectedIds?: Iterable<string> | null;
  scrollY?: number;
};

export type TaskDetailNavigationState = {
  taskListPath?: string;
  taskListTaskId?: string;
  taskListScopeKey?: string;
  restoreTaskList?: boolean;
};

type StoredTaskListSnapshot = {
  version: 1;
  capturedAt: number;
  snapshot: TaskListSnapshot<unknown>;
};

function sessionStore(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; }
  catch { return null; }
}

/** Only /tasks is a destination; a drawer parameter is never restored. */
function safeTaskListUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(TASK_LIST_PATH) || value.length > 2_048) return null;
  try {
    const base = "https://task-list.local";
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname !== TASK_LIST_PATH) return null;
    url.searchParams.delete("businessTask");
    return `${url.pathname}${url.search}`;
  } catch { return null; }
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
    if (next.length >= MAX_ID_COUNT) break;
    if (typeof item === "string" && item) next.push(item.slice(0, 256));
  }
  return [...new Set(next)];
}

/** Identity/authority version markers, not an authorization implementation. */
export function taskListScopeKey(account: unknown): string {
  if (!account || typeof account !== "object") return "";
  const value = account as Record<string, unknown>;
  if (typeof value.id !== "string" && typeof value.id !== "number") return "";
  const markers = ["id", "role", "company_id", "org_unit_id", "workspace_key", "organization_version", "scope_version", "data_scope_version", "brand_id"];
  return JSON.stringify(markers.map(key => {
    const item = value[key];
    return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? item : null;
  }));
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
    loadedAgentPages: Math.min(MAX_RESTORE_PAGES, nonNegativeInteger(input.loadedAgentPages)),
    loadedBusinessPages: Math.min(MAX_RESTORE_PAGES, nonNegativeInteger(input.loadedBusinessPages)),
    scrollPosition: nonNegativeInteger(input.scrollPosition ?? input.scrollY),
    ...(input.outerScrollPosition !== undefined ? { outerScrollPosition: nonNegativeInteger(input.outerScrollPosition) } : {}),
    ...(input.shellScrollPosition !== undefined ? { shellScrollPosition: nonNegativeInteger(input.shellScrollPosition) } : {}),
    ...(input.openedTaskId ? { openedTaskId: text(input.openedTaskId, 256) } : {}),
    ...(input.scopeKey ? { scopeKey: text(input.scopeKey) } : {}),
  };
}

export function captureTaskListSnapshot<TFilter = string>(input: TaskListSnapshotInput<TFilter>): TaskListSnapshot<TFilter> | null {
  const snapshot = snapshotFrom<TFilter>(input, true);
  const storage = sessionStore();
  if (!snapshot || !storage) return snapshot;
  try {
    const stored: StoredTaskListSnapshot = { version: 1, capturedAt: Date.now(), snapshot };
    storage.setItem(TASK_LIST_SNAPSHOT_KEY, JSON.stringify(stored));
  } catch { /* Optional enhancement; explicit list navigation still works. */ }
  return snapshot;
}

export function readTaskListSnapshot<TFilter = string>(match?: { taskId?: string; scopeKey?: string }): TaskListSnapshot<TFilter> | null {
  const storage = sessionStore();
  if (!storage) return null;
  try {
    const raw = storage.getItem(TASK_LIST_SNAPSHOT_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredTaskListSnapshot;
    if (stored.version !== 1 || !Number.isFinite(stored.capturedAt) || stored.capturedAt < 0 || stored.capturedAt > Date.now() + 1_000 || Date.now() - stored.capturedAt > TASK_LIST_SNAPSHOT_MAX_AGE_MS) throw new Error("Invalid snapshot age");
    const snapshot = snapshotFrom<TFilter>(stored.snapshot);
    if (!snapshot) throw new Error("Invalid task-list snapshot");
    if (match && (!match.taskId || snapshot.openedTaskId !== match.taskId || !match.scopeKey || snapshot.scopeKey !== match.scopeKey)) return null;
    return snapshot;
  } catch {
    clearTaskListSnapshot();
    return null;
  }
}

export function clearTaskListSnapshot() {
  try { sessionStore()?.removeItem(TASK_LIST_SNAPSHOT_KEY); }
  catch { /* Cleanup must not block navigation. */ }
}

export function taskListReturnState(taskId: string, scopeKey = ""): TaskDetailNavigationState {
  return { restoreTaskList: true, taskListTaskId: taskId, taskListScopeKey: scopeKey };
}

export function taskListSnapshotForReturn<TFilter = string>(state: unknown, scopeKey: string): TaskListSnapshot<TFilter> | null {
  if (!state || typeof state !== "object") return null;
  const intent = state as TaskDetailNavigationState;
  if (!intent.restoreTaskList || intent.taskListScopeKey !== scopeKey) return null;
  return readTaskListSnapshot<TFilter>({ taskId: intent.taskListTaskId, scopeKey });
}

/** Targeted consumers require provenance; legacy non-targeted callers keep their URL-only contract. */
export function taskListReturnUrl(from?: unknown, taskId?: string, scopeKey = ""): string {
  const state = from && typeof from === "object" ? from as TaskDetailNavigationState : null;
  const explicit = safeTaskListUrl(typeof from === "string" ? from : state?.taskListPath);
  if (!taskId) return explicit ?? readTaskListSnapshot()?.originalUrl ?? TASK_LIST_PATH;
  const matchingState = state?.taskListTaskId === taskId && Boolean(scopeKey) && state.taskListScopeKey === scopeKey;
  const snapshot = readTaskListSnapshot({ taskId, scopeKey });
  const list = (matchingState ? explicit : null) ?? snapshot?.originalUrl ?? TASK_LIST_PATH;
  return `${list}#${TASK_LIST_ANCHOR}`;
}
