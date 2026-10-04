import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import {
  pgCronJobById,
  pgCronRunById,
  pgEnqueueManualCronRun,
  pgEnsureSystemCronJobs,
  pgSchedulingAdminReadModel,
  pgTickCronDue,
} from "../src/cron/postgres-store.js";
import { pgClaimExecutionJobById, pgEnqueueExecutionJob, pgFailExecutionJob, pgRetryFailedExecutionJob } from "../src/execution-jobs/postgres-store.js";
import { executeCronRun } from "../src/cron/worker.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

describePostgres("native PostgreSQL Cron scheduler", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS execution_jobs (
        id TEXT PRIMARY KEY, job_type TEXT NOT NULL, tenant_ref TEXT NOT NULL, actor_ref TEXT NOT NULL,
        object_ref_json JSONB NOT NULL DEFAULT '{}'::jsonb, ticket_id TEXT, run_id TEXT, trigger_event_id TEXT,
        rule_id TEXT, rule_version TEXT, risk_level TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        scope_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb, priority_class TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, lease_until TEXT, lease_owner TEXT, next_attempt_at TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, receipt_json JSONB, error_code TEXT, error_summary TEXT,
        created_at TEXT NOT NULL, started_at TEXT, terminal_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_outbox (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE, event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at TEXT NOT NULL,
        published_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, publisher_id TEXT, publisher_lease_until TEXT
      );
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY, job_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, owner_account_id TEXT, execute_as TEXT NOT NULL,
        capability_expert_id TEXT NOT NULL, handler_key TEXT NOT NULL, scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        condition_json JSONB NOT NULL DEFAULT '{}'::jsonb, cron_expr TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL,
        retry_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb, takeover_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        published_rev INTEGER NOT NULL, next_run_at TIMESTAMPTZ, last_run_at TIMESTAMPTZ, last_terminal_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS cron_runs (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE, trigger TEXT NOT NULL, status TEXT NOT NULL,
        scheduled_for TEXT NOT NULL, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, error_code TEXT, error_summary TEXT,
        receipt_json JSONB, artifact_refs JSONB, session_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(job_id,scheduled_for)
      );
      CREATE TABLE IF NOT EXISTS execution_worker_heartbeats (
        worker_id TEXT PRIMARY KEY, worker_kind TEXT NOT NULL, status TEXT NOT NULL, details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(), heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(), stopped_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS scheduling_rules (
        id TEXT NOT NULL, version INTEGER NOT NULL, rule_type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
        scope_json JSONB NOT NULL DEFAULT '{}'::jsonb, definition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT NOT NULL, published_by TEXT, created_at TEXT NOT NULL, published_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(id,version)
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, task_type TEXT NOT NULL, profile TEXT NOT NULL,
        title TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal', due_at TEXT,
        business_category TEXT, stage_code TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_assignments (
        ticket_id TEXT NOT NULL, assignee_user_id TEXT, assignee_person_ref TEXT, role TEXT NOT NULL,
        status TEXT NOT NULL, assignment_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS ticket_watchers (
        ticket_id TEXT NOT NULL, watcher_user_id TEXT, status TEXT NOT NULL
      );
      TRUNCATE cron_runs, cron_jobs, execution_worker_heartbeats, scheduling_rules, execution_outbox, execution_jobs CASCADE;
      TRUNCATE ticket_watchers, ticket_assignments, tickets CASCADE;
    `);
  });

  afterAll(async () => { await closePostgresPool(); });

  it("seeds five system jobs and atomically enqueues a due run with an Outbox event", async () => {
    const pool = postgresPool();
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    const seed = await pool.query<{ count: string; disabled: string }>(
      "SELECT COUNT(*)::text AS count,MAX(status) FILTER (WHERE job_key='discovery-search') AS disabled FROM cron_jobs",
    );
    expect(seed.rows[0]).toEqual({ count: "5", disabled: "disabled" });

    const overdue = await pgCronJobById("overdue-scan");
    expect(overdue).toBeTruthy();
    await pool.query("UPDATE cron_jobs SET next_run_at=$1 WHERE id=$2", ["2030-12-31T23:59:00.000Z", overdue?.id]);
    const tick = await pgTickCronDue(now);
    expect(tick.claimed).toHaveLength(1);
    const run = await pgCronRunById(tick.claimed[0]!);
    expect(run).toMatchObject({ trigger: "schedule", status: "queued", job_id: overdue?.id });
    const dispatch = await pool.query<{ jobs: string; outbox: string }>(
      `SELECT (SELECT COUNT(*) FROM execution_jobs WHERE idempotency_key=$1)::text AS jobs,
              (SELECT COUNT(*) FROM execution_outbox)::text AS outbox`,
      [`cron-run:${tick.claimed[0]}`],
    );
    expect(dispatch.rows[0]).toEqual({ jobs: "1", outbox: "1" });
  });

  it("deduplicates manual slots and projects persisted scheduling operations", async () => {
    await pgEnsureSystemCronJobs(new Date("2031-01-01T00:00:00.000Z"));
    const overdue = await pgCronJobById("overdue-scan");
    const slot = "2031-01-02T08:00:00.000Z";
    const first = await pgEnqueueManualCronRun(String(overdue?.id), slot);
    const replay = await pgEnqueueManualCronRun(String(overdue?.id), slot);
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ run_id: first.run_id, duplicate: true });
    await postgresPool().query(
      `INSERT INTO scheduling_rules (id,version,rule_type,title,status,scope_json,definition_json,created_by,created_at,updated_at)
       VALUES ('rule_sla_preview',1,'sla','报价跟进 SLA（草案）','draft','{}','{}','biz:owner',$1,$1)`,
      ["2031-01-01T00:00:00.000Z"],
    );
    const model = await pgSchedulingAdminReadModel(50);
    expect(model).toMatchObject({ execution_mode: "postgres_redis_bullmq_multi_worker" });
    expect((model.items as Array<{ job_type: string }>).some((item) => item.job_type === "cron.run")).toBe(true);
    expect((model.rules as Array<{ id: string }>)[0]).toMatchObject({ id: "rule_sla_preview" });
  });

  it("re-publishes a failed low-risk execution job through a native Outbox transaction", async () => {
    const queued = await pgEnqueueExecutionJob({ job_type: "cron.run", tenant_ref: "company:test", actor_ref: "system", idempotency_key: "cron-retry-native-1" });
    await pgClaimExecutionJobById(String(queued.job.id), "cron-test-worker", { now: new Date("2031-01-01T00:00:00.000Z") });
    await pgFailExecutionJob(String(queued.job.id), { code: "handler_error", summary: "failed" }, { now: new Date("2031-01-01T00:00:01.000Z") });
    const retried = await pgRetryFailedExecutionJob(String(queued.job.id), { actor_ref: "operator", now: new Date("2031-01-01T00:00:02.000Z") });
    expect(retried).toMatchObject({ retried: true, job: { status: "queued" } });
    const outbox = await postgresPool().query<{ count: string }>("SELECT COUNT(*)::text AS count FROM execution_outbox WHERE job_id=$1", [queued.job.id]);
    expect(outbox.rows[0]).toEqual({ count: "2" });
  });

  it("executes read-only scans against PostgreSQL formal tickets and quarantines unmigrated business writers", async () => {
    const pool = postgresPool();
    await pgEnsureSystemCronJobs(new Date("2031-01-01T00:00:00.000Z"));
    await pool.query(
      `INSERT INTO tickets (id,owner_user_id,task_type,skill,profile,title,status,priority,due_at,business_category,stage_code,created_at,updated_at)
       VALUES ('ticket-overdue','u-cron','manual_ticket','ticket_form','ticket-workbench','逾期报价跟进','pending','urgent','2020-12-31T00:00:00.000Z','kol','QUOTE_PENDING','2031-01-01T00:00:00.000Z','2031-01-01T00:00:00.000Z')`,
    );
    await pool.query("INSERT INTO ticket_assignments (ticket_id,assignee_user_id,assignee_person_ref,org_unit_id,role,status,assignment_version) VALUES ('ticket-overdue','u-cron','person:cron','org:cron','primary','active',1)");
    const overdue = await pgCronJobById("overdue-scan");
    const overdueRun = await pgEnqueueManualCronRun(String(overdue?.id), "2031-01-01T08:00:00.000Z");
    await pool.query("UPDATE cron_runs SET status='running',started_at=$1 WHERE id=$2", ["2031-01-01T08:00:01.000Z", overdueRun.run_id]);
    const finished = await executeCronRun(overdueRun.run_id, undefined, Date.parse("2031-01-01T08:00:02.000Z"));
    expect(finished.status).toBe("succeeded");
    expect((finished.receipt_json as { source?: string; count?: number })).toMatchObject({ source: "postgresql_formal_tickets", count: 1 });

    const release = await pgCronJobById("ownership-release");
    const releaseRun = await pgEnqueueManualCronRun(String(release?.id), "2031-01-01T03:00:00.000Z");
    await pool.query("UPDATE cron_runs SET status='running',started_at=$1 WHERE id=$2", ["2031-01-01T03:00:01.000Z", releaseRun.run_id]);
    const quarantined = await executeCronRun(releaseRun.run_id, undefined, Date.parse("2031-01-01T03:00:02.000Z"));
    expect(quarantined).toMatchObject({ status: "needs_takeover", error_code: "postgres_handler_dependency_not_migrated" });
  });
});
