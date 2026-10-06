import { describe, expect, it } from "vitest";
import { dashboardPeriod } from "../src/ticket-domain/task-work-orders.js";

describe("task-work-order dashboard period", () => {
  it("accepts every documented period and defaults to realtime", () => {
    expect(dashboardPeriod()).toBe("realtime");
    expect(["realtime", "today", "week", "month", "year"].map((period) => dashboardPeriod(period))).toEqual(["realtime", "today", "week", "month", "year"]);
  });

  it("rejects an invalid period instead of silently changing report scope", () => {
    expect(() => dashboardPeriod("quarter")).toThrow(/invalid_dashboard_period/);
  });
});
