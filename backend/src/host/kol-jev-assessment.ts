import { TypeSafeClient } from "@typesafe-ai/sdk";
import { audit, getConn, nowIso, type SqliteConn } from "../db.js";
import type { Row } from "../types.js";
import { memoryCompanyId } from "./kol-memory.js";
import { criteriaState, criteriaSummary, type KolScoringCriteria } from "./kol-scoring-criteria.js";

const JEV_OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const ASSESSMENT_VERSION = "jev-kol-v1";

type FetchLike = typeof fetch;
let jevFetchOverride: FetchLike | null = null;

/** Test seam; the browser never receives the OpenRouter credential. */
export function setKolJevFetch(fetcher?: FetchLike): void {
  jevFetchOverride = fetcher || null;
}

function apiKey(): string {
  return String(process.env.OPENROUTER_API_KEY || "").trim();
}

function model(): string {
  return String(process.env.JEV_MODEL || "jev-1.13").trim() || "jev-1.13";
}

function assessmentTimeoutMs(): number {
  const value = Number(process.env.JEV_KOL_TIMEOUT_MS || 8_000);
  return Number.isFinite(value) ? Math.max(1_000, Math.min(15_000, Math.floor(value))) : 8_000;
}

function boundedText(value: unknown, max = 180): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizedMetric(value: unknown): string {
  const text = boundedText(value, 40);
  return text || "未提供";
}

function profileState(row: Row): string {
  return JSON.stringify({
    public_profile: {
      platform: boundedText(row.platform, 40) || "未提供",
      handle: boundedText(row.handle || row.display_name, 80) || "未提供",
      homepage_present: Boolean(boundedText(row.homepage_url, 240)),
      avatar_present: Boolean(boundedText(row.avatar_url, 240)),
      followers: normalizedMetric(row.followers),
      average_plays: normalizedMetric(row.avg_plays),
      engagement: normalizedMetric(row.engagement),
      topic: boundedText(row.direction, 120) || "未提供",
      region: boundedText(row.region, 80) || "未提供",
      style: boundedText(row.style, 120) || "未提供",
    },
  });
}

