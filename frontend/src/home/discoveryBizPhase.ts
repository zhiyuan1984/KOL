import type { DiscoveryProcessKind, DiscoveryProcessStep } from "./discoveryEvents";

/**
 * 业务四段（对外呈现的采集进度），替代智能体内部阶段。
 *
 * 内部阶段（任务开始处理/加载任务规则/正在分析/整理结果/读取业务数据/
 * 校验输出…）是智能体自己的流水账，业务方不关心，收到"详情"折叠里。
 * 这里只回答业务三问中的"找到多少了"：①理解需求 → ②搜索中 →
 * ③去重打分 → ④完成。
 */
export type BizPhaseId = "understand" | "searching" | "scoring" | "done";

export const BIZ_PHASES: Array<{ id: BizPhaseId; label: string }> = [
  { id: "understand", label: "理解需求" },
  { id: "searching", label: "搜索中" },
  { id: "scoring", label: "去重打分" },
  { id: "done", label: "完成" },
];

/** 能证明远端正在采的步骤（与 DiscoveryRunEvents 的 COLLECTION_KINDS 对齐的子集）。 */
const SEARCH_KINDS: ReadonlySet<DiscoveryProcessKind> = new Set(["queued", "search", "collecting", "received", "collect_done"]);
/** 去重打分段的步骤。 */
const SCORE_KINDS: ReadonlySet<DiscoveryProcessKind> = new Set(["deduped", "analyzing", "scoring", "briefing"]);
/** 远端作业仍在推进的状态（runtime_crawl_jobs.state）。 */
const CRAWL_ACTIVE_STATES = new Set(
  ["queued", "starting", "running", "stopping", "crawling", "uploading", "analyzing"],
);

/**
 * 当前走到第几段（0-based）。步骤是累积的，按"最晚到达的一段"判定：
 * 完成 > 去重打分 > 搜索中 > 理解需求。失败/停止不停留在此，由调用方
 * 按原有 tone（danger）处理。
 */
export function discoveryBizPhaseIndex(input: {
  steps: DiscoveryProcessStep[];
  crawlState: string | null;
  stage: string;
}): number {
  const kinds = new Set(input.steps.map((step) => step.kind));
  const crawl = String(input.crawlState || "").toLowerCase();
  if (kinds.has("ranked") || crawl === "succeeded" || input.stage === "success") return 3;
  if ([...SCORE_KINDS].some((kind) => kinds.has(kind))) return 2;
  if ([...SEARCH_KINDS].some((kind) => kinds.has(kind)) || CRAWL_ACTIVE_STATES.has(crawl)) return 1;
  return 0;
}
