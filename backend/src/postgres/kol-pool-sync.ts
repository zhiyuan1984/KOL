import { postgresConnection } from "./pool.js";
import { nid } from "../ids.js";
import { firstString, listOf } from "../starrykol/mail-fields.js";
import { pageKolProfiles } from "../host/starry-connectors.js";
import { avgPlaysOf, engagementWithSource, followersOf, geoOf } from "../starrykol/remote-metrics.js";
import { postgresPool, postgresTransaction } from "./pool.js";
import type { Json } from "../types.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

type SyncResult = { ok: boolean; run_id: string; count: number; pages: number; expected_count: number; error?: string };
function now(): string { return new Date().toISOString(); }
function companyId(): string { return String(process.env.KOL_COMPANY_ID || "company:default"); }
function homepageOf(p: Json): string { return firstString(p.homepageUrl, p.homepage, p.platformUrl, p.profileUrl, p.homePage, p.url); }
function numberField(data: Json, key: string): number | null {
  const value = Number(data[key]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function mapProfile(p: Json, version: string): Record<string, unknown> {
  const uid = firstString(p.kolUid, p.kol_uid, p.uid);
  const engagement = engagementWithSource(p);
  return {
    id: nid("kpi"), company_id: companyId(), kol_uid: uid,
    handle: firstString(p.kolName, p.nickname, p.name, p.accountHandle, p.handle),
    display_name: firstString(p.kolName, p.nickname, p.displayName, p.accountHandle, p.name),
    platform: firstString(p.platform, p.primaryPlatform), homepage_url: homepageOf(p),
    avatar_url: firstString(p.avatarUrl, p.avatar_url, p.avatar, p.profileImage, p.profile_image),
    followers: followersOf(p), avg_plays: avgPlaysOf(p), engagement: engagement.value,
    engagement_source: engagement.source, direction: firstString(p.niche, p.nicheTagsText, p.direction),
    region: geoOf(p) || firstString(p.region),
    style: firstString(Array.isArray(p.followStyleTags) ? p.followStyleTags.join(",") : "", p.style),
    ingest_source: "starry.pageKolProfiles", ingested_at: version,
    public_stage: firstString(p.cooperationStageName, p.stageName, p.stage),
    pool_status: "open", idle: 0, source_version: version, source_batch: version,
    platform_creator_id: firstString(p.platformCreatorId, p.platform_creator_id, p.creatorId),
    created_at: version, updated_at: version,
  };
}
async function mark(runId: string, status: "succeeded" | "failed", fields: { count?: number; pages?: number; error?: string; expected?: number; }): Promise<void> {
  const finished = now();
  await postgresConnection().query(`UPDATE kol_pool_sync_runs SET status=$1,expected_count=COALESCE($2,expected_count),fetched_count=$3,upserted_count=$3,page_count=$4,completed_at=$5,error=$6 WHERE id=$7`,
    [status, fields.expected ?? null, fields.count ?? 0, fields.pages ?? 0, finished, fields.error?.slice(0, 1000) || null, runId]);
}
/** Full snapshot: remote data is collected and validated before any local cache mutation. */
export async function syncKolProfileIndexPostgres(pageSize = DEFAULT_PAGE_SIZE): Promise<SyncResult> {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
  const runId = nid("kpsr"); const version = now(); const company = companyId();
  await postgresConnection().query(`INSERT INTO kol_pool_sync_runs(id,company_id,status,source_version,started_at,created_at) VALUES($1,$2,running,$3,$3,$3)`, [runId, company, version]);
  await postgresConnection().query(`INSERT INTO starry_ownership_sync_state(company_id,state,source_version,profile_count,error,updated_at,last_attempt_at,last_run_id) VALUES($1,failed,$2,0,NULL,$2,$2,$3) ON CONFLICT(company_id) DO UPDATE SET last_attempt_at=$2,last_run_id=$3`, [company, version, runId]);
  const profiles: Json[] = []; const seen = new Set<string>(); let expected: number | null = null; let pages = 0;
  try {
    for (;;) {
      pages += 1;
      const data = await pageKolProfiles({ pageNo: pages, pageSize: size });
      const total = numberField(data, "total");
      if (total == null) throw new Error("starry_snapshot_total_missing");
      if (expected != null && expected !== total) throw new Error("starry_snapshot_total_changed");
      expected = total;
      const rows = listOf(data);
      for (const row of rows) {
        const uid = firstString(row.kolUid, row.kol_uid, row.uid);
        if (!uid || seen.has(uid)) throw new Error("starry_snapshot_duplicate_or_missing_uid");
        seen.add(uid); profiles.push(row);
      }
      if (profiles.length > total) throw new Error("starry_snapshot_count_overflow");
      if (profiles.length === total) break;
      if (!rows.length) throw new Error("starry_snapshot_pagination_incomplete");
      const safeMaxPages = Math.max(1, Math.ceil(total / size) + 2);
      if (pages >= safeMaxPages) throw new Error("starry_snapshot_pagination_safety_limit");
    }
    if (expected == null || profiles.length !== expected) throw new Error("starry_snapshot_count_mismatch");
    await postgresTransaction(async (client) => {
      const ids = profiles.map((p) => firstString(p.kolUid, p.kol_uid, p.uid));
      for (const profile of profiles) {
        const row = mapProfile(profile, version);
        await client.query(`INSERT INTO kol_profile_index (id,company_id,kol_uid,handle,display_name,platform,homepage_url,avatar_url,followers,avg_plays,engagement,engagement_source,direction,region,style,ingest_source,ingested_at,public_stage,pool_status,idle,source_version,source_batch,platform_creator_id,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
          ON CONFLICT(company_id,kol_uid) DO UPDATE SET handle=COALESCE(NULLIF(EXCLUDED.handle,),kol_profile_index.handle),display_name=COALESCE(NULLIF(EXCLUDED.display_name,),kol_profile_index.display_name),platform=COALESCE(NULLIF(EXCLUDED.platform,),kol_profile_index.platform),homepage_url=COALESCE(NULLIF(EXCLUDED.homepage_url,),kol_profile_index.homepage_url),avatar_url=COALESCE(NULLIF(EXCLUDED.avatar_url,),kol_profile_index.avatar_url),followers=COALESCE(NULLIF(EXCLUDED.followers,),kol_profile_index.followers),avg_plays=COALESCE(NULLIF(EXCLUDED.avg_plays,),kol_profile_index.avg_plays),engagement=COALESCE(NULLIF(EXCLUDED.engagement,),kol_profile_index.engagement),engagement_source=COALESCE(NULLIF(EXCLUDED.engagement_source,),kol_profile_index.engagement_source),direction=COALESCE(NULLIF(EXCLUDED.direction,),kol_profile_index.direction),region=COALESCE(NULLIF(EXCLUDED.region,),kol_profile_index.region),style=COALESCE(NULLIF(EXCLUDED.style,),kol_profile_index.style),ingest_source=EXCLUDED.ingest_source,public_stage=COALESCE(NULLIF(EXCLUDED.public_stage,),kol_profile_index.public_stage),source_version=EXCLUDED.source_version,source_batch=EXCLUDED.source_batch,platform_creator_id=COALESCE(NULLIF(EXCLUDED.platform_creator_id,),kol_profile_index.platform_creator_id),updated_at=EXCLUDED.updated_at`, Object.values(row));
      }
      await client.query(`UPDATE kol_profile_index SET pool_status=closed,source_version=$1,source_batch=$1,updated_at=$1 WHERE company_id=$2 AND ingest_source=starry.pageKolProfiles AND NOT (kol_uid = ANY($3::text[]))`, [version, company, ids]);
      await client.query(`DELETE FROM starry_profile_ownership WHERE company_id=$1`, [company]);
      for (const profile of profiles) {
        const uid = firstString(profile.kolUid, profile.kol_uid, profile.uid);
        const owner = firstString(profile.ownerOpenId, profile.owner_open_id, profile.ownerUserId, profile.owner_user_id);
        const mailbox = firstString(profile.ownerMailbox, profile.owner_mailbox, profile.mailboxEmail).toLowerCase();
        await client.query(`INSERT INTO starry_profile_ownership(company_id,kol_uid,owner_open_id,owner_mailbox,brand,source_version,synced_at) VALUES($1,$2,$3,$4,$5,$6,$6)`, [company, uid, owner, mailbox, firstString(profile.brandCode, profile.brandName), version]);
      }
      await client.query(`INSERT INTO starry_ownership_sync_state(company_id,state,source_version,profile_count,error,updated_at,last_success_at,last_attempt_at,last_run_id) VALUES($1,ready,$2,$3,NULL,$2,$2,$2,$4) ON CONFLICT(company_id) DO UPDATE SET state=ready,source_version=$2,profile_count=$3,error=NULL,updated_at=$2,last_success_at=$2,last_attempt_at=$2,last_run_id=$4`, [company, version, profiles.length, runId]);
    });
    await mark(runId, "succeeded", { count: profiles.length, pages, expected: expected! });
    return { ok: true, run_id: runId, count: profiles.length, pages, expected_count: expected! };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mark(runId, "failed", { count: profiles.length, pages, expected: expected ?? undefined, error: message });
    await postgresConnection().query(`UPDATE starry_ownership_sync_state SET state=failed,error=$1,last_attempt_at=$2,last_run_id=$3 WHERE company_id=$4`, [message.slice(0, 1000), now(), runId, company]);
    return { ok: false, run_id: runId, count: profiles.length, pages, expected_count: expected ?? 0, error: message };
  }
}
