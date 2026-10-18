import { audit, nowIso } from "../db.js";
import { postgresTransaction } from "../postgres/pool.js";
import { appendTaskEventIn } from "../task-events.js";
import { taskDefinitions } from "../tasks/registry.js";

/** Repair only the former read-result acceptance wait. Manual work orders,
 * incomplete runs and tasks with controlled actions are deliberately excluded. */
export async function completeSavedReadTaskRuns(): Promise<string[]> {
  const types = (await taskDefinitions()).filter(definition => definition.side_effects === "none" && definition.output === "task_result").map(definition => definition.id);
  if (!types.length) return [];
  return postgresTransaction(async db => {
    const rows = (await db.query(`SELECT t.id,r.id AS run_id,r.completed_at FROM tickets t
      JOIN LATERAL (SELECT id,status,worker_id,completed_at FROM task_runs
        WHERE work_item_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
      WHERE t.status='waiting' AND t.task_type=ANY($1::text[]) AND r.status='completed'
        AND EXISTS (SELECT 1 FROM task_artifacts WHERE run_id=r.id AND artifact_type='task_result_card')
        AND NOT EXISTS (SELECT 1 FROM runtime_actions WHERE context_json->>'runId'=r.worker_id)
      ORDER BY t.id FOR UPDATE OF t`, [types])).rows;
    for (const row of rows) {
      const now = nowIso();
      await db.query("UPDATE tickets SET status='completed',completed_at=$1,updated_at=$2,data_version=data_version+1 WHERE id=$3 AND status='waiting'", [row.completed_at || now, now, row.id]);
      await appendTaskEventIn(db, row.id, row.run_id, "task.execution_state", "任务已完成", "completed", "已核对成功运行与已保存成果，自动结束旧版人工完成等待。");
      await audit("host", "task.automatic_completion_recovered", { work_item_id: row.id, run_id: row.run_id }, db);
    }
    return rows.map(row => String(row.id));
  });
}

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
