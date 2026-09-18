/**
 * Official open-pool profile (table A: kol_profile_index) vs exclusive follow
 * (table B: kol_follow_index). Discovery candidate ≠ A ≠ B.active.
 *
 * Ingest writes A with pool_status=open and must not activate B.
 * Claim requires A and writes B.status=active, then A.pool_status=held.
 * GET /api/home/following only includes B.active (legacy collabs without A
 * stay visible so Starry library sync is unchanged).
 */
import { audit, getConn, nowIso } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json, Row } from "./types.js";

export const POOL_OPEN = "open";
export const POOL_HELD = "held";
export const FOLLOW_ACTIVE = "active";
export const FOLLOW_RELEASED = "released";

export type OfficialProfile = {
  kol_uid: string;
  platform: string;
  platform_creator_id: string;
  pool_status: typeof POOL_OPEN | typeof POOL_HELD;
  handle: string;
  display_name: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export type FollowClaim = {
  id: string;
  kol_uid: string;
  owner_user_id: string;
  status: typeof FOLLOW_ACTIVE | typeof FOLLOW_RELEASED;
  claimed_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
};

export function stableExternalIdOf(source: Row | Json): {
  platform: string;
  platform_creator_id: string;
  external_id: string;
} | null {
  const payload = asObject(source.payload);
  const platform = firstString(source.platform, payload.platform).toLowerCase();
  const creatorId = firstString(
    source.platform_creator_id,
    payload.platform_creator_id,
    payload.platformCreatorId,
    payload.creator_id,
  );
  if (!platform || !creatorId) return null;
  return {
    platform,
    platform_creator_id: creatorId,
    external_id: `${platform}:${creatorId}`,
  };
}

export function requireStableExternalId(source: Row | Json): {
  platform: string;
  platform_creator_id: string;
  external_id: string;
} {
  const id = stableExternalIdOf(source);
  if (!id) {
    throw new HttpFail(409, {
      code: "ingest_missing_external_id",
      message: "缺少稳定外部编号，无法入库公海。",
      biz: "BIZ-10",
    });
  }
  return id;
}

export function getOfficialProfile(kolUid: string): OfficialProfile | undefined {
  const row = getConn().prepare("SELECT * FROM kol_profile_index WHERE kol_uid=?").get(kolUid) as Row | undefined;
  return row ? asProfile(row) : undefined;
}

export function hasOfficialProfile(kolUid: string): boolean {
  return Boolean(getOfficialProfile(kolUid));
}

export function getActiveFollow(kolUid: string): FollowClaim | undefined {
  const row = getConn().prepare(
    "SELECT * FROM kol_follow_index WHERE kol_uid=? AND status=? LIMIT 1",
  ).get(kolUid, FOLLOW_ACTIVE) as Row | undefined;
  return row ? asFollow(row) : undefined;
}

export function getOwnerFollow(kolUid: string, ownerUserId: string): FollowClaim | undefined {
  const row = getConn().prepare(
    "SELECT * FROM kol_follow_index WHERE kol_uid=? AND owner_user_id=?",
  ).get(kolUid, ownerUserId) as Row | undefined;
  return row ? asFollow(row) : undefined;
}

export function isClaimedFollow(kolUid: string, ownerUserId?: string): boolean {
  const follow = getActiveFollow(kolUid);
  if (!follow) return false;
  if (!ownerUserId) return true;
  return follow.owner_user_id === ownerUserId;
}

/** True when this collaboration should appear on GET /api/home/following. */
export function collaborationVisibleInFollowing(row: Row, ownerUserId: string): boolean {
  const uid = String(row.kol_uid || "").trim();
  if (!uid) return false;
  if (isClaimedFollow(uid, ownerUserId)) return true;
  if (hasOfficialProfile(uid)) return false;
  return true;
}

export function upsertOpenPoolProfile(input: {
  kolUid: string;
  platform: string;
  platformCreatorId: string;
  handle?: string;
  displayName?: string;
  source?: string;
}): OfficialProfile {
  const now = nowIso();
  const handle = String(input.handle || "").trim();
  const displayName = String(input.displayName || input.handle || "").trim();
  const source = String(input.source || "discovery").trim() || "discovery";
  const existing = getOfficialProfile(input.kolUid);
  if (existing) {
    getConn().prepare(
      `UPDATE kol_profile_index
          SET platform=?, platform_creator_id=?, handle=COALESCE(NULLIF(?, ''), handle),
              display_name=COALESCE(NULLIF(?, ''), display_name), updated_at=?
        WHERE kol_uid=?`,
    ).run(input.platform, input.platformCreatorId, handle, displayName, now, input.kolUid);
    return getOfficialProfile(input.kolUid)!;
  }
  const byExternal = getConn().prepare(
    "SELECT * FROM kol_profile_index WHERE platform=? AND platform_creator_id=?",
  ).get(input.platform, input.platformCreatorId) as Row | undefined;
  if (byExternal && String(byExternal.kol_uid) !== input.kolUid) {
    throw new HttpFail(409, {
      code: "ingest_external_id_conflict",
      message: "该外部编号已对应其他红人档案，未入库公海。",
      biz: "BIZ-10",
      kol_uid: byExternal.kol_uid,
    });
  }
  getConn().prepare(
    `INSERT INTO kol_profile_index
     (kol_uid, platform, platform_creator_id, pool_status, handle, display_name, source, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.kolUid,
    input.platform,
    input.platformCreatorId,
    POOL_OPEN,
    handle,
    displayName,
    source,
    now,
    now,
  );
  return getOfficialProfile(input.kolUid)!;
}

export function claimOfficialProfile(kolUid: string, ownerUserId: string): {
  profile: OfficialProfile;
  follow: FollowClaim;
  created: boolean;
} {
  const uid = String(kolUid || "").trim();
  if (!uid) {
    throw new HttpFail(400, { code: "claim_kol_uid_required", message: "缺少红人编号，无法领取跟进。" });
  }
  const profile = getOfficialProfile(uid);
  if (!profile) {
    throw new HttpFail(409, {
      code: "pool_profile_not_found",
      message: "该红人尚未入库公海，不能领取跟进。",
    });
  }
  const active = getActiveFollow(uid);
  if (active && active.owner_user_id !== ownerUserId) {
    throw new HttpFail(409, {
      code: "follow_held_by_other",
      message: "该红人已被领取。",
      owner_user_id: active.owner_user_id,
    });
  }
  const now = nowIso();
  const mine = getOwnerFollow(uid, ownerUserId);
  if (mine && mine.status === FOLLOW_ACTIVE) {
    if (profile.pool_status !== POOL_HELD) {
      getConn().prepare("UPDATE kol_profile_index SET pool_status=?, updated_at=? WHERE kol_uid=?").run(
        POOL_HELD,
        now,
        uid,
      );
    }
    return { profile: getOfficialProfile(uid)!, follow: mine, created: false };
  }
  const id = mine?.id || nid("kfol");
  if (mine) {
    getConn().prepare(
      `UPDATE kol_follow_index
          SET status=?, claimed_at=COALESCE(claimed_at, ?), released_at=NULL, updated_at=?
        WHERE id=?`,
    ).run(FOLLOW_ACTIVE, now, now, id);
  } else {
    getConn().prepare(
      `INSERT INTO kol_follow_index
       (id, kol_uid, owner_user_id, status, claimed_at, released_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, uid, ownerUserId, FOLLOW_ACTIVE, now, null, now, now);
  }
  getConn().prepare("UPDATE kol_profile_index SET pool_status=?, updated_at=? WHERE kol_uid=?").run(
    POOL_HELD,
    now,
    uid,
  );
  audit(ownerUserId, "kol.follow.claimed", {
    kol_uid: uid,
    owner_user_id: ownerUserId,
    pool_status: POOL_HELD,
    sent: false,
    stage_changed: false,
  });
  return {
    profile: getOfficialProfile(uid)!,
    follow: getOwnerFollow(uid, ownerUserId)!,
    created: !mine,
  };
}

export function publicPoolProfile(row: OfficialProfile | Row, ownerUserId?: string): Json {
  const profile = "kol_uid" in row && "pool_status" in row && !("id" in row && "owner_user_id" in row)
    ? asProfile(row as Row)
    : asProfile(row as Row);
  const uid = profile.kol_uid;
  const follow = getActiveFollow(uid);
  return {
    kol_uid: uid,
    platform: profile.platform,
    platform_creator_id: profile.platform_creator_id,
    pool_status: profile.pool_status,
    handle: profile.handle,
    display_name: profile.display_name,
    source: profile.source,
    claimed: Boolean(follow && (!ownerUserId || follow.owner_user_id === ownerUserId)),
    claimed_by: follow?.owner_user_id || null,
    follow_status: follow?.status || null,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

export function listOfficialPool(input: {
  poolStatus?: string;
  limit?: number;
  offset?: number;
  ownerUserId?: string;
} = {}): Json {
  const limit = Math.min(Math.max(Number(input.limit || 50) || 50, 1), 200);
  const offset = Math.max(Number(input.offset || 0) || 0, 0);
  const status = String(input.poolStatus || "").trim().toLowerCase();
  const rows = (status === POOL_OPEN || status === POOL_HELD
    ? getConn().prepare(
      `SELECT * FROM kol_profile_index WHERE pool_status=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).all(status, limit, offset)
    : getConn().prepare(
      `SELECT * FROM kol_profile_index ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).all(limit, offset)) as Row[];
  const totalRow = (status === POOL_OPEN || status === POOL_HELD
    ? getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index WHERE pool_status=?").get(status)
    : getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()) as { n: number };
  return {
    items: rows.map((row) => publicPoolProfile(row, input.ownerUserId)),
    total: Number(totalRow.n || 0),
    limit,
    offset,
    index: "公海档案",
  };
}

function asProfile(row: Row): OfficialProfile {
  return {
    kol_uid: String(row.kol_uid || ""),
    platform: String(row.platform || ""),
    platform_creator_id: String(row.platform_creator_id || ""),
    pool_status: String(row.pool_status || POOL_OPEN) === POOL_HELD ? POOL_HELD : POOL_OPEN,
    handle: String(row.handle || ""),
    display_name: String(row.display_name || row.handle || ""),
    source: String(row.source || "discovery"),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

function asFollow(row: Row): FollowClaim {
  return {
    id: String(row.id || ""),
    kol_uid: String(row.kol_uid || ""),
    owner_user_id: String(row.owner_user_id || ""),
    status: String(row.status || FOLLOW_ACTIVE) === FOLLOW_RELEASED ? FOLLOW_RELEASED : FOLLOW_ACTIVE,
    claimed_at: row.claimed_at ? String(row.claimed_at) : null,
    released_at: row.released_at ? String(row.released_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

function asObject(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
    } catch {
      return {};
    }
  }
  return {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}
