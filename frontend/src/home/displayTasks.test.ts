import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import { displayTasksOrBase, projectDisplayTasks } from "./displayTasks";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return { source: "manual", status: "pending", ...partial };
}

const due = task({ id: "tsk_due", title: "写报价确认邮件", due_at: new Date().toISOString() });

describe("displayTasksOrBase", () => {
  it("uses the Codex projection when the display rows resolve", () => {
    const rows = displayTasksOrBase([{ work_item_id: "tsk_due", title: "写报价确认邮件", rank: 1 }], [due]);
    expect(rows.map((row) => row.id)).toEqual(["tsk_due"]);
  });

  it("falls back to the open tasks when the display payload cannot resolve", () => {
    // Host rows carry the matching id but the display payload has no title and
    // references a work item that is not in the open list.
    const display = [
      { work_item_id: "tsk_home_laozhang_quote", rank: 1, why: "未了结正式任务" },
      { work_item_id: "tsk_home_trip_stage", rank: 2, why: "执行失败" },
    ];
    expect(projectDisplayTasks(display, [due])).toEqual([]);
    expect(displayTasksOrBase(display, [due]).map((row) => row.id)).toEqual(["tsk_due"]);
  });

  it("falls back to the open tasks when there is no display payload", () => {
    expect(displayTasksOrBase(undefined, [due]).map((row) => row.id)).toEqual(["tsk_due"]);
    expect(displayTasksOrBase([], [due]).map((row) => row.id)).toEqual(["tsk_due"]);
  });

  it("stays empty when neither source has rows", () => {
    expect(displayTasksOrBase([], [])).toEqual([]);
    expect(displayTasksOrBase(undefined)).toEqual([]);
  });

  it("never invents rows when both the projection and the open list are empty", () => {
    expect(displayTasksOrBase([{ work_item_id: "tsk_gone", rank: 1 }], [])).toEqual([]);
  });

  it("never revives a titled result whose task is no longer in the authorized host list", () => {
    const stale = [{ work_item_id: "tsk_gone", title: "历史计划里的任务", rank: 1 }];
    expect(projectDisplayTasks(stale, [due])).toEqual([]);
    expect(displayTasksOrBase(stale, [due])).toEqual([due]);
  });

  it("keeps new host tasks when the previous plan covers only part of the current list", () => {
    const added = task({ id: "tsk_new", title: "规划后新建的待办", plan_view: "todo" });
    const rows = displayTasksOrBase([{ work_item_id: due.id, rank: 1 }], [due, added]);
    expect(rows.map((row) => row.id)).toEqual([due.id, added.id]);
    expect(rows[1]).toEqual(added);
  });

  it("keeps current task state and service-owned membership over stale plan metadata", () => {
    const current = task({ id: "tsk_changed", title: "重新安排", status: "waiting", plan_view: "todo", owner_user_id: "owner", collaboration_id: "collab" });
    const [row] = displayTasksOrBase([{ work_item_id: current.id, view: "today", why: "旧安排", rank: 1 }], [current]);
    expect(row).toMatchObject({ status: "waiting", plan_view: "todo", owner_user_id: "owner", collaboration_id: "collab", layout_why: "旧安排" });
  });

  it("deduplicates display IDs and excludes closed or dismissed rows from either source", () => {
    const closed = task({ id: "closed", title: "已完成", status: "completed" });
    const dismissed = task({ id: "dismissed", title: "已忽略", dismissed_at: new Date().toISOString() });
    const rows = displayTasksOrBase([
      { work_item_id: due.id, rank: 1 },
      { work_item_id: due.id, rank: 2 },
      { work_item_id: closed.id, title: "旧任务", rank: 3 },
    ], [due, closed, dismissed]);
    expect(rows.map((row) => row.id)).toEqual([due.id]);
  });
  it("never overwrites edited titles or current actions with historical plan text", () => {
    const current = task({ id: "edited", title: "人工修改后的标题", next_action_code: "approve", next_action: "确认当前结果", display_verb: "approve", display_label: "去审批" });
    const [row] = displayTasksOrBase([{ work_item_id: current.id, title: "旧标题", verb: "send", label: "再次发送", next_action: "旧操作", why: "规划依据", rank: 1 }], [current]);
    expect(row).toMatchObject({ title: current.title, next_action_code: "approve", next_action: "确认当前结果", display_verb: "approve", display_label: "去审批", layout_why: "规划依据" });
    const [noAction] = displayTasksOrBase([{ work_item_id: due.id, verb: "send", label: "发送" }], [due]);
    expect(noAction.display_verb).toBeUndefined();
    expect(noAction.next_action_code).toBeUndefined();
  });

});
