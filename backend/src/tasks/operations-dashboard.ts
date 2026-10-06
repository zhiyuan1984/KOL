import { HttpFail } from "../host/errors.js";

export const TASK_OPERATION_PERIODS = ["realtime", "today", "week", "month", "year"] as const;
export type TaskOperationsPeriod = (typeof TASK_OPERATION_PERIODS)[number];
export type TaskOperationsMetricKey = "total" | "in_progress" | "completion_rate" | "overdue_rate" | "failed" | "median_processing_hours";

export type TaskOperationsRow = {
  id: string;
  task_type: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type TaskOperationsMetrics = Record<TaskOperationsMetricKey, number | null> & {
  overdue: number;
  waiting: number;
  cancelled: number;
};

type TimeRange = { start: Date; end: Date } | null;
type DashboardRanges = { current: TimeRange; previous: TimeRange };

const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "done", "success", "succeeded"]);
const UNSTARTED = new Set(["open", "pending", "queued"]);
const RUNNING = new Set(["running", "starting", "in_progress"]);
const WAITING = new Set(["waiting", "waiting_approval", "needs_clarification", "waiting_external", "needs_review"]);
const COMPLETED = new Set(["completed", "done", "success", "succeeded"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

function normalizedStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function parsedDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function inRange(date: Date | null, range: TimeRange): boolean {
  return Boolean(date && (!range || (date >= range.start && date < range.end)));
}

function statusGroup(status: string): "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" {
  if (COMPLETED.has(status)) return "completed";
  if (status === "failed") return "failed";
  if (CANCELLED.has(status)) return "cancelled";
  if (RUNNING.has(status)) return "running";
  if (WAITING.has(status)) return "waiting";
  return "queued";
}

function calendarParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number } {
  const fields = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const number = (type: string) => Number(fields.find((part) => part.type === type)?.value || 0);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour") };
}

/** Converts a target local midnight into UTC without taking a server-local timezone dependency. */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const probe = calendarParts(new Date(desired), timeZone);
  const observed = Date.UTC(probe.year, probe.month - 1, probe.day, probe.hour, 0, 0, 0);
  return new Date(desired - (observed - desired));
}

function addLocalDate(date: Date, timeZone: string, increment: { days?: number; months?: number; years?: number }): Date {
  const parts = calendarParts(date, timeZone);
  const local = new Date(Date.UTC(parts.year + (increment.years || 0), parts.month - 1 + (increment.months || 0), parts.day + (increment.days || 0)));
  return zonedMidnight(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), timeZone);
}

export function taskOperationsPeriod(value?: unknown): TaskOperationsPeriod {
  const period = String(value ?? "realtime").trim() || "realtime";
  if (!TASK_OPERATION_PERIODS.includes(period as TaskOperationsPeriod)) {
    throw new HttpFail(400, { code: "invalid_operations_period", period, supported: TASK_OPERATION_PERIODS });
  }
  return period as TaskOperationsPeriod;
}

export function taskOperationsTrendPointCount(period: TaskOperationsPeriod): number {
  if (period === "today") return 24;
  if (period === "week") return 7;
  if (period === "month") return 30;
  if (period === "year") return 12;
  return 7;
}

export function taskOperationsDashboardRanges(period: TaskOperationsPeriod, now = new Date(), timeZone = "Asia/Shanghai"): DashboardRanges {
  if (period === "realtime") return { current: null, previous: null };
  const local = calendarParts(now, timeZone);
  let start: Date;
  let prior: Date;
  if (period === "today") {
    start = zonedMidnight(local.year, local.month, local.day, timeZone);
    prior = addLocalDate(start, timeZone, { days: -1 });
  } else if (period === "week") {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const mondayOffset = (day + 6) % 7;
    start = addLocalDate(zonedMidnight(local.year, local.month, local.day, timeZone), timeZone, { days: -mondayOffset });
    prior = addLocalDate(start, timeZone, { days: -7 });
  } else if (period === "month") {
    start = zonedMidnight(local.year, local.month, 1, timeZone);
    prior = addLocalDate(start, timeZone, { months: -1 });
  } else {
    start = zonedMidnight(local.year, 1, 1, timeZone);
    prior = addLocalDate(start, timeZone, { years: -1 });
  }
  return { current: { start, end: period === "today" ? addLocalDate(start, timeZone, { days: 1 }) : period === "week" ? addLocalDate(start, timeZone, { days: 7 }) : period === "month" ? addLocalDate(start, timeZone, { months: 1 }) : addLocalDate(start, timeZone, { years: 1 }) }, previous: { start: prior, end: start } };
}

