/**
 * AI发现的阶段机（纯函数）。中栏与右栏共用同一阶段：
 * - compose：还没有运行，中栏给条件卡；
 * - running：提交后到终态事件为止，中栏给过程流、右栏给运行状态；
 * - failure：落定的失败（含仍保留原始候选的情况），入口在失败页；
 * - success：有运行且无失败，右栏给结果。
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
 * 条件卡只属于「还没有运行」和一个显式的「改条件再搜」。
 * 提交后卡片消失是有意的：过程流是那之后中栏唯一的主角。
 */
export function isCardVisible(stage: DiscoveryStage, cardPinned: boolean): boolean {
  return cardPinned || stage === "compose";
}
