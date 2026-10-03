import { describe, expect, it } from "vitest";
import type { TaskEvent } from "../api";
import { mergeTaskRunEvents } from "./useTaskRunEventStream";

describe("mergeTaskRunEvents", () => {
  it("deduplicates replayed SSE events and retains sequence ordering", () => {
    const initial: TaskEvent[] = [{ id: "evt_2", sequence: 2, title: "旧进度", created_at: "2026-10-03T00:00:02Z" }];
    const rows = mergeTaskRunEvents(initial, [
      { event_id: "evt_3", sequence: 3, label: "最新进度", safe_summary: "已完成第三步", occurred_at: "2026-10-03T00:00:03Z" },
      { event_id: "evt_2", sequence: 2, label: "更新后的第二步", safe_summary: "已完成第二步", occurred_at: "2026-10-03T00:00:02Z" },
      { event_id: "evt_1", sequence: 1, label: "第一步", occurred_at: "2026-10-03T00:00:01Z" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["evt_1", "evt_2", "evt_3"]);
    expect(rows.find((row) => row.id === "evt_2")).toMatchObject({ title: "更新后的第二步", summary: "已完成第二步" });
  });
});
