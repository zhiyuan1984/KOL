import type { Json, Row } from "../types.js";
import type { ClaimedExecutionJob } from "./contracts.js";
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
 * Runtime execution authority is PostgreSQL only. `postgresPool()` validates
 * DATABASE_URL before any call, so an application/worker cannot quietly fall
 * back to a local database fixture.
 */
export async function runtimeClaimExecutionJobById(
  id: string,
  workerId: string,
  options: { lease_ms?: number; now?: Date } = {},
): Promise<ClaimedExecutionJob | null> {
  return pgClaimExecutionJobById(id, workerId, options);
}

export async function runtimeClaimNextExecutionJob(
  workerId: string,
  options: { job_types?: string[]; lease_ms?: number; now?: Date } = {},
): Promise<ClaimedExecutionJob | null> {
  return pgClaimNextExecutionJob(workerId, options);
}

export async function runtimeRenewExecutionJobLease(
  id: string,
  workerId: string,
  options: { lease_ms?: number; now?: Date } = {},
): Promise<boolean> {
  return pgRenewExecutionJobLease(id, workerId, options);
}

export async function runtimeCompleteExecutionJob(id: string, receipt: Json = {}, now = new Date()): Promise<Row | undefined> {
  return pgCompleteExecutionJob(id, receipt, now);
}

export async function runtimeFailExecutionJob(
  id: string,
  error: { code: string; summary: string },
  options: { retry_at?: string | null; now?: Date } = {},
): Promise<Row | undefined> {
  return pgFailExecutionJob(id, error, options);
}

export async function runtimeRecoverExpiredExecutionJobs(now = new Date()): Promise<{ requeued: number; uncertain: number }> {
  return pgRecoverExpiredExecutionJobs(now);
}

export function runtimeExecutionJobPayload(job: Row): Json {
  return pgExecutionJobPayload(job);
}
