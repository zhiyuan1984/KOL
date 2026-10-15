import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock("../src/task-events.js", () => ({ upsertTaskEvent: mocks.persist }));
import { createRunTraceSink } from "../src/host/run-trace.js";

describe("native run trace owned persistence queue", () => {
  beforeEach(() => { mocks.persist.mockReset().mockResolvedValue(null); });

  it("finish drains an in-flight write before resolving and seals late progress", async () => {
    let release!: () => void;
    mocks.persist.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const sink = createRunTraceSink({ workItemId: "synthetic-work", runId: "synthetic-run" });
    sink.onStream({ phase: "reading_data", trace: { id: "phase-1", kind: "host", label: "读取事实", status: "running" } });
    await Promise.resolve();
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    let complete = false;
    const finished = sink.finish(false).then(() => { complete = true; });
    await Promise.resolve();
    expect(complete).toBe(false);
    release();
    await finished;
    expect(complete).toBe(true);
    expect(mocks.persist.mock.calls.map((call) => call[5])).toEqual(["running", "done"]);
    const count = mocks.persist.mock.calls.length;
    sink.onStream({ phase: "reading_data", trace: { id: "late-phase", kind: "host", label: "迟到", status: "running" } });
    await Promise.resolve();
    expect(mocks.persist).toHaveBeenCalledTimes(count);
  });

  it("retains a real persistence failure for the task owner rather than floating a rejection", async () => {
    mocks.persist.mockRejectedValueOnce(new Error("trace-write-denied"));
    const sink = createRunTraceSink({ workItemId: "synthetic-work", runId: "synthetic-run" });
    sink.onStream({ phase: "reading_data", trace: { id: "phase-1", kind: "host", label: "读取事实", status: "running" } });
    await expect(sink.finish(true)).rejects.toThrow("trace-write-denied");
  });

  it("repeated finish calls share the same terminal owner", async () => {
    const sink = createRunTraceSink({ workItemId: "synthetic-work", runId: "synthetic-run" });
    sink.onStream({ phase: "reading_data", trace: { id: "phase-1", kind: "host", label: "读取事实", status: "running" } });
    const first = sink.finish(false);
    expect(sink.finish(false)).toBe(first);
    await first;
  });
});
