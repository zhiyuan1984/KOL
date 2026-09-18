import type { HomeWorkbench, RecommendedTask, Task, TaskDefinition, TodayBriefPrimary, TodoLayoutItem } from "../api";
import { waitDisplayOf, waitStatusLabel, failureHint } from "../waitStatus";
import { todayTaskOriginLabel } from "./modes";

export const openStatuses = new Set(["pending", "waiting", "running", "queued", "in_progress", "failed"]);
export const closedStatuses = new Set(["completed", "done", "cancelled"]);
export const HOME_FOLD_LIMIT = 6;

export type OpenBucket = "high_risk" | "overdue" | "due_today" | "running" | "approval" | "later";
export type TodoListFilter = "all" | OpenBucket;
export type ActionableTodoBucket = "overdue" | "today" | "waiting" | "approval" | "queued" | "running";
export type TodoBucket = ActionableTodoBucket | "open";
export type TodayBucket = Exclude<OpenBucket, "later">;

export const HOME_TODO_BUCKETS = [
  ["overdue", "逾期"],
  ["today", "今天到期"],
  ["approval", "等审批"],
  ["queued", "已入队"],
  ["running", "执行中"],
] as const satisfies ReadonlyArray<readonly [Exclude<ActionableTodoBucket, "waiting">, string]>;

export const TODAY_BUCKETS = [
  ["high_risk", "高风险"],
  ["overdue", "已逾期"],
  ["due_today", "今天到期"],
  ["running", "进行中"],
  ["approval", "审批中"],
] as const satisfies ReadonlyArray<readonly [TodayBucket, string]>;

export const OPEN_BUCKETS = [
  ...TODAY_BUCKETS,
  ["later", "后续"],
] as const satisfies ReadonlyArray<readonly [OpenBucket, string]>;

export const OPEN_FILTERS = [
  ["all", "全部"],
  ["high_risk", "高风险"],
  ["overdue", "已逾期"],
  ["due_today", "今天"],
  ["running", "进行中"],
  ["approval", "审批中"],
  ["later", "后续"],
] as const satisfies ReadonlyArray<readonly [TodoListFilter, string]>;

const HIGH_RISK_TEXT = /异常|拒绝|暂缓/;
const TODAY_BUCKET_RANK: Record<TodayBucket, number> = {
  high_risk: 0,
  overdue: 1,
  due_today: 2,
  running: 3,
  approval: 4,
};
const OPEN_BUCKET_RANK: Record<OpenBucket, number> = {
  ...TODAY_BUCKET_RANK,
  later: 5,
};

export const EXCEPTION_TEMPLATE: TaskDefinition = {
  id: "exception_delay_care",
  skill_id: "email_compose",
  title: "延期关怀",
  description: "对合作延期做关怀式跟进，不把延期直接判定为违约",
  prompt: "延期关怀 [红人或合作]",
  category: "异常",
  profile: "lead",
};

export const MAIL_COMMAND_TEMPLATES: TaskDefinition[] = [
  {
    id: "content_nudge",
    skill_id: "email_compose",
    title: "催大纲",
    description: "仅测试中或内容策划阶段可催大纲",
    prompt: "催大纲 [红人或合作]",
    category: "履约",
    profile: "lead",
  },
];

export function withHomeCommandTemplates(list: TaskDefinition[]): TaskDefinition[] {
  const extras = [EXCEPTION_TEMPLATE, ...MAIL_COMMAND_TEMPLATES];
  const extraIds = new Set(extras.map((row) => row.id));
  return [...list.filter((row) => !extraIds.has(row.id)), ...extras];
}

export function definitionList(
  value: TaskDefinition[] | { task_definitions?: TaskDefinition[]; definitions?: TaskDefinition[] },
): TaskDefinition[] {
  return Array.isArray(value) ? value : value.task_definitions || value.definitions || [];
}

export function taskValue(value: Task | { task: Task }): Task {
  return (value as { task?: Task }).task || (value as Task);
}

export function isClosedTask(task: Task) {
  return closedStatuses.has(String(task.status || ""));
}

export function isPlanningTask(task: Task) {
  const type = String(task.task_type || task.skill || "");
  return type === "today_plan" || type === "today_analyze" || task.source === "planning";
}

export function isInsightTask(task: Task) {
  return task.source === "ai" && !task.promoted_at && !task.dismissed_at && !isClosedTask(task);
}

