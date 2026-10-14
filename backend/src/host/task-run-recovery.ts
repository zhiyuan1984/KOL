import { audit, postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { appendTaskEvent } from "../task-events.js";
/**
 * Boot-time reconciliation for task runs. Nothing can still be executing in a
 * fresh process, so a run left `running` by a previous process lost its worker.
 * Close it honestly with a terminal event and let the employee retry, instead
 * of leaving the task looking "进行中 / 任务开始处理" forever.
 *
 * Call after `failStuckPlans`, which already settles the planning runs.
 */
export async function failInterruptedTaskRuns(reason: string): Promise<string[]> {
  const rows = (await postgresDb().many(`SELECT r.id AS run_id, r.work_item_id AS work_item_id
       FROM task_runs r
       JOIN tickets w ON w.id = r.work_item_id
      WHERE r.status = 'running'`)) as {
    run_id: string;
    work_item_id: string;
  }[];
  const touched: string[] = [];
  for (const row of rows) {
    const now = nowIso();
    const changed = (await pgTransaction(async (db) => {
      const run = (await db.execute("UPDATE task_runs SET status='failed',error=$1,completed_at=$2 WHERE id=$3 AND status='running'", JSON.stringify({ code: "interrupted", message: reason }), now, row.run_id));
      (await db.execute("UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status IN ('running','in_progress','starting')", now, row.work_item_id));
      return Number(run.changes) > 0;
    }));
    if (!changed)
      continue;
    (await appendTaskEvent(row.work_item_id, row.run_id, "run.failed", "执行被中断", "failed", `${reason}；未产生结果，可重新执行。`));
    (await audit("host", "task.run.orphaned", { work_item_id: row.work_item_id, run_id: row.run_id, reason }));
    touched.push(row.work_item_id);
  }
  return touched;
}
