import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DiscoveryConfirmCard from "./DiscoveryConfirmCard";
import DiscoveryParamsCheck from "./DiscoveryParamsCheck";
import DiscoveryRunEvents from "./DiscoveryRunEvents";
import DiscoverySkillEvent, { DiscoveryGuidanceEvent } from "./DiscoverySkillEvent";
import type { DiscoveryProcessStep } from "./discoveryEvents";
import type { SkillTemplate } from "../api";

const TEMPLATE: SkillTemplate = {
  id: "skill-template:crawler_collect",
  kind: "skill_template",
  skill_id: "crawler_collect",
  version: "v1",
  title: "采集线索",
  description: "提出受控的远程采集请求，并读取已授权任务的进度和结果",
  steps: ["核对平台、目标和发现条件", "展示实际采集参数，等待员工确认"],
  inputs: [],
  starter: "采集线索",
  output: { type: "task_result", title: "采集进度、回执与可复核候选" },
  constraints: ["地区、粉丝、均播与期望人数是候选核对条件，不是远端数量限制"],
  evidence: ["候选来源链接、采集时间和任务范围"],
  decisions: ["确认实际采集平台、关键词和范围"],
  recovery: ["远端等待时保留排队原因和当前任务编号"],
  source: "skill",
  read_only: true,
};

const STEP = (kind: DiscoveryProcessStep["kind"], label: string): DiscoveryProcessStep => ({
  id: kind,
  kind,
  label,
  time: "09:01:02",
});

describe("AI发现中栏事件渲染契约", () => {
  it("renders the skill contract flat and read-only", () => {
    const html = renderToStaticMarkup(createElement(DiscoverySkillEvent, { template: TEMPLATE }));
    expect(html).toContain('data-discovery-event="skill"');
    expect(html).toContain('data-discovery-event-index="1"');
    expect(html).toContain("采集线索");
    expect(html).toContain("技能交互模板 · 只读");
    expect(html).toContain('data-skill-template-flat="true"');
    expect(html).toContain("使用边界");
    expect(html).toContain("异常与恢复");
    // 平铺：使用边界/异常与恢复不再折叠。
    expect(html).not.toContain("<details");
    expect(html).toContain("无需必填参数");
  });

  it("renders the guidance event second", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryGuidanceEvent));
    expect(html).toContain('data-discovery-event="guidance"');
    expect(html).toContain('data-discovery-event-index="2"');
    expect(html).toContain("均可选");
  });

  it("separates executed parameters from post-check conditions", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryParamsCheck, {
      phase: "pending",
      executed: [{ key: "platforms", label: "平台", value: "YouTube", state: "executed" }],
      checkedAfter: [{ key: "followers", label: "粉丝数", value: "10,000–不限", state: "checked_after" }],
      stale: false,
      error: "",
    }));
    expect(html).toContain('data-discovery-event="params"');
    expect(html).toContain('data-discovery-params-executed');
    expect(html).toContain("YouTube");
    expect(html).toContain('data-discovery-params-checked-after');
    expect(html).toContain("10,000–不限");
    expect(html).toContain('data-discovery-event-state="ready"');
  });

  it("keeps the waiting state honest while the proposal is still being prepared", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryParamsCheck, {
      phase: "waiting_proposal",
      executed: [],
      checkedAfter: [],
      stale: false,
      error: "",
    }));
    expect(html).toContain("data-discovery-params-waiting");
    expect(html).toContain('data-discovery-event-state="waiting"');
    expect(html).not.toContain("data-discovery-params-executed");
  });

  it("marks an edited check stale instead of inventing a new card", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryParamsCheck, {
      phase: "pending",
      executed: [],
      checkedAfter: [],
      stale: true,
      error: "",
    }));
    expect(html).toContain("data-discovery-params-stale");
    expect(html).toContain("已失效");
  });

  it("offers confirm once, then reports 已确认，正在启动 without a second button", () => {
    const pending = renderToStaticMarkup(createElement(DiscoveryConfirmCard, {
      phase: "pending",
      error: "",
      blockedReason: "",
    }));
    expect(pending).toContain("data-discovery-start-confirm");
    expect(pending).toContain("确认开始采集");

    const dispatching = renderToStaticMarkup(createElement(DiscoveryConfirmCard, {
      phase: "dispatching",
      error: "",
      blockedReason: "",
    }));
    expect(dispatching).toContain("已确认，正在启动");
    expect(dispatching).not.toContain("data-discovery-start-confirm");
  });

  it("blocks the confirm while the check is stale", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryConfirmCard, {
      phase: "pending",
      error: "",
      blockedReason: "条件已修改，重新核对后才能确认采集。",
    }));
    expect(html).toContain("条件已修改");
    expect(html).toMatch(/data-discovery-start-confirm[^>]*disabled/);
  });

  it("renders the run trail from real events only", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryRunEvents, {
      stage: "running",
      steps: [STEP("queued", "排队"), STEP("search", "开始搜索关键词"), STEP("received", "已收到 40 条")],
      inFlight: true,
    }));
    expect(html).toContain('data-discovery-event="run"');
    expect(html).toContain('data-discovery-step="queued"');
    expect(html).toContain('data-discovery-step="received"');
    expect(html).toContain("正在采集");
    expect(html).not.toContain("已完成");
  });

  it("does not claim collection before the employee confirms", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryRunEvents, {
      stage: "running",
      steps: [STEP("queued", "排队")],
      inFlight: true,
      confirmed: false,
    }));
    expect(html).toContain("data-discovery-run-unconfirmed");
    expect(html).toContain("等待确认");
    expect(html).not.toContain("正在采集");
    expect(html).not.toContain("data-discovery-run-stop");
  });

  it("does not claim completion without a run", () => {
    const preRun = renderToStaticMarkup(createElement(DiscoveryRunEvents, {
      stage: "compose",
      steps: [],
      inFlight: false,
    }));
    expect(preRun).toContain("data-discovery-run-pending");
    expect(preRun).toContain("尚未开始");
    expect(preRun).not.toContain("已完成");

    const settled = renderToStaticMarkup(createElement(DiscoveryRunEvents, {
      stage: "success",
      steps: [],
      inFlight: false,
    }));
    expect(settled).toContain("data-discovery-run-empty");
    expect(settled).toContain("没有留下过程记录");
  });
});
