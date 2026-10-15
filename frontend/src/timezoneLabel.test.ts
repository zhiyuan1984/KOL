import { describe, expect, it } from "vitest";
import { timezoneLabel } from "./timezoneLabel";
describe("business timezone display", () => {
  it("shows Beijing time without exposing the internal Shanghai identifier", () => {
    const zone = "Asia/Shanghai";
    expect(timezoneLabel(zone)).toBe("北京时间（UTC+8）");
    expect(timezoneLabel(zone)).not.toContain("Asia/Shanghai");
    expect(zone).toBe("Asia/Shanghai");
    const hour = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, hour: "numeric", hour12: false }).formatToParts(new Date("2026-10-15T00:00:00Z")).find(part => part.type === "hour")?.value;
    expect(Number(hour)).toBe(8);
  });
  it("does not mislabel an explicitly different timezone as Beijing", () => {
    expect(timezoneLabel("UTC")).toBe("UTC");
  });
  it("keeps absent timezone honest instead of inventing a configured value", () => {
    expect(timezoneLabel(undefined)).toBe("—");
    expect(timezoneLabel(null, "未指定")).toBe("未指定");
  });
});
