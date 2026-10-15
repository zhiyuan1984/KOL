import { scopedUser } from "../auth.js";
import { syncStarryOwnershipIndex } from "./ownership-sync.js";
import { BRAND_MAILBOXES } from "../config.js";
import { audit, getConn, nowIso, onConnReset, tx } from "../db.js";
import { parseFollowStyleTags, serializeFollowStyleTags } from "../follow-style-tags.js";
import { trackBackgroundWork } from "../background-work.js";
import { codeFromLabel, mergeRemoteLibraryStage, normalizeStage, preferLaterMainStage } from "../stages.js";
import type { Json, Row } from "../types.js";
import { avgPlaysOf, engagementOf, followersOf, geoOf } from "./remote-metrics.js";
import { normalizeRiskTag, parseNicheTags } from "./remote-contract.js";
import { executeStarryKolTask, normalizeStarryKolResult, remoteLifecycleIdFrom, starryKolRows, starryKolUsesLocalDouble } from "./service.js";
import { runPlatformSkillTool } from "../runtime/platform-run.js";

export type StarryLibrarySync = {
  ownership_ok?: boolean;
  ownership_error?: string;
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

export async function startStarryHomeLibrarySync(): Promise<StarryLibrarySync> {
  inFlight = trackBackgroundWork(syncStarryHomeLibrary(), "library.sync");
  return inFlight;
}

export async function ensureStarryHomeLibrary(): Promise<StarryLibrarySync> {
  if (!inFlight) inFlight = trackBackgroundWork(syncStarryHomeLibrary(), "library.sync");
  return inFlight;
}

export async function starryLibraryStatus(): Promise<Awaited<StarryLibrarySync>> {
  const raw = (await getConn().query("SELECT value FROM app_state WHERE key='starry_library_sync'",[])).rows[0] as
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

async function recordedOfficialStage(existing: Row): Promise<string> {
  return (await recordedOfficialStages([existing])).get(String(existing.id || "")) || "";
}

async function recordedOfficialStages(cols: Row[]): Promise<Map<string, string>> {
  const recorded = new Map<string, string>();
  if (!cols.length) return recorded;
  const db = getConn();
  const ids = [...new Set(cols.map((col) => String(col.id || "")).filter(Boolean))];
  const lifecycleIds = [...new Set(cols.map((col) => String(col.lifecycle_id || "")).filter(Boolean))];
  if (!ids.length && !lifecycleIds.length) return recorded;

  const transitionByCol = new Map<string, string>();
  const transitionConditions: string[] = [];
  const transitionParams: string[][] = [];
  if (ids.length) {
    transitionConditions.push("collaboration_id = ANY($1)");
    transitionParams.push(ids);
  }
  if (lifecycleIds.length) {
    transitionConditions.push(`lifecycle_id = ANY($${transitionParams.length + 1})`);
    transitionParams.push(lifecycleIds);
  }
  const transitions = (await db.query(
    `SELECT collaboration_id, lifecycle_id, to_stage FROM stage_transitions
     WHERE ${transitionConditions.join(" OR ")}
     ORDER BY data_version_after DESC, occurred_at DESC`,
    transitionParams,
  )).rows as Row[];
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
    const writes = (await db.query(
      `SELECT lifecycle_id, stage_code FROM starry_stage_writes
       WHERE lifecycle_id = ANY($1)
       ORDER BY ts DESC, id DESC`,
      [lifecycleIds],
    )).rows as Row[];
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

async function resolvedLocalStage(existing: Row | undefined): Promise<string> {
  if (!existing) return "";
  return preferLaterMainStage(String(existing.stage_code || ""), await recordedOfficialStage(existing));
}

/** Batch official-stage restore. Mutates every supplied row sharing an id. */
export async function restoreOfficialCollaborationStages(cols: Row[]): Promise<Awaited<Map<string, string>>> {
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
  const recorded = await recordedOfficialStages(unique);
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
    const stmt = "UPDATE collaborations SET stage_code = $1 WHERE id = $2";
    for (const row of updates) (await getConn().query(stmt,[row.stage,row.id]));
  }
  for (const col of cols) {
    const stage = resolved.get(String(col.id || ""));
    if (stage) col.stage_code = stage;
  }
  return resolved;
}

export async function restoreOfficialCollaborationStage(col: Row): Promise<Awaited<string>> {
  (await restoreOfficialCollaborationStages([col]));
  return normalizeStage(String(col.stage_code || "")) || "INITIAL_CONTACT";
}

function kolUidOf(profile: Json): string {
  return firstString(profile.kolUid, profile.kol_uid, profile.uid);
}

async function existingRow(uid: string, name: string): Promise<Awaited<Row | undefined>> {
  const db = getConn();
  const byUid = (await db.query("SELECT * FROM collaborations WHERE kol_uid = $1",[uid])).rows[0] as Row | undefined;
  if (byUid) return byUid;
  if (!name) return undefined;
  const byName = (await db.query("SELECT * FROM collaborations WHERE handle = $1 OR display_name = $2",[name,name])).rows[0] as Row | undefined;
  if (byName && (!byName.kol_uid || String(byName.kol_uid) === uid)) return byName;
  return undefined;
}

async function persistStatus(result: StarryLibrarySync): Promise<Awaited<void>> {
  (await getConn().query("INSERT INTO app_state (key, value) VALUES ('starry_library_sync', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(result)]));
}

/**
 * 红人库全量走技能链路：由平台同步 Agent 以系统身份运行 `creator_library_all` 的 listAllKolProfiles，
 * 受同样的装配、挂载、登记与风险档闸门约束（不再由 Host 直连远端）。stub / 测试替身仍走本地桩。
 */
async function fetchLibraryProfiles(): Promise<Json> {
  if (starryKolUsesLocalDouble()) return (await executeStarryKolTask("creator_library_all", {}, "host")).data;
  const listed = normalizeStarryKolResult(await runPlatformSkillTool("creator_library_all", "starrykol", "listAllKolProfiles", {}));
  return { ...listed, list: starryKolRows(listed) };
}

export async function syncStarryHomeLibrary(): Promise<StarryLibrarySync> {
  const syncedAt = nowIso();
  try {
    const data = await fetchLibraryProfiles();
    const profiles = listOf(data).filter((row) => kolUidOf(row) && firstString(row.kolName, row.nickname, row.name));
    const seen = new Set<string>();
    (await tx(async (db) => {
      for (const profile of profiles) {
        const uid = kolUidOf(profile);
        if (seen.has(uid)) continue;
        seen.add(uid);
        const name = firstString(profile.kolName, profile.nickname, profile.name);
        const brand = brandOf(profile);
        const existing = (await existingRow(uid, name));
        const id = String(existing?.id || `col_${uid}`);
        const email = firstString(existing?.email, profile.contactEmail, profile.email);
        const mailbox = firstString(existing?.mailbox_from, BRAND_MAILBOXES[brand]);
        const remoteStage = remoteStageOf(profile);
        const stage = mergeRemoteLibraryStage(
          existing ? await resolvedLocalStage(existing) : null,
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
        (await db.query("INSERT INTO collaborations\n           (id, handle, display_name, brand, platform, followers, email, mailbox_from,\n            lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,\n            stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)\n           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)\n           ON CONFLICT(id) DO UPDATE SET\n            handle=excluded.handle,\n            display_name=excluded.display_name,\n            brand=excluded.brand,\n            platform=excluded.platform,\n            followers=excluded.followers,\n            email=excluded.email,\n            mailbox_from=excluded.mailbox_from,\n            lifecycle_id=excluded.lifecycle_id,\n            conversation_id=excluded.conversation_id,\n            stage_code=excluded.stage_code,\n            days_in_stage=excluded.days_in_stage,\n            notes=excluded.notes,\n            overdue=excluded.overdue,\n            stage_version=excluded.stage_version,\n            recipient_name=excluded.recipient_name,\n            phone=excluded.phone,\n            address_line=excluded.address_line,\n            country=excluded.country,\n            postal=excluded.postal,\n            sku=excluded.sku,\n            qty=excluded.qty,\n            locked=excluded.locked",[id,name,name,brand,firstString(profile.platform, profile.primaryPlatform, existing?.platform),followersOf(profile) || String(existing?.followers || ""),email,mailbox,lifecycleId,String(existing?.conversation_id || `conv_${uid}`),stage,Number.isFinite(days) ? days : 0,firstString(profile.notes, existing?.notes),Number(existing?.overdue || 0),Number(existing?.stage_version || 0),String(existing?.recipient_name || ""),String(existing?.phone || ""),String(existing?.address_line || ""),firstString(profile.countryName, existing?.country),String(existing?.postal || ""),String(existing?.sku || ""),String(existing?.qty || ""),Number(existing?.locked || 0)]));
        const nicheTags = parseNicheTags(profile.nicheTagsText);
        const remoteStyle = parseFollowStyleTags(profile.followStyleTags);
        const risk = normalizeRiskTag(firstString(
          Array.isArray(profile.riskTagCodes) ? profile.riskTagCodes[0] : "",
          profile.riskTag,
          profile.riskTagCode,
        ));
        (await db.query("UPDATE collaborations SET owner_name=$1, owner_mailbox=$2, engagement_rate=$3, audience_geo=$4,\n            avg_views_10=$5, kol_uid=$6, source='starry', duplicate_checked=1,\n            niche=$7, risk_tag=$8, wechat=$9, kol_id=$10, last_conversation_id=$11, last_lifecycle_id=$12, contact_email_masked=$13\n           WHERE id=$14",[firstString(profile.ownerName, profile.ownerUserName, existing?.owner_name),firstString(profile.ownerMailbox, profile.mailboxEmail, profile.owner_mailbox, existing?.owner_mailbox),engagementOf(profile) || String(existing?.engagement_rate || ""),geoOf(profile) || String(existing?.audience_geo || ""),avgPlaysOf(profile) || String(existing?.avg_views_10 || ""),uid,firstString(nicheTags.map((row) => row.name).join("；"), profile.nicheTagsText, existing?.niche),firstString(risk, existing?.risk_tag),firstString(profile.wechat, existing?.wechat),firstString(profile.kolId, profile.kol_id, existing?.kol_id),firstString(profile.lastConversationId, profile.last_conversation_id, existing?.last_conversation_id),remoteLifecycle != null ? String(remoteLifecycle) : firstString(existing?.last_lifecycle_id),firstString(profile.contactEmailMasked, profile.contact_email_masked, existing?.contact_email_masked),id]));
        // Remote list-all often sends []. Do not clobber tags the operator just saved.
        if (remoteStyle.length) {
          (await db.query("UPDATE collaborations SET follow_style_tags=$1 WHERE id=$2",[serializeFollowStyleTags(remoteStyle),id]));
        }
      }
    }));
    let ownershipError="";
    if (scopedUser()) try {
      const ownership=await syncStarryOwnershipIndex();
      (await audit("host", "starrykol.ownership_sync", ownership));
    } catch (error) {
      ownershipError=error instanceof Error ? error.message : String(error);
      (await audit("host", "starrykol.ownership_sync_failed", { error: error instanceof Error ? error.message : String(error) }));
    }
    const result: StarryLibrarySync = {
      ...(scopedUser() ? {ownership_ok: !ownershipError} : {}),
      ...(ownershipError ? {ownership_error:ownershipError} : {}),
      ok: true,
      source: "starry",
      tool: "listAllKolProfiles",
      count: seen.size,
      synced_at: syncedAt,
    };
    (await persistStatus(result));
    (await audit("host", "starrykol.library_sync", { count: seen.size, tool: "listAllKolProfiles" }));
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
    (await persistStatus(result));
    (await audit("host", "starrykol.library_sync_failed", { error: result.error }));
    return result;
  }
}
