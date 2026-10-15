import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  claimExecutionJobById,
  claimNextExecutionJob,
  completeExecutionJob,
  enqueueExecutionJob,
  executionJobById,
  failExecutionJob,
  publishExecutionOutboxForJob,
  recoverExpiredExecutionJobs,
  renewExecutionJobLease,
  retryFailedExecutionJob,
} from "../src/execution-jobs/store.js";
import { freshTestDatabase } from "./support/pg.js";

beforeEach(async () => {
  await freshTestDatabase({ reclaimPrevious: true });
});

afterEach(async () => {
  await resetConn();
});

describe("PostgreSQL execution jobs", () => {
  it("persists one idempotent job and its outbox fact atomically", async () => {
    const input = {
      job_type: "cron.run",
      tenant_ref: "company:amperetime",
      actor_ref: "system",
      idempotency_key: "cron-run:test-001",
      payload: { cron_run_id: "crun_test_001" },
    };
    const first = (await enqueueExecutionJob(input));
    const replay = (await enqueueExecutionJob(input));
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.job.id).toBe(first.job.id);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS count FROM execution_jobs",[])).rows[0] as { count: unknown }).count)).toBe(1);
    const outbox = (await getConn().query("SELECT * FROM execution_outbox WHERE job_id=$1",[first.job.id])).rows[0] as { status: string; event_type: string };
    expect(outbox).toMatchObject({ status: "pending", event_type: "execution_job.queued" });
  });

  it("claims once, records delivery only for the publisher lease, and records a terminal receipt", async () => {
    const queued = (await enqueueExecutionJob({
      job_type: "cron.run", tenant_ref: "company:amperetime", actor_ref: "system",
      idempotency_key: "cron-run:test-002", payload: { cron_run_id: "crun_test_002" },
    }));
    const claimed = (await claimNextExecutionJob("test-worker", { job_types: ["cron.run"], now: new Date("2030-10-02T00:00:00.000Z") }));
    expect(claimed?.id).toBe(queued.job.id);
    expect((await claimExecutionJobById(String(queued.job.id), "second-worker"))).toBeNull();
    const handoffAt = new Date("2030-10-02T00:00:01.000Z");
    const publisher = "test-outbox-publisher";
    expect((await publishExecutionOutboxForJob(String(queued.job.id), publisher, handoffAt))).toBe(0);
    const handoff = await getConn().query(
      `UPDATE execution_outbox
       SET status='publishing',attempts=attempts+1,publisher_id=$1,publisher_lease_until=$2,updated_at=$3
       WHERE job_id=$4 AND status='pending'
       RETURNING id`,
      [publisher, new Date(handoffAt.getTime() + 60_000).toISOString(), handoffAt.toISOString(), queued.job.id],
    );
    expect(handoff.rowCount).toBe(1);
    expect((await publishExecutionOutboxForJob(String(queued.job.id), "second-publisher", handoffAt))).toBe(0);
    expect((await publishExecutionOutboxForJob(String(queued.job.id), publisher, handoffAt))).toBe(1);
    const completed = (await completeExecutionJob(String(queued.job.id), { cron_run_id: "crun_test_002", cron_status: "succeeded" }, new Date("2030-10-02T00:00:02.000Z")));
    expect(completed).toMatchObject({ status: "succeeded", lease_until: null });
    expect(((await getConn().query("SELECT status FROM execution_outbox WHERE job_id=$1",[queued.job.id])).rows[0] as { status: string }).status).toBe("published");
  });

  it("never blindly retries an expired high-risk lease", async () => {
    const high = (await enqueueExecutionJob({
      job_type: "write.operation", tenant_ref: "company:amperetime", actor_ref: "system",
      idempotency_key: "write:test-003", risk_level: "high", max_attempts: 3,
    }));
    const claimed = (await claimExecutionJobById(String(high.job.id), "test-worker", { lease_ms: 1_000, now: new Date("2030-10-02T00:00:00.000Z") }));
    expect(claimed).toBeTruthy();
    const recovered = (await recoverExpiredExecutionJobs(new Date("2030-10-02T00:01:00.000Z")));
    expect(recovered).toEqual({ requeued: 0, uncertain: 1 });
    expect((await executionJobById(String(high.job.id)))).toMatchObject({ status: "uncertain", error_code: "lease_expired" });
  });

  it("renews only the lease owned by the active worker", async () => {
    const job = (await enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:lease-owner-001", max_attempts: 2,
    }));
    const claimed = (await claimExecutionJobById(String(job.job.id), "worker-a", {
      lease_ms: 10_000, now: new Date("2030-10-02T00:00:00.000Z"),
    }));
    expect(claimed).toMatchObject({ lease_owner: "worker-a" });
    expect((await renewExecutionJobLease(String(job.job.id), "worker-b", {
      lease_ms: 60_000, now: new Date("2030-10-02T00:00:05.000Z"),
    }))).toBe(false);
    expect((await renewExecutionJobLease(String(job.job.id), "worker-a", {
      lease_ms: 60_000, now: new Date("2030-10-02T00:00:05.000Z"),
    }))).toBe(true);
    expect((await executionJobById(String(job.job.id)))).toMatchObject({
      lease_owner: "worker-a",
      lease_until: "2030-10-02T00:01:05.000Z",
    });
  });

  it("writes a fresh dispatch fact when a low-risk worker lease expires", async () => {
    const job = (await enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:lease-recovery-001", max_attempts: 2,
    }));
    expect((await claimExecutionJobById(String(job.job.id), "worker-a", {
      lease_ms: 1_000, now: new Date("2030-10-02T00:00:00.000Z"),
    }))).toBeTruthy();
    expect((await recoverExpiredExecutionJobs(new Date("2030-10-02T00:01:00.000Z")))).toEqual({ requeued: 1, uncertain: 0 });
    expect((await executionJobById(String(job.job.id)))).toMatchObject({ status: "retrying", lease_owner: null, error_code: "lease_expired" });
    const outbox = (await getConn().query("SELECT event_type,status FROM execution_outbox WHERE job_id=$1 ORDER BY created_at,id",[job.job.id])).rows as Array<{ event_type: string; status: string }>;
    expect(outbox).toEqual([
      { event_type: "execution_job.queued", status: "pending" },
      { event_type: "execution_job.lease_recovered", status: "pending" },
    ]);
  });

  it("creates a retry dispatch fact when a low-risk handler failure is retryable", async () => {
    const job = (await enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:failure-retry-001", max_attempts: 2,
    }));
    expect((await claimExecutionJobById(String(job.job.id), "worker-a"))).toBeTruthy();
    (await failExecutionJob(String(job.job.id), { code: "model_timeout", summary: "model timeout" }, {
      now: new Date("2030-10-02T00:00:00.000Z"),
    }));
    expect((await executionJobById(String(job.job.id)))).toMatchObject({ status: "retrying", lease_owner: null });
    expect(Number(((await getConn().query("SELECT COUNT(*) AS count FROM execution_outbox WHERE job_id=$1",[job.job.id])).rows[0] as { count: unknown }).count)).toBe(2);
  });

  it("re-publishes only an explicitly requested failed low-risk job", async () => {
    const low = (await enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:test-004", risk_level: "low",
    }));
    expect((await claimExecutionJobById(String(low.job.id), "test-worker"))).toBeTruthy();
    (await failExecutionJob(String(low.job.id), { code: "model_timeout", summary: "model timeout" }));
    const retried = (await retryFailedExecutionJob(String(low.job.id), { actor_ref: "admin:test" }));
    expect(retried.retried).toBe(true);
    expect(retried.job).toMatchObject({ status: "queued", error_code: null, max_attempts: 2 });
    expect(Number(((await getConn().query("SELECT COUNT(*) AS count FROM execution_outbox WHERE job_id=$1",[low.job.id])).rows[0] as { count: unknown }).count)).toBe(2);

    const high = (await enqueueExecutionJob({
      job_type: "write.operation", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "write:test-005", risk_level: "high",
    }));
    expect((await claimExecutionJobById(String(high.job.id), "test-worker"))).toBeTruthy();
    (await failExecutionJob(String(high.job.id), { code: "write_timeout", summary: "outcome unknown" }));
    expect((await retryFailedExecutionJob(String(high.job.id), { actor_ref: "admin:test" }))).toMatchObject({
      retried: false, reason: "not_failed",
    });
  });
});
