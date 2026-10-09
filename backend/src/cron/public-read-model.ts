import type { TicketPrincipal } from "../ticket-domain/auth.js";
import type { Json, Row } from "../types.js";
import { canMutateJob, canSeeJob } from "./authz.js";
import { handlerContract, isCronHandlerKey } from "./handlers.js";

export type ExecutionCapability = {
  ready: boolean;
  reason?: string;
  code?: string;
};

export type AllowedCronActions = {
  edit: boolean;
  pause: boolean;
  resume: boolean;
  publish: boolean;
  run_now: boolean;
  run_reason?: string;
};

function jsonObject(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

/** The handler contract, rather than UI state or a caller-supplied role, is the
 * authority for whether a handler is currently executable. */
export function cronExecutionCapability(job: Row): ExecutionCapability {
  const handlerKey = String(job.handler_key || "");
  if (!isCronHandlerKey(handlerKey)) {
    return {
      ready: false,
      code: "unknown_handler",
      reason: "处理器未登记，暂不可执行。",
    };
  }
  const migrationState = handlerContract(handlerKey).migration_state;
  if (typeof migrationState === "string" && migrationState !== "ready" && migrationState !== "migrated") {
    return {
      ready: false,
      code: migrationState,
      reason: "处理器依赖尚未完成 PostgreSQL 原生迁移，已隔离，暂不可执行。",
    };
  }
  return { ready: true };
}

function lastResultLabel(job: Row): string {
  const terminal = String(job.last_terminal_status || "");
  if (!terminal) {
    const active = String(job.active_run_status || "");
    if (active === "queued") return "排队中";
    if (active === "running") return "执行中";
    return "暂无运行结果";
  }

  if (terminal === "succeeded") {
    const handlerKey = String(job.handler_key || "");
    if (handlerKey === "discovery-search") {
      const receipt = jsonObject(job.last_result_receipt_json);
      // Discovery only says “queued” when the persisted handler receipt contains
      // the queue's actual crawl job reference; historical successes without it
      // must not be upgraded into a queue claim by handler name alone.
      return String(receipt.crawl_job_id || "").trim()
        ? "已入队"
        : "待核对回执";
    }
    if (handlerKey === "ai-task") return "已提交";
    return "已完成";
  }
  if (terminal === "skipped") return "已跳过";
  if (terminal === "needs_takeover") return "待接管";
  if (terminal === "failed") return "失败";
  return "运行结果未知";
}

/**
 * Read-only additions for the employee scheduling UI. This does not call any
 * mutation assertion: write routes retain their own authoritative checks.
 */
export function cronPublicReadFields(job: Row, actor: TicketPrincipal): Json {
  const status = String(job.status || "");
  const condition = jsonObject(job.condition_json);
  const conditionEnabled = condition.enabled !== false;
  const capability = cronExecutionCapability(job);
  const canMutate = canMutateJob(job, actor);
  const active = String(job.active_run_status || "");

  const actions: AllowedCronActions = {
    edit: canMutate,
    pause: canMutate && status === "published",
    resume: canMutate && status === "paused",
    publish: canMutate && (status === "draft" || status === "disabled"),
    run_now: false,
  };

  let runReason: string | undefined;
  if (!canSeeJob(job, actor)) runReason = "无权查看或运行该作业。";
  else if (status !== "published") runReason = "仅已发布作业支持立即运行。";
  else if (!conditionEnabled) runReason = "作业条件已停用。";
  else if (active === "queued" || active === "running") runReason = "已有运行正在排队或执行。";
  else if (!capability.ready) runReason = capability.reason || "处理器暂不可执行。";
  else actions.run_now = true;

  if (runReason) actions.run_reason = runReason;

  return {
    // Preserve status as the source of lifecycle truth, while applying the same
    // condition.enabled rule to summary and detail projections.
    enabled: status !== "disabled" && conditionEnabled,
    execution_capability: capability,
    allowed_actions: actions,
    last_result_label: lastResultLabel(job),
  };
}
