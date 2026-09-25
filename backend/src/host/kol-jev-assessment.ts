import { TypeSafeClient } from "@typesafe-ai/sdk";
import { audit, getConn, nowIso, type SqliteConn } from "../db.js";
import type { Row } from "../types.js";
import { memoryCompanyId } from "./kol-memory.js";

const JEV_OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const ASSESSMENT_VERSION = "jev-kol-v1";
const MIN_CONFIDENCE = 0.7;

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

type AssessmentAnswer = { choice?: string; confidence?: number };

function scoreFor(choice: string, highChoice: string, mediumChoice: string): number | null {
  if (choice === highChoice) return 85;
  if (choice === mediumChoice) return 50;
  return null;
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
  risk_score: number | null;
  risk_confidence: number | null;
  model: string;
  version: string;
  assessed_at: string;
};

/**
 * Score only the suitability/risk signal encoded in already-public KOL index
 * fields. It does not retrieve contact data, produce outreach copy, or make a
 * business decision. Low-confidence and insufficient results stay unscored.
 */
export async function assessPublicKolWithJev(row: Row): Promise<KolAssessment> {
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
    state: { public_profile: profileState(row) },
    questions: {
      potential: {
        type: "choice",
        instructions: "只根据 `public_profile` 的公开字段评估合作潜力；缺少关键公开指标时选 insufficient。不得推断私密联系方式、报价、合同或未提供的互动表现。",
        criteria: {
          high_potential: "公开指标与内容方向充分，显示出可验证的受众规模或内容匹配信号，值得优先人工复核。",
          watch: "存在部分正向信号，但公开指标、内容匹配或时效不足以列为高潜。",
          insufficient: "公开资料不足，不能可靠判断合作潜力。",
        },
      },
      risk: {
        type: "choice",
        instructions: "只根据 `public_profile` 的公开字段评估信息与匹配风险；风险是人工复核优先级，不是拒绝或删除依据。缺资料时选 insufficient。",
        criteria: {
          high_risk: "公开资料存在显著缺口或明显不匹配信号，需要人工优先核验。",
          watch: "有待核验点，但没有足够公开证据定为高风险。",
          normal: "公开资料未显示明显风险，仍需人工判断。",
          insufficient: "公开资料不足，不能可靠判断风险。",
        },
      },
    },
  });
  const answers = response.answers as { potential?: AssessmentAnswer; risk?: AssessmentAnswer };
  const potential = selected(answers.potential);
  const risk = selected(answers.risk);
  const potentialScore = potential.confidence >= MIN_CONFIDENCE
    ? scoreFor(potential.choice, "high_potential", "watch")
    : null;
  const riskScore = risk.confidence >= MIN_CONFIDENCE
    ? scoreFor(risk.choice, "high_risk", "watch")
    : risk.choice === "normal" && risk.confidence >= MIN_CONFIDENCE ? 20 : null;
  return {
    potential_score: potentialScore,
    potential_confidence: potential.confidence || null,
    risk_score: riskScore,
    risk_confidence: risk.confidence || null,
    model: currentModel,
    version: ASSESSMENT_VERSION,
    assessed_at: nowIso(),
  };
}

function eligibleProfiles(companyId: string, limit: number, db: SqliteConn): Row[] {
  return db.prepare(
    `SELECT *
       FROM kol_profile_index
      WHERE company_id=? AND pool_status='open'
      ORDER BY CASE WHEN assessed_at IS NULL OR trim(assessed_at)='' THEN 0 ELSE 1 END,
               assessed_at ASC, ingested_at DESC, kol_uid
      LIMIT ?`,
  ).all(companyId, limit) as Row[];
}

export type JevAssessmentResult = {
  ok: boolean;
  eligible: number;
  assessed: number;
  high_potential: number;
  high_risk: number;
  failed: number;
};

/** Explicit, bounded scoring run. No scheduler, no action write beyond the local assessment columns. */
export async function assessPublicKolsWithJev(input: {
  limit?: number;
  companyId?: string;
  db?: SqliteConn;
} = {}): Promise<JevAssessmentResult> {
  const db = input.db || getConn();
  const companyId = input.companyId || memoryCompanyId();
  const limit = Math.max(1, Math.min(12, Math.floor(Number(input.limit || 12))));
  const profiles = eligibleProfiles(companyId, limit, db);
  let assessed = 0;
  let highPotential = 0;
  let highRisk = 0;
  let failed = 0;
  for (const profile of profiles) {
    try {
      const assessment = await assessPublicKolWithJev(profile);
      db.prepare(
        `UPDATE kol_profile_index
            SET potential_score=?, potential_confidence=?, risk_score=?, risk_confidence=?,
                assessment_model=?, assessment_version=?, assessed_at=?, assessment_error='', updated_at=?
          WHERE company_id=? AND kol_uid=?`,
      ).run(
        assessment.potential_score,
        assessment.potential_confidence,
        assessment.risk_score,
        assessment.risk_confidence,
        assessment.model,
        assessment.version,
        assessment.assessed_at,
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
  const result = { ok: true, eligible: profiles.length, assessed, high_potential: highPotential, high_risk: highRisk, failed };
  audit("system", "kol.memory.jev_assessment", { ...result, limit, model: model(), version: ASSESSMENT_VERSION });
  return result;
}
