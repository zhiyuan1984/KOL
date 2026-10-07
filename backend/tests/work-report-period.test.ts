import { describe, expect, it } from "vitest";
import { periodRange, previousPeriodRange } from "../src/routers/work-report.js";

const TZ = "Asia/Shanghai";

describe("work report period windows", () => {
  it("day window is the selected date in the report timezone", () => {
    expect(periodRange("2026-10-08", TZ, "day")).toEqual({
      start: "2026-10-07T16:00:00.000Z",
      end: "2026-10-08T16:00:00.000Z",
    });
  });

  it("week window is Monday to Sunday containing the date", () => {
    // 2026-10-08 is a Thursday; week is 10-05 (Mon) .. 10-11 (Sun).
    expect(periodRange("2026-10-08", TZ, "week")).toEqual({
      start: "2026-10-04T16:00:00.000Z",
      end: "2026-10-11T16:00:00.000Z",
    });
    // Sunday belongs to the same week.
    expect(periodRange("2026-10-11", TZ, "week").start).toBe("2026-10-04T16:00:00.000Z");
    // Monday starts a new week.
    expect(periodRange("2026-10-12", TZ, "week").start).toBe("2026-10-11T16:00:00.000Z");
  });

  it("month window is the natural calendar month", () => {
    expect(periodRange("2026-10-08", TZ, "month")).toEqual({
      start: "2026-09-30T16:00:00.000Z",
      end: "2026-10-31T16:00:00.000Z",
    });
    // January rolls back to the previous year.
    expect(periodRange("2026-01-15", TZ, "month").start).toBe("2025-12-31T16:00:00.000Z");
  });

  it("previous window is exactly one period before", () => {
    expect(previousPeriodRange("2026-10-08", TZ, "day")).toEqual({
      start: "2026-10-06T16:00:00.000Z",
      end: "2026-10-07T16:00:00.000Z",
    });
    expect(previousPeriodRange("2026-10-08", TZ, "week")).toEqual({
      start: "2026-09-27T16:00:00.000Z",
      end: "2026-10-04T16:00:00.000Z",
    });
    expect(previousPeriodRange("2026-10-08", TZ, "month")).toEqual({
      start: "2026-08-31T16:00:00.000Z",
      end: "2026-09-30T16:00:00.000Z",
    });
  });
});
