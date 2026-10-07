import { describe, expect, it } from "vitest";
import { discoveryBizPhaseIndex, BIZ_PHASES } from "./discoveryBizPhase";
import type { DiscoveryProcessStep } from "./discoveryEvents";

const STEP = (kind: DiscoveryProcessStep["kind"]): DiscoveryProcessStep => ({
  id: `s-${kind}`,
  kind,
  label: kind,
});

describe("discoveryBizPhase", () => {
  it("exposes four business stages", () => {
    expect(BIZ_PHASES.map((p) => p.label)).toEqual(["理解需求", "搜索中", "去重打分", "完成"]);
  });

  it("stays at 理解需求 before any collection step", () => {
    expect(discoveryBizPhaseIndex({ steps: [], crawlState: null, stage: "compose" })).toBe(0);
    expect(discoveryBizPhaseIndex({
      steps: [STEP("step"), STEP("step")], crawlState: null, stage: "running",
    })).toBe(0);
  });

  it("moves to 搜索中 on collection steps or an active crawl job", () => {
    expect(discoveryBizPhaseIndex({
      steps: [STEP("search"), STEP("received")], crawlState: null, stage: "running",
    })).toBe(1);
    expect(discoveryBizPhaseIndex({ steps: [], crawlState: "running", stage: "running" })).toBe(1);
    expect(discoveryBizPhaseIndex({ steps: [], crawlState: "queued", stage: "running" })).toBe(1);
  });

  it("moves to 去重打分 on dedup/scoring steps", () => {
    expect(discoveryBizPhaseIndex({
      steps: [STEP("collecting"), STEP("deduped"), STEP("scoring")], crawlState: "running", stage: "running",
    })).toBe(2);
  });

  it("moves to 完成 on ranked or a succeeded crawl", () => {
    expect(discoveryBizPhaseIndex({
      steps: [STEP("ranked")], crawlState: "succeeded", stage: "success",
    })).toBe(3);
    expect(discoveryBizPhaseIndex({ steps: [], crawlState: "succeeded", stage: "running" })).toBe(3);
  });
});
