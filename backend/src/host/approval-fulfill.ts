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
  if (kind === "skill_publish") {
    // 技能发布审批：终审通过本身即是放行凭证，无额外副作用；
    // 发布门禁读取该审批记录（consumed + base_version）做放行判断。
    return { skill_publish: true, sent: false, stage_changed: false };
  }
  throw new Error(`unknown approval kind ${kind}`);
}
