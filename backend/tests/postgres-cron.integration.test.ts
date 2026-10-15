import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePostgresPool, postgresPool, postgresTransaction } from "../src/postgres/pool.js";
import {
  pgCronJobById,
  pgCronRunById,
  pgEnqueueManualCronRun,
  pgEnsureSystemCronJobs,
  pgSchedulingAdminReadModel,
  pgStartCronRun,
  pgTickCronDue,
} from "../src/cron/postgres-store.js";
import { pgClaimExecutionJobById, pgEnqueueExecutionJob, pgFailExecutionJob, pgRetryFailedExecutionJob } from "../src/execution-jobs/postgres-store.js";
import { executeCronRun, processCronExecutionJobById } from "../src/cron/worker.js";
import { CRON_HANDLERS } from "../src/cron/handlers.js";
import { pgCronTickHeartbeat, runCronTickWorker } from "../src/cron/tick-worker.js";

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
        condition_json TEXT NOT NULL DEFAULT '{}', cron_expr TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL,
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

  it("seeds six system jobs and atomically enqueues a due run with an Outbox event", async () => {
    const pool = postgresPool();
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    const seed = await pool.query<{ job_key: string; status: string }>(
      "SELECT job_key,status FROM cron_jobs ORDER BY job_key",
    );
    expect(seed.rows).toEqual([
      { job_key: "daily-task-snapshot", status: "published" },
      { job_key: "discovery-search", status: "disabled" },
      { job_key: "kol-pool-sync", status: "published" },
      { job_key: "mail-memory-increment", status: "published" },
      { job_key: "overdue-scan", status: "published" },
      { job_key: "ownership-release", status: "published" },
    ]);

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
    const releaseResult = await executeCronRun(releaseRun.run_id, undefined, Date.parse("2031-01-01T03:00:02.000Z"));
    expect(releaseResult).toMatchObject({ status: "succeeded" });
    expect(releaseResult.receipt_json).toMatchObject({ handler_key: "ownership-release" });
  });

  it("coalesces missed windows once, advances into the future and never executes the handler", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    const oldSlot = "2030-12-29T23:50:00.000Z";
    await pgEnsureSystemCronJobs(now);
    await postgresPool().query("UPDATE cron_jobs SET next_run_at=$1 WHERE job_key='mail-memory-increment'", [oldSlot]);
    const tick = await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false });
    expect(tick.claimed).toHaveLength(1);
    expect(await pgCronRunById(tick.claimed[0]!)).toMatchObject({ status: "queued", started_at: null, receipt_json: null, scheduled_for: oldSlot });
    const job = await pgCronJobById("mail-memory-increment");
    expect(new Date(job!.next_run_at as string).toISOString()).toBe("2031-01-01T00:10:00.000Z");
    const dispatch = await postgresPool().query("SELECT payload_json FROM execution_jobs WHERE job_type='cron.run'");
    const payload = typeof dispatch.rows[0].payload_json === "string" ? JSON.parse(dispatch.rows[0].payload_json) : dispatch.rows[0].payload_json;
    expect(payload.schedule_dispatch).toMatchObject({ missed_run_policy: "coalesce", first_due_at: oldSlot, advance_from: now.toISOString() });
    expect((await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false })).claimed).toEqual([]);
    expect((await postgresPool().query("SELECT COUNT(*)::int AS n FROM execution_outbox")).rows[0].n).toBe(1);
  });

  it("preserves the existing API replay policy unless coalescing is explicitly chosen", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    await postgresPool().query("UPDATE cron_jobs SET next_run_at='2030-12-29T23:50:00.000Z' WHERE job_key='mail-memory-increment'");
    expect((await pgTickCronDue(now, { ensure_system_jobs: false })).claimed).toHaveLength(1);
    const job = await pgCronJobById("mail-memory-increment");
    expect(new Date(job!.next_run_at as string).toISOString()).toBe("2030-12-30T00:00:00.000Z");
  });

  it("two concurrent tickers cannot create duplicate runs or Outbox events", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    await postgresPool().query("UPDATE cron_jobs SET next_run_at='2030-12-29T23:50:00.000Z' WHERE job_key='mail-memory-increment'");
    const options = { missed_run_policy: "coalesce" as const, ensure_system_jobs: false };
    const results = await Promise.all([pgTickCronDue(now, options), pgTickCronDue(now, options)]);
    expect(results.flatMap((result) => result.claimed)).toHaveLength(1);
    for (const table of ["cron_runs", "execution_jobs", "execution_outbox"]) {
      expect((await postgresPool().query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n).toBe(1);
    }
  });

  it("an outer rollback preserves the old clock and removes the run, execution job and Outbox together", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    const oldSlot = "2030-12-29T23:50:00.000Z";
    await pgEnsureSystemCronJobs(now);
    await postgresPool().query("UPDATE cron_jobs SET next_run_at=$1 WHERE job_key='mail-memory-increment'", [oldSlot]);
    await expect(postgresTransaction(async () => {
      expect((await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false })).claimed).toHaveLength(1);
      throw new Error("synthetic outer rollback");
    })).rejects.toThrow("synthetic outer rollback");
    expect(new Date((await pgCronJobById("mail-memory-increment"))!.next_run_at as string).toISOString()).toBe(oldSlot);
    for (const table of ["cron_runs", "execution_jobs", "execution_outbox"]) {
      expect((await postgresPool().query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });

  it("bootstrap and recurring ticks preserve explicitly disabled system jobs and custom conditions", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    const condition = JSON.stringify({ enabled: false, operator_pause: true, idle_days: 14 });
    await postgresPool().query("UPDATE cron_jobs SET status='disabled',condition_json=$1,next_run_at='2030-12-29T23:50:00.000Z' WHERE job_key IN ('mail-memory-increment','ownership-release')", [condition]);
    await pgEnsureSystemCronJobs(now);
    expect((await pgTickCronDue(now, { missed_run_policy: "coalesce" })).claimed).toEqual([]);
    for (const key of ["mail-memory-increment", "ownership-release"]) {
      const job = await pgCronJobById(key);
      expect(job?.status).toBe("disabled");
      expect(typeof job?.condition_json === "string" ? JSON.parse(job.condition_json) : job?.condition_json).toEqual(JSON.parse(condition));
    }
  });

  it("a due single-run window is queued once and then has no next run", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    const oldSlot = "2030-12-31T23:50:00.000Z";
    await pgEnsureSystemCronJobs(now);
    await postgresPool().query("UPDATE cron_jobs SET next_run_at=$1,condition_json=$2 WHERE job_key='mail-memory-increment'", [oldSlot, JSON.stringify({ schedule: { kind: "once", once_at: oldSlot } })]);
    expect((await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false })).claimed).toHaveLength(1);
    expect((await pgCronJobById("mail-memory-increment"))?.next_run_at).toBeNull();
    expect((await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false })).claimed).toEqual([]);
  });

  it("a configured synthetic AI job is only enqueued, with no invented session or terminal receipt", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    await postgresPool().query("UPDATE cron_jobs SET handler_key='ai-task',execute_as='synthetic-employee',next_run_at='2030-12-31T23:59:00.000Z' WHERE job_key='overdue-scan'");
    const tick = await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false });
    expect(tick.claimed).toHaveLength(1);
    expect(await pgCronRunById(tick.claimed[0]!)).toMatchObject({ status: "queued", session_id: null, receipt_json: null, started_at: null });
    expect((await postgresPool().query("SELECT actor_ref,status FROM execution_jobs")).rows[0]).toMatchObject({ actor_ref: "synthetic-employee", status: "queued" });
  });

  it("records a fresh Cron worker generation and explicit stop in the existing heartbeat table", async () => {
    await pgCronTickHeartbeat("synthetic-ticker", "running", { enqueue_only: true }, "2020-01-01T00:00:00.000Z");
    await pgCronTickHeartbeat("synthetic-ticker", "stopped", { enqueue_only: true });
    let row = (await postgresPool().query("SELECT * FROM execution_worker_heartbeats WHERE worker_id='synthetic-ticker'")).rows[0];
    expect(row).toMatchObject({ worker_kind: "cron-tick", status: "stopped" });
    expect(row.stopped_at).toBeTruthy();
    await pgCronTickHeartbeat("synthetic-ticker", "running", { enqueue_only: true }, "2021-01-01T00:00:00.000Z");
    row = (await postgresPool().query("SELECT * FROM execution_worker_heartbeats WHERE worker_id='synthetic-ticker'")).rows[0];
    expect(new Date(row.started_at).toISOString()).toBe("2021-01-01T00:00:00.000Z");
    expect(row.stopped_at).toBeNull();
  });

  it("marks only truly stale runs and never fabricates no-side-effect evidence", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    await pgEnsureSystemCronJobs(now);
    const job = await pgCronJobById("mail-memory-increment");
    const queued = await pgEnqueueManualCronRun(String(job!.id), "synthetic-stale-slot");
    await postgresPool().query("UPDATE cron_runs SET status='running',started_at=$1 WHERE id=$2", [now.toISOString(), queued.run_id]);
    const healthyTick = await pgTickCronDue(now, { missed_run_policy: "coalesce", ensure_system_jobs: false });
    expect(healthyTick.stale).toBe(false);
    expect((await pgCronRunById(queued.run_id))?.status).toBe("running");
    const later = new Date(now.getTime() + 31 * 60_000);
    const staleTick = await pgTickCronDue(later, { missed_run_policy: "coalesce", ensure_system_jobs: false });
    expect(staleTick.stale).toBe(true);
    expect(await pgCronRunById(queued.run_id)).toMatchObject({ status: "needs_takeover", error_code: "stale_run", receipt_json: {
      side_effect: "unknown", created_session: null, reconciliation_required: true,
    } });
  });

  it("runs the actual native resident worker, commits only queue state, and drains cleanly on stop", async () => {
    await pgEnsureSystemCronJobs(new Date("2031-01-01T00:00:00.000Z"));
    await postgresPool().query("UPDATE cron_jobs SET next_run_at='2020-01-01T00:00:00.000Z' WHERE job_key='mail-memory-increment'");
    const controller = new AbortController();
    const listenersBefore = process.listenerCount("SIGTERM");
    const worker = runCronTickWorker({ worker_id: "synthetic-resident", poll_ms: 250, missed_run_policy: "coalesce", signal: controller.signal });
    let success = false;
    let workerFailure: unknown;
    worker.catch((error) => { workerFailure = error; });
    const deadline = Date.now() + 12_000;
    try {
      while (Date.now() < deadline && !workerFailure) {
        const row = (await postgresPool().query("SELECT details_json FROM execution_worker_heartbeats WHERE worker_id='synthetic-resident'")).rows[0];
        const details = typeof row?.details_json === "string" ? JSON.parse(row.details_json) : row?.details_json;
        if (details?.last_success_at) { success = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      controller.abort();
      await worker;
    }
    expect(success).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(listenersBefore);
    expect((await postgresPool().query("SELECT status FROM execution_worker_heartbeats WHERE worker_id='synthetic-resident'")).rows[0].status).toBe("stopped");
    expect((await postgresPool().query("SELECT status,started_at,receipt_json FROM cron_runs")).rows).toEqual([{ status: "queued", started_at: null, receipt_json: null }]);
  }, 20_000);

  it.each([false, true])("persists actual completion time for Cron and Execution on handler failure=%s", async (fail) => {
    const start = Date.parse("2031-01-01T00:00:00.000Z");
    const finish = start + 5_000;
    const original = CRON_HANDLERS["overdue-scan"];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    try {
      await pgEnsureSystemCronJobs(new Date(start));
      const job = await pgCronJobById("overdue-scan");
      const run = await pgEnqueueManualCronRun(String(job!.id), "synthetic-live-terminal-clock");
      const execution = (await postgresPool().query("SELECT id FROM execution_jobs WHERE payload_json::jsonb->>'cron_run_id'=$1", [run.run_id])).rows[0];
      CRON_HANDLERS["overdue-scan"] = async (context) => {
        expect(context.nowMs).toBe(start);
        vi.setSystemTime(finish);
        if (fail) throw new Error("synthetic handler failure after model wait");
        return { status: "succeeded", receipt: { source: "synthetic-clock-test", side_effect: "none" } };
      };
      expect(await processCronExecutionJobById(String(execution.id), "synthetic-clock-worker")).toBe(run.run_id);
      const terminal = await pgCronRunById(run.run_id);
      const dispatch = (await postgresPool().query("SELECT status,started_at,terminal_at FROM execution_jobs WHERE id=$1", [execution.id])).rows[0];
      expect(terminal?.status).toBe(fail ? "failed" : "succeeded");
      expect(dispatch.status).toBe(fail ? "failed" : "succeeded");
      expect(new Date(String(terminal!.started_at)).getTime()).toBe(start);
      expect(new Date(String(terminal!.finished_at)).getTime()).toBe(finish);
      expect(new Date(String(dispatch.started_at)).getTime()).toBe(start);
      expect(new Date(String(dispatch.terminal_at)).getTime()).toBe(finish);
      if (fail) expect(terminal?.error_code).toBe("handler_error");
    } finally {
      CRON_HANDLERS["overdue-scan"] = original;
      vi.useRealTimers();
    }
  });

  it("direct native Cron execution samples the live clock after the handler returns", async () => {
    const start = Date.parse("2031-01-01T00:00:00.000Z");
    const original = CRON_HANDLERS["overdue-scan"];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    try {
      await pgEnsureSystemCronJobs(new Date(start));
      const job = await pgCronJobById("overdue-scan");
      const run = await pgEnqueueManualCronRun(String(job!.id), "synthetic-direct-terminal-clock");
      await pgStartCronRun(run.run_id, new Date(start));
      CRON_HANDLERS["overdue-scan"] = async (context) => {
        expect(context.nowMs).toBe(start);
        vi.setSystemTime(start + 5_000);
        return { status: "succeeded", receipt: { side_effect: "none" } };
      };
      const terminal = await executeCronRun(run.run_id);
      expect(new Date(String(terminal.finished_at)).getTime()).toBe(start + 5_000);
    } finally {
      CRON_HANDLERS["overdue-scan"] = original;
      vi.useRealTimers();
    }
  });

  it("retains explicitly supplied deterministic clocks without freezing the default production clock", async () => {
    const fixed = Date.parse("2031-01-01T00:00:00.000Z");
    const original = CRON_HANDLERS["overdue-scan"];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixed);
    try {
      await pgEnsureSystemCronJobs(new Date(fixed));
      const job = await pgCronJobById("overdue-scan");
      const run = await pgEnqueueManualCronRun(String(job!.id), "synthetic-fixed-terminal-clock");
      const execution = (await postgresPool().query("SELECT id FROM execution_jobs WHERE payload_json::jsonb->>'cron_run_id'=$1", [run.run_id])).rows[0];
      CRON_HANDLERS["overdue-scan"] = async (context) => {
        expect(context.nowMs).toBe(fixed);
        vi.setSystemTime(fixed + 5_000);
        return { status: "succeeded", receipt: { side_effect: "none" } };
      };
      await processCronExecutionJobById(String(execution.id), "synthetic-fixed-clock-worker", undefined, fixed);
      const terminal = await pgCronRunById(run.run_id);
      const dispatch = (await postgresPool().query("SELECT terminal_at FROM execution_jobs WHERE id=$1", [execution.id])).rows[0];
      expect(new Date(String(terminal!.finished_at)).getTime()).toBe(fixed);
      expect(new Date(String(dispatch.terminal_at)).getTime()).toBe(fixed);
    } finally {
      CRON_HANDLERS["overdue-scan"] = original;
      vi.useRealTimers();
    }
  });
});
