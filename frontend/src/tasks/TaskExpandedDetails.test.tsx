import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiTaskWorkOrderAggregate, AiWorkOrderSummary } from "../api";
import { AgentExpandedDetails, BusinessExpandedDetails, agentDetailFacts, businessDetailFacts, usefulSummary } from "./TaskExpandedDetails";

const makeDetail = (patch: Partial<AiTaskWorkOrderAggregate["task"]> = {}): AiTaskWorkOrderAggregate => ({
  task: { task_id: "test-task", title: "测试任务", goal: "测试任务", status: "open", priority: "normal", due_at: null, data_version: 1, created_at: "2026-10-09T02:00:00Z", updated_at: "2026-10-09T02:00:00Z", ...patch },
  counts: { total: 0, open: 0, blocked: 0, waiting_review: 0, completed: 0, automatic_created: 0, automatic_assigned: 0 },
  work_orders: [], verified_events: [], current_blocking_work_order: null, as_of: "2026-10-09T02:00:00Z", source: "test-only",
});
const statusLabel = (status: string) => status;
const decisionSummary = (order: AiWorkOrderSummary) => order.latest_decision?.outcome || "—";

describe("task expanded detail content density", () => {
  it("omits generic empty summaries and duplicate task titles", () => {
    for (const text of ["", "—", "暂无任务历史", "暂无开放工单", "测试任务", " 测试 任务 "]) expect(usefulSummary(text, "测试任务")).toBe("");
    expect(usefulSummary("等待外部回复", "测试任务")).toBe("等待外部回复");
  });
  it("keeps only present agent metadata, without empty start or deadline columns", () => {
    const facts = agentDetailFacts({ id: "test", title: "测试", skill: "测试技能", created_at: "2026-10-09T02:00:00Z", started_at: null });
    expect(facts.map(item => item.label)).toEqual(["技能", "创建"]);
    expect(facts.find(item => item.label === "技能")?.value).toBe("测试技能");
  });
  it("preserves unknown priority codes instead of inventing their meaning", () => {
    expect(businessDetailFacts(makeDetail({ priority: "custom-priority" })).find(item => item.label === "优先级")?.value).toBe("custom-priority");
  });
  it("renders sparse business tasks as metadata only without standalone empty cards", () => {
    const html = renderToStaticMarkup(<BusinessExpandedDetails detail={makeDetail()} statusLabel={statusLabel} decisionSummary={decisionSummary} />);
    expect(html).not.toContain("task-expanded-summary");
    expect(html).not.toContain("归属标准工单");
    expect(html).not.toContain("尚未物化");
    expect(html).not.toContain("<table");
    expect(html).toContain("<dt>创建</dt>");
    expect(html).toContain("<dt>工单</dt><dd>无</dd>");
  });
  it("shows the actual goal and metadata while excluding repeated main-row facts", () => {
    const html = renderToStaticMarkup(<BusinessExpandedDetails detail={makeDetail({ goal: "核对真实目标" })} statusLabel={statusLabel} decisionSummary={decisionSummary} />);
    expect(html).toContain("核对真实目标");
    expect(html).not.toContain("<dt>状态</dt>");
    expect(html).not.toContain("<dt>更新时间</dt>");
    expect(html).not.toContain("<dt>截止</dt>");
  });
  it("renders child rows only when present, with short empty cells and full-title hints", () => {
    const detail = makeDetail();
    detail.work_orders = [{ work_order_id: "order-1", title: "真实字段工单", template_code: "example", template_version: 2, status: "open", primary_assignee: null, latest_decision: null } as AiWorkOrderSummary];
    detail.counts = { ...detail.counts, total: 1, open: 1 };
    const html = renderToStaticMarkup(<BusinessExpandedDetails detail={detail} statusLabel={statusLabel} decisionSummary={decisionSummary} />);
    expect(html).toContain('aria-label="标准工单明细"');
    expect(html).toContain("真实字段工单 · example.v2");
    expect(html).toContain("未分派");
    expect(html).toContain("开放 1");
    expect(html).not.toContain("无自动化决策");
  });
  it("does not introduce fake facts for completely empty agent details", () => {
    const html = renderToStaticMarkup(<AgentExpandedDetails task={{ id: "empty", title: "测试" }} title="测试" summary="—" />);
    expect(html).toContain("暂无补充信息");
    expect(html).not.toContain("<dl");
  });
});
