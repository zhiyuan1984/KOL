import type { Json, Row } from "../types.js";

/** Final side effect after the last approval node agrees. */
export async function fulfillExpenseApproval(ap: Row): Promise<Json> {
  const kind = String(ap.kind || "");
  if (kind === "expense") {
    return { expense: true, sent: false, stage_changed: false };
  }
  if (kind === "stage" || kind === "content" || kind === "settlement") {
    const { applyConfirmedStageFromApproval } = await import("./api.js");
    const written = await applyConfirmedStageFromApproval(ap.payload as Json, String(ap.id));
    return { ...written, sent: false, stage_changed: !written.waiting_approval };
  }
  throw new Error(`unknown approval kind ${kind}`);
}
