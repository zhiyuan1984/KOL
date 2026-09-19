import type { Json } from "../types.js";
import { persistIncrement } from "./employee-memory.js";
import { parseTodayTaskResults, writeTodayTaskResults } from "./today-tasks.js";
import type { PlanScope } from "./today-plan-context.js";

export function persistTodayDisplayFromBrief(input: {
  owner: string;
  workItemId: string;
  runId: string | null;
  brief: unknown;
  scope?: PlanScope;
}): { ok: true } | { ok: false; reason: string } {
  const scope = input.scope ?? "today";
  const parsed = parseTodayTaskResults(input.brief);
  if (!parsed) return { ok: false, reason: "Codex did not produce display_tasks" };
  const written = writeTodayTaskResults({
    owner: input.owner,
    workItemId: input.workItemId,
    runId: input.runId,
    results: parsed,
    scope,
  });
  if (!written.ok) return written;
  persistIncrement({
    owner: input.owner,
    family: scope === "todo" ? "todo" : "task",
    layer: "display",
    incoming: parsed.items.map((item) => ({
      item_key: item.work_item_id,
      payload: item as unknown as Json,
    })),
  });
  return { ok: true };
}
