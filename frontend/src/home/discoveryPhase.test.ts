import { describe, expect, it } from "vitest";
import { discoveryStage, isCardVisible, type DiscoveryStageInput } from "./discoveryPhase";

const base: DiscoveryStageInput = {
  polling: false,
  runInFlight: false,
  failure: false,
  visibleCount: 0,
  hasRun: false,
};

describe("discovery stage", () => {
  it("stays in compose while nothing has run", () => {
    expect(discoveryStage(base)).toBe("compose");
    expect(isCardVisible("compose", false)).toBe(true);
  });

  it("runs while the submit is polling or the Host run is in flight", () => {
    expect(discoveryStage({ ...base, polling: true })).toBe("running");
    expect(discoveryStage({ ...base, runInFlight: true, hasRun: true })).toBe("running");
    // 提交后卡片就收起来：中栏那之后是过程流的地盘。
    expect(isCardVisible("running", false)).toBe(false);
  });

  it("settles into success once a run exists without a failure", () => {
    expect(discoveryStage({ ...base, hasRun: true })).toBe("success");
    expect(discoveryStage({ ...base, visibleCount: 3 })).toBe("success");
    expect(isCardVisible("success", false)).toBe(false);
  });

  it("lets a settled failure outrank running and success", () => {
    const failed: DiscoveryStageInput = { ...base, failure: true };
    expect(discoveryStage(failed)).toBe("failure");
    expect(discoveryStage({ ...failed, polling: true })).toBe("failure");
    // rank_failed 保留了原始候选：仍然是失败页，候选照列。
    expect(discoveryStage({ ...failed, hasRun: true, visibleCount: 2 })).toBe("failure");
    expect(isCardVisible("failure", false)).toBe(false);
  });

  it("brings the condition card back only on demand", () => {
    expect(isCardVisible("success", true)).toBe(true);
    expect(isCardVisible("failure", true)).toBe(true);
    expect(isCardVisible("running", true)).toBe(true);
  });
});
