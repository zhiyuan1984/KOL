/**
 * BIZ-06 allowed ownership-release path.
 * Re-reads owner + last correspondence before mutate. Never writes stage,
 * never sends mail, never calls creator_owner_update / confirm_stage.
 */
import { audit, getConn, nowIso, type SqliteConn } from "../db.js";
import type { Json, Row } from "../types.js";

export const OWNERSHIP_RELEASE_POLICY = "biz-06-v1-safe-subset";
export const OWNERSHIP_IDLE_DAYS = 14;

export type OwnershipReleaseDecision =
  | { action: "release"; collaboration_id: string; owner_before: string }
  | { action: "skip"; collaboration_id: string; reason: string; detail: Json };

function text(value: unknown): string {
  return String(value || "").trim();
}

export function lastCorrespondenceAt(db: SqliteConn, collaborationId: string): string | null {
  const thread = db.prepare(
    "SELECT MAX(last_at) AS last_at FROM kol_mail_threads WHERE collaboration_id=?",
  ).get(collaborationId) as { last_at?: string | null } | undefined;
  const item = db.prepare(
    "SELECT MAX(occurred_at) AS last_at FROM kol_mail_items WHERE collaboration_id=?",
  ).get(collaborationId) as { last_at?: string | null } | undefined;
  const inbound = db.prepare(
    "SELECT MAX(ts) AS last_at FROM inbound WHERE collaboration_id=?",
  ).get(collaborationId) as { last_at?: string | null } | undefined;
  const stamps = [thread?.last_at, item?.last_at, inbound?.last_at]
    .map((value) => text(value))
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

export function idleMs(fromIso: string, now = Date.now()): number {
  const ts = Date.parse(fromIso);
  if (!Number.isFinite(ts)) return Number.NaN;
  return now - ts;
}

export function evaluateOwnershipRelease(
  row: Row,
  lastAt: string | null,
  now = Date.now(),
): OwnershipReleaseDecision {
  const id = text(row.id);
  const owner = text(row.owner_name);
  if (!id || !owner) {
    return { action: "skip", collaboration_id: id, reason: "no_owner", detail: { owner_name: owner } };
  }
  if (!lastAt) {
    return {
      action: "skip",
      collaboration_id: id,
      reason: "correspondence_incomplete",
      detail: {
        gap: "no_effective_correspondence_timestamp",
        note: "缺少有效往来时间，不能把未同步当成没有往来（BIZ-06）",
      },
    };
  }
  const elapsed = idleMs(lastAt, now);
  if (!Number.isFinite(elapsed)) {
    return {
      action: "skip",
      collaboration_id: id,
      reason: "correspondence_unreadable",
      detail: { last_at: lastAt },
    };
  }
  if (elapsed < OWNERSHIP_IDLE_DAYS * 24 * 60 * 60 * 1000) {
    return {
      action: "skip",
      collaboration_id: id,
      reason: "renewed",
      detail: { last_at: lastAt, owner_name: owner },
    };
  }
  return { action: "release", collaboration_id: id, owner_before: owner };
}

export function releaseFollowOwnershipIfEligible(input: {
  db: SqliteConn;
  collaborationId: string;
  expectedOwner: string;
  expectedLastAt: string;
  actor: string;
  nowMs?: number;
}): OwnershipReleaseDecision {
  const db = input.db;
  const current = db.prepare("SELECT * FROM collaborations WHERE id=?").get(input.collaborationId) as Row | undefined;
  if (!current) {
    return {
      action: "skip",
      collaboration_id: input.collaborationId,
      reason: "missing",
      detail: {},
    };
  }
  const lastAt = lastCorrespondenceAt(db, input.collaborationId);
  const owner = text(current.owner_name);
  if (owner !== input.expectedOwner) {
    return {
      action: "skip",
      collaboration_id: input.collaborationId,
      reason: "reassigned",
      detail: { expected_owner: input.expectedOwner, current_owner: owner },
    };
  }
  if (lastAt !== input.expectedLastAt) {
    return {
      action: "skip",
      collaboration_id: input.collaborationId,
      reason: lastAt && idleMs(lastAt, input.nowMs ?? Date.now()) < OWNERSHIP_IDLE_DAYS * 24 * 60 * 60 * 1000
        ? "renewed"
        : "correspondence_changed",
      detail: { expected_last_at: input.expectedLastAt, current_last_at: lastAt },
    };
  }
  const decision = evaluateOwnershipRelease(current, lastAt, input.nowMs ?? Date.now());
  if (decision.action !== "release") return decision;
  const changed = db.prepare(
    `UPDATE collaborations
        SET owner_name=NULL, owner_mailbox=NULL
      WHERE id=? AND owner_name=?`,
  ).run(input.collaborationId, input.expectedOwner);
  if (!changed.changes) {
    return {
      action: "skip",
      collaboration_id: input.collaborationId,
      reason: "reassigned",
      detail: { expected_owner: input.expectedOwner },
    };
  }
  audit(input.actor, "cron.ownership_release", {
    collaboration_id: input.collaborationId,
    owner_before: input.expectedOwner,
    last_at: lastAt,
    policy: OWNERSHIP_RELEASE_POLICY,
    stage_unchanged: text(current.stage_code),
  });
  return decision;
}

export function listOwnedCollaborations(db: SqliteConn = getConn()): Row[] {
  return db.prepare(
    `SELECT * FROM collaborations
      WHERE owner_name IS NOT NULL AND trim(owner_name) != ''`,
  ).all() as Row[];
}

export function ownershipReceiptMeta(): Json {
  return {
    policy: OWNERSHIP_RELEASE_POLICY,
    idle_days: OWNERSHIP_IDLE_DAYS,
    evaluated_at: nowIso(),
    correspondence_sources: ["kol_mail_threads.last_at", "kol_mail_items.occurred_at", "inbound.ts"],
    gaps: [
      "没有独立的排他跟进关系表；本作业只用 collaborations.owner_name 作为归属安全子集",
      "有效往来口径尚未由业务专家发布；缺时间戳一律 skip，不释放",
    ],
  };
}
