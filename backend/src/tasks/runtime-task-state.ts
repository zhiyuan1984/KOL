import { postgresTransaction } from "../postgres/pool.js";
import { appendTaskEventIn } from "../task-events.js";
import { taskRunOutcome } from "./run-outcome.js";

/** Called by durable action/crawl writers, never by the browser's polling clock.
 * A model turn may end before its confirmed asynchronous business action. */
export async function syncRuntimeTaskState(workerId: string): Promise<void> {
  if (!workerId) return;
  await postgresTransaction(async db => {
    const rows = (await db.query(`SELECT r.id,r.work_item_id FROM task_runs r
      JOIN tickets t ON t.id=r.work_item_id
      WHERE r.worker_id=$1 AND r.status='completed'
        AND t.status IN ('running','waiting_approval','uncertain')
      ORDER BY t.id FOR UPDATE OF t`, [workerId])).rows;
    for (const run of rows) {
      const latest = (await db.query("SELECT id FROM task_runs WHERE work_item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [run.work_item_id])).rows[0];
      if (latest?.id !== run.id) continue;
      const states = (await db.query(`SELECT CASE
        WHEN c.state='succeeded' AND c.result_state='failed' THEN 'failed'
        WHEN c.state='succeeded' AND COALESCE(c.result_state,'pending')<>'ready' THEN 'running'
        ELSE COALESCE(c.state,a.state) END AS state
        FROM runtime_actions a LEFT JOIN runtime_crawl_jobs c ON c.id=a.id
        WHERE a.context_json->>'runId'=$1`, [workerId])).rows.map(row => String(row.state));
      if (!states.length) continue;
      const artifacts = (await db.query("SELECT artifact_type FROM task_artifacts WHERE run_id=$1", [run.id])).rows;
      const outcome = taskRunOutcome({ failed: false, needsInput: false, artifactKinds: artifacts.map(row => String(row.artifact_type)), actionStates: states });
      const now = new Date().toISOString();
      const changed = await db.query("UPDATE tickets SET status=$1,completed_at=$2,updated_at=$3,data_version=data_version+1 WHERE id=$4 AND status<>$1", [outcome.status,
        ["completed", "failed", "cancelled"].includes(outcome.status) ? now : null, now, run.work_item_id]);
      if (changed.rowCount) await appendTaskEventIn(db, run.work_item_id, run.id, "task.execution_state", outcome.status === "completed" ? "任务已完成" : outcome.status === "failed" ? "执行失败" : "业务状态已更新", outcome.status, "依据真实业务回执自动更新。");
    }
  });
}
