import { audit, nowIso } from "../db.js";
import { postgresTransaction } from "../postgres/pool.js";
import { appendTaskEventIn } from "../task-events.js";

/** Boot-time recovery applies to every interrupted run, not only planner skills.
 * The ticket lock, run CAS, lifecycle state, trace and audit commit together. */
export async function failInterruptedTaskRuns(reason: string): Promise<string[]> {
  return postgresTransaction(async (db) => {
    const rows = (await db.query<{ run_id: string; work_item_id: string }>(
      `SELECT r.id AS run_id,r.work_item_id FROM task_runs r
         JOIN tickets t ON t.id=r.work_item_id
        WHERE r.status='running' ORDER BY t.id,r.id
        FOR UPDATE OF t SKIP LOCKED`,
    )).rows;
    const touched: string[] = [];
    for (const row of rows) {
      const now = nowIso();
      const changed = await db.query(
        `UPDATE task_runs SET status='failed',error=$1,completed_at=$2
          WHERE id=$3 AND work_item_id=$4 AND status='running'`,
        [JSON.stringify({ code: "interrupted", message: reason }), now, row.run_id, row.work_item_id],
      );
      if (!changed.rowCount) continue;
      await db.query(
        "UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status IN ('running','in_progress','starting')",
        [now, row.work_item_id],
      );
      await appendTaskEventIn(db, row.work_item_id, row.run_id, "run.failed", "执行被中断", "failed", `${reason}；未产生结果，可重新执行。`);
      await audit("host", "task.run.orphaned", { work_item_id: row.work_item_id, run_id: row.run_id, reason }, db);
      touched.push(row.work_item_id);
    }
    return touched;
  });
}
