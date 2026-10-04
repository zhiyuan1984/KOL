import type { Json } from "../types.js";

/** Keep bounded source evidence; a legacy numeric count is not a verified subscriber fact. */
export function followerEvidence(value: unknown): Json {
  const evidence = value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
  const raw = typeof evidence.raw_text === "string" ? evidence.raw_text.slice(0, 256) : null;
  const field = ["subscriberCountText", "dom.subscriberText"].includes(String(evidence.source_field)) ? evidence.source_field : null;
  const captured = typeof evidence.captured_at === "string" && Number.isFinite(Date.parse(evidence.captured_at))
    ? new Date(evidence.captured_at).toISOString() : null;
  const parser = evidence.parser_version === "youtube-subscribers/v1" ? evidence.parser_version : null;
  return { state: evidence.state === "source_recorded" && raw?.trim() && field && captured && parser
    ? "source_recorded" : evidence.state === "unavailable" ? "unavailable" : "missing_source",
    raw_text: raw, source_field: field, captured_at: captured, parser_version: parser };
}

export function candidateAnalysisView(candidate: Json): Json {
  const evidence = followerEvidence(candidate.followers_evidence);
  return { ...candidate, reported_followers: candidate.followers ?? null,
    followers: evidence.state === "source_recorded" ? candidate.followers ?? null : null,
    followers_evidence: evidence };
}
