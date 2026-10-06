import { afterEach, describe, expect, it, vi } from "vitest";
import { businessTaskStatus, createTaskSearchDebouncer, isAgentTaskInProgress, sortTaskRowsByUpdatedAt, TASK_SEARCH_DEBOUNCE_MS } from "./taskCenterModel";

afterEach(() => vi.useRealTimers());

describe("task center status model", () => {
  it("keeps open Agent tasks out of the in-progress KPI while counting active states", () => {
    expect(isAgentTaskInProgress("open")).toBe(false);
    expect(isAgentTaskInProgress("queued")).toBe(false);
    expect(isAgentTaskInProgress("in_progress")).toBe(true);
    expect(isAgentTaskInProgress("waiting_approval")).toBe(true);
    expect(isAgentTaskInProgress("completed")).toBe(false);
  });

  it("maps business tasks to the employee-facing lifecycle", () => {
    expect(businessTaskStatus({ status: "open", counts: { waiting_review: 0 } })).toBe("queued");
    expect(businessTaskStatus({ status: "in_progress", counts: { waiting_review: 0 } })).toBe("running");
    expect(businessTaskStatus({ status: "in_progress", counts: { waiting_review: 1 } })).toBe("waiting_approval");
    expect(businessTaskStatus({ status: "completed", counts: { waiting_review: 0 } })).toBe("completed");
  });

  it("sorts unified rows by updated time before rendering", () => {
    expect(sortTaskRowsByUpdatedAt([
      { key: "old", updatedAt: "2026-01-01T00:00:00Z" },
      { key: "new", updatedAt: "2026-01-02T00:00:00Z" },
    ]).map((row) => row.key)).toEqual(["new", "old"]);
  });
});

describe("task center query debounce", () => {
  it("emits one consolidated search after 300ms", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = createTaskSearchDebouncer(callback);
    debouncer.schedule("K");
    debouncer.schedule("KO");
    debouncer.schedule("KOL");
    vi.advanceTimersByTime(TASK_SEARCH_DEBOUNCE_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("KOL");
  });
});
