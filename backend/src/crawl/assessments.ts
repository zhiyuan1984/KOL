import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DEFAULT_COMPANY_ID } from "../host/kol-memory.js";
import { assessPublicKolWithJev, KOL_ASSESSMENT_VERSION } from "../host/kol-jev-assessment.js";
import { normalizeScoringCriteria, type KolScoringCriteria } from "../host/kol-scoring-criteria.js";
import { pgEnqueueExecutionJob, pgExecutionJobPayload } from "../execution-jobs/postgres-store.js";
import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { authorizeConnector, runtimeHash, type RuntimeContext } from "../runtime/execution.js";
import { HttpFail } from "../host/errors.js";
import type { Json, Row } from "../types.js";

const company = DEFAULT_COMPANY_ID;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

/** Use this task's saved conditions, never the employee's latest unrelated search. */
export async function crawlScoringCriteria(actionId: string, client: Pick<PoolClient, "query"> = postgresPool()): Promise<KolScoringCriteria | null> {
  const row = (await client.query(`SELECT t.input FROM runtime_crawl_jobs c JOIN tickets t
    ON t.session_id=c.context_json->>'sessionId' AND t.owner_user_id=c.actor_id
    WHERE c.id=$1 ORDER BY t.created_at LIMIT 1`, [actionId])).rows[0];
  let input: Json = {};
  try { input = object(typeof row?.input === "string" ? JSON.parse(row.input) : row?.input); } catch { /* no declared criteria */ }
  return normalizeScoringCriteria(object(input.discovery_workspace).brief);
}

export function candidateAssessmentKey(row: Json, criteria: KolScoringCriteria | null): string {
  return runtimeHash({ version: KOL_ASSESSMENT_VERSION, profile: assessmentProfile(row), criteria });
}

/** Only verified latest-ten metrics are submitted; sampled views are never substituted. */
function assessmentProfile(row: Json): Row {
  return { platform: String(row.platform).toLowerCase(), handle: String(row.id), display_name: row.name,
    homepage_url: row.source_url, avatar_url: row.avatar_url || null, followers: row.followers,
    avg_plays: row.avg_views_10, direction: row.direction || null, region: row.region };
}

export async function enqueueCandidateAssessments(actionId: string, context: RuntimeContext, candidates: Json[],
  client: PoolClient, retry = false): Promise<void> {
  authorizeConnector(context, "claw");
  const criteria = await crawlScoringCriteria(actionId, client);
  for (const row of candidates) {
    const key = candidateAssessmentKey(row, criteria);
    const platform = String(row.platform).toLowerCase();
    const values = [company, platform, String(row.id), key];
    const inserted = await client.query(`INSERT INTO kol_candidate_assessments
      (company_id,platform,creator_id,assessment_key,source_action_id,state,evidence_json,criteria_json)
      VALUES($1,$2,$3,$4,$5,'queued',$6,$7) ON CONFLICT DO NOTHING RETURNING assessment_key`,
    [...values, actionId, JSON.stringify(row), JSON.stringify(criteria)]);
    if (!inserted.rowCount) {
      if (!retry) continue;
      const reset = await client.query(`UPDATE kol_candidate_assessments SET state='queued',error_code=NULL,
        source_action_id=$5,updated_at=now() WHERE company_id=$1 AND platform=$2 AND creator_id=$3
        AND assessment_key=$4 AND state='failed' RETURNING assessment_key`, [...values, actionId]);
      if (!reset.rowCount) continue;
    }
    await pgEnqueueExecutionJob({ job_type: "discovery.score", tenant_ref: company, actor_ref: context.userId,
      idempotency_key: `discovery-score:${company}:${platform}:${row.id}:${key}${retry ? `:${randomUUID()}` : ""}`,
      object_ref: { platform, creator_id: row.id, assessment_key: key }, risk_level: "low", max_attempts: 3,
      scope_snapshot: context, payload: { action_id: actionId, platform, creator_id: row.id, assessment_key: key } }, { client });
  }
}

