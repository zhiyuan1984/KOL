import { expect, it } from "vitest";
import { traceEventPayload } from "../src/worker/trace-events.js";
import { discoveryTimeline } from "../../frontend/src/home/discoveryTimeline.js";
import type { Message } from "../../frontend/src/api.js";

it("appends terminal events, keeps streamed summaries in place, and does not invent historical time", () => {
  const start = traceEventPayload(null, { items: [{ id: "task", label: "核对条件", status: "running" }] }, "2026-10-05T01:00:00Z");
  const stream = traceEventPayload(start, { items: [{ id: "task", label: "核对发现条件", status: "running" }] }, "2026-10-05T01:00:01Z");
  const end = traceEventPayload(stream, { items: [{ id: "task", label: "核对发现条件", status: "done" }] }, "2026-10-05T01:00:02Z");
  expect(end.timeline_events).toHaveLength(2);
  expect(end.timeline_events[0]).toMatchObject({ label: "核对发现条件", observed_at: "2026-10-05T01:00:00Z" });
  expect(end.timeline_events[1].observed_at).toBe("2026-10-05T01:00:02Z");
  const legacy = traceEventPayload({ items: [{ id: "old", label: "旧记录", status: "running" }] }, { items: [{ id: "old", label: "旧记录", status: "done" }] }, "2026-10-05T01:00:03Z");
  expect(legacy.timeline_events[0].observed_at).toBeUndefined();
});
it("interleaves actual process and operation times and excludes empty entries", () => {
  const message = (id: string, kind: string, payload: Record<string, unknown>): Message => ({ id, kind, payload, role: "assistant", session_id: "s", created_at: "2026-10-05T01:00:00Z" });
  const rows = discoveryTimeline([
    message("p", "process_trace", { items: [{ id: "1", label: "准备", observed_at: "2026-10-05T01:00:00Z" }, { id: "3", label: "整理", observed_at: "2026-10-05T01:00:02Z" }, { id: "empty", observed_at: "2026-10-05T01:00:03Z" }] }),
    message("o", "operation_trace", { items: [{ id: "2", label: "读取", observed_at: "2026-10-05T01:00:01Z" }] }),
  ]);
  expect(rows.map(row => row.payload.text)).toEqual(["准备", "读取", "整理"]);
});
