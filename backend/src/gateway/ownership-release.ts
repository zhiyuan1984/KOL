/**
 * BIZ-06 allowed ownership-release path.
 * Authoritative read is B kol_follow_index.
 * Missing last_effective_mail_at → skip. Never writes stage,
 * never sends mail, never calls creator_owner_update / confirm_stage.
 */
import { audit, getConn, nowIso, type SqliteConn } from "../db.js";
import {
  applyFollowRelease,
  followClock,
  FOLLOW_IDLE_DAYS,
  listActiveFollows,
} from "../host/kol-memory.js";
import type { Json, Row } from "../types.js";

export const OWNERSHIP_RELEASE_POLICY = "biz-06-v1-follow-index";
export const OWNERSHIP_IDLE_DAYS = FOLLOW_IDLE_DAYS;

export type OwnershipReleaseDecision =
  | { action: "release"; collaboration_id: string; follow_id: string; owner_before: string }
  | { action: "skip"; collaboration_id: string; follow_id: string; reason: string; detail: Json };

function text(value: unknown): string {
  return String(value || "").trim();
}

/** @deprecated B.last_effective_mail_at is authoritative. Kept for mail-thread diagnostics. */
export function lastCorrespondenceAt(db: SqliteConn, collaborationId: string): string | null {
  const follow = db.prepare(
    "SELECT last_effective_mail_at FROM kol_follow_index WHERE collaboration_id=? AND status='active' LIMIT 1",
  ).get(collaborationId) as { last_effective_mail_at?: string | null } | undefined;
  if (follow?.last_effective_mail_at) return text(follow.last_effective_mail_at) || null;
  return null;
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
  const followId = text(row.id);
  const owner = text(row.employee_id || row.owner_name);
  const collaborationId = text(row.collaboration_id);
  if (!followId || !owner) {
    return {
      action: "skip",
      collaboration_id: collaborationId,
      follow_id: followId,
      reason: "no_owner",
      detail: { employee_id: owner },
    };
  }
  const effective = text(lastAt || row.last_effective_mail_at);
  if (!effective) {
    return {
      action: "skip",
      collaboration_id: collaborationId,
      follow_id: followId,
      reason: "correspondence_incomplete",
      detail: {
        gap: "no_effective_correspondence_timestamp",
        note: "缺少有效往来时间，不能把未同步当成没有往来（BIZ-06）",
        cron_skip: true,
        countdown: false,
      },
    };
  }
  const clock = followClock(effective, now);
  if (!clock.cron_eligible) {
    return {
      action: "skip",
      collaboration_id: collaborationId,
      follow_id: followId,
      reason: "correspondence_unreadable",
      detail: { last_at: effective },
    };
  }
  const elapsed = idleMs(effective, now);
  if (elapsed < OWNERSHIP_IDLE_DAYS * 24 * 60 * 60 * 1000) {
    return {
      action: "skip",
      collaboration_id: collaborationId,
      follow_id: followId,
      reason: "renewed",
      detail: { last_at: effective, employee_id: owner, release_due_at: clock.release_due_at },
    };
  }
  return {
    action: "release",
    collaboration_id: collaborationId,
    follow_id: followId,
    owner_before: owner,
  };
}

export function releaseFollowOwnershipIfEligible(input: {
  db: SqliteConn;
  collaborationId?: string;
  followId?: string;
  expectedOwner: string;
  expectedLastAt: string;
  actor: string;
  nowMs?: number;
}): OwnershipReleaseDecision {
  const db = input.db;
  const current = input.followId
    ? db.prepare("SELECT * FROM kol_follow_index WHERE id=?").get(input.followId) as Row | undefined
    : db.prepare(
      "SELECT * FROM kol_follow_index WHERE collaboration_id=? AND status='active' LIMIT 1",
    ).get(input.collaborationId) as Row | undefined;
  if (!current) {
    return {
      action: "skip",
      collaboration_id: input.collaborationId || "",
      follow_id: input.followId || "",
      reason: "missing",
      detail: {},
    };
  }
  const lastAt = text(current.last_effective_mail_at) || null;
  const owner = text(current.employee_id);
  if (owner !== input.expectedOwner && text(current.employee_name) !== input.expectedOwner) {
    return {
      action: "skip",
      collaboration_id: text(current.collaboration_id),
      follow_id: text(current.id),
      reason: "reassigned",
      detail: { expected_owner: input.expectedOwner, current_owner: owner },
    };
  }
  if ((lastAt || "") !== input.expectedLastAt) {
    return {
      action: "skip",
      collaboration_id: text(current.collaboration_id),
      follow_id: text(current.id),
      reason: lastAt && idleMs(lastAt, input.nowMs ?? Date.now()) < OWNERSHIP_IDLE_DAYS * 24 * 60 * 60 * 1000
        ? "renewed"
        : "correspondence_changed",
      detail: { expected_last_at: input.expectedLastAt, current_last_at: lastAt },
    };
  }
  const decision = evaluateOwnershipRelease(current, lastAt, input.nowMs ?? Date.now());
  if (decision.action !== "release") return decision;
  applyFollowRelease(db, current, input.actor, "ownership-release");
  audit(input.actor, "cron.ownership_release", {
    follow_id: current.id,
    collaboration_id: current.collaboration_id,
    owner_before: input.expectedOwner,
    last_at: lastAt,
    policy: OWNERSHIP_RELEASE_POLICY,
    stage_unchanged: true,
  });
  return decision;
}

export function listOwnedCollaborations(db: SqliteConn = getConn()): Row[] {
  return listActiveFollows(db);
}

export function ownershipReceiptMeta(): Json {
  return {
    policy: OWNERSHIP_RELEASE_POLICY,
    idle_days: OWNERSHIP_IDLE_DAYS,
    evaluated_at: nowIso(),
    correspondence_sources: ["kol_follow_index.last_effective_mail_at"],
    authority: "kol_follow_index",
    gaps: [
      "有效往来必须带网关成功回执；退信/自动回复/投递失败不续期",
      "缺少 last_effective_mail_at 一律 skip，不释放，卡片不计倒计时",
    ],
  };
}
