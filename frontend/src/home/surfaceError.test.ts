import { describe, expect, it } from "vitest";
import { surfaceDownView, surfaceErrorView } from "./surfaceError";

describe("home surface failure copy", () => {
  it("never shows the raw HTTP line as the headline", () => {
    const view = surfaceErrorView("请求失败 (502)", "跟进列表读取失败");
    expect(view.message).toBe("上游服务暂时不可用，稍后可重试。");
    expect(view.message).not.toContain("502");
    expect(view.detail).toBe("请求失败 (502)");
  });

  it("maps deny / timeout / offline apart", () => {
    expect(surfaceErrorView("authentication required", "跟进列表读取失败").message)
      .toBe("当前账号没有读取权限，请联系管理员。");
    expect(surfaceErrorView("请求超时或网络中断，请稍后重试", "跟进列表读取失败").message)
      .toBe("请求超时，服务没有在时限内响应。");
    expect(surfaceErrorView("Failed to fetch", "公海读取失败").message)
      .toBe("网络中断，这次没有读到数据。");
  });

  it("keeps the surface's own fallback for unknown failures", () => {
    const view = surfaceErrorView(new Error("boom"), "公海读取失败");
    expect(view.message).toBe("公海读取失败");
    expect(view.detail).toBe("boom");
  });

  it("carries retry + handoff actions into the pane view", () => {
    const onRetry = () => undefined;
    const onHandoff = () => undefined;
    const view = surfaceDownView("请求失败 (503)", "公海读取失败", { retrying: true, onRetry, onHandoff });
    expect(view).toMatchObject({
      message: "上游服务暂时不可用，稍后可重试。",
      detail: "请求失败 (503)",
      retrying: true,
      onRetry,
      onHandoff,
    });
  });
});
