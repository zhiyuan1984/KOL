import type { DiscoveryStartPhase } from "./discoveryStart";
import type { DiscoveryErrorView } from "./discovery-error";
import type { ResultStatus } from "./workspace/result-contract";

export type DiscoveryTaskStatus = {
  key: Exclude<ResultStatus, "ready" | "awaiting_confirm" | "stale"> | "waiting";
  glyph: string; label: string; detail: string; live: boolean;
};

/** A successful start receipt only proves submission. Completion is a remote
 * crawl terminal fact or the saved run's success, never a local click. */
export function discoveryTaskStatus({ failure, startPhase, crawlPhase, submitted, stage }: {
  failure: DiscoveryErrorView | null; startPhase: DiscoveryStartPhase; crawlPhase: string | null; submitted: boolean; stage: string;
}): DiscoveryTaskStatus {
  if (failure || startPhase === "failed" || crawlPhase === "failed") return { key: "failed", glyph: "⚠", label: "失败", detail: "保留已取得的结果；可核对原因后重试。", live: false };
  if (startPhase === "uncertain" || crawlPhase === "uncertain") return { key: "uncertain", glyph: "⚠", label: "结果待核实", detail: "不重复提交；先核对任务状态。", live: false };
  if (startPhase === "pending") return { key: "waiting", glyph: "⚠", label: "待确认", detail: "确认前不会发起采集。", live: false };
  if (crawlPhase === "running" || startPhase === "running") return { key: "running", glyph: "▶", label: "采集中", detail: "候选到达后原位更新，不打断阅读。", live: true };
  if (["cancelled", "rejected"].includes(startPhase) || crawlPhase === "cancelled") return { key: "stopped", glyph: "■", label: "已停止", detail: "只保留已取得的候选。", live: false };
  if (crawlPhase === "partial") return { key: "partial", glyph: "⚠", label: "部分完成", detail: "保留已取得的候选；请核对未完成的范围。", live: false };
  if (crawlPhase === "succeeded" || (!crawlPhase && stage === "success")) return { key: "completed", glyph: "✓", label: "已完成", detail: "候选与来源在结果栏；入库是独立动作。", live: false };
  if (["dispatching", "starting", "succeeded"].includes(startPhase) || crawlPhase === "queued" || crawlPhase === "starting") return { key: "preparing", glyph: "▶", label: "启动中", detail: "请求已提交，正在等待采集状态。", live: true };
  if (stage === "running" || submitted) return { key: "preparing", glyph: "·", label: "准备中", detail: "正在整理本次采集范围。", live: true };
  return { key: "idle", glyph: "·", label: "未开始", detail: "提交条件后，结果会保存在这里。", live: false };
}
