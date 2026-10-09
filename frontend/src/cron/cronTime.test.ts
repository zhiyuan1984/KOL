import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  compactFrequency,
  formatExactTime,
  formatNextTime,
  fromZonedInput,
  toZonedInput,
} from "./cronTime";

describe("cron time zone conversion", () => {
  it("uses Beijing by default and is independent of the browser local zone", () => {
    const instant = "2025-01-15T00:30:00.000Z";
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Shanghai");
    expect(formatExactTime(instant)).toBe("2025-01-15 08:30");
    expect(toZonedInput(instant)).toBe("2025-01-15T08:30");
    expect(fromZonedInput("2025-01-15T08:30")).toBe(instant);
  });

  it("round-trips a non-China IANA zone without consulting browser local time", () => {
    const instant = "2025-01-15T14:30:00.000Z";
    expect(toZonedInput(instant, "America/New_York")).toBe("2025-01-15T09:30");
    expect(fromZonedInput("2025-01-15T09:30", "America/New_York")).toBe(instant);
  });

  it("does not invent dates for malformed input or an invalid IANA zone", () => {
    expect(formatExactTime("not-a-date")).toBe("not-a-date");
    expect(formatExactTime("2025-02-30T00:00:00.000Z")).toBe("2025-02-30T00:00:00.000Z");
    expect(formatExactTime("2025-01-15T00:30:00.000Z", "Mars/Olympus")).toBe("2025-01-15T00:30:00.000Z");
    expect(toZonedInput("not-a-date")).toBe("");
    expect(() => fromZonedInput("2025-02-30T08:30")).toThrow("无效的本地日期时间");
    expect(() => fromZonedInput("2025-01-15T08:30", "Mars/Olympus")).toThrow("无效时区");
  });

  it("rejects nonexistent and ambiguous DST local times rather than shifting a job", () => {
    expect(() => fromZonedInput("2025-03-09T02:30", "America/New_York")).toThrow("不存在");
    expect(() => fromZonedInput("2025-11-02T01:30", "America/New_York")).toThrow("歧义");
  });
});

describe("formatNextTime", () => {
  const now = new Date("2025-12-31T15:30:00.000Z"); // Beijing: 2025-12-31 23:30

  it("uses Beijing calendar boundaries, including the year boundary", () => {
    expect(formatNextTime("2025-12-31T15:45:00.000Z", now)).toBe("今天 23:45");
    expect(formatNextTime("2025-12-31T16:15:00.000Z", now)).toBe("明天 00:15");
    expect(formatNextTime("2026-01-02T00:00:00.000Z", now)).toBe("2026-01-02 08:00");
  });

  it("keeps a numeric date for stale values instead of rounding elapsed days", () => {
    expect(formatNextTime("2025-12-30T16:01:00.000Z", now)).toBe("12-31 00:01");
    expect(formatNextTime("2024-12-30T16:00:00.000Z", now)).toBe("2024-12-31 00:00");
    expect(formatNextTime("broken", now)).toBe("broken");
  });
});

describe("compactFrequency", () => {
  it("humanises common cron expressions without changing unrecognised schedules", () => {
    expect(compactFrequency({ cron_expr: "*/10 * * * *" })).toBe("每10分钟");
    expect(compactFrequency({ cron_expr: "0 * * * *" })).toBe("每小时");
    expect(compactFrequency({ cron_expr: "15 9 * * *" })).toBe("每天 09:15");
    expect(compactFrequency({ cron_expr: "30 8 * * 1" })).toBe("每周一 08:30");
    expect(compactFrequency({ cron_expr: "0 8 1 * *" })).toBe("每月1日 08:00");
    expect(compactFrequency({ cron_expr: "0 8 1-5 * *" })).toBe("0 8 1-5 * *");
  });

  it("only drops the default Beijing label and retains every other zone marker", () => {
    expect(compactFrequency({ frequency: "每天 08:00（上海时间）", timezone: "Asia/Shanghai" })).toBe("每天 08:00");
    expect(compactFrequency({ frequency: "每天 08:00（Asia/Shanghai）" })).toBe("每天 08:00");
    expect(compactFrequency({ cron_expr: "0 8 * * *", timezone: "America/New_York" })).toBe("每天 08:00（America/New_York）");
    expect(compactFrequency({ frequency: "每天 08:00", timezone: "UTC" })).toBe("每天 08:00（UTC）");
  });

  it("prefers explicit once and interval schedules over cron and frequency", () => {
    expect(compactFrequency({
      cron_expr: "0 8 * * *",
      frequency: "每天 08:00（上海时间）",
      schedule: { kind: "once", once_at: "2025-02-01T00:00:00.000Z" },
    })).toBe("单次 2025-02-01 08:00");
    expect(compactFrequency({
      cron_expr: "0 8 * * *",
      condition: { schedule: { kind: "interval", interval_minutes: 90 } },
      timezone: "UTC",
    })).toBe("每隔 90 分钟（UTC）");
  });
});
