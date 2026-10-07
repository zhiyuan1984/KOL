import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiTaskWorkOrderDashboard, TaskOperationsDashboard } from "../api";
import { TaskOperationsReport } from "./TaskOperationsReport";

const dashboard: TaskOperationsDashboard = {
  report_version: "task-operations-dashboard.v1", period: "week", as_of: "2026-10-07T04:00:00.000Z", timezone: "Asia/Shanghai", scope: "personal", source: "legacy_agent_task_projection",
  metrics: { total: 12, in_progress: 3, completion_rate: 58.3, overdue_rate: 8.3, failed: 1, median_processing_hours: 4.5, overdue: 1, waiting: 2, cancelled: 0 },
  comparison: { previous: { total: 10, in_progress: 2, completion_rate: 50, overdue_rate: 10, failed: 0, median_processing_hours: 5, overdue: 1, waiting: 1, cancelled: 0 }, deltas: { total: 20, in_progress: 50, completion_rate: 8.3, overdue_rate: -1.7, failed: null, median_processing_hours: -0.5 } },
  trends: { total: [1, 2, 3], in_progress: [1, 1, 3], completion_rate: [25, 50, 58], overdue_rate: [0, 10, 8], failed: [0, 0, 1], median_processing_hours: [6, 5, 4.5] },
  status_distribution: { queued: 4, running: 1, waiting: 2, completed: 4, failed: 1, cancelled: 0 },
  task_types: [{ task_type: "creator_discovery", title: "红人发现", total: 8, in_progress: 2, completed: 4, failed: 1, trend: [1, 3, 4] }],
};

const workOrders: AiTaskWorkOrderDashboard = {
  report_version: "task-work-order-dashboard.v2.1", as_of: "2026-10-07T04:00:00.000Z", timezone: "Asia/Shanghai", scope: "personal_authorized", source: "postgresql_task_work_orders", period: "week",
  summary: { tasks: { total: 2, open: 2, blocked: 1, waiting_review: 1, completed: 0 }, work_orders: { total: 6, open: 4, blocked: 2, waiting_review: 1, completed: 2, automatic_created: 1, automatic_assigned: 1 } },
  metrics: { total: 2, in_progress: 1, completion_rate: 0, overdue_rate: 0, automatic_rate: 25, median_processing_hours: null, overdue: 0, blocked: 1 },
  comparison: null, trends: {}, by_template: [], tasks: { items: [], page: { limit: 50, next_cursor: null, total: 2 } }, request_id: "req-test",
};

describe("TaskOperationsReport", () => {
  it("renders full Agent status labels, task-type distribution, and work-order KPI values", () => {
    const html = renderToStaticMarkup(<TaskOperationsReport dashboard={dashboard} workOrders={workOrders} period="week" loading={false} workOrdersLoading={false} error="" workOrdersError="" activeFilter="in_progress" onPeriod={() => undefined} onFilter={() => undefined} onClearFilter={() => undefined} onRetry={() => undefined} onRetryWorkOrders={() => undefined} />);
    expect(html).toContain("任务运营");
    expect(html).toContain("Agent／系统任务");
    expect(html).toContain("待启动");
    expect(html).toContain("等待处理");
    expect(html).toContain("任务类型分布");
    expect(html).toContain("红人发现");
    expect(html).toContain("工单总量");
    expect(html).toContain("开放工单");
    expect(html).toContain("阻塞工单");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('<details class="task-operations-breakdown" open="">');
  });

  it("does not report a false zero when work-order metrics cannot be read", () => {
    const html = renderToStaticMarkup(<TaskOperationsReport dashboard={dashboard} workOrders={null} period="week" loading={false} workOrdersLoading={false} error="" workOrdersError="工单服务不可用" activeFilter={null} onPeriod={() => undefined} onFilter={() => undefined} onClearFilter={() => undefined} onRetry={() => undefined} onRetryWorkOrders={() => undefined} />);
    expect(html).toContain("工单指标暂时无法读取");
    expect(html).toContain("工单总量");
    expect(html).toContain(">—<");
  });
});
