import { describe, expect, it, vi } from "vitest";
import type { WorkbenchTaskPage } from "../api";
import { loadAllWorkbenchTasks } from "./workbenchPagination";

function page(items: string[], cursor: string | null): WorkbenchTaskPage {
  return {
    items: items.map((id) => ({ id, title: id })),
    page: { limit: 100, next_cursor: cursor, total_estimate: 3 },
    as_of: "2026-10-03T00:00:00.000Z",
    evaluated_at: "2026-10-03T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    projection_version: "task-workbench.v1",
    schema_version: "ticket-api.v1",
  };
}

describe("loadAllWorkbenchTasks", () => {
  it("forwards cancellation and stops before loading another page", async () => {
    const controller = new AbortController();
    const load = vi.fn(async (_view: "today" | "todo", opts?: { signal?: AbortSignal }) => {
      expect(opts?.signal).toBe(controller.signal);
      controller.abort();
      return page(["tsk_1"], "cursor-2");
    });
    await expect(loadAllWorkbenchTasks("today", load, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("accumulates every page and replaces duplicated ids", async () => {
    const load = vi.fn(async (_view: "today" | "todo", opts?: { cursor?: string }) => {
      return opts?.cursor ? page(["tsk_2", "tsk_3"], null) : page(["tsk_1", "tsk_2"], "cursor-2");
    });
    const rows = await loadAllWorkbenchTasks("todo", load);
    expect(rows.map((row) => row.id)).toEqual(["tsk_1", "tsk_2", "tsk_3"]);
    expect(load).toHaveBeenCalledWith("todo", { cursor: undefined, limit: 100 });
    expect(load).toHaveBeenCalledWith("todo", { cursor: "cursor-2", limit: 100 });
  });
});
