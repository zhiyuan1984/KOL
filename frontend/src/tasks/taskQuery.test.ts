import { describe, expect, it } from "vitest";
import { agentLifecycle, formatTaskTime, patchTaskQuery, readTaskQuery } from "./taskQuery";

describe("task operations query", () => {
  it("separates running from waiting while retaining old waiting deep links", () => {
    expect(agentLifecycle("running")).toBe("running");
    for (const status of ["waiting", "waiting_approval", "needs_clarification", "waiting_external", "needs_review"]) expect(agentLifecycle(status)).toBe("waiting");
    expect(readTaskQuery(new URLSearchParams("status=waiting_approval")).status).toBe("waiting");
  });
  it("keeps independent status, attention and source conditions across refresh", () => {
    const url = patchTaskQuery(new URLSearchParams("businessTask=keep&status=running"), { attention: "overdue", source: "agent", q: "报价" });
    expect(readTaskQuery(url)).toMatchObject({ status: "running", overdue: true, source: "agent", q: "报价" });
    expect(url.get("businessTask")).toBe("keep");
    const cleared = patchTaskQuery(url, { attention: null });
    expect(readTaskQuery(cleared)).toMatchObject({ status: "running", overdue: false, source: "agent" });
  });
  it("drops only explicitly cleared query fields, not task identities", () => {
    const url = patchTaskQuery(new URLSearchParams("businessTask=abc&task_type=creator_discovery&from=2026-10-01&status=failed"), { status: "all", source: "all" });
    expect(url.get("status")).toBeNull();
    expect(url.get("businessTask")).toBe("abc");
    expect(url.get("from")).toBe("2026-10-01");
  });
  it("formats server timezone rather than machine timezone", () => {
    expect(formatTaskTime("2026-10-09T06:02:00Z", "Asia/Shanghai")).toContain("14:02");
    expect(formatTaskTime("invalid", "Asia/Shanghai")).toBe("—");
    expect(formatTaskTime(null)).toBe("—");
  });
});
