import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import { scopeRows } from "./scopeRows";

function task(id: string, fields: Partial<Task> = {}): Task {
  return { id, title: id, source: "manual", status: "pending", ...fields };
}

describe("scopeRows authoritative unfinished task projections", () => {
  it("keeps today's tasks in My Todo alongside future and undated work", () => {
    const rows = [task("today", { plan_view: "today" }), task("later", { plan_view: "todo" }), task("undated")];
    expect(new Set(scopeRows("todo", rows).map((row) => row.id))).toEqual(new Set(["today", "later", "undated"]));
    expect(scopeRows("today", rows).map((row) => row.id)).toEqual(["today"]);
  });

  it("excludes all terminal work, including discovery history, and planning records", () => {
    const rows = [
      task("open"),
      ...["completed", "done", "cancelled"].map((status) => task(status, { status, task_type: "discovery_crawl", discovery_run_id: `run-${status}` })),
      task("ordinary-completed", { status: "completed" }),
      task("dismissed", { dismissed_at: new Date().toISOString() }),
      task("planning", { task_type: "today_plan", source: "planning" }),
    ];
    expect(scopeRows("todo", rows).map((row) => row.id)).toEqual(["open"]);
  });
});
