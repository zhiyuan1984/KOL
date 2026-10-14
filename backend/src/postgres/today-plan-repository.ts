import type { PoolClient } from "pg";
import { nid } from "../ids.js";
import { pgEnqueueExecutionJob } from "../execution-jobs/postgres-store.js";
import { postgresPool, postgresTransaction } from "./pool.js";
import type { Json } from "../types.js";

type PlanScope = "today" | "todo";
type NativeStart = {
  work_item_id: string;
  session_id: string;
  run_id: string;
  execution_job_id: string;
  producer: "deterministic_organize" | "agent_plan";
  attached: boolean;
  planning: boolean;
};

type Input = {
  owner: string;
  taskType: "today_plan" | "today_analyze";
  title: string;
  scope: PlanScope;
  producer: "deterministic_organize" | "agent_plan";
  payload: Json;
  extraPayload: Json;
  queuedLabel: string;
  progress?: Array<{ label: string; summary: string }>;
};

function stamp(): string { return new Date().toISOString(); }

async function appendEvent(client: PoolClient, workItemId: string, runId: string, eventType: string, label: string, status: string, summary: string): Promise<void> {
  const current = await client.query<{ sequence: string }>("SELECT COALESCE(MAX(sequence),0)::text AS sequence FROM task_events WHERE work_item_id=$1", [workItemId]);
  const now = stamp();
  await client.query(
    `INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
     VALUES ($1,$2,$3,$4,$5,'run_trace',$6,$7,$8,$9,$9)`,
    [nid("tev"), workItemId, runId, Number(current.rows[0]?.sequence || 0) + 1, eventType, label.slice(0, 160), status, summary.slice(0, 1000), now],
  );
}

async function existingPlan(owner: string): Promise<NativeStart | undefined> {
  const result = await postgresPool().query<Record<string, string>>(
    `SELECT t.id AS work_item_id,t.session_id,r.id AS run_id,j.id AS execution_job_id
       FROM tickets t JOIN task_runs r ON r.work_item_id=t.id
       LEFT JOIN LATERAL (SELECT id FROM execution_jobs WHERE run_id=r.id ORDER BY created_at DESC LIMIT 1) j ON true
      WHERE t.owner_user_id=$1 AND t.task_type='today_plan'
        AND t.status IN ('pending','queued','running','in_progress','starting')
      ORDER BY t.created_at DESC LIMIT 1`, [owner],
  );
  const row = result.rows[0];
  return row ? { work_item_id: row.work_item_id, session_id: row.session_id, run_id: row.run_id, execution_job_id: row.execution_job_id || "", producer: "deterministic_organize", attached: true, planning: true } : undefined;
}

export async function startNativeTodayPlan(input: Input): Promise<NativeStart> {
  const existing = input.taskType === "today_plan" ? await existingPlan(input.owner) : undefined;
  if (existing) return { ...existing, producer: input.producer };
  return postgresTransaction(async (client) => {
    const now = stamp();
    const sessionId = nid("ses");
    const workItemId = nid("tsk");
    const runId = nid("run");
    await client.query(
      `INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
       VALUES ($1,$2,$3,$3,$4,0,$5,$6,NULL)`,
      [sessionId, input.title, now, input.taskType, input.owner, input.taskType],
    );
    await client.query(
      `INSERT INTO tickets
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,session_id,input,entities,data_version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'planning','queued','normal',$3,$5,$6,$7,'{}',1,$8,$8)`,
      [workItemId, input.owner, input.taskType, input.title.slice(0, 200), input.taskType, sessionId, JSON.stringify(input.payload), now],
    );
    await client.query(
      `INSERT INTO task_runs (id,work_item_id,session_id,status,input,entities,created_at,started_at)
       VALUES ($1,$2,$3,'queued',$4,'{}',$5,NULL)`,
      [runId, workItemId, sessionId, JSON.stringify(input.payload), now],
    );
    const queued = await pgEnqueueExecutionJob({
      job_type: input.taskType === "today_plan" ? "work_plan.run" : "today_analyze.run",
      tenant_ref: "company:amperetime", actor_ref: input.owner, ticket_id: workItemId, run_id: runId,
      object_ref: { type: "ticket", id: workItemId }, rule_id: input.taskType === "today_plan" ? "workbench-plan" : "today-analyze",
      rule_version: "task-workbench.v1", risk_level: "low", scope_snapshot: { scope: input.scope, projection_version: "task-workbench.v1" },
      priority_class: "normal", max_attempts: 1, idempotency_key: `${input.taskType === "today_plan" ? "work_plan.run" : "today_analyze.run"}:${runId}`,
      payload: { owner: input.owner, work_item_id: workItemId, run_id: runId, scope: input.scope, task_payload: input.payload, ...input.extraPayload },
      outbox: { event_type: `${input.taskType === "today_plan" ? "work_plan.run" : "today_analyze.run"}.queued`, aggregate_type: "task_run", aggregate_id: runId, payload: { work_item_id: workItemId, run_id: runId, scope: input.scope } },
    }, { client });
    await appendEvent(client, workItemId, runId, "run.queued", input.queuedLabel, "queued", "已通过 PostgreSQL 原子事务持久化等待执行");
    for (const event of input.progress || []) await appendEvent(client, workItemId, runId, "run.progress", event.label, "queued", event.summary);
    return { work_item_id: workItemId, session_id: sessionId, run_id: runId, execution_job_id: String(queued.job.id), producer: input.producer, attached: false, planning: true };
  }, { isolation: "SERIALIZABLE" });
}
