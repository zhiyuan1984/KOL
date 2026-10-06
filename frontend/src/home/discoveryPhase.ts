/**
 * AI发现的阶段机（纯函数）。中栏与右栏共用同一阶段：
 * - compose：还没有运行，条件卡可编辑；
 * - running：提交后到终态事件为止，中栏给过程流、右栏给运行状态；
 * - failure：落定的失败（含仍保留原始候选的情况），入口在失败页；
 * - success：有运行且无失败，右栏给结果。
 *
 * 条件卡不再随提交消失：提交后原位转只读，历史事件保持顺序。
 */
export type DiscoveryStage = "compose" | "running" | "success" | "failure";

export type DiscoveryStageInput = {
  /** 本地轮询中（提交成功到出现终态步为止）。 */
  polling: boolean;
  /** Host 的 run 仍在进行（queued / crawling / ranking）。 */
  runInFlight: boolean;
  /** 已落定的失败：提交失败之外，还有采集失败、简报失败、服务不可用。 */
  failure: boolean;
  /** 结果区实际可展示的候选数。 */
  visibleCount: number;
  /** 是否已经有过一次运行（哪怕 0 条入围）。 */
  hasRun: boolean;
};

export function discoveryStage(input: DiscoveryStageInput): DiscoveryStage {
  if (input.failure) return "failure";
  if (input.polling || input.runInFlight) return "running";
  if (input.hasRun || input.visibleCount > 0) return "success";
  return "compose";
}

/**
 * 条件卡的两种形态：提交前可编辑，提交后原位只读（数值保留、历史不清空）。
 * 「修改条件」把它调回编辑并让上一次参数核对失效；重新提交后再次只读。
 */
export type DiscoveryCardMode = "edit" | "readonly";

export function discoveryCardMode(input: {
  /** 已经提交过至少一次（Home 的 lastSubmit 身份）。 */
  submitted: boolean;
  /** 员工显式点了「修改条件」。 */
  editing: boolean;
}): DiscoveryCardMode {
  if (input.editing) return "edit";
  return input.submitted ? "readonly" : "edit";
}
