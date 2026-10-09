/**
 * 线索阶段 Jev 打分（2026-10-08 一期）。
 *
 * 复用公海那套 `assessPublicKolWithJev(row, criteria)` 本体（输入一行公开画像 +
 * 可选口径，输出结构化评分），不复制评分逻辑：
 *  - 线索建档后异步打分，不阻塞 `createKolLead` 返回；失败记 `assessment_error`；
 *  - 去重命中已有新鲜评分（同版本、窗口内）直接复用，不重复调 API；
 *  - 公海卡片经 `attachLeadAssessments` 沿用线索分 + 口径摘要展示
 *    （"口径不同的两次评分不该看起来一样"；跨口径仅参考，不做全池重评）。
 */
import { postgresPool } from "../postgres/pool.js";
import {
  ASSESSMENT_VERSION,
  assessPublicKolWithJev,
} from "../host/kol-jev-assessment.js";
import {
  latestDiscoveryCriteria,
  type KolScoringCriteria,
} from "../host/kol-scoring-criteria.js";
import { normalizeCreatorKey, isUsableCreatorKey } from "../crawl/dedup.js";
import type { Json, Row } from "../types.js";

/** 评分复用窗口（天）：同精确键、同版本、窗口内的评分直接复用。 */
export const LEAD_SCORE_REUSE_WINDOW_DAYS = 30;

type LeadAssessment = {
  potential_score: number | null;
  potential_confidence: number | null;
  risk_score: number | null;
  risk_confidence: number | null;
  assessment_version: string | null;
  assessment_criteria: string | null;
  assessed_at: string | null;
};

function leadToProfileRow(lead: Row): Row {
  return {
    platform: lead.platform,
    handle: lead.account_handle,
    display_name: lead.display_name,
    homepage_url: lead.account_url,
    avatar_url: null,
    followers: lead.follower_count,
    avg_plays: null,
    engagement: null,
    direction: lead.category,
    region: null,
    style: null,
  } as Row;
}

async function writeLeadAssessment(leadId: string, assessment: LeadAssessment): Promise<void> {
  await postgresPool().query(
    `UPDATE kol_leads
        SET potential_score=$2, potential_confidence=$3, risk_score=$4, risk_confidence=$5,
            assessment_version=$6, assessment_criteria=$7, assessed_at=$8, assessment_error=NULL,
            updated_at=now()
      WHERE id=$1`,
    [
      leadId,
      assessment.potential_score,
      assessment.potential_confidence,
      assessment.risk_score,
      assessment.risk_confidence,
      assessment.assessment_version,
      assessment.assessment_criteria,
      assessment.assessed_at,
    ],
  );
}

/** 去重命中复用：同归一化键、非归档、同版本、窗口内的最新评分。 */
async function findReusableAssessment(lead: Row): Promise<LeadAssessment | null> {
  const key = normalizeCreatorKey(lead.platform, lead.account_handle);
  if (!isUsableCreatorKey(key)) return null;
  const platform = key.split(":")[0];
  const normalizedId = key.slice(key.indexOf(":") + 1);
  const { rows } = await postgresPool().query(
    `SELECT potential_score, potential_confidence, risk_score, risk_confidence,
            assessment_version, assessment_criteria, assessed_at
       FROM kol_leads
      WHERE id <> $1 AND NOT is_archived
        AND lower(platform) = $2 AND lower(account_handle) = $3
        AND assessment_version = $4 AND assessed_at IS NOT NULL
        AND assessed_at > now() - make_interval(days => $5)
      ORDER BY assessed_at DESC LIMIT 1`,
    [String(lead.id), platform, normalizedId, ASSESSMENT_VERSION, LEAD_SCORE_REUSE_WINDOW_DAYS],
  );
  const row = rows[0] as Row | undefined;
  if (!row || row.potential_score == null) return null;
  return {
    potential_score: Number(row.potential_score),
    potential_confidence: row.potential_confidence == null ? null : Number(row.potential_confidence),
    risk_score: row.risk_score == null ? null : Number(row.risk_score),
    risk_confidence: row.risk_confidence == null ? null : Number(row.risk_confidence),
    assessment_version: String(row.assessment_version || ""),
    assessment_criteria: row.assessment_criteria == null ? null : String(row.assessment_criteria),
    assessed_at: String(row.assessed_at || ""),
  };
}

