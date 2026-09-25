import { authDisabled, isAdmin, requireConnector, requireSkill, scopedUser, type AppUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import type { Row } from "../types.js";
import { isSystemJob } from "./store.js";

export function requireStarryRead(): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  if (isAdmin(user)) return;
  try {
    requireConnector("starrykol", "read");
    return;
  } catch {
    requireConnector("starry", "read");
  }
}

export function canSeeJob(job: Row, user = scopedUser()): boolean {
  if (authDisabled() || !user || isAdmin(user)) return true;
  if (isSystemJob(job)) return true;
  return String(job.owner_account_id || "") === user.id || String(job.execute_as || "") === user.id;
}

export function assertCanSeeJob(job: Row, user = scopedUser()): void {
  if (!canSeeJob(job, user)) throw new HttpFail(404, "cron job not found");
}

export function assertCanMutateJob(job: Row, user = scopedUser()): AppUser | undefined {
  if (authDisabled()) return user;
  if (!user) throw new HttpFail(401, "authentication required");
  if (isSystemJob(job) && !isAdmin(user)) throw new HttpFail(403, "system job requires admin");
  if (isAdmin(user) || canSeeJob(job, user)) return user;
  throw new HttpFail(404, "cron job not found");
}

export function assertHandlerGates(handlerKey: string): void {
  if (handlerKey === "overdue-scan") {
    requireSkill("risk_scan");
    requireStarryRead();
    return;
  }
  if (handlerKey === "daily-task-snapshot") {
    requireSkill("creator_daily_tasks");
    requireStarryRead();
    return;
  }
  if (handlerKey === "ownership-release") {
    return;
  }
  if (handlerKey === "discovery-search") {
    throw new HttpFail(409, { code: "not_enabled", message: "发现搜索未启用" });
  }
}

export function assertJobRunnable(job: Row): void {
  const status = String(job.status);
  if (status === "disabled" || String(job.handler_key) === "discovery-search") {
    throw new HttpFail(409, { code: "not_enabled", message: "该作业未启用" });
  }
  if (status === "draft") throw new HttpFail(409, { code: "not_published", message: "作业尚未发布" });
}
