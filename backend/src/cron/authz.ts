import { HttpFail } from "../host/errors.js";
import { requireTicketPrincipal, ticketIsAdmin, ticketPrincipal, type TicketPrincipal } from "../ticket-domain/auth.js";
import type { Row } from "../types.js";
import { cronSystemJob } from "./contracts.js";

/** Cron access is evaluated only against the formal PostgreSQL ticket identity.
 * Legacy connector/skill grants are not a fallback authority for scheduling. */
export function canSeeJob(job: Row, viewer = ticketPrincipal()): boolean {
  if (!viewer) return false;
  if (ticketIsAdmin(viewer) || cronSystemJob(job)) return true;
  return String(job.owner_account_id || "") === viewer.id || String(job.execute_as || "") === viewer.id;
}

export function assertCanSeeJob(job: Row, viewer = ticketPrincipal()): TicketPrincipal {
  const actor = viewer || requireTicketPrincipal();
  if (!canSeeJob(job, actor)) throw new HttpFail(404, "cron job not found");
  return actor;
}

export function canMutateJob(job: Row, viewer = ticketPrincipal()): boolean {
  if (!viewer) return false;
  if (cronSystemJob(job)) return ticketIsAdmin(viewer);
  return ticketIsAdmin(viewer) || canSeeJob(job, viewer);
}

export function assertCanMutateJob(job: Row, viewer = ticketPrincipal()): TicketPrincipal {
  const actor = viewer || requireTicketPrincipal();
  if (canMutateJob(job, actor)) return actor;
  if (cronSystemJob(job)) throw new HttpFail(403, "system job requires admin");
  throw new HttpFail(404, "cron job not found");
}

/** Only handlers whose side-effect contract is published may run. The two
 * formal-ticket scanners are native read-only projections; discovery-search
 * enqueues a crawl demand into the PG crawl queue (ADR-2026-10-08). */
export function assertHandlerGates(handlerKey: string): void {
  // ownership-release/mail-memory-increment/ai-task are quarantined by their
  // handler contracts and return needs_takeover; no legacy privilege is used.
  void handlerKey;
}

export function assertJobRunnable(job: Row): void {
  const status = String(job.status);
  if (status === "disabled") {
    throw new HttpFail(409, { code: "not_enabled", message: "该作业未启用" });
  }
  if (status === "draft") throw new HttpFail(409, { code: "not_published", message: "作业尚未发布" });
}
