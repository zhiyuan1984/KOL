import { CRAWL_PLATFORM_SET } from "../crawl/platforms.js";
import { audit, postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
export function health(): Json {
  return { ok: true, service: "kol-claw", version: "0.1.0" };
}

function creator(row: Row): Json {
  const extra = row.payload ? (JSON.parse(String(row.payload)) as Json) : {};
  return {
    ...extra,
    id: row.id,
    handle: row.handle,
    name: row.name,
    platform: row.platform,
    platform_creator_id: row.platform_creator_id,
    followers: row.followers,
    score: row.score,
    status: row.status,
    outreach_script: row.outreach_script,
  };
}
export async function listCreators(): Promise<Json[]> {
  return ((await postgresDb().many("SELECT * FROM claw_creators")) as Row[]).map(creator);
}
export async function getCreator(cid: string): Promise<Json | null> {
  const db = postgresDb();
  let row = (await db.one("SELECT * FROM claw_creators WHERE id = $1", cid)) as Row | undefined;
  if (!row)
    row = (await db.one("SELECT * FROM claw_creators WHERE handle = $1", cid)) as Row | undefined;
  if (!row)
    row = (await db.one("SELECT * FROM claw_creators WHERE platform_creator_id = $1", cid)) as Row | undefined;
  return row ? creator(row) : null;
}
export async function createCreator(body: Json): Promise<Json> {
  const cid = String(body.id || `cr_${body.handle || "new"}`);
  (await pgTransaction(async (c) => {
    (await c.execute(`INSERT INTO claw_creators
       (id, handle, name, platform, followers, score, status, outreach_script, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle,name=EXCLUDED.name,platform=EXCLUDED.platform,followers=EXCLUDED.followers,score=EXCLUDED.score,status=EXCLUDED.status,outreach_script=EXCLUDED.outreach_script,payload=EXCLUDED.payload`, cid, body.handle ?? null, body.name ?? null, body.platform ?? null, Number(body.followers || 0), Number(body.score || 0), body.status || "discovered", body.outreach_script || "", JSON.stringify(body)));
  }));
  (await audit("claw", "claw.creator.create", { id: cid }));
  return (await getCreator(cid)) || {};
}
export async function outreachScript(cid: string): Promise<Json> {
  const cr = (await getCreator(cid));
  if (!cr)
    throw new Error(cid);
  return { creator_id: cr.id, script: cr.outreach_script || "" };
}
export async function patchStatus(cid: string, body: Json): Promise<Json> {
  (await pgTransaction(async (c) => {
    (await c.execute("UPDATE claw_creators SET status = $1 WHERE id = $2", body.status, cid));
  }));
  (await audit("claw", "claw.creator.status", { id: cid, status: body.status }));
  return (await getCreator(cid)) || {};
}
export async function analysis(cid?: string | null): Promise<Json> {
  if (cid) {
    const cr = (await getCreator(cid));
    return { creator: cr, fit: cr?.score, read_only: true };
  }
  return { creators: (await listCreators()), read_only: true };
}
export function dailyTasks(): Json {
  return {
    date: "2026-08-30",
    tasks: [
      { code: "T4", title: "跟进 @小美妆日记" },
      { code: "T5", title: "报价 @数码老张" },
      { code: "T7", title: "催大纲 @母婴小课" },
      { code: "T8", title: "风险扫描" },
    ],
  };
}

export function campaigns(): Json[] {
  return [
    { id: "cmp_lt_q3", name: "LiTime Q3 KOL", brand: "LT", budget_usd: 24000 },
    { id: "cmp_ro_camp", name: "Renogy family camp", brand: "RO", budget_usd: 12000 },
  ];
}

export function budgetReport(): Json {
  return { campaigns: campaigns(), spent_usd: 4180, open_approvals_usd: 680 };
}
export async function ingestMediacrawler(body: Json): Promise<Json> {
  const nested = body.data && typeof body.data === "object" ? body.data as Json : {};
  const raw = body.items ?? body.creators ?? nested.items ?? nested.creators ?? body.data ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  const batchId = nid("ing");
  const source = String(body.source || nested.source || "mediacrawler").slice(0, 120);
  const taskId = body.task_id || body.remote_task_id || nested.task_id || null;
  const crawlJobId = body.crawl_job_id || null;
  const now = nowIso();
  let inserted = 0;
  let updated = 0;
  let rejected = 0;
  const accepted: Json[] = [];
  (await pgTransaction(async (db) => {
    for (const value of items) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        rejected += 1;
        continue;
      }
      const item = value as Json;
      const platform = String(item.platform || body.platform || "").trim().toLowerCase();
      const platformCreatorId = String(item.platform_creator_id || item.creator_id || item.user_id || item.sec_uid || item.id || "").trim();
      const nickname = String(item.nickname || item.name || item.handle || "").trim();
      if (!CRAWL_PLATFORM_SET.has(platform) || !platformCreatorId || !nickname) {
        rejected += 1;
        continue;
      }
      const followers = nonNegativeInt(item.followers ?? item.fans ?? item.follower_count);
      const recentViews = normalizeViews(item.recent_views ?? item.views ?? item.recent_10_views);
      const scoring = calculateCreatorScore(followers, recentViews);
      const existing = (await db.one("SELECT id FROM claw_creators WHERE platform=$1 AND platform_creator_id=$2", platform, platformCreatorId)) as {
        id: string;
      } | undefined;
      const creatorId = existing?.id || `cr_${platform}_${safeId(platformCreatorId)}`;
      const collectedAt = validDate(item.collected_at || body.collected_at) || now;
      const payload: Json = {
        ...item,
        platform,
        platform_creator_id: platformCreatorId,
        nickname,
        followers,
        recent_views: recentViews,
        collected_at: collectedAt,
        source,
        task_id: taskId,
        score_details: scoring,
      };
      if (existing) {
        (await db.execute(`UPDATE claw_creators SET handle=$1,name=$2,followers=$3,score=$4,status='discovered',payload=$5 WHERE id=$6`, nickname, nickname, followers, scoring.score, JSON.stringify(payload), creatorId));
        updated += 1;
      }
      else {
        (await db.execute(`INSERT INTO claw_creators
           (id,handle,name,platform,platform_creator_id,followers,score,status,outreach_script,payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'discovered','',$8)`, creatorId, nickname, nickname, platform, platformCreatorId, followers, scoring.score, JSON.stringify(payload)));
        inserted += 1;
      }
      (await db.execute(`INSERT INTO creator_snapshots
         (id,creator_id,ingestion_batch_id,crawl_job_id,platform,platform_creator_id,nickname,followers,
          recent_views,score,score_details,source,task_id,collected_at,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, nid("snap"), creatorId, batchId, crawlJobId, platform, platformCreatorId, nickname, followers, JSON.stringify(recentViews), scoring.score, JSON.stringify(scoring), source, taskId, collectedAt, now));
      accepted.push({ creator_id: creatorId, platform, platform_creator_id: platformCreatorId, score: scoring.score });
    }
    (await db.execute(`INSERT INTO ingestion_batches
       (id,source,task_id,crawl_job_id,accepted,inserted,updated,rejected,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, batchId, source, taskId, crawlJobId, accepted.length, inserted, updated, rejected, now));
  }));
  (await audit("claw", "claw.ingest.mediacrawler", {
    batch_id: batchId, accepted: accepted.length, inserted, updated, rejected, source,
  }));
  return { ok: true, batch_id: batchId, accepted: accepted.length, inserted, updated, rejected, creators: accepted };
}
function nonNegativeInt(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function normalizeViews(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  return raw.map(Number).filter((number) => Number.isFinite(number) && number >= 0).slice(-10);
}

function safeId(value: string): string {
  return Buffer.from(value).toString("base64url").slice(0, 80);
}
function validDate(value: unknown): string | null {
  if (!value)
    return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export type CreatorScore = {
  score: number;
  followers: number;
  sample_size: number;
  view_median: number;
  view_mean: number;
  view_follower_ratio: number;
  stability: number;
  sample_confidence: number;
};

export function calculateCreatorScore(followers: number, recentViews: number[]): CreatorScore {
  const views = normalizeViews(recentViews);
  const sorted = [...views].sort((a, b) => a - b);
  const mean = views.length ? views.reduce((sum, value) => sum + value, 0) / views.length : 0;
  const middle = Math.floor(sorted.length / 2);
  const median = !sorted.length ? 0 : sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = views.length
    ? views.reduce((sum, value) => sum + (value - mean) ** 2, 0) / views.length
    : 0;
  const stability = mean > 0 ? Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / mean)) : 0;
  const ratio = followers > 0 ? mean / followers : 0;
  const confidence = Math.min(1, views.length / 10);
  const followerPoints = Math.min(25, Math.log10(Math.max(1, followers)) / 6 * 25);
  const viewPoints = Math.min(25, Math.log10(Math.max(1, median)) / 6 * 25);
  const ratioPoints = Math.min(20, ratio * 40);
  const score = followerPoints + viewPoints + ratioPoints + stability * 15 + confidence * 15;
  return {
    score: Math.round(score * 100) / 100,
    followers: nonNegativeInt(followers),
    sample_size: views.length,
    view_median: Math.round(median * 100) / 100,
    view_mean: Math.round(mean * 100) / 100,
    view_follower_ratio: Math.round(ratio * 10000) / 10000,
    stability: Math.round(stability * 10000) / 10000,
    sample_confidence: Math.round(confidence * 100) / 100,
  };
}
