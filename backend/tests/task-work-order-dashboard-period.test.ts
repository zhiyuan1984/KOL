import { describe, expect, it } from "vitest";
import { dashboardDeltas, dashboardPeriod, dashboardTrendPointCount, type DashboardMetrics } from "../src/ticket-domain/task-work-orders.js";

function metrics(overrides: Partial<DashboardMetrics> = {}): DashboardMetrics {
  return {
    total: 10,
    in_progress: 4,
    completion_rate: 40,
    overdue_rate: 10,
    automatic_rate: 25,
    median_processing_hours: 12,
    overdue: 1,
    blocked: 0,
    ...overrides,
  };
}

describe("task-work-order dashboard period", () => {
  it("accepts every documented period and defaults to realtime", () => {
    expect(dashboardPeriod()).toBe("realtime");
    expect(["realtime", "today", "week", "month", "year"].map((period) => dashboardPeriod(period))).toEqual(["realtime", "today", "week", "month", "year"]);
  });

  it("rejects an invalid period instead of silently changing report scope", () => {
    expect(() => dashboardPeriod("quarter")).toThrow(/invalid_dashboard_period/);
  });

  it("uses the documented point count for every trend period", () => {
    expect(dashboardTrendPointCount("today")).toBe(24);
    expect(dashboardTrendPointCount("week")).toBe(7);
    expect(dashboardTrendPointCount("month")).toBe(30);
    expect(dashboardTrendPointCount("year")).toBe(12);
    expect(dashboardTrendPointCount("realtime")).toBe(7);
  });

  it("calculates processing-duration deltas as hours and preserves an absent previous value", () => {
    expect(dashboardDeltas(metrics({ median_processing_hours: 15.5 }), metrics({ median_processing_hours: 12.2 })).median_processing_hours).toBe(3.3);
    expect(dashboardDeltas(metrics({ median_processing_hours: 15.5 }), metrics({ median_processing_hours: null })).median_processing_hours).toBeNull();
  });
});
