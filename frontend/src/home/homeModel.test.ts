import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import {
  isOpenTask,
  isTodayActionableTodo,
  isTodoTask,
  openBucket,
  openBucketLabel,
  openPrimaryAction,
  riskLevelLabel,
  sortOpenWorkItems,
  sortTodayTodos,
  sortedTasks,
  taskDisplayStatus,
  taskPriorityLabel,
  taskPriorityRank,
  todayBucket,
  todayContentLine,
  applyTodoLayout,
  applyLayoutWhy,
  briefPrimaryLabel,
  isPlanningTask,
  todoPaneRows,
} from "./homeModel";
import { isTodayScheduled } from "./schedule";
import { groupDisplayTasks, projectDisplayTasks } from "./displayTasks";

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

  it("shows open todo rows immediately without waiting for layout", () => {
    const due = task({ id: "tsk_due", title: "写报价", status: "waiting", due_at: new Date().toISOString() });
    const later = task({ id: "tsk_later", title: "画像补全", status: "queued" });
    expect(todoPaneRows([due, later], "all").map((row) => row.id)).toEqual(["tsk_due", "tsk_later"]);
    expect(todoPaneRows([due, later], "all", []).map((row) => row.id)).toEqual(["tsk_due", "tsk_later"]);
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

describe("priority severity rank and labels", () => {
  it("ranks canonical codes 重要紧急 first and tolerates legacy codes", () => {
    expect(taskPriorityRank({ priority: "important_urgent" })).toBe(0);
    expect(taskPriorityRank({ priority: "important" })).toBe(1);
    expect(taskPriorityRank({ priority: "urgent" })).toBe(0);
    expect(taskPriorityRank({ priority: "high" })).toBe(1);
    expect(taskPriorityRank({ priority: "normal" })).toBe(3);
    expect(taskPriorityRank({ priority: "low" })).toBe(4);
    expect(taskPriorityRank({})).toBe(5);
    expect(taskPriorityRank({ priority: "urgent", priority_label: "紧急" })).toBe(2);
    expect(taskPriorityRank({ priority: "high", priority_label: "重要" })).toBe(1);
  });

  it("labels canonical and legacy codes, preferring backend label", () => {
    expect(taskPriorityLabel({ priority: "important_urgent" })).toBe("重要紧急");
    expect(taskPriorityLabel({ priority: "high" })).toBe("重要");
    expect(taskPriorityLabel({ priority: "urgent" })).toBe("重要紧急");
    expect(taskPriorityLabel({ priority: "urgent", priority_label: "紧急" })).toBe("紧急");
    expect(taskPriorityLabel({ priority: "low" })).toBe("低");
    expect(taskPriorityLabel({})).toBe("");
    expect(riskLevelLabel({ risk_level: "high" })).toBe("高");
    expect(riskLevelLabel({})).toBe("无");
  });
});

describe("today scheduling union", () => {
  const todayStr = () => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

  it("puts high-priority, start-today, due, running, approval and high-risk tasks in today", () => {
    expect(isTodayScheduled(task({ id: "p0", title: "重要紧急", priority: "important_urgent" }))).toBe(true);
    expect(isTodayScheduled(task({ id: "p1", title: "重要", priority: "important" }))).toBe(true);
    expect(isTodayScheduled(task({ id: "p2", title: "紧急", priority: "urgent", priority_label: "紧急" }))).toBe(true);
    expect(isTodayScheduled(task({ id: "s0", title: "今天开始", start_date: todayStr() }))).toBe(true);
    expect(isTodayScheduled(task({
      id: "o0",
      title: "逾期",
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    }))).toBe(true);
    expect(isTodayScheduled(task({ id: "d0", title: "今天到期", due_at: new Date().toISOString() }))).toBe(true);
    expect(isTodayScheduled(task({ id: "r0", title: "进行中", status: "running" }))).toBe(true);
    expect(isTodayScheduled(task({ id: "a0", title: "等审批", status: "waiting_approval" }))).toBe(true);
    expect(isTodayScheduled(task({ id: "h0", title: "高风险", risk_level: "high" }))).toBe(true);
  });

  it("keeps normal future or undated open tasks out of today, and closed tasks out", () => {
    expect(isTodayScheduled(task({
      id: "f0",
      title: "下周寄样",
      due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    }))).toBe(false);
    expect(isTodayScheduled(task({ id: "n0", title: "无日期", priority: "normal" }))).toBe(false);
    expect(isTodayScheduled(task({ id: "c0", title: "已完成", priority: "important_urgent", status: "completed" }))).toBe(false);
  });

  it("sorts today and open lists by priority severity first", () => {
    const urgentApproval = task({ id: "ua", title: "紧急审批", priority: "important_urgent", status: "waiting_approval" });
    const lowOverdue = task({
      id: "lo",
      title: "低优先逾期",
      priority: "low",
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(sortTodayTodos([lowOverdue, urgentApproval]).map((row) => row.id)).toEqual(["ua", "lo"]);
    expect(sortOpenWorkItems([lowOverdue, urgentApproval]).map((row) => row.id)).toEqual(["ua", "lo"]);
    expect(sortedTasks([lowOverdue, urgentApproval], "priority").map((row) => row.id)).toEqual(["ua", "lo"]);
  });
});

describe("display status labels", () => {
  it("uses backend labels first and derives 延期/临期 from real dates", () => {
    expect(taskDisplayStatus(task({
      id: "b0",
      title: "后端标签",
      display_status: "overdue",
      display_status_label: "延期",
    }))?.label).toBe("延期");
    const overdue = taskDisplayStatus(task({
      id: "b1",
      title: "真实逾期",
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    }));
    expect(overdue).toEqual({ code: "overdue", label: "延期" });
    expect(taskDisplayStatus(task({ id: "b2", title: "今天到期", due_at: new Date().toISOString() }))).toEqual({
      code: "due_soon",
      label: "临期",
    });
    expect(taskDisplayStatus(task({ id: "b3", title: "跑着", status: "running" }))).toEqual({
      code: "in_progress",
      label: "进行中",
    });
    expect(taskDisplayStatus(task({ id: "b4", title: "还没开始" }))).toEqual({ code: "not_started", label: "未开始" });
  });
});

describe("display task grouping", () => {
  it("projects icon/group/verb onto host tasks and keeps display_rank order", () => {
    const host = [task({ id: "t1", title: "宿主", priority: "important", due_at: new Date().toISOString() })];
    const rows = projectDisplayTasks([
      { work_item_id: "t1", title: "改写标题", why: "因为", rank: 2, verb: "handle", label: "处理", icon: "🔥", group: "重要" },
    ], host);
    expect(rows).toHaveLength(1);
    expect(rows[0].display_icon).toBe("🔥");
    expect(rows[0].display_group).toBe("重要");
    expect(rows[0].display_verb).toBe("handle");
    expect(rows[0].title).toBe("改写标题");
    expect(rows[0].priority).toBe("important");
  });

  it("groups by codex group first, falls back to priority severity, ordered 重要紧急→其他", () => {
    const rows = [
      task({ id: "g1", title: "普通", priority: "low", display_group: undefined }),
      task({ id: "g2", title: "紧急", priority: "urgent", priority_label: "紧急" }),
      task({ id: "g3", title: "指定组", display_group: "重要" }),
      task({ id: "g4", title: "最重", priority: "important_urgent" }),
    ] as Task[];
    const groups = groupDisplayTasks(rows);
    expect(groups.map((entry) => entry.group)).toEqual(["重要紧急", "重要", "紧急", "其他"]);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["g4"]);
    expect(groups[1].rows.map((row) => row.id)).toEqual(["g3"]);
    expect(groups[2].rows.map((row) => row.id)).toEqual(["g2"]);
    expect(groups[3].rows.map((row) => row.id)).toEqual(["g1"]);
  });

  it("drops rows whose host task reached a terminal state", () => {
    const host = [
      task({ id: "t1", title: "进行中", status: "running" }),
      task({ id: "t2", title: "已完成", status: "completed" }),
      task({ id: "t3", title: "已取消", status: "cancelled" }),
      task({ id: "t4", title: "已忽略", dismissed_at: "2026-09-01T00:00:00Z" }),
    ];
    const rows = projectDisplayTasks([
      { work_item_id: "t1", title: "还在", rank: 1 },
      { work_item_id: "t2", title: "结束-完成", rank: 2 },
      { work_item_id: "t3", title: "结束-取消", rank: 3 },
      { work_item_id: "t4", title: "结束-忽略", rank: 4 },
      { work_item_id: "", title: "无宿主保留", rank: 5 },
    ], host);
    expect(rows.map((row) => row.title)).toEqual(["还在", "无宿主保留"]);
  });
});
