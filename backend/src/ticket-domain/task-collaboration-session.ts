import { nid } from "../ids.js";
import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { lockAdoptionTask } from "./work-order-adoption.js";
import { collaborationContentHash, taskCollaborationContextInTransaction } from "./collaboration-context.js";

export const taskCollaborationSessionSchema = `
CREATE TABLE IF NOT EXISTS task_collaboration_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  actor_ref TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id,actor_ref)
);
`;

/** Opens a workspace, not a second business task or a model run. */
export async function openTaskCollaborationSession(actorId: string, taskId: string) {
  return postgresTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`task-collaboration-session:${actorId}:${taskId}`]);
    const task = await lockAdoptionTask(client, actorId, taskId);
    const prior = (await client.query(`SELECT s.id,s.title FROM task_collaboration_sessions b JOIN sessions s ON s.id=b.session_id
      WHERE b.task_id=$1 AND b.actor_ref=$2 AND s.owner_user_id=$2 AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.disabled=0
      FOR SHARE OF b,s`, [taskId, actorId])).rows[0];
    if (prior) return { id: String(prior.id), task_id: taskId, replayed: true, calls_model: false };
    // An archived/deleted workspace is an explicit recovery condition. Do not
    // silently create another thread or restore an archived session.
    if ((await client.query("SELECT 1 FROM task_collaboration_sessions WHERE task_id=$1 AND actor_ref=$2", [taskId, actorId])).rows.length) {
      throw new HttpFail(409, { code: "task_workspace_unavailable" });
    }
    const id = nid("ses"), now = new Date().toISOString();
    await client.query(`INSERT INTO sessions(id,title,created_at,updated_at,kind,disabled,owner_user_id)
      VALUES ($1,$2,$3,$3,'task_collaboration',0,$4)`, [id, task.title, now, actorId]);
    await client.query("INSERT INTO task_collaboration_sessions(session_id,task_id,actor_ref) VALUES ($1,$2,$3)", [id, taskId, actorId]);
    return { id, task_id: taskId, replayed: false, calls_model: false };
  });
}

/** Null is only for ordinary sessions. A bound but revoked workspace fails. */
async function authorizeInTransaction(client: PoolClient, actorId: string, sessionId: string, allowArchived = false) {
  const binding = (await client.query("SELECT task_id,actor_ref FROM task_collaboration_sessions WHERE session_id=$1 FOR SHARE", [sessionId])).rows[0];
  if (!binding) return null;
  if (binding.actor_ref !== actorId) throw new HttpFail(404, { code: "task_workspace_not_found" });
  const session = await client.query(`SELECT 1 FROM sessions WHERE id=$1 AND owner_user_id=$2 AND disabled=0
    AND deleted_at IS NULL AND ($3::boolean OR archived_at IS NULL) FOR SHARE`, [sessionId, actorId,allowArchived]);
  if (!session.rows.length) throw new HttpFail(404, { code: "task_workspace_not_found" });
  const task = await lockAdoptionTask(client, actorId, binding.task_id);
  return { session_id: sessionId, task_id: String(task.id), title: String(task.title) };
}

export async function authorizedTaskSession(actorId: string, sessionId: string, allowArchived = false) {
  if (!(await postgresPool().query("SELECT 1 FROM task_collaboration_sessions WHERE session_id=$1",[sessionId])).rows.length) return null;
  return postgresTransaction(client => authorizeInTransaction(client,actorId,sessionId,allowArchived));
}

/** Permission-scoped projection before any private title leaves PostgreSQL. */
export async function listTaskCollaborationSessions(actorId: string, includeArchived: boolean) {
  return (await postgresPool().query(`SELECT s.id,s.title,s.archived_at FROM task_collaboration_sessions b
    JOIN sessions s ON s.id=b.session_id AND s.owner_user_id=$1 AND s.deleted_at IS NULL AND s.disabled=0
    JOIN tickets t ON t.id=b.task_id AND t.owner_user_id=$1
    JOIN ticket_accounts a ON a.id=$1 AND a.active=true
    JOIN users u ON u.id=$1 AND u.active=1
    LEFT JOIN collaborations c ON c.id=t.collaboration_id
    WHERE b.actor_ref=$1 AND ($2::boolean OR s.archived_at IS NULL)
      AND (t.collaboration_id IS NULL OR u.brands::jsonb ? c.brand)
    ORDER BY s.updated_at DESC`,[actorId,includeArchived])).rows;
}

/** Fixed, bounded source evidence. No model calls, summaries or inferred links. */
export async function taskSessionHarnessEvidence(actorId: string, sessionId: string) {
  return postgresTransaction(async client => {
    const binding = await authorizeInTransaction(client,actorId,sessionId);
    if (!binding) return null;
    const context = await taskCollaborationContextInTransaction(client,actorId,binding.task_id);
    const task = (await client.query(`SELECT id,title,collaboration_id,COALESCE(NULLIF(goal,''),NULLIF(content,''),title) AS goal,status,data_version FROM tickets WHERE id=$1`, [binding.task_id])).rows[0];
    const visible = context.gates.map(gate => gate.work_order_id);
    const orders = (await client.query(`SELECT id,title,status,stage_code,data_version FROM work_orders
      WHERE task_id=$1 AND id=ANY($2::text[]) ORDER BY id`, [binding.task_id, visible])).rows;
    const evidence = { task, gates: context.gates, work_orders: orders, events: context.events,
      history_complete: !context.has_more, cursor: context.cursor };
    return { schema: "task-collaboration-evidence.v1", ...evidence, version: collaborationContentHash(evidence),
      as_of: context.as_of, risk: "L1", calls_model: false };
  }, { isolation: "REPEATABLE READ" });
}
