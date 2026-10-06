import { describe, expect, it } from "vitest";
import { discoveryCardMode, discoveryStage, type DiscoveryStageInput } from "./discoveryPhase";

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
  });

  it("runs while the submit is polling or the Host run is in flight", () => {
    expect(discoveryStage({ ...base, polling: true })).toBe("running");
    expect(discoveryStage({ ...base, runInFlight: true, hasRun: true })).toBe("running");
  });

  it("settles into success once a run exists without a failure", () => {
    expect(discoveryStage({ ...base, hasRun: true })).toBe("success");
    expect(discoveryStage({ ...base, visibleCount: 3 })).toBe("success");
  });

  it("lets a settled failure outrank running and success", () => {
    const failed: DiscoveryStageInput = { ...base, failure: true };
    expect(discoveryStage(failed)).toBe("failure");
    expect(discoveryStage({ ...failed, polling: true })).toBe("failure");
    // rank_failed 保留了原始候选：仍然是失败页，候选照列。
    expect(discoveryStage({ ...failed, hasRun: true, visibleCount: 2 })).toBe("failure");
  });
});

describe("discovery condition card mode", () => {
  it("is editable before the first submit", () => {
    expect(discoveryCardMode({ submitted: false, editing: false })).toBe("edit");
  });

  it("stays in the stream read-only after a submit", () => {
    // 提交后卡片不消失：原位转只读，历史事件保持顺序。
    expect(discoveryCardMode({ submitted: true, editing: false })).toBe("readonly");
  });

  it("returns to edit in place on demand and back to read-only after the next submit", () => {
    expect(discoveryCardMode({ submitted: true, editing: true })).toBe("edit");
    expect(discoveryCardMode({ submitted: true, editing: false })).toBe("readonly");
  });
});
