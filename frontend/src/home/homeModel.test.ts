import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import {
  isTodayActionableTodo,
  isTodoTask,
  sortTodayTodos,
  todayBucket,
  todayContentLine,
} from "./homeModel";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return { source: "manual", status: "pending", ...partial };
}

describe("today pane buckets", () => {
  it("keeps parseHomeMode default and drops queued / open-with-no-due", async () => {
    const { parseHomeMode } = await import("./modes");
    expect(parseHomeMode(null)).toBe("today");
    expect(isTodayActionableTodo(task({ id: "q", title: "queued", status: "queued" }))).toBe(false);
    expect(isTodayActionableTodo(task({ id: "p", title: "open no due", status: "pending" }))).toBe(false);
    expect(isTodayActionableTodo(task({ id: "ai-open", title: "ai pending no due", source: "ai", status: "pending" }))).toBe(false);
  });

  it("shows source=ai work items that fit a bucket without promote", () => {
    const failed = task({
      id: "ai-failed",
      title: "记状态",
      source: "ai",
      status: "failed",
    });
    const overdue = task({
      id: "ai-overdue",
      title: "失联跟进",
      source: "ai",
      status: "pending",
      due_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    expect(isTodoTask(failed)).toBe(false);
    expect(isTodoTask(overdue)).toBe(false);
    expect(isTodayActionableTodo(failed)).toBe(true);
    expect(isTodayActionableTodo(overdue)).toBe(true);
    expect(todayBucket(failed)).toBe("high_risk");
    expect(todayBucket(overdue)).toBe("overdue");
    expect(isTodayActionableTodo(task({ id: "ai-run", title: "扫描", source: "ai", status: "running" }))).toBe(true);
  });

  it("assigns exclusive buckets with high-risk winning overdue", () => {
    const overdueFailed = task({
      id: "risk",
      title: "记状态",
      status: "failed",
      due_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    const overdue = task({
      id: "over",
      title: "补样品",
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const dueToday = task({
      id: "today",
      title: "写报价",
      due_at: new Date().toISOString(),
    });
    const running = task({ id: "run", title: "扫描", status: "in_progress" });
    const approval = task({ id: "appr", title: "报价审批", status: "waiting_approval" });
    expect(todayBucket(overdueFailed)).toBe("high_risk");
    expect(todayBucket(overdue)).toBe("overdue");
    expect(todayBucket(dueToday)).toBe("due_today");
    expect(todayBucket(running)).toBe("running");
    expect(todayBucket(approval)).toBe("approval");
    expect(sortTodayTodos([approval, running, dueToday, overdueFailed, overdue]).map((row) => row.id))
      .toEqual(["risk", "over", "today", "run", "appr"]);
  });

  it("builds content from real fields only", () => {
    expect(todayContentLine(task({ id: "empty", title: "空" }))).toBe("");
    expect(todayContentLine(task({
      id: "full",
      title: "跟进",
      description: "描述",
      history_summary: "历史",
      next_action: "下一步",
      risk: "样品丢失",
    }))).toBe("描述 · 历史 · 下一步 · 样品丢失");
  });
});
