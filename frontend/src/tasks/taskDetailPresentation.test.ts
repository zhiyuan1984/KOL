import { describe, expect, it } from "vitest";
import { businessTaskStatusLabel, formatDetailTime } from "./taskDetailPresentation";
describe("task detail presentation", () => {
  it("preserves root state distinctions instead of reusing execution grouping", () => {
    expect(businessTaskStatusLabel("open")).toBe("待启动");
    expect(businessTaskStatusLabel("in_progress")).toBe("进行中");
    expect(businessTaskStatusLabel("blocked")).toBe("已阻塞");
    expect(businessTaskStatusLabel("waiting_external")).toBe("等待外部");
    expect(businessTaskStatusLabel("needs_review")).toBe("待复核");
    expect(businessTaskStatusLabel("future-state")).toBe("future-state");
  });
  it("does not depend on the machine's local timezone", () => {
    expect(formatDetailTime("2026-10-09T02:09:00Z")).toContain("10:09");
    expect(formatDetailTime("2026-10-09T02:09:00Z", "UTC")).toContain("02:09");
    expect(formatDetailTime("2026-10-09T02:09:00Z", "invalid-zone")).toContain("10:09");
  });
  it("retains invalid raw values and avoids invented timestamps", () => {
    expect(formatDetailTime("unparseable-source-value")).toBe("unparseable-source-value");
    expect(formatDetailTime(null)).toBe("—");
  });
});