function isOperationalRowInRange(row: TaskOperationsRow, range: TimeRange): boolean {
  return !range || inRange(parsedDate(row.created_at), range) || inRange(parsedDate(row.completed_at), range);
}

function completedRows(rows: TaskOperationsRow[], range: TimeRange): TaskOperationsRow[] {
  return rows.filter((row) => inRange(parsedDate(row.completed_at), range));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function round(value: number | null, digits = 2): number | null {
  return value == null ? null : Number(value.toFixed(digits));
}

function metricFor(rows: TaskOperationsRow[], completionRows: TaskOperationsRow[], asOf: Date): TaskOperationsMetrics {
  const total = rows.length;
  const inProgress = rows.filter((row) => {
    const status = normalizedStatus(row.status);
    return !TERMINAL.has(status) && !UNSTARTED.has(status);
  }).length;
  const completed = rows.filter((row) => COMPLETED.has(normalizedStatus(row.status))).length;
  const overdue = rows.filter((row) => {
    const due = parsedDate(row.due_at);
    return Boolean(due && due < asOf && !TERMINAL.has(normalizedStatus(row.status)));
  }).length;
  const failed = rows.filter((row) => normalizedStatus(row.status) === "failed").length;
  const waiting = rows.filter((row) => WAITING.has(normalizedStatus(row.status))).length;
  const cancelled = rows.filter((row) => CANCELLED.has(normalizedStatus(row.status))).length;
  const durations = completionRows.flatMap((row) => {
    const createdAt = parsedDate(row.created_at);
    const completedAt = parsedDate(row.completed_at);
    if (!createdAt || !completedAt || completedAt < createdAt) return [];
    return [(completedAt.getTime() - createdAt.getTime()) / 3_600_000];
  });
  return {
    total,
    in_progress: inProgress,
    completion_rate: total ? round((completed / total) * 100) : null,
    overdue_rate: total ? round((overdue / total) * 100) : null,
    failed,
    median_processing_hours: round(median(durations)),
    overdue,
    waiting,
    cancelled,
  };
}

function percentageDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return round(((current - previous) / previous) * 100);
}

export function taskOperationsDeltas(current: TaskOperationsMetrics, previous: TaskOperationsMetrics): Record<TaskOperationsMetricKey, number | null> {
  return {
    total: percentageDelta(current.total, previous.total),
    in_progress: percentageDelta(current.in_progress, previous.in_progress),
    completion_rate: current.completion_rate == null || previous.completion_rate == null ? null : round(current.completion_rate - previous.completion_rate),
    overdue_rate: current.overdue_rate == null || previous.overdue_rate == null ? null : round(current.overdue_rate - previous.overdue_rate),
    failed: percentageDelta(current.failed, previous.failed),
    median_processing_hours: current.median_processing_hours == null || previous.median_processing_hours == null ? null : round(current.median_processing_hours - previous.median_processing_hours, 1),
  };
}

function trendBucketStart(period: TaskOperationsPeriod, now: Date, timeZone: string): Date {
  const ranges = taskOperationsDashboardRanges(period, now, timeZone);
  if (ranges.current) return ranges.current.start;
  const local = calendarParts(now, timeZone);
  return addLocalDate(zonedMidnight(local.year, local.month, local.day, timeZone), timeZone, { days: -6 });
}

function nextBucketStart(start: Date, period: TaskOperationsPeriod, timeZone: string): Date {
  if (period === "today") return new Date(start.getTime() + 3_600_000);
  if (period === "year") return addLocalDate(start, timeZone, { months: 1 });
  return addLocalDate(start, timeZone, { days: 1 });
}