/**
 * 线索建档后调用（fire-and-forget）。已有评分不重复打；
 * 无 API key 等失败如实记 assessment_error，不抛错阻塞建档。
 */
export async function scoreKolLeadWithJev(
  leadId: string,
  criteria?: KolScoringCriteria | null,
): Promise<void> {
  const { rows } = await postgresPool().query(`SELECT * FROM kol_leads WHERE id=$1`, [leadId]);
  const lead = rows[0] as Row | undefined;
  if (!lead || lead.assessed_at) return;
  const reused = await findReusableAssessment(lead).catch(() => null);
  if (reused) {
    await writeLeadAssessment(leadId, reused);
    return;
  }
  const resolvedCriteria = criteria ?? latestDiscoveryCriteria(String(lead.owner_principal_id || ""));
  try {
    const assessment = await assessPublicKolWithJev(leadToProfileRow(lead), resolvedCriteria);
    await writeLeadAssessment(leadId, {
      potential_score: assessment.potential_score,
      potential_confidence: assessment.potential_confidence,
      risk_score: assessment.risk_score,
      risk_confidence: assessment.risk_confidence,
      assessment_version: assessment.version,
      assessment_criteria: assessment.criteria_summary || null,
      assessed_at: assessment.assessed_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 180) : "Jev 评分失败";
    await postgresPool().query(`UPDATE kol_leads SET assessment_error=$2, updated_at=now() WHERE id=$1`, [
      leadId,
      message,
    ]);
  }
}

export type LeadAssessmentView = LeadAssessment & { lead_id: string };

/**
 * 公海沿用：批量给公海档案行附上同创作者的线索评分（含口径）。
 * 无匹配行不加字段；调用方展示时标注口径，跨口径仅参考。
 */
export async function attachLeadAssessments(items: Json[]): Promise<Json[]> {
  const keyed = items
    .map((item, index) => ({
      index,
      key: normalizeCreatorKey((item as Row).platform, (item as Row).platform_creator_id),
    }))
    .filter((entry) => isUsableCreatorKey(entry.key));
  if (!keyed.length) return items;
  const platforms = keyed.map((entry) => entry.key.split(":")[0]);
  const ids = keyed.map((entry) => entry.key.slice(entry.key.indexOf(":") + 1));
  let rows: Row[] = [];
  try {
    const result = await postgresPool().query(
      `SELECT DISTINCT ON (lower(platform), lower(account_handle))
              id AS lead_id, lower(platform) AS platform, lower(account_handle) AS account_handle,
              potential_score, potential_confidence, risk_score, risk_confidence,
              assessment_version, assessment_criteria, assessed_at
         FROM kol_leads
        WHERE NOT is_archived AND assessed_at IS NOT NULL
          AND lower(platform) = ANY($1::text[]) AND lower(account_handle) = ANY($2::text[])
        ORDER BY lower(platform), lower(account_handle), assessed_at DESC`,
      [platforms, ids],
    );
    rows = result.rows as Row[];
  } catch {
    return items;
  }
  const byKey = new Map<string, LeadAssessmentView>();
  for (const row of rows) {
    byKey.set(normalizeCreatorKey(row.platform, row.account_handle), {
      lead_id: String(row.lead_id),
      potential_score: row.potential_score == null ? null : Number(row.potential_score),
      potential_confidence: row.potential_confidence == null ? null : Number(row.potential_confidence),
      risk_score: row.risk_score == null ? null : Number(row.risk_score),
      risk_confidence: row.risk_confidence == null ? null : Number(row.risk_confidence),
      assessment_version: String(row.assessment_version || ""),
      assessment_criteria: row.assessment_criteria == null ? null : String(row.assessment_criteria),
      assessed_at: String(row.assessed_at || ""),
    });
  }
  return items.map((item, index) => {
    const entry = keyed.find((keyedEntry) => keyedEntry.index === index);
    const view = entry ? byKey.get(entry.key) : undefined;
    return view ? { ...item, lead_assessment: view } : item;
  });
}
