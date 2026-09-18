import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import {
  isOpenTask,
  isTodayActionableTodo,
  isTodoTask,
  openBucket,
  openBucketLabel,
  openPrimaryAction,
  sortOpenWorkItems,
  sortTodayTodos,
  todayBucket,
  todayContentLine,
  applyTodoLayout,
  applyLayoutWhy,
  briefPrimaryLabel,
  isPlanningTask,
} from "./homeModel";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return { source: "manual", status: "pending", ...partial };
}

describe("today pane buckets", () => {
  it("keeps parseHomeMode default and drops queued / open-with-no-due", async () => {
    const { HOME_MODES, parseHomeMode } = await import("./modes");
    expect(HOME_MODES).toEqual(["today", "todo", "discovery", "pool", "lifecycle"]);
    expect(parseHomeMode(null)).toBe("today");
    expect(parseHomeMode("pool")).toBe("pool");
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

  it("open list includes source=ai and puts queued/pending no-due in 后续", () => {
    const failed = task({
      id: "ai-failed",
      title: "记状态",
      source: "ai",
      status: "failed",
    });
    const queued = task({ id: "q", title: "queued", status: "queued" });
    const pending = task({ id: "p", title: "open no due", status: "pending" });
    const future = task({
      id: "later-due",
      title: "下周寄样",
      status: "pending",
      due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      updated_at: "2026-09-01T00:00:00.000Z",
    });
    expect(isOpenTask(failed)).toBe(true);
    expect(openBucket(failed)).toBe("high_risk");
    expect(isOpenTask(queued)).toBe(true);
    expect(openBucket(queued)).toBe("later");
    expect(openBucket(pending)).toBe("later");
    expect(openBucket(future)).toBe("later");
    expect(openBucketLabel("later")).toBe("后续");
    expect(openPrimaryAction("later")).toBe("打开");
    expect(openPrimaryAction("approval")).toBe("去审批");
    expect(openPrimaryAction("high_risk")).toBe("处理");
    expect(isOpenTask(task({ id: "done", title: "完", status: "completed" }))).toBe(false);
    expect(sortOpenWorkItems([future, queued, failed]).map((row) => row.id)).toEqual(["ai-failed", "later-due", "q"]);
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

  it("sorts open todos by todo_layout why/rank and hides planning work items", () => {
    const later = task({ id: "b", title: "后", status: "pending", updated_at: "2026-09-02T00:00:00.000Z" });
    const first = task({ id: "a", title: "先", status: "pending", updated_at: "2026-09-01T00:00:00.000Z" });
    const laid = applyTodoLayout([later, first], [
      { work_item_id: "a", rank: 1, why: "昨日未完成" },
      { work_item_id: "b", rank: 2, why: "批次空结果" },
    ]);
    expect(laid.map((row) => row.id)).toEqual(["a", "b"]);
    expect(laid[0].layout_why).toBe("昨日未完成");
    expect(isPlanningTask(task({ id: "p", title: "规划", task_type: "today_plan", source: "planning", status: "running" }))).toBe(true);
    expect(isOpenTask(task({ id: "p", title: "规划", task_type: "today_plan", source: "planning", status: "running" }))).toBe(false);
    expect(isTodoTask(task({ id: "p", title: "规划", task_type: "today_plan", source: "planning", status: "running" }))).toBe(false);
    expect(briefPrimaryLabel({ verb: "follow", label: "处理", object_type: "batch" })).toBe("重试采集");
    expect(briefPrimaryLabel({ verb: "retry_crawl", label: "待补阶段", object_type: "batch" })).toBe("重试采集");
    expect(briefPrimaryLabel({ verb: "open_batch", label: "打开批次", object_type: "batch" })).toBe("打开批次");
  });

  it("stamps layout_why without reordering today buckets", () => {
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
    const stamped = applyLayoutWhy([overdue, dueToday], [
      { work_item_id: "today", rank: 1, why: "本轮先写报价" },
      { work_item_id: "over", rank: 2, why: "昨日未完成" },
    ]);
    expect(stamped.map((row) => row.id)).toEqual(["over", "today"]);
    expect(stamped[0].layout_why).toBe("昨日未完成");
    expect(stamped[1].layout_why).toBe("本轮先写报价");
  });
});
