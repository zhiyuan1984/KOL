import type { Json, Row } from "../types.js";
import {
  claimExecutionJobById,
  claimNextExecutionJob,
  completeExecutionJob,
  failExecutionJob,
  renewExecutionJobLease,
  recoverExpiredExecutionJobs,
  type ClaimedExecutionJob,
} from "./store.js";
import {
  pgClaimExecutionJobById,
  pgClaimNextExecutionJob,
  pgCompleteExecutionJob,
  pgExecutionJobPayload,
  pgFailExecutionJob,
  pgRecoverExpiredExecutionJobs,
  pgRenewExecutionJobLease,
} from "./postgres-store.js";

/**
 * Production-only code path: PostgreSQL native repository. The fallback exists
 * temporarily so isolated legacy test fixtures can be converted in controlled
 * batches; it is never a runtime authority when DATABASE_URL is present.
 */
function nativePostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function runtimeClaimExecutionJobById(
  id: string,
  workerId: string,
  options: { lease_ms?: number; now?: Date } = {},
): Promise<ClaimedExecutionJob | null> {
  return nativePostgres()
    ? pgClaimExecutionJobById(id, workerId, options)
    : claimExecutionJobById(id, workerId, options);
}

export async function runtimeClaimNextExecutionJob(
  workerId: string,
  options: { job_types?: string[]; lease_ms?: number; now?: Date } = {},
): Promise<ClaimedExecutionJob | null> {
  return nativePostgres()
    ? pgClaimNextExecutionJob(workerId, options)
    : claimNextExecutionJob(workerId, options);
}

export async function runtimeRenewExecutionJobLease(
  id: string,
  workerId: string,
  options: { lease_ms?: number; now?: Date } = {},
): Promise<boolean> {
  return nativePostgres()
    ? pgRenewExecutionJobLease(id, workerId, options)
    : renewExecutionJobLease(id, workerId, options);
}

export async function runtimeCompleteExecutionJob(id: string, receipt: Json = {}, now = new Date()): Promise<Row | undefined> {
  return nativePostgres() ? pgCompleteExecutionJob(id, receipt, now) : completeExecutionJob(id, receipt, now);
}

export async function runtimeFailExecutionJob(
  id: string,
  error: { code: string; summary: string },
  options: { retry_at?: string | null; now?: Date } = {},
): Promise<Row | undefined> {
  return nativePostgres() ? pgFailExecutionJob(id, error, options) : failExecutionJob(id, error, options);
}

export async function runtimeRecoverExpiredExecutionJobs(now = new Date()): Promise<{ requeued: number; uncertain: number }> {
  return nativePostgres() ? pgRecoverExpiredExecutionJobs(now) : recoverExpiredExecutionJobs(now);
}

export function runtimeExecutionJobPayload(job: Row): Json {
  return nativePostgres() ? pgExecutionJobPayload(job) : (() => {
    try {
      return JSON.parse(String(job.payload_json || "{}")) as Json;
    } catch {
      return {};
    }
  })();
}
