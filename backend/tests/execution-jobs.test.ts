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
  publishExecutionOutboxForJob,
  recoverExpiredExecutionJobs,
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
});
