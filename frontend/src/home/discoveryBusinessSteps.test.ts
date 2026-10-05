import { describe, expect, it } from "vitest";
import { discoveryBusinessSteps } from "./discoveryBusinessSteps";
import type { HomeDiscoveryRun } from "./discoveryHome";
import type { DiscoveryProcessStep } from "./discoveryEvents";

const run: HomeDiscoveryRun = {
  id: "run-1", headline: "户外发现", status: "completed", brief_version: 1,
  raw_count: 33, shortlist_count: 16,
  created_at: "2026-09-30T09:30:07.000Z", started_at: "2026-09-30T09:30:12.000Z",
  completed_at: "2026-09-30T09:33:51.000Z",
  status_contract: {
    status: "completed", stage: "completed", title: "红人线索发现完成", message: "共找到 16 位符合条件的红人。",
    input_preserved: true, has_results: true, execution_started: true,
    retryable: false, retry_mode: "manual", next_retry_at: null,
    condition_snapshot: {
      platforms: ["youtube"], region: "global_en", directions: ["camping"],
      keywords: ["camping"], min_followers: 10000, max_followers: 2000000, min_avg_views_10: 5000,
    },
    progress: { collected: 33, parsed: null, deduplicated: null, matched: 16 },
    diagnostics: { service: "discovery", error_code: null, occurred_at: null, request_id: null, last_heartbeat: null },
  },
};

const trace: DiscoveryProcessStep[] = [
  { id: "c", kind: "conditions", label: "检索条件已确认", time: "17:30:07" },
  { id: "s", kind: "collecting", label: "正在采集", time: "17:30:12" },
  { id: "f", kind: "filtered", label: "原始 33 条，入围 16 位", time: "17:33:00" },
  { id: "r", kind: "ranked", label: "已排出候选", time: "17:33:51" },
];

describe("discovery business timeline", () => {
  it("explains submission, collection, thresholds and ranking with persisted timestamps", () => {
    const steps = discoveryBusinessSteps(run, trace, false);
    expect(steps.map((step) => step.id)).toEqual(["conditions", "collection", "filtering", "brief"]);
    expect(steps.map((step) => step.time)).toEqual(["17:30:07", "17:30:12", "17:33:00", "17:33:51"]);
    expect(steps[0].detail).toContain("YouTube · 全球英文 · 关键词 camping");
    expect(steps[2].detail).toContain("粉丝 10,000–2,000,000、近10均播 ≥5,000");
    expect(steps[2].detail).toContain("原始 33 条 → 暂留 16 位");
    expect(steps[2].title).toBe("条件初筛 · 16 位候选");
    expect(steps[2].detail).toContain("缺失指标不视为验证通过");
  });

  it("keeps a historical run useful without inventing the filter timestamp or dedup count", () => {
    const steps = discoveryBusinessSteps(run, [], false);
    expect(steps.map((step) => step.id)).toEqual(["conditions", "collection", "filtering", "brief"]);
    expect(steps[2].time).toBeUndefined();
    expect(steps[2].detail).not.toContain("已去重");
  });

  it("does not announce collection or matching when the service never started", () => {
    expect(discoveryBusinessSteps({ ...run, status: "crawl_failed", started_at: undefined,
      raw_count: null, shortlist_count: null, status_contract: null }, [], false))
      .toEqual([expect.objectContaining({ id: "conditions" }),
        expect.objectContaining({ id: "terminal", state: "failed" })]);
  });

  it("does not announce a ranked result when generation failed", () => {
    const steps = discoveryBusinessSteps({ ...run, status: "rank_failed" }, trace.slice(0, 3), false);
    expect(steps.map((step) => step.id)).toEqual(["conditions", "collection", "filtering", "terminal"]);
    expect(steps.at(-1)?.state).toBe("failed");
  });

  it("keeps a live collector count visible without presenting it as a completed result", () => {
    const progress = discoveryBusinessSteps({ ...run, status: "crawling", raw_count: null,
      shortlist_count: null, status_contract: null }, [
      { id: "s", kind: "collecting", label: "正在采集", time: "17:30:12" },
      { id: "p", kind: "collecting", label: "已采集 15 条", count: 15, time: "17:32:46" },
    ], true);
    expect(progress[1]).toMatchObject({ title: "正在采集 · 已见 15 条", state: "running" });
    expect(progress[1].detail).toContain("尚非最终入围数");
  });

  it("marks a failed or stopped crawl as not completed, including its terminal milestone", () => {
    for (const status of ["crawl_failed", "cancelled"]) {
      const steps = discoveryBusinessSteps({ ...run, status, raw_count: null, shortlist_count: null,
        status_contract: null }, [{ id: "s", kind: "collecting", label: "正在采集" }], false);
      expect(steps[1].state).toBe(status === "cancelled" ? "stopped" : "failed");
      expect(steps.at(-1)?.state).toBe(steps[1].state);
      expect(steps.some((step) => step.state === "done" && step.id === "collection")).toBe(false);
    }
  });

  it("separates uncertain matches from those needing a human review", () => {
    expect(discoveryBusinessSteps(run, trace, false, 3)[2].detail)
      .toContain("当前已加载线索中 3 位待人工复核");
  });
});