export type TaskOperationsDashboard = {
  report_version: "task-operations-dashboard.v1";
  period: TaskOperationsPeriod;
  as_of: string;
  timezone: string;
  scope: "personal" | "organization";
  source: "legacy_agent_task_projection";
  metrics: TaskOperationsMetrics;
  comparison: { previous: TaskOperationsMetrics; deltas: Record<TaskOperationsMetricKey, number | null> } | null;
  trends: Record<TaskOperationsMetricKey, number[]>;
  status_distribution: Record<"queued" | "running" | "waiting" | "completed" | "failed" | "cancelled", number>;
  task_types: Array<{ task_type: string; total: number; in_progress: number; completed: number; failed: number; trend: number[] }>;
};

export function buildTaskOperationsDashboard(
  rows: TaskOperationsRow[],
  options: { period?: TaskOperationsPeriod; timezone?: string; now?: Date; scope?: "personal" | "organization" } = {},
): TaskOperationsDashboard {
  const period = options.period || "realtime";
  const timezone = options.timezone || "Asia/Shanghai";
  const now = options.now || new Date();
  const ranges = taskOperationsDashboardRanges(period, now, timezone);
  const currentRows = rows.filter((row) => isOperationalRowInRange(row, ranges.current));
  const previousRows = rows.filter((row) => ranges.previous ? isOperationalRowInRange(row, ranges.previous) : false);
  const metrics = metricFor(currentRows, completedRows(rows, ranges.current), now);
  const previous = metricFor(previousRows, completedRows(rows, ranges.previous), ranges.current?.start || now);
  const pointCount = taskOperationsTrendPointCount(period);
  const starts: Date[] = [];
  let start = trendBucketStart(period, now, timezone);
  for (let index = 0; index < pointCount; index += 1) {
    starts.push(start);
    start = nextBucketStart(start, period, timezone);
  }
  const byType = new Map<string, TaskOperationsRow[]>();
  currentRows.forEach((row) => {
    const typeRows = byType.get(row.task_type) || [];
    typeRows.push(row);
    byType.set(row.task_type, typeRows);
  });
  const statusDistribution: TaskOperationsDashboard["status_distribution"] = { queued: 0, running: 0, waiting: 0, completed: 0, failed: 0, cancelled: 0 };
  currentRows.forEach((row) => { statusDistribution[statusGroup(normalizedStatus(row.status))] += 1; });
  const pointMetrics = starts.map((bucketStart) => {
    const bucketEnd = nextBucketStart(bucketStart, period, timezone);
    const rowsInBucket = rows.filter((row) => isOperationalRowInRange(row, { start: bucketStart, end: bucketEnd }));
    return metricFor(rowsInBucket, completedRows(rows, { start: bucketStart, end: bucketEnd }), bucketEnd);
  });
  return {
    report_version: "task-operations-dashboard.v1",
    period,
    as_of: now.toISOString(),
    timezone,
    scope: options.scope || "personal",
    source: "legacy_agent_task_projection",
    metrics,
    comparison: period === "realtime" ? null : { previous, deltas: taskOperationsDeltas(metrics, previous) },
    trends: {
      total: pointMetrics.map((point) => point.total || 0),
      in_progress: pointMetrics.map((point) => point.in_progress || 0),
      completion_rate: pointMetrics.map((point) => point.completion_rate || 0),
      overdue_rate: pointMetrics.map((point) => point.overdue_rate || 0),
      failed: pointMetrics.map((point) => point.failed || 0),
      median_processing_hours: pointMetrics.map((point) => point.median_processing_hours || 0),
    },
    status_distribution: statusDistribution,
    task_types: [...byType.entries()].map(([taskType, taskRows]) => ({
      task_type: taskType,
      total: taskRows.length,
      in_progress: taskRows.filter((row) => { const status = normalizedStatus(row.status); return !TERMINAL.has(status) && !UNSTARTED.has(status); }).length,
      completed: taskRows.filter((row) => COMPLETED.has(normalizedStatus(row.status))).length,
      failed: taskRows.filter((row) => normalizedStatus(row.status) === "failed").length,
      trend: starts.map((bucketStart) => {
        const bucketEnd = nextBucketStart(bucketStart, period, timezone);
        return rows.filter((row) => row.task_type === taskType && isOperationalRowInRange(row, { start: bucketStart, end: bucketEnd })).length;
      }),
    })).sort((left, right) => right.total - left.total || left.task_type.localeCompare(right.task_type)),
  };
}
