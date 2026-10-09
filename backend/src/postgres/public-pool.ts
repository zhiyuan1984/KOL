import { postgresQuery } from "./pool.js";
import { publicProfileFields } from "../host/public-profile.js";
import { HttpFail } from "../host/errors.js";
import { attachLeadAssessments } from "../ticket-domain/kol-lead-scoring.js";
import type { Json, Row } from "../types.js";

export type PoolPageOptions = {
  query: string;
  filter: "all" | "new" | "overdue";
  sort: "default" | "ingested-asc" | "ingested-desc" | "followers-asc" | "followers-desc" | "score-asc" | "score-desc";
  offset: number;
  limit: number;
};

export function parsePoolPageOptions(input: Record<string, string>): PoolPageOptions {
  const filter = input.filter || "all";
  const sort = input.sort || "score-desc";
  const offset = Number(input.offset || 0);
  const limit = Number(input.limit || 50);
  if (!["all", "new", "overdue"].includes(filter)
    || !["default", "ingested-asc", "ingested-desc", "followers-asc", "followers-desc", "score-asc", "score-desc"].includes(sort)
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || (input.query || "").length > 200) {
    throw new HttpFail(400, { code: "invalid_pool_page", message: "公海分页或筛选参数无效" });
  }
  return { query: (input.query || "").trim(), filter, sort, offset, limit } as PoolPageOptions;
}

// Only public fields plus the assessment error needed to derive its public state.
// Never load contacts, correspondence, contracts or employee notes into this read.
const columns = [
  "id", "company_id", "kol_uid", "handle", "display_name", "platform", "homepage_url", "avatar_url",
  "followers", "avg_plays", "engagement", "engagement_source", "direction", "region", "style",
  "ingest_source", "ingested_at", "public_stage", "pool_status", "idle", "source_batch", "platform_creator_id",
  "potential_score", "potential_probabilities", "potential_confidence", "risk_score", "risk_probabilities",
  "risk_confidence", "assessment_model", "assessment_version", "assessed_at", "assessment_error", "assessment_criteria",
];

// Match the employee-facing metric formatting so a search for “12万” or “4.2%”
// finds the stored numeric value, not just the raw database representation.
function metricSearch(column: string): string {
  return `CASE WHEN COALESCE(${column}, '') ~ '^[0-9]+([.][0-9]+)?$' THEN
    CASE WHEN ${column}::numeric > 0 AND ${column}::numeric <= 1 THEN round(${column}::numeric * 100, 1)::text || '%'
      WHEN ${column}::numeric >= 10000 THEN round(${column}::numeric / 10000)::text || '万'
      ELSE ${column} END ELSE ${column} END`;
}

/** One PostgreSQL snapshot for the bounded page, counts and library status. No sync bridge or remote calls. */
/**
 * 公海品牌可见性（2026-10-08 用户规则）：viewerBrands 为查看者的品牌 code 数组
 * 时，排除被同品牌跟进（kol_pool_brand_locks）锁定的 KOL；null 表示全品牌
 * （推广组组长/管理员/公司级部门负责人）不过滤；undefined 表示无法判定查看者，
 * 按失败开放处理（不过滤，保持现有行为）。
 */
