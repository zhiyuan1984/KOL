import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import {
  pgClaimExecutionJobById,
  pgCompleteExecutionJob,
  pgEnqueueExecutionJob,
  pgFailExecutionJob,
  pgRecoverExpiredExecutionJobs,
} from "../src/execution-jobs/postgres-store.js";
import { dispatchClaimedExecutionJob } from "../src/execution-jobs/dispatcher.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;

const describePostgres = configured ? describe : describe.skip;

describePostgres("native PostgreSQL execution-job repository", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS execution_jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        tenant_ref TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        object_ref_json TEXT NOT NULL DEFAULT '{}',
        ticket_id TEXT,
        run_id TEXT,
        trigger_event_id TEXT,
        rule_id TEXT,
        rule_version TEXT,
        risk_level TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        scope_snapshot_json TEXT NOT NULL DEFAULT '{}',
        priority_class TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        lease_until TEXT,
        lease_owner TEXT,
        next_attempt_at TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        receipt_json TEXT,
        error_code TEXT,
        error_summary TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        terminal_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_outbox (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        published_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        publisher_id TEXT,
        publisher_lease_until TEXT
      );
      TRUNCATE execution_outbox, execution_jobs;
    `);
  });

  afterAll(async () => {
    await closePostgresPool();
  });

  it("writes an authority job and Outbox dispatch atomically, then deduplicates replays", async () => {
    const input = {
      job_type: "cron.run",
      tenant_ref: "company:test",
      actor_ref: "system:test",
      idempotency_key: "native-job-idempotency-0001",
      payload: { cron_run_id: "run-native-1" },
      max_attempts: 2,
    };
    const first = await pgEnqueueExecutionJob(input);
    const replay = await pgEnqueueExecutionJob(input);
    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, job: { id: first.job.id } });

    const counts = await postgresPool().query<{ jobs: string; outbox: string }>(
      "SELECT (SELECT COUNT(*) FROM execution_jobs)::text AS jobs,(SELECT COUNT(*) FROM execution_outbox)::text AS outbox",
    );
    expect(counts.rows[0]).toEqual({ jobs: "1", outbox: "1" });
  });

  it("claims once, renews ownership, schedules a low-risk retry and completes it", async () => {
    const queued = await pgEnqueueExecutionJob({
      job_type: "cron.run",
      tenant_ref: "company:test",
      actor_ref: "system:test",
      idempotency_key: "native-job-idempotency-0002",
      max_attempts: 2,
    });
    const claimed = await pgClaimExecutionJobById(String(queued.job.id), "worker-native", {
      now: new Date("2031-01-01T00:00:00.000Z"),
    });
    expect(claimed).toMatchObject({ id: queued.job.id, worker_id: "worker-native", status: "running", attempts: 1 });
    expect(await pgClaimExecutionJobById(String(queued.job.id), "worker-second")).toBeNull();

    const failed = await pgFailExecutionJob(String(queued.job.id), { code: "temporary", summary: "network timeout" }, {
      now: new Date("2031-01-01T00:00:01.000Z"),
    });
    expect(failed).toMatchObject({ status: "retrying", error_code: "temporary" });

    const reClaimed = await pgClaimExecutionJobById(String(queued.job.id), "worker-native", {
      now: new Date("2031-01-01T00:00:10.000Z"),
    });
    expect(reClaimed?.status).toBe("running");
    const done = await pgCompleteExecutionJob(String(queued.job.id), { receipt: "ok" }, new Date("2031-01-01T00:00:11.000Z"));
    expect(done).toMatchObject({ status: "succeeded", lease_owner: null });
  });

  it("requeues an expired low-risk lease with a fresh Outbox handoff", async () => {
    const queued = await pgEnqueueExecutionJob({
      job_type: "cron.run",
      tenant_ref: "company:test",
      actor_ref: "system:test",
      idempotency_key: "native-job-idempotency-0003",
      max_attempts: 2,
    });
    await pgClaimExecutionJobById(String(queued.job.id), "worker-expired", {
      lease_ms: 1_000,
      now: new Date("2031-01-01T00:00:00.000Z"),
    });
    const recovered = await pgRecoverExpiredExecutionJobs(new Date("2031-01-01T00:00:02.000Z"));
    expect(recovered).toEqual({ requeued: 1, uncertain: 0 });
    const state = await postgresPool().query<{ status: string; lease_owner: string | null }>(
      "SELECT status,lease_owner FROM execution_jobs WHERE id=$1",
      [queued.job.id],
    );
    expect(state.rows[0]).toEqual({ status: "retrying", lease_owner: null });
    const outbox = await postgresPool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM execution_outbox WHERE job_id=$1",
      [queued.job.id],
    );
    expect(Number(outbox.rows[0]?.count || 0)).toBe(2);
  });

  it("quarantines retired planning job types without loading a legacy handler", async () => {
    const queued = await pgEnqueueExecutionJob({
      job_type: "work_plan.run",
      tenant_ref: "company:test",
      actor_ref: "system:test",
      idempotency_key: "native-job-planning-quarantine-0001",
    });
    const claimed = await pgClaimExecutionJobById(String(queued.job.id), "worker-native");
    expect(claimed).not.toBeNull();
    const dispatched = await dispatchClaimedExecutionJob(claimed!);
    expect(dispatched).toMatchObject({ job_type: "work_plan.run", handled: false, outcome: "needs_takeover", target_id: null });
    const state = await postgresPool().query<{ status: string; error_code: string; lease_owner: string | null }>(
      "SELECT status,error_code,lease_owner FROM execution_jobs WHERE id=$1",
      [queued.job.id],
    );
    expect(state.rows[0]).toEqual({ status: "uncertain", error_code: "needs_takeover", lease_owner: null });
  });
});
