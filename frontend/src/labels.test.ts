import { describe, expect, it } from "vitest";
import { friendlyApiError } from "./labels";

function apiError(status: number, payload: unknown): Error & { status: number; payload: unknown } {
  return Object.assign(new Error(`请求失败 (${status})`), { status, payload });
}

describe("friendlyApiError", () => {
  it("turns the bare 403 code into employee copy with a next step", () => {
    const message = friendlyApiError(
      apiError(403, { detail: { code: "skill_not_granted", skill_id: "creator_discovery" } }),
    );
    expect(message).toContain("技能未授权");
    expect(message).toContain("联系管理员");
    expect(message).not.toContain("请求失败");
  });

  it("keeps an unknown failure's own message", () => {
    expect(friendlyApiError(new Error("请求失败 (502)"), "发现任务没有提交。")).toBe("请求失败 (502)");
  });

  it("falls back only when there is nothing readable, and keeps unknown codes as-is", () => {
    expect(friendlyApiError({}, "发现任务没有提交。")).toBe("发现任务没有提交。");
    expect(friendlyApiError(apiError(500, { detail: { code: "not_a_known_code" } }), "发现任务没有提交。"))
      .toBe("请求失败 (500)");
  });
});
