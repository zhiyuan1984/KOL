import { describe, expect, it } from "vitest";
import { buildTaskOperationsDashboard, taskOperationsDashboardRanges, taskOperationsPeriod } from "../src/tasks/operations-dashboard.js";

const now = new Date("2026-10-07T04:00:00.000Z"); // 2026-10-07 12:00 in Asia/Shanghai
const rows = [
  { id: "done", task_type: "creator_discovery", title: "已完成", status: "completed", due_at: null, created_at: "2026-10-06T18:00:00.000Z", completed_at: "2026-10-06T19:00:00.000Z", updated_at: "2026-10-06T19:00:00.000Z" },
  { id: "running", task_type: "creator_discovery", title: "执行中", status: "running", due_at: "2026-10-07T01:00:00.000Z", created_at: "2026-10-06T20:00:00.000Z", completed_at: null, updated_at: "2026-10-07T03:00:00.000Z" },
  { id: "waiting", task_type: "today_brief", title: "等待处理", status: "waiting", due_at: null, created_at: "2026-10-06T21:00:00.000Z", completed_at: null, updated_at: "2026-10-07T02:00:00.000Z" },
  { id: "failed", task_type: "today_brief", title: "失败", status: "failed", due_at: null, created_at: "2026-10-06T22:00:00.000Z", completed_at: null, updated_at: "2026-10-07T02:30:00.000Z" },
  { id: "previous", task_type: "creator_discovery", title: "前一日", status: "completed", due_at: null, created_at: "2026-10-05T18:00:00.000Z", completed_at: "2026-10-05T20:00:00.000Z", updated_at: "2026-10-05T20:00:00.000Z" },
];

describe("task operations dashboard", () => {
  it("uses the selected Shanghai day for both created and completed task activity", () => {
    const dashboard = buildTaskOperationsDashboard(rows, { period: "today", now, timezone: "Asia/Shanghai" });
    expect(dashboard.metrics).toMatchObject({ total: 4, in_progress: 2, waiting: 1, overdue: 1, failed: 1, completion_rate: 25, overdue_rate: 25, median_processing_hours: 1 });
    expect(dashboard.status_distribution).toEqual({ queued: 0, running: 1, waiting: 1, completed: 1, failed: 1, cancelled: 0 });
    expect(dashboard.comparison?.previous.total).toBe(1);
    expect(dashboard.comparison?.deltas.total).toBe(300);
    expect(dashboard.task_types[0]).toMatchObject({ task_type: "creator_discovery", total: 2, in_progress: 1, completed: 1 });
  });

  it("returns Shanghai-aligned boundaries and rejects an unsupported period", () => {
    const ranges = taskOperationsDashboardRanges("today", now, "Asia/Shanghai");
    expect(ranges.current?.start.toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(ranges.current?.end.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    expect(() => taskOperationsPeriod("quarter")).toThrow(/invalid_operations_period/);
  });
});
