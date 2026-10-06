import { budgetBlockFor, BudgetBlocked, recordCostEvent } from "../costs.js";
import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";
import type { QaLunaResult } from "./qa-luna.js";

/** Admin preview has no Agent identity; company/user budgets still apply. */
export function assertQaBudget(actor: string): void {
  const reason = budgetBlockFor("", actor);
  if (reason) throw new HttpFail(429, new BudgetBlocked(reason).asDict());
}
export function captureQaUsage(actor: string, source: "knowledge_rewrite" | "knowledge_qa_context", requestId: string, call?: QaLunaResult): void {
  if (!call) return;
  if (!call.usage || call.usage.total_tokens === null) {
    // recordCostEvent sums null fields as zero; never pass incomplete usage as a measured total.
    audit(actor, "knowledge.qa_usage_unavailable", { source, request_id: requestId, model: call.model, usage: call.usage });
    return;
  }
  recordCostEvent({
    source, userId: actor, model: call.model, inputTokens: call.usage.input_tokens,
    outputTokens: call.usage.output_tokens, totalTokens: call.usage.total_tokens,
    raw: JSON.stringify({ request_id: requestId, usage: call.usage }),
  });
}
