import { currentTransactionClient, postgresTransaction } from "./pool.js";
import type { PoolClient } from "pg";
import { nid } from "../ids.js";
import { firstString, listOf } from "../starrykol/mail-fields.js";
import { pageKolProfiles } from "../host/starry-connectors.js";
import {
  avgPlaysOf,
  engagementWithSource,
  followersOf,
  geoOf,
} from "../starrykol/remote-metrics.js";
import { withStarryConnectorAuth } from "../starrykol/service.js";
import type { Json } from "../types.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const POOL_INGEST_SOURCE = "starry.pageKolProfiles";

type SyncResult = {
  ok: boolean;
  run_id: string;
  count: number;
  pages: number;
  expected_count: number;
  error?: string;
};
function now(): string {
  return new Date().toISOString();
}
function companyId(): string {
  return String(process.env.KOL_COMPANY_ID || "company:default");
}
function homepageOf(p: Json): string {
  return firstString(
    p.homepageUrl,
    p.homepage,
    p.platformUrl,
    p.profileUrl,
    p.homePage,
    p.url,
  );
}
function numberField(data: Json, key: string): number | null {
  const raw = data[key];
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function mapProfile(p: Json, version: string): Record<string, unknown> {
  const uid = firstString(p.kolUid, p.kol_uid, p.uid);
  const engagement = engagementWithSource(p);
  return {
    id: nid("kpi"),
    company_id: companyId(),
    kol_uid: uid,
    handle: firstString(
      p.kolName,
      p.nickname,
      p.name,
      p.accountHandle,
      p.handle,
    ),
    display_name: firstString(
      p.kolName,
      p.nickname,
      p.displayName,
      p.accountHandle,
      p.name,
    ),
    platform: firstString(p.platform, p.primaryPlatform),
    homepage_url: homepageOf(p),
    avatar_url: firstString(
      p.avatarUrl,
      p.avatar_url,
      p.avatar,
      p.profileImage,
      p.profile_image,
    ),
    followers: followersOf(p),
    avg_plays: avgPlaysOf(p),
    engagement: engagement.value,
    engagement_source: engagement.source,
    direction: firstString(p.niche, p.nicheTagsText, p.direction),
    region: geoOf(p) || firstString(p.region),
    style: firstString(
      Array.isArray(p.followStyleTags) ? p.followStyleTags.join(",") : "",
      p.style,
    ),
    ingest_source: POOL_INGEST_SOURCE,
    ingested_at: version,
    public_stage: firstString(p.cooperationStageName, p.stageName, p.stage),
    pool_status: "open",
    idle: 0,
    source_version: version,
    source_batch: version,
    platform_creator_id: firstString(
      p.platformCreatorId,
      p.platform_creator_id,
      p.creatorId,
    ),
    created_at: version,
    updated_at: version,
  };
}
async function mark(
  client: PoolClient,
  runId: string,
  status: "succeeded" | "failed",
  fields: {
    fetched?: number;
    upserted?: number;
    pages?: number;
    error?: string;
    expected?: number;
  },
): Promise<void> {
  const finished = now();
  await client.query(
    `UPDATE kol_pool_sync_runs SET status=$1,expected_count=COALESCE($2,expected_count),fetched_count=$3,upserted_count=$4,page_count=$5,completed_at=$6,error=$7 WHERE id=$8`,
    [
      status,
      fields.expected ?? null,
      fields.fetched ?? 0,
      fields.upserted ?? 0,
      fields.pages ?? 0,
      finished,
      fields.error?.slice(0, 1000) || null,
      runId,
    ],
  );
}
/** Full snapshot: remote data is collected and validated before any local cache mutation. */
export async function syncKolProfileIndexPostgres(
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<SyncResult> {
  // Fetching the remote authority while an ambient SQL transaction is open would
  // hold that caller-owned transaction across network I/O. Refuse it rather than
  // escaping to another client and splitting the caller's consistency boundary.
  if (currentTransactionClient()) {
    throw new Error("syncKolProfileIndexPostgres refuses ambient PostgreSQL transaction");
  }
  const size = Number.isFinite(pageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)))
    : DEFAULT_PAGE_SIZE;
  const runId = nid("kpsr");
  const version = now();
  const company = companyId();
  await postgresTransaction(async (client) => {
    await client.query(
      `INSERT INTO kol_pool_sync_runs(id,company_id,status,source_version,started_at,created_at) VALUES($1,$2,$3,$4,$4,$4)`,
      [runId, company, "running", version],
    );
    // Preserve an existing ready snapshot until a full replacement commits.
    await client.query(
      `INSERT INTO starry_ownership_sync_state(company_id,state,source_version,profile_count,error,updated_at,last_attempt_at,last_run_id) VALUES($1,$2,$3,0,NULL,$3,$3,$4) ON CONFLICT(company_id) DO UPDATE SET last_attempt_at=$3,last_run_id=$4`,
      [company, "failed", version, runId],
    );
  });
  const profiles: Json[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  let pages = 0;
  try {
    for (;;) {
      pages += 1;
      const data = await withStarryConnectorAuth(() =>
        pageKolProfiles({ pageNo: pages, pageSize: size }),
      );
      const total = numberField(data, "total");
      if (total == null) throw new Error("starry_snapshot_total_missing");
      if (expected != null && expected !== total)
        throw new Error("starry_snapshot_total_changed");
      expected = total;
      const rows = listOf(data);
      for (const row of rows) {
        const uid = firstString(row.kolUid, row.kol_uid, row.uid);
        if (!uid || seen.has(uid))
          throw new Error("starry_snapshot_duplicate_or_missing_uid");
        seen.add(uid);
        profiles.push(row);
      }
      if (profiles.length > total)
        throw new Error("starry_snapshot_count_overflow");
      if (profiles.length === total) break;
      if (!rows.length)
        throw new Error("starry_snapshot_pagination_incomplete");
      const safeMaxPages = Math.max(1, Math.ceil(total / size) + 2);
      if (pages >= safeMaxPages)
        throw new Error("starry_snapshot_pagination_safety_limit");
    }
    if (expected == null || profiles.length !== expected)
      throw new Error("starry_snapshot_count_mismatch");
    await postgresTransaction(async (client) => {
      // The start transaction makes last_run_id the latest accepted attempt. Lock
      // and verify that lease before changing any snapshot table: an older fetch
      // that finishes later must not replace a newer complete snapshot.
      const state = await client.query<{ last_run_id: string | null }>(
        "SELECT last_run_id FROM starry_ownership_sync_state WHERE company_id=$1 FOR UPDATE",
        [company],
      );
      if (state.rows[0]?.last_run_id !== runId) {
        throw new Error("starry_pool_sync_superseded");
      }
      const ids = profiles.map((p) => firstString(p.kolUid, p.kol_uid, p.uid));
      for (const profile of profiles) {
        const row = mapProfile(profile, version);
        await client.query(
          `INSERT INTO kol_profile_index (id,company_id,kol_uid,handle,display_name,platform,homepage_url,avatar_url,followers,avg_plays,engagement,engagement_source,direction,region,style,ingest_source,ingested_at,public_stage,pool_status,idle,source_version,source_batch,platform_creator_id,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
          ON CONFLICT(company_id,kol_uid) DO UPDATE SET handle=COALESCE(NULLIF(EXCLUDED.handle,''),kol_profile_index.handle),display_name=COALESCE(NULLIF(EXCLUDED.display_name,''),kol_profile_index.display_name),platform=COALESCE(NULLIF(EXCLUDED.platform,''),kol_profile_index.platform),homepage_url=COALESCE(NULLIF(EXCLUDED.homepage_url,''),kol_profile_index.homepage_url),avatar_url=COALESCE(NULLIF(EXCLUDED.avatar_url,''),kol_profile_index.avatar_url),followers=COALESCE(NULLIF(EXCLUDED.followers,''),kol_profile_index.followers),avg_plays=COALESCE(NULLIF(EXCLUDED.avg_plays,''),kol_profile_index.avg_plays),engagement=COALESCE(NULLIF(EXCLUDED.engagement,''),kol_profile_index.engagement),engagement_source=COALESCE(NULLIF(EXCLUDED.engagement_source,''),kol_profile_index.engagement_source),direction=COALESCE(NULLIF(EXCLUDED.direction,''),kol_profile_index.direction),region=COALESCE(NULLIF(EXCLUDED.region,''),kol_profile_index.region),style=COALESCE(NULLIF(EXCLUDED.style,''),kol_profile_index.style),ingest_source=EXCLUDED.ingest_source,public_stage=COALESCE(NULLIF(EXCLUDED.public_stage,''),kol_profile_index.public_stage),pool_status=EXCLUDED.pool_status,source_version=EXCLUDED.source_version,source_batch=EXCLUDED.source_batch,platform_creator_id=COALESCE(NULLIF(EXCLUDED.platform_creator_id,''),kol_profile_index.platform_creator_id),updated_at=EXCLUDED.updated_at`,
          Object.values(row),
        );
      }
      await client.query(
        `UPDATE kol_profile_index SET pool_status=$1,source_version=$2,source_batch=$2,updated_at=$2 WHERE company_id=$3 AND ingest_source=$4 AND NOT (kol_uid = ANY($5::text[]))`,
        ["closed", version, company, POOL_INGEST_SOURCE, ids],
      );
      await client.query(
        `DELETE FROM starry_profile_ownership WHERE company_id=$1`,
        [company],
      );
      for (const profile of profiles) {
        const uid = firstString(profile.kolUid, profile.kol_uid, profile.uid);
        const owner = firstString(
          profile.ownerOpenId,
          profile.owner_open_id,
          profile.ownerUserId,
          profile.owner_user_id,
        );
        const mailbox = firstString(
          profile.ownerMailbox,
          profile.owner_mailbox,
          profile.mailboxEmail,
        ).toLowerCase();
        await client.query(
          `INSERT INTO starry_profile_ownership(company_id,kol_uid,owner_open_id,owner_mailbox,brand,source_version,synced_at) VALUES($1,$2,$3,$4,$5,$6,$6)`,
          [
            company,
            uid,
            owner,
            mailbox,
            firstString(profile.brandCode, profile.brandName),
            version,
          ],
        );
      }
      const ready = await client.query(
        `UPDATE starry_ownership_sync_state SET state=$1,source_version=$2,profile_count=$3,error=NULL,updated_at=$2,last_success_at=$2,last_attempt_at=$2,last_run_id=$4 WHERE company_id=$5 AND last_run_id=$4`,
        ["ready", version, profiles.length, runId, company],
      );
      if (ready.rowCount !== 1) throw new Error("starry_pool_sync_superseded");
      await mark(client, runId, "succeeded", {
        fetched: profiles.length,
        upserted: profiles.length,
        pages,
        expected: expected!,
      });
    });
    return {
      ok: true,
      run_id: runId,
      count: profiles.length,
      pages,
      expected_count: expected!,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postgresTransaction(async (client) => {
      await mark(client, runId, "failed", {
        fetched: profiles.length,
        upserted: 0,
        pages,
        expected: expected ?? undefined,
        error: message,
      });
      // A failed attempt is visible, but it may change global state only while
      // it still owns the latest-attempt lease. A newer ready snapshot is intact.
      await client.query(
        `UPDATE starry_ownership_sync_state SET state=$1,error=$2,last_attempt_at=$3 WHERE company_id=$4 AND last_run_id=$5`,
        ["failed", message.slice(0, 1000), now(), company, runId],
      );
    });
    return {
      ok: false,
      run_id: runId,
      count: profiles.length,
      pages,
      expected_count: expected ?? 0,
      error: message,
    };
  }
}
