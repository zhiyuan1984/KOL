import { describe, expect, it } from "vitest";
import type { AdminWorkReport } from "../api";
import {
  buildSummaryText,
  flattenEvidence,
  formatDelta,
  interventionRank,
  isOverdue,
  overdueLabel,
  periodLabel,
  periodWindowLabel,
  sortInterventions,
  type Intervention,
} from "./adminWorkReportModel";

const NOW = new Date("2026-10-08T08:00:00+08:00").getTime();

function intervention(partial: Partial<Intervention> & { ticket_id: string }): Intervention {
  return {
    title: partial.ticket_id,
    status: "waiting",
    owner_name: null,
    owner_user_id: "u1",
    due_at: null,
    occurred_at: "2026-10-08T00:00:00.000Z",
    ticket_kind: "general",
    ...partial,
  };
}

describe("isOverdue", () => {
  it("past due date on an open ticket is overdue", () => {
    expect(isOverdue("2026-10-07T08:00:00+08:00", "waiting", NOW)).toBe(true);
  });
  it("future due date is not overdue", () => {
    expect(isOverdue("2026-10-09T08:00:00+08:00", "waiting", NOW)).toBe(false);
  });
  it("missing due date is not overdue", () => {
    expect(isOverdue(null, "waiting", NOW)).toBe(false);
  });
  it("terminal statuses are never overdue", () => {
    for (const status of ["failed", "cancelled", "completed"]) {
      expect(isOverdue("2026-10-01T00:00:00Z", status, NOW)).toBe(false);
    }
  });
});

describe("interventionRank", () => {
  it("orders waiting_approval > overdue > failed > waiting > cancelled", () => {
    expect(interventionRank("waiting_approval", false)).toBeLessThan(interventionRank("waiting", true));
    expect(interventionRank("waiting", true)).toBeLessThan(interventionRank("failed", false));
    expect(interventionRank("failed", false)).toBeLessThan(interventionRank("waiting", false));
    expect(interventionRank("waiting", false)).toBeLessThan(interventionRank("cancelled", false));
  });
});

describe("sortInterventions", () => {
  it("sorts by intervention priority, then due date", () => {
    const items = [
      intervention({ ticket_id: "c1", status: "cancelled" }),
      intervention({ ticket_id: "w1", status: "waiting", due_at: "2026-10-09T08:00:00+08:00" }),
      intervention({ ticket_id: "f1", status: "failed" }),
      intervention({ ticket_id: "o1", status: "waiting", due_at: "2026-10-06T08:00:00+08:00" }),
      intervention({ ticket_id: "a1", status: "waiting_approval" }),
    ];
    const sorted = sortInterventions(items, NOW).map((item) => item.ticket_id);
    expect(sorted).toEqual(["a1", "o1", "f1", "w1", "c1"]);
  });
});

describe("formatDelta", () => {
  it("formats up/down/flat", () => {
    expect(formatDelta(10, 7)).toEqual({ text: "▲+3", tone: "up" });
    expect(formatDelta(5, 7)).toEqual({ text: "▼-2", tone: "down" });
    expect(formatDelta(7, 7)).toEqual({ text: "持平", tone: "flat" });
  });
  it("returns null without a previous value", () => {
    expect(formatDelta(7, null)).toBeNull();
    expect(formatDelta(7, undefined)).toBeNull();
  });
});

describe("overdueLabel", () => {
  it("renders days and hours", () => {
    expect(overdueLabel("2026-10-06T08:00:00+08:00", NOW)).toBe("已逾期 2 天");
    expect(overdueLabel("2026-10-08T05:30:00+08:00", NOW)).toBe("已逾期 2 小时");
  });
});

describe("flattenEvidence", () => {
  it("renders key-value pairs and truncates nested objects", () => {
    const entries = flattenEvidence({ receipt: "人工核验", detail: { a: 1, b: "x".repeat(200) }, empty: null });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ key: "receipt", value: "人工核验" });
    expect(entries[1].value.endsWith("…")).toBe(true);
    expect(entries[2]).toEqual({ key: "empty", value: "—" });
  });
  it("returns empty for null", () => {
    expect(flattenEvidence(null)).toEqual([]);
  });
});

describe("periodLabel / periodWindowLabel", () => {
  it("labels day/week/month", () => {
    expect(periodLabel("day")).toBe("今日");
    expect(periodLabel("week")).toBe("本周");
    expect(periodLabel("month")).toBe("本月");
  });
  it("formats window labels in the report timezone", () => {
    expect(periodWindowLabel({ period: "day", start: "2026-10-07T16:00:00.000Z", end: "2026-10-08T16:00:00.000Z" }, "Asia/Shanghai")).toBe("10月8日");
    expect(
      periodWindowLabel({ period: "week", start: "2026-10-04T16:00:00.000Z", end: "2026-10-11T16:00:00.000Z" }, "Asia/Shanghai"),
    ).toBe("10月5日～10月11日");
  });
});

function fakeReport(): AdminWorkReport {
  return {
    report_version: "daily-work-report.v1",
    as_of: "2026-10-08T08:00:00.000Z",
    data_cutoff_at: "2026-10-08T08:00:00.000Z",
    period: { date: "2026-10-08", timezone: "Asia/Shanghai", period: "day", start: "2026-10-07T16:00:00.000Z", end: "2026-10-08T16:00:00.000Z" },
    filters: { owner: null, kind: null, team: null },
    filter_options: { owners: [], kinds: [], teams: [] },
    summary: { accepted: 10, accepted_attributed: 9, accepted_unattributed: 1, previous_accepted: 7, processing: 3, waiting: 2, exception: 1 },
    accepted_by_kind: [{ kind: "general", count: 10 }],
    employees: [],
    process: {
      blockers: [
        { kind: "blocker", ticket_id: "b1", title: "t", status: "waiting_approval", owner_user_id: "u1", owner_name: "张三", due_at: null, occurred_at: "2026-10-08T01:00:00.000Z", ticket_kind: "general" },
        { kind: "blocker", ticket_id: "b2", title: "t", status: "failed", owner_user_id: "u1", owner_name: null, due_at: null, occurred_at: "2026-10-08T01:00:00.000Z", ticket_kind: "general" },
      ],
      activity: [],
    },
    attribution: { accepted_owner: "", accepted_actor: "", legacy_accepted: 1, legacy_note: null, team_scope_note: null },
    contribution_note: "",
    source_refs: [],
  };
}

describe("buildSummaryText", () => {
  it("includes period, counts, delta and intervention breakdown", () => {
    const text = buildSummaryText(fakeReport(), "10-08 16:00");
    expect(text).toContain("【工作战报】2026-10-08（今日）");
    expect(text).toContain("验收 10（较上期▲+3）");
    expect(text).toContain("处理中 3 · 等待 2 · 失败/取消 1");
    expect(text).toContain("需处理 2 项：等审批 1 · 已逾期 0 · 失败 1 · 等待中 0");
    expect(text).toContain("口径：验收以验收事实计");
  });
});