export function isTodoTask(task: Task) {
  if (isPlanningTask(task) || isClosedTask(task) || task.dismissed_at) return false;
  return task.source !== "ai" || Boolean(task.promoted_at);
}

export function isCandidateItem(item: { candidate?: boolean; source?: string; promoted_at?: string | null }): boolean {
  if (item.candidate === true) return true;
  if (item.candidate === false) return false;
  return item.source === "ai" && !item.promoted_at;
}

export function isHighValueInsight(task: Task) {
  return task.priority === "high" || task.priority === "urgent" || Boolean(task.risk) || task.status === "failed";
}

function dueTime(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function workPriorityScore(task: Task) {
  let score = 0;
  if (task.risk || task.status === "failed") score += 100;
  const due = dueTime(task.due_at);
  if (Number.isFinite(due)) {
    const days = (due - Date.now()) / 86_400_000;
    if (days < 0) score += 90;
    else if (days < 1) score += 70;
    else if (days < 3) score += 40;
  }
  if (task.priority === "high" || task.priority === "urgent") score += 50;
  if (task.status === "waiting" || task.status === "queued") score += 30;
  if (task.source === "ai") score += 20;
  return score;
}

export function sortedTasks(rows: Task[], sort: string) {
  return [...rows].sort((a, b) => {
    if (sort === "due") return String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"));
    if (sort === "progress") return Number(b.progress || 0) - Number(a.progress || 0);
    const byScore = workPriorityScore(b) - workPriorityScore(a);
    if (byScore) return byScore;
    const rank = { high: 0, urgent: 0, medium: 1, normal: 1, low: 2 };
    return (rank[a.priority as keyof typeof rank] ?? 3) - (rank[b.priority as keyof typeof rank] ?? 3);
  });
}

export function dueDayDiff(value?: string, now = new Date()): number | null {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = new Date(due);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - start.getTime()) / 86_400_000);
}

export function todoBucket(task: Task): TodoBucket {
  const diff = dueDayDiff(task.due_at);
  if (diff != null) {
    if (diff < 0) return "overdue";
    if (diff === 0) return "today";
  }
  const display = waitDisplayOf(task.status);
  if (display === "awaiting_review") return "waiting";
  if (display === "awaiting_approval") return "approval";
  if (display === "queued") return "queued";
  if (display === "running") return "running";
  return "open";
}

export function isHighRiskTask(task: Task) {
  if (task.risk || String(task.status || "") === "failed") return true;
  return HIGH_RISK_TEXT.test(`${task.title || ""} ${task.current_stage || ""}`);
}

function isRunningStatus(status?: string) {
  const value = String(status || "").toLowerCase();
  return waitDisplayOf(status) === "running" || value === "in_progress" || value === "starting" || value === "running";
}

function isApprovalStatus(status?: string) {
  const value = String(status || "").toLowerCase();
  return waitDisplayOf(status) === "awaiting_approval" || value === "awaiting_approval" || value === "waiting_approval";
}

/** Exclusive today bucket. Not closed / not dismissed only — no promote / isTodoTask gate. */
export function todayBucket(task: Task): TodayBucket | null {
  if (isClosedTask(task) || task.dismissed_at) return null;
  if (isHighRiskTask(task)) return "high_risk";
  const diff = dueDayDiff(task.due_at);
  if (diff != null && diff < 0) return "overdue";
  if (diff === 0) return "due_today";
  if (isRunningStatus(task.status)) return "running";
  if (isApprovalStatus(task.status)) return "approval";
  return null;
}

export function todayBucketLabel(bucket: TodayBucket) {
  return TODAY_BUCKETS.find(([id]) => id === bucket)?.[1] || bucket;
}

export function isTodayActionableTodo(task: Task) {
  if (isPlanningTask(task)) return false;
  return todayBucket(task) !== null;
}

/** Full open memory list — not closed / not dismissed. No promote gate. */
export function isOpenTask(task: Task) {
  if (isPlanningTask(task)) return false;
  return !isClosedTask(task) && !task.dismissed_at;
}

export function openBucket(task: Task): OpenBucket | null {
  if (!isOpenTask(task)) return null;
  return todayBucket(task) || "later";
}

export function openBucketLabel(bucket: OpenBucket) {
  return OPEN_BUCKETS.find(([id]) => id === bucket)?.[1] || bucket;
}

