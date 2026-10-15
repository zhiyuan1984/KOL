import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import {
  executeNativeClaimedPlanningJob,
  nativeTodayBriefSnapshot,
  nativeTodayPlanContext,
  nativeTodayTaskResults,
  recoverNativeTaskRuns,
  startNativeTodayPlan,
} from "../src/postgres/today-plan-repository.js";
import type { Json } from "../src/types.js";
import type { ClaimedExecutionJob } from "../src/execution-jobs/contracts.js";

const OWNER = "task-chain-native-owner";
const OTHER_OWNER = "task-chain-other-owner";

function input(owner = OWNER) {
  return {
    owner,
    taskType: "today_plan" as const,
    title: "原生今日计划",
    scope: "today" as const,
    producer: "agent_plan" as const,
    payload: { mode: "today_plan", skip_user_memory: true } as Json,
    extraPayload: { producer: "deterministic_organize" } as Json,
    queuedLabel: "工作计划已入队",
  };
}

describe("task-chain native PostgreSQL plan", () => {
  beforeEach(async () => {
    await freshTestDatabase();
  });
  afterEach(async () => {
    await closePostgresPool();
  });

  it("uses an owner advisory lock so concurrent starts create one session/run/job", async () => {
    const [first, second] = await Promise.all([(await startNativeTodayPlan(input())), (await startNativeTodayPlan(input()))]);
    expect([first.attached, second.attached].filter(Boolean)).toHaveLength(1);
    expect(first.work_item_id).toBe(second.work_item_id);
    const facts = await postgresPool().query<{ sessions: string; tickets: string; runs: string; jobs: string; events: string }>(
      `SELECT
        (SELECT COUNT(*) FROM sessions WHERE owner_user_id=$1)::text AS sessions,
        (SELECT COUNT(*) FROM tickets WHERE owner_user_id=$1 AND task_type='today_plan')::text AS tickets,
        (SELECT COUNT(*) FROM task_runs WHERE work_item_id=$2)::text AS runs,
        (SELECT COUNT(*) FROM execution_jobs WHERE run_id=$3)::text AS jobs,
        (SELECT COUNT(*) FROM task_events WHERE work_item_id=$2 AND event_type='run.queued')::text AS events`,
      [OWNER, first.work_item_id, first.run_id],
    );
    expect(facts.rows[0]).toEqual({ sessions: "1", tickets: "1", runs: "1", jobs: "1", events: "1" });
  });

  it("executes real worker plan with native artifacts and excludes a different tenant's task", async () => {
    const now = new Date().toISOString();
    await postgresPool().query(
      `INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)
       VALUES ('task-chain-visible',$1,'manual_ticket','我的任务','manual','pending','normal','manual_ticket','default','{}','{}',1,$3,$3),
              ('task-chain-hidden',$2,'manual_ticket','他人的任务','manual','pending','normal','manual_ticket','default','{}','{}',1,$3,$3)`,
      [OWNER, OTHER_OWNER, now],
    );
    const pack = await nativeTodayPlanContext(OWNER);
    expect(pack.catalog.map((item) => item.work_item_id)).toContain("task-chain-visible");
    expect(pack.catalog.map((item) => item.work_item_id)).not.toContain("task-chain-hidden");
    const started = await startNativeTodayPlan({ ...input(), payload: { mode: "today_plan", pack } });
    const claimed = {
      id: started.execution_job_id,
      job_type: "work_plan.run",
      tenant_ref: "company:amperetime",
      actor_ref: OWNER,
      ticket_id: started.work_item_id,
      run_id: started.run_id,
      worker_id: "test-worker",
      payload_json: JSON.stringify({ owner: OWNER, work_item_id: started.work_item_id, run_id: started.run_id, session_id: started.session_id, scope: "today", pack, producer: "agent_plan" }),
    } as unknown as ClaimedExecutionJob;
    const [receipt, duplicate] = await Promise.all([
      (await executeNativeClaimedPlanningJob(claimed)),
      (await executeNativeClaimedPlanningJob({ ...claimed, worker_id: "second-test-worker" } as ClaimedExecutionJob)),
    ]);
    expect(receipt).toMatchObject({ work_item_id: started.work_item_id, run_id: started.run_id, mode: "agent_plan" });
    expect(duplicate).toMatchObject({ work_item_id: started.work_item_id, run_id: started.run_id, duplicate: true });
    const snapshot = await nativeTodayBriefSnapshot(OWNER);
    expect(snapshot).toMatchObject({ status: "ready", work_item_id: started.work_item_id });
    const results = await nativeTodayTaskResults(OWNER);
    expect((results?.items as Array<{ work_item_id: string }>).map((item) => item.work_item_id)).toEqual(["task-chain-visible"]);
    const status = await postgresPool().query<{ ticket_status: string; run_status: string }>(
      "SELECT t.status AS ticket_status,r.status AS run_status FROM tickets t JOIN task_runs r ON r.work_item_id=t.id WHERE t.id=$1 AND r.id=$2",
      [started.work_item_id, started.run_id],
    );
    expect(status.rows[0]).toEqual({ ticket_status: "waiting", run_status: "completed" });
  });

  it("marks only running task-runs failed during restart recovery and appends terminal evidence", async () => {
    const started = await startNativeTodayPlan(input());
    await postgresPool().query("UPDATE task_runs SET status='running' WHERE id=$1", [started.run_id]);
    await postgresPool().query("UPDATE tickets SET status='running' WHERE id=$1", [started.work_item_id]);
    const touched = await recoverNativeTaskRuns("测试重启恢复");
    expect(touched).toContain(started.work_item_id);
    const evidence = await postgresPool().query<{ run_status: string; ticket_status: string; n: string }>(
      `SELECT r.status AS run_status,t.status AS ticket_status,
        (SELECT COUNT(*) FROM task_events WHERE work_item_id=$1 AND run_id=$2 AND event_type='run.failed')::text AS n
       FROM tickets t JOIN task_runs r ON r.work_item_id=t.id WHERE t.id=$1 AND r.id=$2`,
      [started.work_item_id, started.run_id],
    );
    expect(evidence.rows[0]).toEqual({ run_status: "failed", ticket_status: "failed", n: "1" });
  });
});
