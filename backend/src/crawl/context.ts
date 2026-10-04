import { postgresPool } from "../postgres/pool.js";
import { authorizeConnector, type RuntimeContext } from "../runtime/execution.js";
import type { Json } from "../types.js";
import { candidateAnalysisView } from "./candidate-evidence.js";

/** Permission-checked snapshots from this conversation, bounded before model input. */
export async function discoveryResultContext(context: RuntimeContext): Promise<Json[]> {
  if (context.skillId !== "crawler_collect" || !context.sessionId) return [];
  authorizeConnector(context, "claw");
  const { rows } = await postgresPool().query(`SELECT c.remote_task_id,c.state,c.result_state,c.result_json,c.result_error
    FROM runtime_crawl_jobs c JOIN runtime_actions a ON a.id=c.id
    WHERE a.actor_id=$1 AND a.session_id=$2 AND a.context_json->>'agentId'=$3
      AND a.context_json->>'skillId'=$4 AND a.connector_id='claw'
    ORDER BY a.created_at DESC LIMIT 4`, [context.userId, context.sessionId, context.agentId, context.skillId]);
  let budget = 24000;
  const result: Json[] = [];
  for (const row of rows) {
    const snapshot = row.result_json;
    const candidates: Json[] = [];
    const all = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
    for (const candidate of all) {
      const safeCandidate = candidateAnalysisView(candidate);
      const text = JSON.stringify(safeCandidate);
      if (candidates.length >= 80 || text.length > budget) break;
      budget -= text.length; candidates.push(safeCandidate);
    }
    result.push({ task_id: row.remote_task_id, collection_state: row.state, result_state: row.result_state,
      result_error: row.result_error, captured_at: snapshot?.captured_at || null,
      result_complete: snapshot?.complete === true, candidate_count: all.length,
      included_count: candidates.length, context_truncated: candidates.length < all.length, candidates });
  }
  authorizeConnector(context, "claw");
  return result;
}
