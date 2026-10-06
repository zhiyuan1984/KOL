import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiTaskWorkOrderDashboard } from "../api";
import { TaskReportHeader } from "./TaskReportHeader";

const emptyDashboard: AiTaskWorkOrderDashboard = {
  report_version: "task-work-order-dashboard.v2.1", as_of: "2026-10-07T04:00:00.000Z", timezone: "Asia/Shanghai", source: "postgresql_task_work_orders", period: "realtime",
  summary: { tasks: { total: 0 }, work_orders: { total: 0, automatic_created: 0 } },
  metrics: { total: 0, in_progress: 0, completion_rate: null, overdue_rate: null, automatic_rate: null, median_processing_hours: null, overdue: 0, blocked: 0 },
  comparison: null, trends: {}, by_template: [], tasks: { items: [], page: { next_cursor: null, total: 0 } },
};

describe("TaskReportHeader", () => {
  it("uses one compact auxiliary row for an empty business-work-order area", () => {
    const html = renderToStaticMarkup(<TaskReportHeader dashboard={emptyDashboard} period="realtime" loading={false} error="" activeTemplate={null} exporting={false} onTemplate={() => undefined} onClearTemplate={() => undefined} onRetry={() => undefined} onExport={() => undefined} onCreateBusinessTask={() => undefined} />);
    expect(html).toContain("业务工单");
    expect(html).toContain("0 · 暂无标准工单");
    expect(html).toContain("新建业务任务");
    expect(html).not.toContain("导出 CSV");
    expect(html).not.toContain("task-business-empty");
  });
});
