import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import { BOARD_FILTERS, matchesAttentionFilter, matchesBoardFilter, matchesBoardQuery } from "./taskBoardFilters";

const task = (patch: Partial<Task>): Task => ({ id: "task", title: "核对报价", status: "pending", ...patch } as Task);
describe("task board facets", () => {
  it("does not label unknown priority as general", () => {
    expect(matchesBoardFilter(task({}), "normal")).toBe(false);
    expect(matchesBoardFilter(task({}), "unclassified")).toBe(true);
    expect(matchesBoardFilter(task({ priority: "low" }), "normal")).toBe(true);
    expect(matchesBoardFilter(task({ priority_label: "紧急" }), "ui")).toBe(true);
  });
  it("partitions priority counts without mixing overlapping attention counts", () => {
    const rows = [task({ priority: "high" }), task({ priority: "normal" }), task({})];
    const total = BOARD_FILTERS.filter(filter => filter.id !== "all")
      .reduce((count, filter) => count + rows.filter(row => matchesBoardFilter(row, filter.id)).length, 0);
    expect(total).toBe(rows.length);
  });
  it("keeps an execution failure separate from overdue and excludes closed tasks", () => {
    const overdue = task({ due_at: "2000-01-01", execution: { status: "failed" } as Task["execution"] });
    expect(matchesAttentionFilter(overdue, "exception")).toBe(true);
    expect(matchesAttentionFilter(overdue, "overdue")).toBe(true);
    expect(overdue.status).toBe("pending");
    expect(matchesAttentionFilter({ ...overdue, status: "completed" }, "exception")).toBe(false);
    expect(matchesAttentionFilter({ ...overdue, status: "completed" }, "overdue")).toBe(false);
  });
  it("searches the current rows before calculating category counts", () => {
    const rows = [task({ id: "a", title: "报价 Alpha", priority: "high" }), task({ id: "b", title: "报价 Beta", priority: "normal" })];
    const searched = rows.filter(row => matchesBoardQuery(row, " ALPHA "));
    expect(searched.map(row => row.id)).toEqual(["a"]);
    expect(searched.filter(row => matchesBoardFilter(row, "in"))).toHaveLength(1);
    expect(searched.filter(row => matchesBoardFilter(row, "normal"))).toHaveLength(0);
    expect(matchesBoardQuery(rows[0], "")).toBe(true);
  });
  it("recognizes today's due date but not invalid deadlines", () => {
    expect(matchesAttentionFilter(task({ due_at: new Date().toISOString() }), "due_today")).toBe(true);
    expect(matchesAttentionFilter(task({ due_at: "invalid" }), "due_today")).toBe(false);
  });
});
