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
});
