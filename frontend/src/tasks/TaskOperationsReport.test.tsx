import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskOperationsDashboard } from "../api";
import { TaskOperationsReport } from "./TaskOperationsReport";

const dashboard: TaskOperationsDashboard = {
  report_version: "task-operations-dashboard.v1", period: "week", as_of: "2026-10-07T04:00:00.000Z", timezone: "Asia/Shanghai", scope: "personal", source: "legacy_agent_task_projection",
  metrics: { total: 12, in_progress: 3, completion_rate: 58.3, overdue_rate: 8.3, failed: 1, median_processing_hours: 4.5, overdue: 1, waiting: 2, cancelled: 0 },
  comparison: { previous: { total: 10, in_progress: 2, completion_rate: 50, overdue_rate: 10, failed: 0, median_processing_hours: 5, overdue: 1, waiting: 1, cancelled: 0 }, deltas: { total: 20, in_progress: 50, completion_rate: 8.3, overdue_rate: -1.7, failed: null, median_processing_hours: -0.5 } },
  trends: { total: [1, 2, 3], in_progress: [1, 1, 3], completion_rate: [25, 50, 58], overdue_rate: [0, 10, 8], failed: [0, 0, 1], median_processing_hours: [6, 5, 4.5] },
  status_distribution: { queued: 4, running: 1, waiting: 2, completed: 4, failed: 1, cancelled: 0 },
  task_types: [{ task_type: "creator_discovery", title: "红人发现", total: 8, in_progress: 2, completed: 4, failed: 1, trend: [1, 3, 4] }],
};

describe("TaskOperationsReport", () => {
  it("renders Agent/system source, interactive status filtering, and task-type distribution", () => {
    const html = renderToStaticMarkup(<TaskOperationsReport dashboard={dashboard} period="week" loading={false} error="" activeFilter="in_progress" onPeriod={() => undefined} onFilter={() => undefined} onClearFilter={() => undefined} onRetry={() => undefined} />);
    expect(html).toContain("任务运营概览");
    expect(html).toContain("Agent 与系统任务");
    expect(html).toContain("任务类型分布");
    expect(html).toContain("红人发现");
    expect(html).toContain('aria-pressed="true"');
  });
});
