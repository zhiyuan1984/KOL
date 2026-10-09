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
