import { describe, expect, it } from "vitest";
import { businessTaskExportStatusLabel } from "../src/routers/tickets.js";

describe("business task CSV status labels", () => {
  it("exports employee-facing Chinese labels instead of raw state codes", () => {
    expect(businessTaskExportStatusLabel("in_progress")).toBe("处理中");
    expect(businessTaskExportStatusLabel("completed")).toBe("已完成");
    expect(businessTaskExportStatusLabel("cancelled")).toBe("已取消");
  });
});
