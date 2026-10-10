import { describe, expect, it } from "vitest";
import type { RuntimeActionView } from "../api";
import { discoveryParamCheck, discoveryParamsStale } from "./discoveryParams";
import { discoveryStartAction, discoveryStartPhase } from "./discoveryStart";
import { defaultDiscoveryBrief } from "./discoveryTemplate";

function action(overrides: Partial<RuntimeActionView> = {}): RuntimeActionView {
  return {
    id: "act_1",
    skill_id: "crawler_collect",
    operation: "start_crawl",
    arguments: {},
    state: "pending",
    risk: "L3",
    confirmation_version: "v1",
    blocked_reason: null,
    receipt: null,
    error_code: null,
    ...overrides,
  };
}

describe("discovery start phase", () => {
  it("picks the latest start_crawl action", () => {
    const stop = action({ id: "act_stop", operation: "stop_crawl" });
    const first = action({ id: "act_1" });
    const second = action({ id: "act_2" });
    expect(discoveryStartAction([stop])).toBeNull();
    expect(discoveryStartAction([first, second])?.id).toBe("act_2");
  });

  it("picks the newest proposal when the server answers newest-first", () => {
    // GET /api/queries/runtime.actions 是 ORDER BY created_at DESC（最新在前）。
    // 早先取 starts[length-1] 拿到的其实是最旧的一条：员工点「核对后重试」后
    // 服务端确实提出了新提案，确认卡却一直显示那条旧动作，按钮看着完全无效（图 2/图 3）。
    const stale = action({ id: "act_stale", state: "rejected", created_at: "2026-10-06T11:34:03.000Z" });
    const fresh = action({ id: "act_fresh", state: "pending", created_at: "2026-10-06T11:35:56.000Z" });
    expect(discoveryStartAction([fresh, stale])?.id).toBe("act_fresh");
    expect(discoveryStartAction([stale, fresh])?.id).toBe("act_fresh");
  });

  it("waits for the proposal before anything is confirmed", () => {
    expect(discoveryStartPhase(null, false)).toBe("waiting_proposal");
  });

  it("shows 已确认，正在启动 immediately after the employee confirms", () => {
    // 服务端回执还没回来：乐观相位立刻变成 dispatching（确认按钮随之消失，禁止重复提交）。
    expect(discoveryStartPhase(action(), true)).toBe("dispatching");
    expect(discoveryStartPhase(null, true)).toBe("dispatching");
  });

  it("maps server states without inventing progress", () => {
    expect(discoveryStartPhase(action(), false)).toBe("pending");
    expect(discoveryStartPhase(action({ execution: { id: "e1", status: "dispatching", error_code: null } }), false)).toBe("dispatching");
    expect(discoveryStartPhase(action({ execution: { id: "e1", status: "failed", error_code: "x" } }), false)).toBe("failed");
    expect(discoveryStartPhase(action({ state: "queued" }), false)).toBe("starting");
    expect(discoveryStartPhase(action({ state: "running" }), false)).toBe("running");
    expect(discoveryStartPhase(action({ state: "succeeded" }), false)).toBe("succeeded");
    expect(discoveryStartPhase(action({ state: "uncertain" }), false)).toBe("uncertain");
    expect(discoveryStartPhase(action({ state: "cancelled" }), false)).toBe("cancelled");
  });
  it("does not relabel uncertain execution or a saved rejection as starting", () => {
    expect(discoveryStartPhase(action({ execution: { id: "e1", status: "uncertain", error_code: "execution_handler_error" } }), false)).toBe("uncertain");
    expect(discoveryStartPhase(action({ state: "rejected", error_code: "runtime_action_snapshot_stale",
      execution: { id: "e1", status: "failed", error_code: "runtime_action_snapshot_stale" } }), false)).toBe("rejected");
  });
});

describe("discovery actual parameters", () => {
  it("lists only what the confirmed action really sends", () => {
    const brief = defaultDiscoveryBrief();
    const check = discoveryParamCheck({
      brief,
      args: {
        platforms: "youtube",
        crawler_type: "search",
        keywords: ["camping", "portable power station"],
        max_notes_count: 50,
        enable_comments: false,
        unknown_switch: "值",
      },
    });
    const byKey = new Map(check.executed.map((item) => [item.key, item]));
    expect(byKey.get("platforms")?.value).toBe("YouTube");
    expect(byKey.get("crawler_type")?.label).toBe("采集模式");
    expect(byKey.get("keywords")?.value).toBe("camping、portable power station");
    expect(byKey.get("max_notes_count")?.value).toBe("50");
    expect(byKey.get("enable_comments")?.value).toBe("关");
    // 未知键按原样列出，不隐藏也不翻译。
    expect(byKey.get("unknown_switch")?.label).toBe("unknown_switch");
  });

  it("keeps region, followers, plays and expected count as post-check conditions", () => {
    const brief = { ...defaultDiscoveryBrief(), max_followers: null };
    const check = discoveryParamCheck({ brief, args: null });
    expect(check.executed).toEqual([]);
    const keys = check.checkedAfter.map((item) => item.key);
    expect(keys).toEqual(["region", "directions", "followers", "min_avg_plays_10", "expect_count"]);
    expect(check.checkedAfter.find((item) => item.key === "followers")?.value).toBe("10,000–不限");
    expect(check.checkedAfter.find((item) => item.key === "expect_count")?.value).toBe("30");
  });

  it("marks the check stale once the card is edited after a submit", () => {
    expect(discoveryParamsStale({ submitted: false, editing: false })).toBe(false);
    expect(discoveryParamsStale({ submitted: true, editing: false })).toBe(false);
    expect(discoveryParamsStale({ submitted: true, editing: true })).toBe(true);
  });
});
