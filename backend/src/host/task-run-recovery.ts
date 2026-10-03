import { audit, getConn, nowIso, tx } from "../db.js";
import { appendTaskEvent } from "../task-events.js";

/**
 * Boot-time reconciliation for task runs. Nothing can still be executing in a
 * fresh process, so a run left `running` by a previous process lost its worker.
 * Close it honestly with a terminal event and let the employee retry, instead
 * of leaving the task looking "进行中 / 任务开始处理" forever.
 *
 * Call after `failStuckPlans`, which already settles the planning runs.
 */
export function failInterruptedTaskRuns(reason: string): string[] {
  const rows = getConn().prepare(
    `SELECT r.id AS run_id, r.work_item_id AS work_item_id
       FROM task_runs r
       JOIN tickets w ON w.id = r.work_item_id
      WHERE r.status = 'running'`,
  ).all() as { run_id: string; work_item_id: string }[];
  const touched: string[] = [];
  for (const row of rows) {
    const now = nowIso();
    const changed = tx((db) => {
      const run = db.prepare(
        "UPDATE task_runs SET status='failed',error=?,completed_at=? WHERE id=? AND status='running'",
      ).run(JSON.stringify({ code: "interrupted", message: reason }), now, row.run_id);
      db.prepare(
        "UPDATE tickets SET status='failed',updated_at=?,data_version=data_version+1 WHERE id=? AND status IN ('running','in_progress','starting')",
      ).run(now, row.work_item_id);
      return Number(run.changes) > 0;
    });
    if (!changed) continue;
    appendTaskEvent(row.work_item_id, row.run_id, "run.failed", "执行被中断", "failed", `${reason}；未产生结果，可重新执行。`);
    audit("host", "task.run.orphaned", { work_item_id: row.work_item_id, run_id: row.run_id, reason });
    touched.push(row.work_item_id);
  }
  return touched;
}