type AssessmentAnswer = {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

function probabilityMap(answer: AssessmentAnswer): Record<string, number> {
  const raw = answer.probabilities;
  if (!raw || typeof raw !== "object") return answer.choice ? { [answer.choice]: 1 } : {};
  const entries = Object.entries(raw)
    .map(([key, value]) => [key, Math.max(0, Number(value))] as const)
    .filter(([, value]) => Number.isFinite(value));
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return answer.choice ? { [answer.choice]: 1 } : {};
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

function weightedScore(answer: AssessmentAnswer, weights: Record<string, number>): number | null {
  const probabilities = probabilityMap(answer);
  const keys = Object.keys(probabilities);
  if (!keys.length) return null;
  return Math.round(keys.reduce((sum, key) => sum + (probabilities[key] || 0) * (weights[key] ?? 0), 0));
}

function scoreWithCompatibility(answer: AssessmentAnswer, weights: Record<string, number>, legacy: Record<string, number>): number | null {
  return answer.probabilities ? weightedScore(answer, weights) : (legacy[answer.choice || ""] ?? null);
}

function selected(value: AssessmentAnswer | undefined): { choice: string; confidence: number } {
  return {
    choice: String(value?.choice || "insufficient"),
    confidence: Math.max(0, Math.min(1, Number(value?.confidence || 0))),
  };
}

export type KolAssessment = {
  potential_score: number | null;
  potential_confidence: number | null;
  potential_probabilities: string | null;
  risk_score: number | null;
  risk_confidence: number | null;
  risk_probabilities: string | null;
  model: string;
  version: string;
  assessed_at: string;
  /** 本次评分用的口径摘要（员工声明的 AI 发现条件）；空串表示按公开资料通用口径。 */
  criteria_summary: string;
};

/**
 * Score only the suitability/risk signal encoded in already-public KOL index
 * fields. It does not retrieve contact data, produce outreach copy, or make a
 * business decision. Low-confidence results still get a sortable advisory
 * score; confidence is shown separately and gates high-potential badges.
 */
export async function assessPublicKolWithJev(
  row: Row,
  criteria: KolScoringCriteria | null = null,
): Promise<KolAssessment> {
  const key = apiKey();
  if (!key) throw new Error("Jev 评分服务未配置 OpenRouter 密钥。");
  const currentModel = model();
  const client = new TypeSafeClient({
    apiKey: key,
    baseURL: JEV_OPENROUTER_BASE_URL,
    defaultModel: currentModel,
    timeout: assessmentTimeoutMs(),
    retry: { maxRetries: 0 },
    logLevel: "off",
    ...(jevFetchOverride ? { fetch: jevFetchOverride } : {}),
  });
  const response = await client.systemOne({
    model: currentModel,
    // 只有员工声明过目标条件时才提交 target_criteria：没有条件时的「匹配」是模型自己编的。
    state: criteria
      ? { public_profile: profileState(row), target_criteria: criteriaState(criteria) }
      : { public_profile: profileState(row) },
    questions: {
      potential: {
        type: "choice",
        instructions: "只根据 `public_profile` 的公开字段评估合作潜力，并与 `target_criteria`（员工声明的目标平台/地区/方向/关键词/粉丝与均播门槛）比对：量级未达门槛或与目标方向、地区明显不符时选 watch；缺少关键公开指标、或没有 `target_criteria` 时不得推断匹配，选 insufficient。不得推断私密联系方式、报价、合同或未提供的互动表现。",
        criteria: {
          high_potential: "公开指标与内容方向充分，显示出可验证的受众规模或内容匹配信号，值得优先人工复核。",
          watch: "存在部分正向信号，但公开指标、内容匹配或时效不足以列为高潜。",
          insufficient: "公开资料不足，不能可靠判断合作潜力。",
        },
      },
      risk: {
        type: "choice",
        instructions: "只根据 `public_profile` 的公开字段评估信息与匹配风险；风险是人工复核优先级，不是拒绝或删除依据。只把**可核对的不一致**（例如粉丝量与近10条均播/互动率明显不自洽）或与 `target_criteria` 明显冲突判为 high_risk；资料缺失一律选 insufficient，不得当成风险。",
        criteria: {
          high_risk: "公开资料存在显著缺口或明显不匹配信号，需要人工优先核验。",
          watch: "有待核验点，但没有足够公开证据定为高风险。",
          normal: "公开资料未显示明显风险，仍需人工判断。",
          insufficient: "公开资料不足，不能可靠判断风险。",
        },
      },
    },
  });
  void (response as { model?: string });
  const answers = response.answers as { potential?: AssessmentAnswer; risk?: AssessmentAnswer };
  const potential = selected(answers.potential);
  const risk = selected(answers.risk);
  const potentialProbabilities = probabilityMap(answers.potential || {});
  const riskProbabilities = probabilityMap(answers.risk || {});
  const potentialScore = scoreWithCompatibility(
    potential,
    { high_potential: 100, watch: 50, insufficient: 0 },
    { high_potential: 85, watch: 50, insufficient: 0 },
  );
  const riskScore = scoreWithCompatibility(
    risk,
    { high_risk: 100, watch: 50, normal: 20, insufficient: 0 },
    { high_risk: 85, watch: 50, normal: 20, insufficient: 0 },
  );
  return {
    potential_score: potentialScore,
    potential_confidence: potential.confidence || null,
    potential_probabilities: Object.keys(potentialProbabilities).length ? JSON.stringify(potentialProbabilities) : null,
    risk_score: riskScore,
    risk_confidence: risk.confidence || null,
    risk_probabilities: Object.keys(riskProbabilities).length ? JSON.stringify(riskProbabilities) : null,
    model: currentModel,
    version: ASSESSMENT_VERSION,
    assessed_at: nowIso(),
    criteria_summary: criteriaSummary(criteria),
  };
}

function eligibleProfiles(companyId: string, limit: number, db: SqliteConn, kolUids: string[] = []): Row[] {
  const scoped = kolUids.length
    ? ` AND kol_uid IN (${kolUids.map(() => "?").join(",")})`
    : "";
  return db.prepare(
    `SELECT *
       FROM kol_profile_index
      WHERE company_id=? AND pool_status='open'${scoped}
      ORDER BY CASE WHEN assessed_at IS NULL OR trim(assessed_at)='' THEN 0 ELSE 1 END,
               assessed_at ASC, ingested_at DESC, kol_uid
      LIMIT ?`,
  ).all(companyId, ...kolUids, limit) as Row[];
}

/** 去空、去重、限长：调用方不能借 kol_uids 绕过批量上限。 */
export const JEV_MAX_TARGETS = 12;
export function normalizeJevTargets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const uid = String(item == null ? "" : item).trim();
    if (!uid || out.includes(uid)) continue;
    out.push(uid);
    if (out.length >= JEV_MAX_TARGETS) break;
  }
  return out;
}

