import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-execution-jobs-"));
  process.env.LINGONG_DB = path.join(tmp, "jobs.db");
  process.env.LINGONG_DATA = tmp;
  resetConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("SQLite transition execution jobs", () => {
  it("persists one idempotent job and its outbox fact atomically", () => {
    const input = {
      job_type: "cron.run",
      tenant_ref: "company:amperetime",
      actor_ref: "system",
      idempotency_key: "cron-run:test-001",
      payload: { cron_run_id: "crun_test_001" },
    };
    const first = enqueueExecutionJob(input);
    const replay = enqueueExecutionJob(input);
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.job.id).toBe(first.job.id);
    expect((getConn().prepare("SELECT COUNT(*) AS count FROM execution_jobs").get() as { count: number }).count).toBe(1);
    const outbox = getConn().prepare("SELECT * FROM execution_outbox WHERE job_id=?").get(first.job.id) as { status: string; event_type: string };
    expect(outbox).toMatchObject({ status: "pending", event_type: "execution_job.queued" });
  });

  it("claims once, publishes the local handoff, and records a terminal receipt", () => {
    const queued = enqueueExecutionJob({
      job_type: "cron.run", tenant_ref: "company:amperetime", actor_ref: "system",
      idempotency_key: "cron-run:test-002", payload: { cron_run_id: "crun_test_002" },
    });
    const claimed = claimNextExecutionJob("test-worker", { job_types: ["cron.run"], now: new Date("2030-10-02T00:00:00.000Z") });
    expect(claimed?.id).toBe(queued.job.id);
    expect(claimExecutionJobById(String(queued.job.id), "second-worker")).toBeNull();
    expect(publishExecutionOutboxForJob(String(queued.job.id), "test-worker", new Date("2030-10-02T00:00:01.000Z"))).toBe(1);
    const completed = completeExecutionJob(String(queued.job.id), { cron_run_id: "crun_test_002", cron_status: "succeeded" }, new Date("2030-10-02T00:00:02.000Z"));
    expect(completed).toMatchObject({ status: "succeeded", lease_until: null });
    expect((getConn().prepare("SELECT status FROM execution_outbox WHERE job_id=?").get(queued.job.id) as { status: string }).status).toBe("published");
  });

  it("never blindly retries an expired high-risk lease", () => {
    const high = enqueueExecutionJob({
      job_type: "write.operation", tenant_ref: "company:amperetime", actor_ref: "system",
      idempotency_key: "write:test-003", risk_level: "high", max_attempts: 3,
    });
    const claimed = claimExecutionJobById(String(high.job.id), "test-worker", { lease_ms: 1_000, now: new Date("2030-10-02T00:00:00.000Z") });
    expect(claimed).toBeTruthy();
    const recovered = recoverExpiredExecutionJobs(new Date("2030-10-02T00:01:00.000Z"));
    expect(recovered).toEqual({ requeued: 0, uncertain: 1 });
    expect(executionJobById(String(high.job.id))).toMatchObject({ status: "uncertain", error_code: "lease_expired" });
  });

  it("renews only the lease owned by the active worker", () => {
    const job = enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:lease-owner-001", max_attempts: 2,
    });
    const claimed = claimExecutionJobById(String(job.job.id), "worker-a", {
      lease_ms: 10_000, now: new Date("2030-10-02T00:00:00.000Z"),
    });
    expect(claimed).toMatchObject({ lease_owner: "worker-a" });
    expect(renewExecutionJobLease(String(job.job.id), "worker-b", {
      lease_ms: 60_000, now: new Date("2030-10-02T00:00:05.000Z"),
    })).toBe(false);
    expect(renewExecutionJobLease(String(job.job.id), "worker-a", {
      lease_ms: 60_000, now: new Date("2030-10-02T00:00:05.000Z"),
    })).toBe(true);
    expect(executionJobById(String(job.job.id))).toMatchObject({
      lease_owner: "worker-a",
      lease_until: "2030-10-02T00:01:05.000Z",
    });
  });

  it("writes a fresh dispatch fact when a low-risk worker lease expires", () => {
    const job = enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:lease-recovery-001", max_attempts: 2,
    });
    expect(claimExecutionJobById(String(job.job.id), "worker-a", {
      lease_ms: 1_000, now: new Date("2030-10-02T00:00:00.000Z"),
    })).toBeTruthy();
    expect(recoverExpiredExecutionJobs(new Date("2030-10-02T00:01:00.000Z"))).toEqual({ requeued: 1, uncertain: 0 });
    expect(executionJobById(String(job.job.id))).toMatchObject({ status: "retrying", lease_owner: null, error_code: "lease_expired" });
    const outbox = getConn().prepare(
      "SELECT event_type,status FROM execution_outbox WHERE job_id=? ORDER BY created_at,id",
    ).all(job.job.id) as Array<{ event_type: string; status: string }>;
    expect(outbox).toEqual([
      { event_type: "execution_job.queued", status: "pending" },
      { event_type: "execution_job.lease_recovered", status: "pending" },
    ]);
  });

  it("creates a retry dispatch fact when a low-risk handler failure is retryable", () => {
    const job = enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:failure-retry-001", max_attempts: 2,
    });
    expect(claimExecutionJobById(String(job.job.id), "worker-a")).toBeTruthy();
    failExecutionJob(String(job.job.id), { code: "model_timeout", summary: "model timeout" }, {
      now: new Date("2030-10-02T00:00:00.000Z"),
    });
    expect(executionJobById(String(job.job.id))).toMatchObject({ status: "retrying", lease_owner: null });
    expect((getConn().prepare("SELECT COUNT(*) AS count FROM execution_outbox WHERE job_id=?").get(job.job.id) as { count: number }).count).toBe(2);
  });

  it("re-publishes only an explicitly requested failed low-risk job", () => {
    const low = enqueueExecutionJob({
      job_type: "work_plan.run", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "plan:test-004", risk_level: "low",
    });
    expect(claimExecutionJobById(String(low.job.id), "test-worker")).toBeTruthy();
    failExecutionJob(String(low.job.id), { code: "model_timeout", summary: "model timeout" });
    const retried = retryFailedExecutionJob(String(low.job.id), { actor_ref: "admin:test" });
    expect(retried.retried).toBe(true);
    expect(retried.job).toMatchObject({ status: "queued", error_code: null, max_attempts: 2 });
    expect((getConn().prepare("SELECT COUNT(*) AS count FROM execution_outbox WHERE job_id=?").get(low.job.id) as { count: number }).count).toBe(2);

    const high = enqueueExecutionJob({
      job_type: "write.operation", tenant_ref: "company:amperetime", actor_ref: "employee:test",
      idempotency_key: "write:test-005", risk_level: "high",
    });
    expect(claimExecutionJobById(String(high.job.id), "test-worker")).toBeTruthy();
    failExecutionJob(String(high.job.id), { code: "write_timeout", summary: "outcome unknown" });
    expect(retryFailedExecutionJob(String(high.job.id), { actor_ref: "admin:test" })).toMatchObject({
      retried: false, reason: "not_failed",
    });
  });
});
