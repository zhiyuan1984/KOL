import { BRAND_MAILBOXES } from "../config.js";
import { audit, getConn, nowIso, onConnReset, tx } from "../db.js";
import { parseFollowStyleTags, serializeFollowStyleTags } from "../follow-style-tags.js";
import { codeFromLabel, mergeRemoteLibraryStage, normalizeStage, preferLaterMainStage } from "../stages.js";
import type { Json, Row } from "../types.js";
import { normalizeRiskTag, parseNicheTags } from "./remote-contract.js";
import { executeStarryKolTask, remoteLifecycleIdFrom, withStarryCallScope } from "./service.js";

export type StarryLibrarySync = {
  ok: boolean;
  source: "starry";
  tool: "listAllKolProfiles";
  count: number;
  error?: string;
  synced_at?: string;
};

let inFlight: Promise<StarryLibrarySync> | null = null;

onConnReset(() => {
  inFlight = null;
});

export function resetStarryHomeLibrarySync(): void {
  inFlight = null;
}

export function startStarryHomeLibrarySync(): Promise<StarryLibrarySync> {
  inFlight = syncStarryHomeLibrary();
  return inFlight;
}

export function ensureStarryHomeLibrary(): Promise<StarryLibrarySync> {
  if (!inFlight) inFlight = syncStarryHomeLibrary();
  return inFlight;
}

