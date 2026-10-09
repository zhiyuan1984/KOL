import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiTaskWorkOrderDashboard, TaskOperationsDashboard } from "../api";
import { TaskOperationsReport } from "./TaskOperationsReport";
import { TaskTypeBreakdown } from "./TaskTypeBreakdown";

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
  it("renders one six-status lifecycle group with real zero counts and separate exception entrances", () => {
    const html = renderToStaticMarkup(<TaskOperationsReport dashboard={dashboard} workOrders={workOrders} period="week" loading={false} workOrdersLoading={false} error="" workOrdersError="" activeFilter="overdue" activeStatus="running" filteredRangeLabel="手动日期范围" onPeriod={() => undefined} onFilter={() => undefined} onClearFilter={() => undefined} onRetry={() => undefined} onRetryWorkOrders={() => undefined} />);
    expect(html).toContain("任务运营");
    expect(html).toContain("手动日期范围");
    expect(html).toContain("工单仍按周期口径");
    ["待启动", "执行中", "等待处理", "已完成", "失败", "已取消"].forEach((label) => expect(html).toContain(label));
    expect(html).toContain('class="task-operation-status task-operation-status-running is-active"');
    expect(html).toMatch(/task-operation-status-cancelled[^>]*><b>0<\/b>/);
    expect(html).not.toContain("task-status-track-segment-cancelled");
    expect(html).toContain("查看逾期任务");
    expect(html).toContain("查看失败任务");
    expect(html).not.toContain("异常任务");
    expect(html).toContain("工单总量");
    expect(html).toContain("开放工单");
    expect(html).toContain("阻塞工单");
    expect(html).toContain("Asia/Shanghai");
  });

  it("keeps previous dashboard and work-order counts visible when an update fails", () => {
    const html = renderToStaticMarkup(<TaskOperationsReport dashboard={dashboard} workOrders={workOrders} period="week" loading={false} workOrdersLoading={false} error="任务报表服务不可用" workOrdersError="工单服务不可用" activeFilter={null} onPeriod={() => undefined} onFilter={() => undefined} onClearFilter={() => undefined} onRetry={() => undefined} onRetryWorkOrders={() => undefined} />);
    expect(html).toContain("任务运营更新失败，当前显示上次成功数据。");
    expect(html).toContain("工单汇总更新失败，当前显示上次成功数据。");
    expect(html).toContain(">12<");
    expect(html).toContain(">6<");
    expect(html).not.toContain("暂无可用的任务运营数据。");
  });

  it("does not invent task totals when no dashboard is available", () => {
    const html = renderToStaticMarkup(<TaskOperationsReport dashboard={null} workOrders={null} period="week" loading={false} workOrdersLoading={false} error="任务报表服务不可用" workOrdersError="工单服务不可用" activeFilter={null} onPeriod={() => undefined} onFilter={() => undefined} onClearFilter={() => undefined} onRetry={() => undefined} onRetryWorkOrders={() => undefined} />);
    expect(html).toContain("运营报表暂时无法读取。");
    expect(html).toContain("工单指标暂时无法读取");
    expect(html).toContain(">—<");
    expect(html).not.toContain("task-status-track");
    expect(html).not.toContain("任务总量");
  });

  it("renders a default-collapsed type table with exact trend window and known zeroes", () => {
    const zeroTaskTypeDashboard: TaskOperationsDashboard = { ...dashboard, task_types: [{ ...dashboard.task_types[0], in_progress: 0, completed: 0, failed: 0 }] };
    const html = renderToStaticMarkup(<TaskTypeBreakdown dashboard={zeroTaskTypeDashboard} period="week" loading={false} error="" />);
    expect(html).toContain('<details class="task-operations-breakdown">');
    expect(html).not.toContain('open=""');
    expect(html).toContain("处理中（含等待）");
    expect(html).toContain("趋势窗口：本周 7 日");
    expect(html).toContain("<td>0</td>");
    expect(html).not.toContain("task-operations-type-filter");
  });
});
