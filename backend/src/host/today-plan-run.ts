import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import {
  executeNativeClaimedPlanningJob,
  failStaleNativePlans,
  nativeTodayBriefSnapshot,
  nativeTodayPlanContext,
  recoverNativeTaskRuns,
  startNativeTodayPlan,
} from "../postgres/today-plan-repository.js";
import type { Json } from "../types.js";
import {
  planTaskType,
  planningHarnessMount,
  planningRunInput,
  planningRuntimeIdentity,
  type PlanScope,
  type TodayPlanPack,
} from "./today-plan-context.js";

export const PLAN_EMPLOYEE_EVENTS = {
  today: {
    memoryRead: "已读取当前任务记忆",
    deltaPacked: "已打包来源增量",
    codexSubmitted: "已提交 Codex 规划",
    writingBrief: "正在生成今日简报",
    completed: "今日规划已完成",
    failed: "今日规划失败",
    invalid: "今日规划未通过校验",
  },
  todo: {
    memoryRead: "已读取待办任务记忆",
    deltaPacked: "已打包待办增量",
    codexSubmitted: "已提交 Codex 待办规划",
    writingBrief: "正在生成待办简报",
    completed: "待办规划已完成",
    failed: "待办规划失败",
    invalid: "待办规划未通过校验",
  },
} as const;

export const TODAY_PLAN_EMPLOYEE_EVENTS = PLAN_EMPLOYEE_EVENTS.today;

/** Extract only a structured model response; no host-side plan substitute is allowed. */
export function briefFromWorkerItems(items: Json[]): Json | null {
  const candidates = items.filter((item) => item && typeof item === "object" && !Array.isArray(item)
    && (item.type === "today_brief" || (item.lead != null && item.sections != null)));
  if (!candidates.length) return null;
  const preferred = [...candidates].reverse().find((item) => Array.isArray(item.display_tasks)) || candidates[candidates.length - 1];
  const { type: _type, narrative: _narrative, ...brief } = preferred;
  return brief as Json;
}

/** A planner must account for every authorized open formal task. */
export function missingDisplayCoverage(brief: Json | null, pack: TodayPlanPack): string[] {
  if (!brief || !Array.isArray(brief.display_tasks)) {
    return pack.history.unfinished_tasks.map((item) => String(item.work_item_id || item.id || "")).filter(Boolean);
  }
  const displayed = new Set(brief.display_tasks.map((item) => item && typeof item === "object"
    ? String((item as Json).work_item_id || "") : "").filter(Boolean));
  return pack.history.unfinished_tasks.map((item) => String(item.work_item_id || item.id || ""))
    .filter((id) => id && !displayed.has(id));
}

export async function startTodayPlan(
  owner: string,
  scope: PlanScope = "today",
  producer: "deterministic_organize" | "agent_plan" = "agent_plan",
) {
  const canonicalScope: PlanScope = "today";
  const pack = await nativeTodayPlanContext(owner, canonicalScope);
  return startNativeTodayPlan({
    owner,
    taskType: "today_plan",
    title: "统一工作计划",
    scope: canonicalScope,
    producer,
    payload: planningRunInput(pack, {}, canonicalScope),
    extraPayload: { producer },
    queuedLabel: "工作计划已入队",
    progress: [
      { label: PLAN_EMPLOYEE_EVENTS[scope].memoryRead, summary: `未了结 ${pack.now_counts.unfinished} 项` },
      { label: PLAN_EMPLOYEE_EVENTS[scope].deltaPacked, summary: `来源增量 ${pack.delta.added.length} 项` },
    ],
  });
}

export async function startTodayAnalyze(body: Json, owner: string) {
  const identity = planningRuntimeIdentity("today_analyze");
  const objects = Array.isArray(body.objects) ? body.objects : Array.isArray(body.object_ids) ? body.object_ids : [];
  const payload: Json = {
    mode: "today_analyze",
    agent_id: identity.agent_id,
    expert_id: identity.session_identity,
    skip_user_memory: true,
    objects,
    planning_harness: planningHarnessMount("today_analyze"),
  };
  return startNativeTodayPlan({
    owner,
    taskType: "today_analyze",
    title: "今日对象分析",
    scope: "today",
    producer: "agent_plan",
    payload,
    extraPayload: { prompt: String(body.text || "分析所选对象并建议下一步，不要改状态。") },
    queuedLabel: "对象分析已入队",
  });
}

/** Compatibility export backed exclusively by the native PostgreSQL executor. */
export async function executeClaimedPlanningJob(claimed: ClaimedExecutionJob): Promise<string> {
  const receipt = await executeNativeClaimedPlanningJob(claimed);
  return String(receipt.work_item_id || claimed.ticket_id || "");
}

export async function todayBriefSnapshot(owner: string, scope: PlanScope = "today"): Promise<Json> {
  return nativeTodayBriefSnapshot(owner, scope);
}

export { failStaleNativePlans as failStuckPlans, recoverNativeTaskRuns };
export { planTaskType };
