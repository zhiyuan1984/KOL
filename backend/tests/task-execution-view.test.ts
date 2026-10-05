import { describe, expect, it } from "vitest";
import { taskExecutionView } from "../src/tasks/execution-view.js";
import { finishOperationItems, finishProcessItems } from "../src/worker/progress.js";

describe("task result presentation contract", () => {
  it("requires a completed run and a registered read-only definition", () => {
    expect(taskExecutionView("waiting", "none", { id: "read", status: "completed" })?.result_ready).toBe(true);
    for (const [task, effects, run] of [
      ["waiting", "write", "completed"], ["waiting", undefined, "completed"],
      ["running", "none", "completed"], ["waiting_approval", "none", "completed"],
      ["waiting", "none", "failed"], ["waiting", "none", "running"],
    ]) expect(taskExecutionView(task!, effects, { id: "run", status: run! })?.result_ready).toBe(false);
    expect(taskExecutionView("waiting", "none", null)).toBeNull();
  });
  it("settles unfinished calls without inventing tool success or erasing errors", () => {
    const ended = finishOperationItems([
      { id: "ok", status: "done" }, { id: "err", status: "failed" },
      { id: "unknown", status: "running" }, { id: "pending", status: "pending" },
    ]);
    expect(ended.map(item => item.status)).toEqual(["done", "failed", "interrupted", "interrupted"]);
    expect(finishOperationItems(ended)).toEqual(ended);
    expect(finishProcessItems([{ id: "error", label: "调用失败", status: "failed" }], false)[0].status).toBe("failed");
    expect(finishProcessItems([{ id: "error", label: "调用失败", status: "failed" }], true)[0].status).toBe("failed");
    expect(finishProcessItems([{ id: "finished", label: "已读取", status: "done" }], true)[0].status).toBe("done");
  });
});
