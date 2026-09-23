import { HttpFail } from "./errors.js";

export type TaskRecommendationCandidate = {
  recommendation_id?: string;
  work_item_id?: string;
  title: string;
  reason?: string;
  intent?: string;
  handle?: string;
  collaboration_id?: string | null;
  prompt?: string;
  status: "candidate";
};

function boundedText(value: unknown, field: string, max: number, required = false): string | undefined {
  if (value == null && !required) return undefined;
  const text = String(value || "").trim();
  if ((!text && required) || text.length > max) throw new HttpFail(400, `${field} must be ${required ? "1-" : "at most "}${max} characters`);
  return text || undefined;
}

/** Validates the user-selected candidate command before the Host adopts it. */
export function parseTaskRecommendationCandidate(value: unknown): TaskRecommendationCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpFail(400, "recommendation object required");
  const row = value as Record<string, unknown>;
  const recommendationId = boundedText(row.recommendation_id || row.id, "recommendation_id", 200);
  const workItemId = boundedText(row.work_item_id, "work_item_id", 200);
  if (!recommendationId && !workItemId) throw new HttpFail(400, "recommendation_id or work_item_id required");
  if (row.status != null && row.status !== "candidate") throw new HttpFail(409, "only candidate recommendations can be adopted");
  const collaborationId = boundedText(row.collaboration_id, "collaboration_id", 200);
  const title = boundedText(row.title, "title", 200, true)!;
  const reason = boundedText(row.reason, "reason", 4000);
  const intent = boundedText(row.intent || row.task_type, "intent", 100);
  const handle = boundedText(row.handle, "handle", 200);
  const prompt = boundedText(row.prompt, "prompt", 4000);
  return {
    ...(recommendationId ? { recommendation_id: recommendationId } : {}),
    ...(workItemId ? { work_item_id: workItemId } : {}),
    title,
    ...(reason ? { reason } : {}),
    ...(intent ? { intent } : {}),
    ...(handle ? { handle } : {}),
    ...(collaborationId ? { collaboration_id: collaborationId } : {}),
    ...(prompt ? { prompt } : {}),
    status: "candidate",
  };
}