export function starryLibraryStatus(): StarryLibrarySync {
  const raw = getConn().prepare("SELECT value FROM app_state WHERE key='starry_library_sync'").get() as
    | { value: string }
    | undefined;
  if (!raw?.value) return { ok: false, source: "starry", tool: "listAllKolProfiles", count: 0 };
  try {
    const parsed = JSON.parse(raw.value) as StarryLibrarySync;
    return {
      ok: Boolean(parsed.ok),
      source: "starry",
      tool: "listAllKolProfiles",
      count: Number(parsed.count || 0),
      error: parsed.error,
      synced_at: parsed.synced_at,
    };
  } catch {
    return { ok: false, source: "starry", tool: "listAllKolProfiles", count: 0 };
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return firstString(value[0]);
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function listOf(data: Json): Json[] {
  for (const key of ["list", "items", "profiles", "creators"]) {
    if (Array.isArray(data[key])) return data[key] as Json[];
  }
  return [];
}

function brandOf(profile: Json): string {
  const raw = firstString(profile.brandCode, profile.brand_code, profile.brandName, profile.brand).replace(/品牌$/, "");
  if (raw === "LT" || raw === "RO" || raw === "PQ") return raw;
  if (/renogy/i.test(raw)) return "RO";
  if (/powerqueen|pq/i.test(raw)) return "PQ";
  if (/litime|^lt$/i.test(raw)) return "LT";
  return raw.slice(0, 8) || "LT";
}

function followersOf(profile: Json): string {
  const wan = profile.followerCountTenThousands ?? profile.followers_wan;
  if (wan != null && wan !== "") {
    const n = Number(wan);
    if (Number.isFinite(n)) return `${n}万`;
  }
  const raw = profile.followers ?? profile.followerCount;
  if (raw == null || raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  if (n >= 10000) return `${Math.round(n / 10000)}万`;
  return String(n);
}

function geoOf(profile: Json): string {
  const geo = profile.audienceGeo || profile.audience_geo;
  if (geo && typeof geo === "object" && !Array.isArray(geo)) {
    const top = Object.entries(geo as Record<string, string>)
      .sort((a, b) => Number.parseFloat(String(b[1])) - Number.parseFloat(String(a[1])))[0];
    if (top?.[0]) return top[0];
  }
  return firstString(profile.countryName, profile.country, profile.audienceGeo);
}

function remoteStageOf(profile: Json): string | null {
  return codeFromLabel(firstString(
    profile.cooperationStageCode,
    profile.stageCode,
    profile.stage_code,
    profile.cooperationStageName,
    profile.stageName,
    profile.stage,
    profile.status,
  ));
}

function recordedOfficialStage(existing: Row): string {
  return recordedOfficialStages([existing]).get(String(existing.id || "")) || "";
}

function recordedOfficialStages(cols: Row[]): Map<string, string> {
  const recorded = new Map<string, string>();
  if (!cols.length) return recorded;
  const db = getConn();
  const ids = [...new Set(cols.map((col) => String(col.id || "")).filter(Boolean))];
  const lifecycleIds = [...new Set(cols.map((col) => String(col.lifecycle_id || "")).filter(Boolean))];
  if (!ids.length && !lifecycleIds.length) return recorded;

  const transitionByCol = new Map<string, string>();
  const idPh = ids.map(() => "?").join(",");
  const lcPh = lifecycleIds.map(() => "?").join(",");
  const transitionSql = lifecycleIds.length
    ? `SELECT collaboration_id, lifecycle_id, to_stage FROM stage_transitions
       WHERE ${ids.length ? `collaboration_id IN (${idPh}) OR ` : ""}lifecycle_id IN (${lcPh})
       ORDER BY data_version_after DESC, occurred_at DESC`
    : `SELECT collaboration_id, lifecycle_id, to_stage FROM stage_transitions
       WHERE collaboration_id IN (${idPh})
       ORDER BY data_version_after DESC, occurred_at DESC`;
  const transitions = db.prepare(transitionSql).all(...ids, ...lifecycleIds) as Row[];
  for (const row of transitions) {
    for (const col of cols) {
      const key = String(col.id || "");
      if (!key || transitionByCol.has(key)) continue;
      if (String(row.collaboration_id || "") === key) {
        transitionByCol.set(key, normalizeStage(String(row.to_stage || "")));
        continue;
      }
      if (row.lifecycle_id && String(col.lifecycle_id || "") === String(row.lifecycle_id)) {
        transitionByCol.set(key, normalizeStage(String(row.to_stage || "")));
      }
    }
  }

  const writeByLifecycle = new Map<string, string>();
  if (lifecycleIds.length) {
    const writes = db.prepare(
      `SELECT lifecycle_id, stage_code FROM starry_stage_writes
       WHERE lifecycle_id IN (${lcPh})
       ORDER BY ts DESC, id DESC`,
    ).all(...lifecycleIds) as Row[];
    for (const row of writes) {
      const lc = String(row.lifecycle_id || "");
      if (lc && !writeByLifecycle.has(lc)) writeByLifecycle.set(lc, normalizeStage(String(row.stage_code || "")));
    }
  }

  for (const col of cols) {
    const key = String(col.id || "");
    if (!key || recorded.has(key)) continue;
    recorded.set(key, preferLaterMainStage(
      transitionByCol.get(key) || "",
      writeByLifecycle.get(String(col.lifecycle_id || "")) || "",
    ));
  }
  return recorded;
}

function resolvedLocalStage(existing: Row | undefined): string {
  if (!existing) return "";
  return preferLaterMainStage(String(existing.stage_code || ""), recordedOfficialStage(existing));
}

/** Batch official-stage restore. Mutates every supplied row sharing an id. */
export function restoreOfficialCollaborationStages(cols: Row[]): Map<string, string> {
  const resolved = new Map<string, string>();
  if (!cols.length) return resolved;
  const unique: Row[] = [];
  const seen = new Set<string>();
  for (const col of cols) {
    const id = String(col.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(col);
  }
  const recorded = recordedOfficialStages(unique);
  const updates: Array<{ id: string; stage: string }> = [];
  for (const col of unique) {
    const local = preferLaterMainStage(String(col.stage_code || ""), recorded.get(String(col.id)) || "");
    const next = mergeRemoteLibraryStage(local, null, Number(col.stage_version || 0));
    const current = normalizeStage(String(col.stage_code || ""));
    if (next && next !== current) {
      col.stage_code = next;
      updates.push({ id: String(col.id), stage: next });
    }
    resolved.set(String(col.id), String(col.stage_code || next || current || "INITIAL_CONTACT"));
  }
  if (updates.length) {
    const stmt = getConn().prepare("UPDATE collaborations SET stage_code = ? WHERE id = ?");
    for (const row of updates) stmt.run(row.stage, row.id);
  }
  for (const col of cols) {
    const stage = resolved.get(String(col.id || ""));
    if (stage) col.stage_code = stage;
  }
  return resolved;
}

export function restoreOfficialCollaborationStage(col: Row): string {
  restoreOfficialCollaborationStages([col]);
  return normalizeStage(String(col.stage_code || "")) || "INITIAL_CONTACT";
}

function engagementOf(profile: Json): string {
  const value = profile.avgVideoEngagementRate10 ?? profile.engagementRate ?? profile.engagement_rate;
  if (value == null || value === "") return "";
  return String(value);
}

function kolUidOf(profile: Json): string {
  return firstString(profile.kolUid, profile.kol_uid, profile.uid);
}

function existingRow(uid: string, name: string): Row | undefined {
  const db = getConn();
  const byUid = db.prepare("SELECT * FROM collaborations WHERE kol_uid = ?").get(uid) as Row | undefined;
  if (byUid) return byUid;
  if (!name) return undefined;
  const byName = db.prepare("SELECT * FROM collaborations WHERE handle = ? OR display_name = ?").get(name, name) as Row | undefined;
  if (byName && (!byName.kol_uid || String(byName.kol_uid) === uid)) return byName;
  return undefined;
}

function persistStatus(result: StarryLibrarySync): void {
  getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('starry_library_sync', ?)").run(
    JSON.stringify(result),
  );
}

export async function syncStarryHomeLibrary(): Promise<StarryLibrarySync> {
  const syncedAt = nowIso();
  try {
    const { data } = await withStarryCallScope({ ignoreUser: true }, () => executeStarryKolTask("creator_library_all", {}, "host"));
    const profiles = listOf(data).filter((row) => kolUidOf(row) && firstString(row.kolName, row.nickname, row.name));
    const seen = new Set<string>();
    tx((db) => {
      for (const profile of profiles) {
        const uid = kolUidOf(profile);
        if (seen.has(uid)) continue;
        seen.add(uid);
        const name = firstString(profile.kolName, profile.nickname, profile.name);
        const brand = brandOf(profile);
        const existing = existingRow(uid, name);
        const id = String(existing?.id || `col_${uid}`);
        const email = firstString(existing?.email, profile.contactEmail, profile.email);
        const mailbox = firstString(existing?.mailbox_from, BRAND_MAILBOXES[brand]);
        const remoteStage = remoteStageOf(profile);
        const stage = mergeRemoteLibraryStage(
          existing ? resolvedLocalStage(existing) : null,
          remoteStage,
          Number(existing?.stage_version || 0),
        );
        const keepDays = existing && normalizeStage(String(existing.stage_code || "")) === stage;
        const days = Number(
          keepDays
            ? existing?.days_in_stage ?? 0
            : profile.daysInStage ?? profile.days_in_stage ?? existing?.days_in_stage ?? 0,
        );
        const remoteLifecycle = remoteLifecycleIdFrom(profile, existing);
        const lifecycleId = remoteLifecycle != null
          ? String(remoteLifecycle)
          : String(existing?.lifecycle_id || `lc_${uid}`);
        db.prepare(
          `INSERT INTO collaborations
           (id, handle, display_name, brand, platform, followers, email, mailbox_from,
            lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
            stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
            handle=excluded.handle,
            display_name=excluded.display_name,
            brand=excluded.brand,
            platform=excluded.platform,
            followers=excluded.followers,
            email=excluded.email,
            mailbox_from=excluded.mailbox_from,
            lifecycle_id=excluded.lifecycle_id,
            conversation_id=excluded.conversation_id,
            stage_code=excluded.stage_code,
            days_in_stage=excluded.days_in_stage,
            notes=excluded.notes,
            overdue=excluded.overdue,
            stage_version=excluded.stage_version,
            recipient_name=excluded.recipient_name,
            phone=excluded.phone,
            address_line=excluded.address_line,
            country=excluded.country,
            postal=excluded.postal,
            sku=excluded.sku,
            qty=excluded.qty,
            locked=excluded.locked`,
        ).run(
          id,
          name,
          name,
          brand,
          firstString(profile.platform, profile.primaryPlatform, existing?.platform),
          followersOf(profile) || String(existing?.followers || ""),
          email,
          mailbox,
          lifecycleId,
          String(existing?.conversation_id || `conv_${uid}`),
          stage,
          Number.isFinite(days) ? days : 0,
          firstString(profile.notes, existing?.notes),
          Number(existing?.overdue || 0),
          Number(existing?.stage_version || 0),
          String(existing?.recipient_name || ""),
          String(existing?.phone || ""),
          String(existing?.address_line || ""),
          firstString(profile.countryName, existing?.country),
          String(existing?.postal || ""),
          String(existing?.sku || ""),
          String(existing?.qty || ""),
          Number(existing?.locked || 0),
        );
        const nicheTags = parseNicheTags(profile.nicheTagsText);
        const remoteStyle = parseFollowStyleTags(profile.followStyleTags);
        const risk = normalizeRiskTag(firstString(
          Array.isArray(profile.riskTagCodes) ? profile.riskTagCodes[0] : "",
          profile.riskTag,
          profile.riskTagCode,
        ));
        db.prepare(
          `UPDATE collaborations SET owner_name=?, owner_mailbox=?, engagement_rate=?, audience_geo=?,
            avg_views_10=?, kol_uid=?, source='starry', duplicate_checked=1,
            niche=?, risk_tag=?, wechat=?, kol_id=?, last_conversation_id=?, last_lifecycle_id=?, contact_email_masked=?
           WHERE id=?`,
        ).run(
          firstString(profile.ownerName, profile.ownerUserName, existing?.owner_name),
          firstString(profile.ownerMailbox, profile.mailboxEmail, profile.owner_mailbox, existing?.owner_mailbox),
          engagementOf(profile) || String(existing?.engagement_rate || ""),
          geoOf(profile) || String(existing?.audience_geo || ""),
          profile.avgVideoViews10 != null ? String(profile.avgVideoViews10) : String(existing?.avg_views_10 || ""),
          uid,
          firstString(nicheTags.map((row) => row.name).join("；"), profile.nicheTagsText, existing?.niche),
          firstString(risk, existing?.risk_tag),
          firstString(profile.wechat, existing?.wechat),
          firstString(profile.kolId, profile.kol_id, existing?.kol_id),
          firstString(profile.lastConversationId, profile.last_conversation_id, existing?.last_conversation_id),
          remoteLifecycle != null ? String(remoteLifecycle) : firstString(existing?.last_lifecycle_id),
          firstString(profile.contactEmailMasked, profile.contact_email_masked, existing?.contact_email_masked),
          id,
        );
        // Remote list-all often sends []. Do not clobber tags the operator just saved.
        if (remoteStyle.length) {
          db.prepare("UPDATE collaborations SET follow_style_tags=? WHERE id=?").run(
            serializeFollowStyleTags(remoteStyle),
            id,
          );
        }
      }
    });
    const result: StarryLibrarySync = {
      ok: true,
      source: "starry",
      tool: "listAllKolProfiles",
      count: seen.size,
      synced_at: syncedAt,
    };
    persistStatus(result);
    audit("host", "starrykol.library_sync", { count: seen.size, tool: "listAllKolProfiles" });
    return result;
  } catch (error) {
    const result: StarryLibrarySync = {
      ok: false,
      source: "starry",
      tool: "listAllKolProfiles",
      count: 0,
      error: error instanceof Error ? error.message : String(error),
      synced_at: syncedAt,
    };
    persistStatus(result);
    audit("host", "starrykol.library_sync_failed", { error: result.error });
    return result;
  }
}
