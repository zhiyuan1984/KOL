import type { Json } from "../types.js";

/** A completed model turn is not a business receipt. Only persisted output and
 * controlled-action facts can settle the task; the browser never accepts it. */
export function taskRunOutcome(input: {
  failed: boolean;
  needsInput: boolean;
  workerStatus?: string;
  artifactKinds: string[];
  actionStates?: string[];
}): { status: string; reason: string | null } {
  if (input.needsInput) return { status: "needs_clarification", reason: "needs_context" };
  if (input.failed || Boolean(input.workerStatus && !["done", "completed"].includes(input.workerStatus))) {
    return { status: "failed", reason: "execution_failed" };
  }
  const states = input.actionStates || [];
  if (states.includes("uncertain")) return { status: "uncertain", reason: "receipt_unknown" };
  if (states.some(state => ["failed", "rejected"].includes(state))) return { status: "failed", reason: "action_failed" };
  if (states.includes("cancelled")) return { status: "cancelled", reason: "action_cancelled" };
  if (states.some(state => ["queued", "running", "starting", "dispatching", "stopping", "retrying"].includes(state))) {
    return { status: "running", reason: null };
  }
  if (states.includes("pending")) return { status: "waiting_approval", reason: null };
  if (states.some(state => !["succeeded", "completed", "done"].includes(state))) return { status: "uncertain", reason: "receipt_unknown" };
  if (!input.artifactKinds.some(kind => kind !== "error_card")) return { status: "failed", reason: "required_output_missing" };
  return { status: "completed", reason: null };
}

export function outcomeError(code: string | null): Json | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    execution_failed: "执行失败", required_output_missing: "执行未返回必要成果，任务未完成",
    action_failed: "业务操作失败", receipt_unknown: "业务回执尚不能确认", action_cancelled: "业务操作已取消",
    needs_context: "还需要补充信息",
  };
  return { code, message: messages[code] || code };
}
