import type { Json, Row } from "../types.js";

function numericOrNull(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Public projection shared by reads and command receipts; never exposes internal assessment errors. */
export function publicProfileFields(row: Row | Json): Json {
  const score = numericOrNull(row.potential_score);
  const assessmentState = score != null ? "scored" : String(row.assessment_error || "").trim() ? "failed"
    : String(row.assessed_at || "").trim() ? "low_confidence" : "unscored";
  return {
    id: row.id,
    company_id: row.company_id,
    kol_uid: row.kol_uid,
    handle: row.handle || "",
    display_name: row.display_name || row.handle || "",
    platform: row.platform || "",
    homepage_url: row.homepage_url || "",
    avatar_url: row.avatar_url || "",
    followers: row.followers || "",
    avg_plays: row.avg_plays || "",
    engagement: row.engagement || "",
    engagement_source: row.engagement_source || "",
    direction: row.direction || "",
    region: row.region || "",
    style: row.style || "",
    ingest_source: row.ingest_source || "",
    ingested_at: row.ingested_at || null,
    idle: Boolean(Number(row.idle || 0)),
    public_stage: row.public_stage || "",
    pool_status: row.pool_status || "open",
    source_batch: row.source_batch || "",
    platform_creator_id: row.platform_creator_id || "",
    potential_score: score,
    potential_probabilities: row.potential_probabilities || null,
    potential_confidence: numericOrNull(row.potential_confidence),
    risk_score: numericOrNull(row.risk_score),
    risk_probabilities: row.risk_probabilities || null,
    risk_confidence: numericOrNull(row.risk_confidence),
    assessment_model: row.assessment_model || "",
    assessment_version: row.assessment_version || "",
    assessed_at: row.assessed_at || null,
    assessment_state: assessmentState,
    assessment_criteria: row.assessment_criteria || "",
  };
}
