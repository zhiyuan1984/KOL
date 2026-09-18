import { describe, expect, it } from "vitest";
import { bannedModelPretendLabel, mailDigestView } from "./digestView";

describe("mailDigestView", () => {
  it("labels trusted model memory as 往来要点", () => {
    const view = mailDigestView({ source: "codex_memory", text: "对方已确认档期" });
    expect(view.label).toBe("往来要点");
    expect(view.kind).toBe("model");
    expect(view.collapsed).toBe(false);
    expect(view.label).not.toBe(bannedModelPretendLabel());
  });

  it("labels luna the same as 往来要点", () => {
    expect(mailDigestView({ source: "luna", text: "要点" }).label).toBe("往来要点");
  });

  it("collapses rule extracts", () => {
    const view = mailDigestView({ source: "body_analysis", text: "规则摘了一句" });
    expect(view.label).toBe("规则摘录");
    expect(view.kind).toBe("rule");
    expect(view.collapsed).toBe(true);
  });

  it("shows 分析未完成 without pretending to be a model", () => {
    const view = mailDigestView({ source: "analysis_failed", text: "should hide", error: "timeout" });
    expect(view.label).toBe("分析未完成 · timeout");
    expect(view.text).toBe("");
    expect(view.kind).toBe("failed");
  });
});