export type JevAssessmentResult = {
  ok: boolean;
  eligible: number;
  assessed: number;
  high_potential: number;
  high_risk: number;
  failed: number;
  /** 本次评分口径；空串表示按公开资料通用口径。 */
  criteria_summary: string;
};

/**
 * Explicit, bounded scoring run. No scheduler, no action write beyond the local assessment columns.
 * `kol_uids` 非空时只评估指定对象（单卡或已选），否则沿用未评估优先的整池批量。
 */
export async function assessPublicKolsWithJev(input: {
  limit?: number;
  companyId?: string;
  db?: SqliteConn;
  kol_uids?: string[];
  /** 员工声明的目标条件；由路由解析（显式传入优先，其次最近一次 AI 发现请求）。 */
  criteria?: KolScoringCriteria | null;
} = {}): Promise<JevAssessmentResult> {
  const db = input.db || getConn();
  const companyId = input.companyId || memoryCompanyId();
  const kolUids = normalizeJevTargets(input.kol_uids);
  const limit = kolUids.length
    ? kolUids.length
    : Math.max(1, Math.min(12, Math.floor(Number(input.limit || 12))));
  const criteria = input.criteria || null;
  const profiles = eligibleProfiles(companyId, limit, db, kolUids);
  let assessed = 0;
  let highPotential = 0;
  let highRisk = 0;
  let failed = 0;
  for (const profile of profiles) {
    try {
      const assessment = await assessPublicKolWithJev(profile, criteria);
      db.prepare(
        `UPDATE kol_profile_index
            SET potential_score=?, potential_probabilities=?, potential_confidence=?, risk_score=?, risk_probabilities=?, risk_confidence=?,
                assessment_model=?, assessment_version=?, assessed_at=?, assessment_error='',
                assessment_criteria=?, updated_at=?
          WHERE company_id=? AND kol_uid=?`,
      ).run(
        assessment.potential_score,
        assessment.potential_probabilities,
        assessment.potential_confidence,
        assessment.risk_score,
        assessment.risk_probabilities,
        assessment.risk_confidence,
        assessment.model,
        assessment.version,
        assessment.assessed_at,
        assessment.criteria_summary,
        assessment.assessed_at,
        companyId,
        String(profile.kol_uid),
      );
      assessed += 1;
      if ((assessment.potential_score || 0) >= 80) highPotential += 1;
      if ((assessment.risk_score || 0) >= 80) highRisk += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 180) : "Jev 评分失败";
      db.prepare(
        `UPDATE kol_profile_index
            SET assessment_error=?, assessed_at=?, updated_at=?
          WHERE company_id=? AND kol_uid=?`,
      ).run(message, nowIso(), nowIso(), companyId, String(profile.kol_uid));
      failed += 1;
    }
  }
  const result = {
    ok: true, eligible: profiles.length, assessed, high_potential: highPotential, high_risk: highRisk, failed,
    criteria_summary: criteriaSummary(criteria),
  };
  audit("system", "kol.memory.jev_assessment", {
    ...result, limit, model: model(), version: ASSESSMENT_VERSION,
    criteria: criteria || null,
  });
  return result;
}
