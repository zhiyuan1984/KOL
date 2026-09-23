/**
 * Harness trace → task_events rows, shared by the today plan run and the
 * AI发现 discovery run so both render the same 处理过程 /「Codex 推理」 block.
 * Only reasoning *summaries* reach safe_summary; raw reasoning_text never does.
 */
import { upsertTaskEvent } from "../routers/tasks.js";
import {
  applyProgress,
  finishProcessItems,
  mcpCallDisplay,
  upsertOperationItem,
  type WorkerProgress,
  type WorkerTraceItem,
} from "../worker/progress.js";

/** Reasoning deltas arrive per token; batch them into one row write each tick. */
export const TRACE_FLUSH_MS = 400;

export type RunTraceRow = {
  itemKey: string;
  eventType: string;
  label: string;
  status: string;
  summary: string;
};

/**
 * Harness trace item → 处理过程 row. The card used to keep only the last 600
 * characters of one reasoning summary, so every Host phase and MCP read was
 * dropped and the few rows left looked canned. These are the same items the
 * session page renders; each is persisted under its own item_key.
 */
export function runTraceRow(item: WorkerTraceItem): RunTraceRow {
  if (item.kind === "reasoning") {
    const text = item.label === "正在分析…" ? "" : String(item.label || "").replace(/\*\*/g, "").trim();
    return {
      itemKey: item.id,
      eventType: "run.think",
      label: "Codex 推理",
      status: item.status,
      summary: text.slice(-1000),
    };
  }
  return {
    itemKey: item.id,
    eventType: "run.step",
    label: String(item.label || "").trim() || "处理中",
    status: item.status,
    summary: "",
  };
}

export type RunTraceSink = {
  onStream: (progress: WorkerProgress) => void;
  finish: (failed: boolean) => void;
};

/**
 * `task_events.run_id` is an FK to `task_runs`; a run without a task_runs row
 * (AI发现) passes null, the same as its other task_events.
 */
export function createRunTraceSink(input: { workItemId: string; runId: string | null }): RunTraceSink {
  let items: WorkerTraceItem[] = [];
  let operations: { id: string; name: string; label: string; status: string }[] = [];
  let traceDirty = false;
  let traceHandle: ReturnType<typeof setTimeout> | null = null;
  /** Only changed rows are written: a flush re-walks every item. */
  const written = new Map<string, string>();
  const writeRow = (
    itemKey: string,
    eventType: string,
    label: string,
    status: string,
    summary: string,
  ) => {
    const stamp = `${label}\u0000${status}\u0000${summary}`;
    if (written.get(itemKey) === stamp) return;
    written.set(itemKey, stamp);
    upsertTaskEvent(input.workItemId, input.runId, itemKey, eventType, label, status, summary);
  };
  const writeTrace = () => {
    for (const item of items) {
      const row = runTraceRow(item);
      writeRow(row.itemKey, row.eventType, row.label, row.status, row.summary);
    }
    for (const operation of operations) {
      writeRow(
        `op:${operation.id}`,
        "run.tool",
        mcpCallDisplay(operation),
        operation.status,
        operation.name,
      );
    }
  };
  const flushTrace = () => {
    traceHandle = null;
    if (!traceDirty) return;
    traceDirty = false;
    writeTrace();
  };
  const scheduleTrace = (immediate: boolean) => {
    traceDirty = true;
    if (immediate) {
      if (traceHandle) clearTimeout(traceHandle);
      flushTrace();
      return;
    }
    if (!traceHandle) traceHandle = setTimeout(flushTrace, TRACE_FLUSH_MS);
  };
  const onStream = (progress: WorkerProgress) => {
    if (progress.operation) {
      operations = upsertOperationItem(operations, progress.operation);
      scheduleTrace(true);
      return;
    }
    if (!progress.trace) return;
    items = applyProgress(items, progress);
    // Phase and tool transitions are rare and worth showing at once; reasoning
    // text grows every token, so it batches.
    scheduleTrace(progress.trace.kind !== "reasoning");
  };
  const finish = (failed: boolean) => {
    items = finishProcessItems(items, failed);
    operations = operations.map((operation) => ({ ...operation, status: failed ? "failed" : "done" }));
    scheduleTrace(true);
  };
  return { onStream, finish };
}