export async function readPublicPoolPage(options: PoolPageOptions, companyId: string, viewerBrands?: string[] | null) {
  const [field, direction] = options.sort.split("-");
  const orderField = field === "followers" ? "follower_number" : field === "ingested" || field === "default" ? "ingested_at" : "COALESCE(potential_score, 0)";
  const orderDirection = direction === "asc" ? "ASC" : "DESC";
  const brandFilter = Array.isArray(viewerBrands)
    ? viewerBrands.map((brand) => String(brand).trim().toUpperCase()).filter(Boolean)
    : null;
  const rows = await postgresQuery<{
    items: Row[]; total: string; matched: string; new_count: string; library_value: string | null;
  }>(`
    WITH source AS (
      SELECT ${columns.map((column) => `p.${column}`).join(", ")},
        trim(regexp_replace(COALESCE(NULLIF(p.handle, ''), p.display_name, ''), '^@', '')) AS bare_handle,
        CASE WHEN trim(COALESCE(p.homepage_url, '')) <> '' THEN trim(p.homepage_url)
          WHEN trim(regexp_replace(COALESCE(NULLIF(p.handle, ''), p.display_name, ''), '^@', '')) <> '' THEN
            CASE lower(trim(p.platform))
              WHEN 'youtube' THEN 'https://www.youtube.com/@'
              WHEN 'instagram' THEN 'https://www.instagram.com/'
              WHEN 'facebook' THEN 'https://www.facebook.com/' ELSE '' END ||
            CASE WHEN lower(trim(p.platform)) IN ('youtube','instagram','facebook')
              THEN trim(regexp_replace(COALESCE(NULLIF(p.handle, ''), p.display_name, ''), '^@', '')) ELSE '' END
          ELSE '' END AS public_url
      FROM kol_profile_index p WHERE p.company_id=$1 AND p.pool_status='open'
        AND p.ingest_source IS DISTINCT FROM 'discovery-candidate'
        AND NOT EXISTS (SELECT 1 FROM kol_follow_index f JOIN kol_profile_index owned
          ON owned.company_id=f.company_id AND owned.kol_uid=f.kol_uid
          WHERE f.company_id=p.company_id AND f.status='active' AND
            (f.kol_uid=p.kol_uid OR (lower(owned.platform)=lower(p.platform)
              AND NULLIF(owned.platform_creator_id,'')=NULLIF(p.platform_creator_id,''))))
        AND ($6::text[] IS NULL OR NOT EXISTS (
          SELECT 1 FROM kol_pool_brand_locks bl
          WHERE lower(bl.platform) = lower(p.platform)
            AND NULLIF(bl.platform_creator_id, '') = NULLIF(lower(p.platform_creator_id), '')
            AND bl.brand = ANY($6::text[])
        ))
    ), candidates AS (
      SELECT s.*, CASE WHEN public_url <> '' THEN 'url:' || regexp_replace(lower(public_url), '/+$', '')
        ELSE 'identity:' || lower(trim(COALESCE(platform, ''))) || ':@' || lower(bare_handle) END AS profile_key,
        ${["avatar_url", "public_url", "followers", "avg_plays", "engagement", "direction", "region", "style"].map((column) => `(CASE WHEN COALESCE(s.${column}, '') <> '' THEN 1 ELSE 0 END)`).join(" + ")} AS completeness
      FROM source s
    ), canonical AS (
      SELECT DISTINCT ON (profile_key) * FROM candidates ORDER BY profile_key, completeness DESC, ingested_at DESC NULLS LAST, id
    ), visible AS MATERIALIZED (
      SELECT c.*, CASE WHEN released.release_reason='ownership-release' THEN '14天无回复' ELSE c.public_stage END AS effective_stage,
        CASE WHEN released.release_reason='ownership-release' OR COALESCE(c.public_stage, '') ~ '无回复|未回复|14[[:space:]]*(天|日).*无互动'
          THEN 'overdue' ELSE 'new' END AS public_filter,
        CASE WHEN replace(trim(COALESCE(c.followers, '')), ',', '') ~ '^[0-9]+([.][0-9]+)?([万kK])?$'
          THEN regexp_replace(replace(trim(c.followers), ',', ''), '[万kK]$', '')::numeric *
            CASE WHEN c.followers LIKE '%万' THEN 10000 WHEN c.followers ~ '[kK]$' THEN 1000 ELSE 1 END
          ELSE 0 END AS follower_number
      FROM canonical c LEFT JOIN LATERAL (
        SELECT f.release_reason FROM kol_follow_index f
        WHERE f.company_id=c.company_id AND f.kol_uid=c.kol_uid AND f.status='released'
        ORDER BY f.released_at DESC, f.id DESC LIMIT 1
      ) released ON true
    ), filtered AS MATERIALIZED (
      SELECT * FROM visible WHERE ($2='all' OR public_filter=$2)
        AND ($3='' OR strpos(lower(concat_ws(' ', handle, display_name, platform, direction, region, style,
          effective_stage, CASE WHEN public_filter='new' THEN '未首次建联' ELSE '14天无回复' END,
          followers, avg_plays, engagement, ${metricSearch("followers")}, ${metricSearch("avg_plays")}, ${metricSearch("engagement")})), lower($3)) > 0)
    ), page AS (
      SELECT * FROM filtered ORDER BY ${orderField} ${orderDirection} NULLS LAST, id ASC LIMIT $4 OFFSET $5
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${orderField} ${orderDirection} NULLS LAST, id ASC) FROM page), '[]'::jsonb) AS items,
      (SELECT count(*) FROM visible)::text AS total,
      (SELECT count(*) FROM filtered)::text AS matched,
      (SELECT count(*) FROM visible WHERE public_filter='new')::text AS new_count,
      (SELECT value FROM app_state WHERE key='starry_library_sync') AS library_value
  `, [companyId, options.filter, options.query, options.limit, options.offset, brandFilter]);
  const result = rows[0]!;
  let library: Json = { ok: false, source: "starry", tool: "listAllKolProfiles", count: 0 };
  try {
    const status = JSON.parse(result.library_value || "null") as Json | null;
    if (status) library = { ...library, ok: Boolean(status.ok), count: Number(status.count || 0), synced_at: status.synced_at, error: status.error };
  } catch { /* Malformed stored status is not successful synchronization. */ }
  const matched = Number(result.matched);
  return {
    entry: "memory", kind: "memory", creates_session: false, calls_model: false, index: "公海",
    library,
    items: await attachLeadAssessments(
      result.items.map((row) => publicProfileFields({ ...row, public_stage: row.effective_stage })),
    ),
    page: {
      offset: options.offset, limit: options.limit, total: Number(result.total), matched,
      new_count: Number(result.new_count),
      next_offset: options.offset + options.limit < matched ? options.offset + options.limit : null,
    },
  };
}
