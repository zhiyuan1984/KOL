import { describe, expect, it } from "vitest";
import {
  applyChipOverride,
  canSubmitDiscovery,
  defaultDiscoveryBrief,
  DISCOVERY_BODY_PREFIX,
  DISCOVERY_NO_SIDE_EFFECT,
  fallbackDiscoveryTemplate,
  isDomesticPlatform,
  parseDiscoveryBody,
  sameClassConflict,
  toggleDirection,
  togglePlatform,
} from "./discoveryTemplate";
import { discoveryEventCopy, presentDiscoveryEvents } from "./discoveryEvents";
import { asHomeRun, ingestFailureKind, runCountsLabel, runFailed, runFailureReason, displayMetric, displayText } from "./discoveryHome";

describe("discovery template fallback", () => {
  it("starts with 【发现任务】 and forbids mail/stage/fake email", () => {
    const template = fallbackDiscoveryTemplate();
    expect(template.body.startsWith(DISCOVERY_BODY_PREFIX)).toBe(true);
    expect(template.body).toContain(DISCOVERY_NO_SIDE_EFFECT);
    expect(template.body).toContain("不会发信");
    expect(template.body).toContain("不会改阶段");
    expect(template.body).toContain("不会编造邮箱");
    expect(template.platforms.map((row) => row.code)).toEqual(["youtube", "instagram", "facebook"]);
    expect(template.regions.map((row) => row.code)).toEqual(["na", "eu", "sea", "jpkr", "mena", "latam", "global_en"]);
    expect(template.directions).toHaveLength(8);
    expect(template.directions.find((row) => row.code === "beauty")?.keywords).toEqual([
      "beauty", "makeup", "skincare", "cosmetics",
    ]);
    expect(template.defaults.min_followers).toBe(10000);
    expect(template.defaults.max_followers).toBe(2000000);
    expect(template.defaults.min_avg_plays_10).toBe(5000);
    expect(template.defaults.expect_count).toBe(30);
  });

  it("rejects domestic platforms and disables send without keywords", () => {
    expect(isDomesticPlatform("douyin")).toBe(true);
    expect(isDomesticPlatform("xhs")).toBe(true);
    expect(togglePlatform(["youtube"], "youtube")).toEqual([]);
    expect(canSubmitDiscovery({ platforms: [], keywords: ["beauty"] })).toBe(false);
    expect(canSubmitDiscovery({ platforms: ["youtube"], keywords: [] })).toBe(false);
    expect(canSubmitDiscovery(defaultDiscoveryBrief())).toBe(true);
    expect(toggleDirection(["beauty", "fashion", "fitness", "food", "tech", "home", "parenting", "auto"], "beauty").atMax).toBe(false);
  });

  it("lets chips override the same-class body line", () => {
    const brief = defaultDiscoveryBrief();
    const body = `${DISCOVERY_BODY_PREFIX}\n平台：Instagram\n地区：欧洲\n关键词：beauty`;
    expect(sameClassConflict(parseDiscoveryBody(body), brief)).toBe(true);
    const next = applyChipOverride(body, { ...brief, platforms: ["youtube"], region: "na" });
    expect(next).toContain("平台：YouTube");
    expect(next).toContain("地区：北美");
    expect(next.startsWith(DISCOVERY_BODY_PREFIX)).toBe(true);
  });
});

describe("discovery event copy", () => {
  it("maps process events to the required employee copy", () => {
    const steps = presentDiscoveryEvents([
      { type: "queued" },
      { type: "search_started" },
      { type: "received", count: 40 },
      { type: "deduped", count: 28 },
      { type: "scoring" },
      { type: "ranked" },
    ]);
    expect(steps.map((row) => row.label)).toEqual([
      "排队",
      "开始搜索关键词",
      "已收到 40 条",
      "采集结束去重后 28 条",
      "正在打分",
      "已排出候选",
    ]);
    expect(discoveryEventCopy({ type: "failed", message: "采集超时" })?.label).toBe("失败原因：采集超时");
  });
});

describe("discovery metrics", () => {
  it("never treats missing or zero as a real follower count", () => {
    expect(displayMetric(null)).toBe("无");
    expect(displayMetric(0)).toBe("无");
    expect(displayMetric(153000)).toBe("153k");
    expect(displayText("")).toBe("无");
    expect(runCountsLabel({ id: "r1", headline: "x", raw_count: null, shortlist_count: 3, status: "ok", brief_version: 1 }, 3))
      .toBe("原始 无 · 入围 3");
    expect(asHomeRun({ run_id: "drun_1", brief: { headline: "北美美妆" }, candidate_count: 2, brief_version: 3 })?.id)
      .toBe("drun_1");
    expect(asHomeRun({ id: "drun_1", brief_version: 3 })?.brief_version).toBe(3);
  });
});

describe("discovery run failures", () => {
  it("keeps the Host failure reason on the run instead of reporting a filter miss", () => {
    const failed = asHomeRun({
      id: "drun_41afcbef680d",
      status: "crawl_failed",
      error: "远程采集服务未配置。",
      candidate_count: 0,
    });
    expect(failed?.error).toBe("远程采集服务未配置。");
    expect(runFailed(failed)).toBe(true);
    expect(runFailureReason(failed)).toBe("远程采集服务未配置。");
  });

  it("reads the engine aliases and flags a reasonless failure", () => {
    expect(asHomeRun({ id: "drun_2", status: "rank_failed", failure_reason: "打分失败" })?.error).toBe("打分失败");
    expect(runFailureReason({ id: "drun_3", headline: "", raw_count: null, shortlist_count: null, status: "crawl_failed", brief_version: 1 }))
      .toBe("");
  });

  it("does not treat completed, cancelled, or running runs as failures", () => {
    for (const status of ["completed", "cancelled", "queued", "crawling", "ranking"]) {
      const run = { id: "drun_4", headline: "", raw_count: 0, shortlist_count: 0, status, brief_version: 1 };
      expect(runFailed(run)).toBe(false);
      expect(runFailureReason(run)).toBe(null);
    }
    // A cancelled job can carry the engine's stop reason; it is still not a failure.
    const cancelled = { id: "drun_5", headline: "", raw_count: null, shortlist_count: null, status: "cancelled", brief_version: 1, error: "stopped by user" };
    expect(runFailed(cancelled)).toBe(false);
    expect(runFailureReason(cancelled)).toBe(null);
    expect(runFailureReason(null)).toBe(null);
  });
});

describe("discovery ingest failures", () => {
  it("classifies 404 / 422 / 409 without treating them as success", () => {
    expect(ingestFailureKind({ status: 404 })).toBe("missing");
    expect(ingestFailureKind({ status: 422, payload: { status: "needs_confirmation" } })).toBe("needs_confirmation");
    expect(ingestFailureKind({
      status: 409,
      payload: { detail: { code: "brief_version_mismatch", brief_version: 2 } },
    })).toBe("brief_mismatch");
    expect(ingestFailureKind({
      status: 409,
      payload: { detail: { code: "l3_cancelled", message: "该确认已取消，未写入达人库。" } },
    })).toBe("cancelled");
    expect(ingestFailureKind({
      status: 409,
      payload: { detail: { code: "l3_voided" } },
    })).toBe("voided");
    expect(ingestFailureKind({ status: 409 })).toBe("other");
    expect(ingestFailureKind({ status: 500 })).toBe("other");
  });
});
