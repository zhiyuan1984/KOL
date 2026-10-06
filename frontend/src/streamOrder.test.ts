import { describe, expect, it } from "vitest";
import type { Message } from "./api";
import { orderStream, streamTime } from "./streamOrder";

const row = (id: string, kind: string, created_at: string, payload: Record<string, unknown> = {}): Message =>
  ({ id, session_id: "s", role: "assistant", kind, created_at, payload }) as Message;

describe("stream order", () => {
  it("places an in-place updated answer at its latest content time", () => {
    const rows = [
      row("me", "me", "2026-10-06T10:00:00.000Z"),
      row("answer", "assistant", "2026-10-06T10:00:01.000Z", { updated_at: "2026-10-06T10:00:09.000Z" }),
      row("result", "task_result_card", "2026-10-06T10:00:05.000Z"),
    ];
    expect(orderStream(rows).map((item) => item.id)).toEqual(["me", "result", "answer"]);
  });

  it("orders a process trace by its newest step, not by when the trace was opened", () => {
    const trace = row("trace", "process_trace", "2026-10-06T10:00:00.000Z", {
      items: [
        { id: "a", observed_at: "2026-10-06T10:00:00.500Z" },
        { id: "b", observed_at: "2026-10-06T10:00:07.000Z" },
      ],
    });
    expect(streamTime(trace)).toBe(Date.parse("2026-10-06T10:00:07.000Z"));
    const result = row("result", "task_result_card", "2026-10-06T10:00:08.000Z");
    expect(orderStream([result, trace]).map((item) => item.id)).toEqual(["trace", "result"]);
  });

  it("keeps rows without a usable time first and ties in their original order", () => {
    const rows = [
      row("b", "assistant", "2026-10-06T10:00:00.000Z"),
      row("context", "ui_slot", ""),
      row("c", "assistant", "2026-10-06T10:00:00.000Z"),
    ];
    expect(orderStream(rows).map((item) => item.id)).toEqual(["context", "b", "c"]);
  });
});
