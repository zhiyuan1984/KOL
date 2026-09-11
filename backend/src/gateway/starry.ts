/**
 * Gateway：Starry 写动作（confirm-stage）。
 * Dify「HTTP 外部动作」里改正式阶段只走这里。Host 做 PEP 后再调。
 * Worker / Skill / MCP 禁止调这个函数。
 */
import { starry } from "../adapters/clients.js";
import { audit } from "../db.js";
import type { Json, StageTransitionInput } from "../types.js";

export function confirmStarryStage(
  lifecycleId: string,
  stageCode: string,
  actor = "host",
  transition?: StageTransitionInput,
): Json {
  const result = starry.confirmStage(lifecycleId, stageCode, actor, transition);
  audit("gateway", "gateway.confirm_stage", {
    lifecycle_id: lifecycleId,
    stage_code: stageCode,
    actor,
    transition_id: result.transition_id,
  });
  return result;
}
