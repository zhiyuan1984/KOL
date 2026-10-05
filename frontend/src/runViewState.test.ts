import { describe, expect, it } from "vitest";
import type { Task } from "./api";
import { isTerminalTaskStatus, taskRunView } from "./runViewState";

const task = (status: string): Task => ({ id: "tsk_1", status } as Task);

describe("taskRunView", () => {
  it("distinguishes generated read results, acceptance and real approval waits", () => {
    const read = { ...task("waiting"), execution: { run_id: "run", status: "completed", result_ready: true } };
    expect(taskRunView(read, "listening")).toMatchObject({ label: "结果已生成", live: false });
    expect(taskRunView(task("waiting"), "listening").label).toBe("结果待验收");
    expect(taskRunView(read, "waiting_approval").label).toBe("待你确认");
    expect(taskRunView({ ...read, status: "running" }, "running").live).toBe(true);
    expect(taskRunView({ ...read, status: "completed" }, "listening").label).toBe("已完成");
  });
  it("separates queued from running so a waiting task is never shown 执行中", () => {
    expect(taskRunView(task("pending"), "listening").key).toBe("queued");
    expect(taskRunView(task("queued"), "listening").key).toBe("queued");
    expect(taskRunView(task("running"), "listening").key).toBe("running");
  });

  it("keeps stopped and cancelled distinct from running and offers a retry for stopped", () => {
    expect(taskRunView(task("stopped"), "listening").label).toBe("已停止");
    expect(taskRunView(task("stopped"), "listening").canRerun).toBe(true);
    expect(taskRunView(task("cancelled"), "listening").label).toBe("已取消");
    expect(taskRunView(task("failed"), "listening").canRerun).toBe(true);
    expect(taskRunView(task("completed"), "listening").canRerun).toBe(false);
  });

  it("falls back to the session status when no task exists", () => {
    expect(taskRunView(null, "listening").key).toBe("idle");
    expect(taskRunView(null, "running").key).toBe("running");
  });

  it("marks terminal statuses", () => {
    expect(isTerminalTaskStatus("stopped")).toBe(true);
    expect(isTerminalTaskStatus("running")).toBe(false);
  });
});