export function candidateAssessmentView(record?: Row): Json {
  if (!record) return { state: "unscored" };
  const result = object(record.result_json);
  return { state: record.state === "queued" || record.state === "scoring" ? "scoring" : record.state,
    execution_state: record.state,
    potential_score: result.potential_score ?? null, risk_score: result.risk_score ?? null,
    potential_confidence: result.potential_confidence ?? null, risk_confidence: result.risk_confidence ?? null,
    potential_probabilities: result.potential_probabilities ?? null, risk_probabilities: result.risk_probabilities ?? null,
    version: result.version || KOL_ASSESSMENT_VERSION, assessed_at: result.assessed_at || null,
    criteria_summary: result.criteria_summary || "", source_url: object(record.evidence_json).source_url || null,
    error: record.state === "failed" ? "评分服务未能完成，请重试评分；候选资料仍保留。" : null };
}

export async function scoreDiscoveryCandidate(job: ClaimedExecutionJob, checkpoint: () => Promise<void>,
  assessor = assessPublicKolWithJev): Promise<Json> {
  const payload = pgExecutionJobPayload(job);
  const values = [company, payload.platform, String(payload.creator_id), payload.assessment_key];
  try {
    await checkpoint();
    const crawl = (await postgresPool().query("SELECT context_json,actor_id FROM runtime_crawl_jobs WHERE id=$1", [payload.action_id])).rows[0];
    if (!crawl || crawl.actor_id !== job.actor_ref) throw new HttpFail(403, { code: "candidate_scope_denied" });
    authorizeConnector(crawl.context_json, "claw");
    const record = (await postgresPool().query(`SELECT * FROM kol_candidate_assessments
      WHERE company_id=$1 AND platform=$2 AND creator_id=$3 AND assessment_key=$4`, values)).rows[0];
    if (!record || record.state === "scored") return { state: record ? "scored" : "missing", reused: true };
    // Reuse the same ownership filter as UI/model results before sending evidence.
    const { runtimeCandidateViews } = await import("./candidate-actions.js");
    if (!(await runtimeCandidateViews(crawl.context_json, String(payload.action_id), [record.evidence_json])).length) {
      throw new HttpFail(403, { code: "candidate_scope_denied" });
    }
    await postgresPool().query(`UPDATE kol_candidate_assessments SET state='scoring',updated_at=now()
      WHERE company_id=$1 AND platform=$2 AND creator_id=$3 AND assessment_key=$4`, values);
    const result = await assessor(assessmentProfile(record.evidence_json), record.criteria_json);
    await checkpoint();
    authorizeConnector(crawl.context_json, "claw");
    await postgresPool().query(`UPDATE kol_candidate_assessments SET state='scored',result_json=$5,error_code=NULL,updated_at=now()
      WHERE company_id=$1 AND platform=$2 AND creator_id=$3 AND assessment_key=$4`, [...values, JSON.stringify(result)]);
    return { state: "scored", creator_id: payload.creator_id, assessed_at: result.assessed_at };
  } catch (error) {
    await postgresPool().query(`UPDATE kol_candidate_assessments SET state=$5,error_code='assessment_failed',updated_at=now()
      WHERE company_id=$1 AND platform=$2 AND creator_id=$3 AND assessment_key=$4 AND state<>'scored'`,
    [...values, Number(job.attempts) < Number(job.max_attempts) ? "queued" : "failed"]);
    throw new Error("Candidate assessment failed; public evidence and retry state are retained.");
  }
}

export async function retryCandidateAssessment(actionId: string, context: RuntimeContext, row: Json): Promise<void> {
  await postgresTransaction(client => enqueueCandidateAssessments(actionId, context, [row], client, true));
}
registerExecutionHandler("discovery.score", scoreDiscoveryCandidate);
