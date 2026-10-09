import { beforeEach, describe, expect, it } from "vitest";
import {
  captureTaskListSnapshot,
  clearTaskListSnapshot,
  readTaskListSnapshot,
  taskListReturnUrl,
} from "./taskDetailNavigation";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    },
  });
});

describe("task detail navigation", () => {
  it("stores only allowlisted task-list UI state and removes business detail query state", () => {
    const snapshot = captureTaskListSnapshot({
      originalUrl: "/tasks?status=running&businessTask=business-17&period=week",
      query: "合同",
      from: "2026-10-01",
      to: "2026-10-09",
      operationsFilter: "in_progress",
      expandedSystemTasks: new Set(["agent-1", "agent-1", "agent-2"]),
      selectedIds: new Set(["agent-2"]),
      loadedAgentPages: 2,
      loadedBusinessPages: 3,
      scrollPosition: 480,
      // Extra content must never be copied to the session snapshot.
      taskBody: "sensitive task content",
    } as Parameters<typeof captureTaskListSnapshot>[0]);

    expect(snapshot).toEqual({
      originalUrl: "/tasks?status=running&period=week",
      query: "合同",
      from: "2026-10-01",
      to: "2026-10-09",
      operationsFilter: "in_progress",
      expandedSystemTasks: ["agent-1", "agent-2"],
      selectedIds: ["agent-2"],
      loadedAgentPages: 2,
      loadedBusinessPages: 3,
      scrollPosition: 480,
    });
    expect(readTaskListSnapshot()).toEqual(snapshot);
    expect([...memory.values()].join(" ")).not.toContain("sensitive task content");
  });

  it("prefers an explicit validated list path, then a validated session snapshot", () => {
    captureTaskListSnapshot({ originalUrl: "/tasks?status=completed", query: "" });

    expect(taskListReturnUrl({ taskListPath: "/tasks?status=running&businessTask=work-order-4" }))
      .toBe("/tasks?status=running");
    expect(taskListReturnUrl({ taskListPath: "https://outside.example/tasks" }))
      .toBe("/tasks?status=completed");
    expect(taskListReturnUrl("/tasks/agent-1")).toBe("/tasks?status=completed");
  });

  it("falls back to the canonical task list for direct opens or invalid stored state", () => {
    expect(taskListReturnUrl()).toBe("/tasks");

    memory.set("kol:task-list-return:v1", JSON.stringify({
      version: 1,
      capturedAt: 0,
      snapshot: { originalUrl: "/tasks?status=running" },
    }));
    expect(readTaskListSnapshot()).toBeNull();
    expect(taskListReturnUrl()).toBe("/tasks");
  });

  it("clears the session restore state when the consumer finishes restoring it", () => {
    captureTaskListSnapshot({ originalUrl: "/tasks", scrollY: 120 });
    expect(readTaskListSnapshot()?.scrollPosition).toBe(120);

    clearTaskListSnapshot();
    expect(readTaskListSnapshot()).toBeNull();
  });
});


describe("scoped independent task return", () => {
  it("only restores the same object and authority identity", async () => {
    const { taskListScopeKey, taskListSnapshotForReturn, taskListReturnState } = await import("./taskDetailNavigation");
    const scope = taskListScopeKey({ id: "actor-1", company_id: "company-1", scope_version: 3 });
    captureTaskListSnapshot({ originalUrl: "/tasks?source=business&q=MAX&period=week&page=4", openedTaskId: "task-1", scopeKey: scope, loadedBusinessPages: 3, scrollPosition: 240, outerScrollPosition: 12, shellScrollPosition: 20 });
    expect(readTaskListSnapshot({ taskId: "task-1", scopeKey: scope })?.scrollPosition).toBe(240);
    expect(readTaskListSnapshot({ taskId: "other-task", scopeKey: scope })).toBeNull();
    expect(readTaskListSnapshot({ taskId: "task-1", scopeKey: taskListScopeKey({ id: "other-actor", company_id: "company-1" }) })).toBeNull();
    expect(taskListSnapshotForReturn(taskListReturnState("task-1", scope), scope)?.loadedBusinessPages).toBe(3);
    expect(taskListSnapshotForReturn({}, scope)).toBeNull();
    expect(taskListReturnUrl(undefined, "task-1", scope)).toBe("/tasks?source=business&q=MAX&period=week&page=4#task-details");
    expect(taskListReturnUrl(undefined, "other-task", scope)).toBe("/tasks#task-details");
  });
  it("does not treat an arbitrary legacy path as targeted provenance", () => {
    captureTaskListSnapshot({ originalUrl: "/tasks?q=private-filter", openedTaskId: "old-task", scopeKey: "old-scope" });
    expect(taskListReturnUrl({ taskListPath: "/tasks?q=private-filter" }, "new-task", "new-scope")).toBe("/tasks#task-details");
    expect(taskListReturnUrl({ taskListPath: "https://outside.example/tasks", taskListTaskId: "new-task", taskListScopeKey: "new-scope" }, "new-task", "new-scope")).toBe("/tasks#task-details");
  });
  it("does not restore scoped state without a resolved identity", () => {
    captureTaskListSnapshot({ originalUrl: "/tasks?q=old-filter", openedTaskId: "task-1", scopeKey: "actor-1" });
    expect(readTaskListSnapshot({ taskId: "task-1", scopeKey: "" })).toBeNull();
    expect(taskListReturnUrl(undefined, "task-1", "")).toBe("/tasks#task-details");
  });
  it("bounds recovery reads and rejects future or expired snapshots", () => {
    const snapshot = captureTaskListSnapshot({ originalUrl: "/tasks", loadedAgentPages: 100000, loadedBusinessPages: 100000 });
    expect(snapshot?.loadedAgentPages).toBe(50); expect(snapshot?.loadedBusinessPages).toBe(50);
    const stored = JSON.parse([...memory.values()][0]); stored.capturedAt = Date.now() + 100000;
    memory.set("kol:task-list-return:v1", JSON.stringify(stored));
    expect(readTaskListSnapshot()).toBeNull();
  });
  it("authority version changes invalidate the identity key without copying unrelated account values", async () => {
    const { taskListScopeKey } = await import("./taskDetailNavigation");
    const original = taskListScopeKey({ id: "actor", company_id: "company", scope_version: 1, token: "never-copy-this" });
    expect(original).not.toContain("never-copy-this");
    expect(original).not.toBe(taskListScopeKey({ id: "actor", company_id: "company", scope_version: 2 }));
    expect(taskListScopeKey(null)).toBe("");
  });
});