export function openPrimaryAction(bucket: OpenBucket) {
  if (bucket === "later") return "打开";
  return todayPrimaryAction(bucket);
}

export function sortOpenWorkItems(rows: Task[]): Task[] {
  return [...rows].sort((a, b) => {
    const left = openBucket(a);
    const right = openBucket(b);
    const byBucket = (left == null ? 99 : OPEN_BUCKET_RANK[left]) - (right == null ? 99 : OPEN_BUCKET_RANK[right]);
    if (byBucket) return byBucket;
    const dueA = dueTime(a.due_at);
    const dueB = dueTime(b.due_at);
    if (dueA !== dueB) return dueA - dueB;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
}

export function sortTodayTodos(rows: Task[]): Task[] {
  return [...rows].sort((a, b) => {
    const left = todayBucket(a);
    const right = todayBucket(b);
    const byBucket = (left == null ? 99 : TODAY_BUCKET_RANK[left]) - (right == null ? 99 : TODAY_BUCKET_RANK[right]);
    if (byBucket) return byBucket;
    return workPriorityScore(b) - workPriorityScore(a);
  });
}

export function todayContentLine(task: Task) {
  return [
    String(task.description || "").trim(),
    String(task.context || "").trim(),
    String(task.history_summary || "").trim(),
    String(task.next_action || "").trim(),
    String(task.risk || "").trim(),
  ].filter(Boolean).join(" · ");
}

export function todayPrimaryAction(bucket: TodayBucket) {
  return bucket === "approval" ? "去审批" : "处理";
}

const BANNED_BRIEF_PRIMARY = /处理|待补阶段/;
const BATCH_PRIMARY_LABEL: Record<string, string> = {
  retry_crawl: "重试采集",
  open_batch: "打开批次",
  analyze: "分析批次",
};

export function briefPrimaryLabel(primary?: TodayBriefPrimary | null): string {
  if (!primary) return "";
  const verb = String(primary.verb || "").trim();
  const raw = String(primary.label || "").trim();
  const batch = primary.object_type === "batch"
    || (!primary.person_id && /batch|discovery/.test(String(primary.object_type || "")));
  if (batch) {
    if (verb === "follow" || BANNED_BRIEF_PRIMARY.test(raw) || BANNED_BRIEF_PRIMARY.test(verb)) {
      return BATCH_PRIMARY_LABEL[verb] || BATCH_PRIMARY_LABEL.retry_crawl;
    }
    return BATCH_PRIMARY_LABEL[verb] || raw || "打开批次";
  }
  if (BANNED_BRIEF_PRIMARY.test(raw) || BANNED_BRIEF_PRIMARY.test(verb)) return "打开";
  return raw || "打开";
}

export function applyTodoLayout(tasks: Task[], layout?: TodoLayoutItem[] | null): Task[] {
  if (!layout?.length) return sortOpenWorkItems(tasks);
  const byId = new Map(layout.map((row) => [row.work_item_id, row]));
  return [...tasks].sort((a, b) => {
    const left = byId.get(a.id);
    const right = byId.get(b.id);
    const rankA = left?.rank ?? 999;
    const rankB = right?.rank ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return sortOpenWorkItems([a, b]).map((row) => row.id).indexOf(a.id)
      - sortOpenWorkItems([a, b]).map((row) => row.id).indexOf(b.id);
  }).map((task) => {
    const row = byId.get(task.id);
    return row?.why ? { ...task, layout_why: row.why } : task;
  });
}

/** Keep today-bucket order; only stamp plan `why` onto matching rows. */
export function applyLayoutWhy(tasks: Task[], layout?: TodoLayoutItem[] | null): Task[] {
  if (!layout?.length) return tasks;
  const byId = new Map(layout.map((row) => [row.work_item_id, row]));
  return tasks.map((task) => {
    const why = String(byId.get(task.id)?.why || "").trim();
    return why ? { ...task, layout_why: why } : task;
  });
}

export function whyLine(task: Task) {
  const layoutWhy = String(task.layout_why || "").trim();
  if (layoutWhy) return layoutWhy;
  const origin = todayTaskOriginLabel(task.source);
  if (waitDisplayOf(task.status) === "failed") {
    const hint = failureHint(task);
    return hint ? `${origin} · ${hint}` : `${origin} · 执行失败`;
  }
  if (task.risk) return `${origin} · ${task.risk}`;
  if (task.description) return `${origin} · ${task.description}`;
  if (task.context) return `${origin} · ${task.context}`;
  if (task.history_summary) return `${origin} · ${task.history_summary}`;
  if (task.due_at) {
    const due = new Date(task.due_at);
    if (!Number.isNaN(due.getTime())) {
      const today = new Date();
      const sameDay = due.toDateString() === today.toDateString();
      if (due < today && !sameDay) return `${origin} · 已超过计划时间`;
      if (sameDay) return `${origin} · 今天截止`;
      return `${origin} · ${due.toLocaleDateString("zh-CN")} 截止`;
    }
  }
  return [origin, task.skill, task.profile].filter(Boolean).join(" · ");
}

export function urgencyLabel(task: Task) {
  const bucket = todoBucket(task);
  if (bucket === "overdue") return "逾期";
  if (bucket === "today") return "今天到期";
  if (String(task.status || "") === "failed") return "失败";
  if (task.risk) return "有风险";
  if (task.priority === "high" || task.priority === "urgent") return "高优先";
  if (bucket === "waiting") return waitStatusLabel(task.status);
  return waitStatusLabel(task.status);
}

export function dueLabel(task: Task) {
  if (!task.due_at) return "";
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return "";
  return due.toLocaleDateString("zh-CN");
}

export function handleLine(task: Task) {
  const handle = String(task.kol_name || "").replace(/^@/, "").trim();
  const stage = String(task.current_stage || "").trim();
  const named = handle && handle !== "未指定红人" ? `@${handle}` : "";
  const staged = stage && stage !== "阶段未知" ? stage : "";
  if (named && staged) return `${named} · ${staged}`;
  return named || staged;
}

export function objectLine(task: Task) {
  const handle = String(task.kol_name || "").replace(/^@/, "").trim();
  if (handle && handle !== "未指定红人") return `@${handle}`;
  return String(task.project || "").trim();
}

export function basisLine(task: Task) {
  return String(task.history_summary || task.description || task.context || task.risk || "").trim();
}

export function nextStepLine(task: Task) {
  return String(task.next_action || "").trim() || waitStatusLabel(task.status);
}

export function todoMark(task: Task) {
  const bucket = todoBucket(task);
  if (bucket === "overdue") return "!";
  if (bucket === "today") return "⚠";
  if (bucket === "waiting" || bucket === "approval") return "…";
  if (bucket === "running") return "◷";
  return "○";
}

export function sortTodosByLaw(rows: Task[]): Task[] {
  const rank: Record<TodoBucket, number> = {
    overdue: 0,
    today: 1,
    waiting: 2,
    approval: 3,
    queued: 4,
    running: 5,
    open: 6,
  };
  return [...rows].sort((a, b) => {
    const byBucket = rank[todoBucket(a)] - rank[todoBucket(b)];
    if (byBucket) return byBucket;
    return workPriorityScore(b) - workPriorityScore(a);
  });
}

export function deriveWorkbench(tasks: Task[], kols: Array<{ exception?: boolean; unbound?: boolean; days_in_stage?: number }>): HomeWorkbench {
  const open = sortOpenWorkItems(tasks.filter(isOpenTask));
  const todo = sortedTasks(tasks.filter(isTodoTask), "priority");
  const insights = sortedTasks(tasks.filter(isInsightTask), "priority");
  return {
    summary: {
      open: open.length,
      overdue: open.filter((task) => openBucket(task) === "overdue").length,
      due_today: open.filter((task) => openBucket(task) === "due_today").length,
      waiting: open.filter((task) => waitDisplayOf(task.status) === "awaiting_review").length,
      insights: insights.length,
    },
    open,
    todo,
    today: sortTodayTodos(tasks.filter(isTodayActionableTodo)),
    insights,
    recommendations: [],
    lifecycle: {
      exception_count: kols.filter((kol) => kol.exception).length,
      stay_too_long: kols.filter((kol) => !kol.unbound && Number(kol.days_in_stage || 0) >= 7),
    },
  };
}

export function canOpenExistingTaskFlow(task: Task): boolean {
  return Boolean(task.session_id || task.collaboration_id || task.project_id);
}

export function matchesTodoFilter(task: Task, filter: TodoListFilter) {
  if (filter === "all") return isOpenTask(task);
  return openBucket(task) === filter;
}

export function recommendationAsCandidate(item: RecommendedTask): RecommendedTask {
  return { ...item, candidate: true };
}
