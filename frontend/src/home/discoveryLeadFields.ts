import type { HomeDiscoveryCandidate, HomeDiscoveryRun } from "./discoveryHome";

export const MISSING_TEXT = "无";

export type DiscoveryRunStatusRow = { key: string; label: string; value: string };

const RUN_STATUS_LABELS: Record<string, string> = {
  completed: "已完成",
  cancelled: "已取消",
  crawl_failed: "采集未完成",
  rank_failed: "筛选未完成",
  failed: "未完成",
  queued: "排队中",
  starting: "启动中",
  crawling: "采集中",
  ranking: "筛选中",
  running: "进行中",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO 时间 → `YYYY-MM-DD HH:mm`（本地时区，到分钟）；缺失或不可解析一律「无」。 */
export function minuteStamp(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return MISSING_TEXT;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return MISSING_TEXT;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 耗时 = completed_at − started_at，到「X 分 Y 秒」；缺任一端或倒序为「无」。 */
export function elapsedLabel(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): string {
  const from = Date.parse(String(startedAt ?? ""));
  const to = Date.parse(String(completedAt ?? ""));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return MISSING_TEXT;
  const seconds = Math.round((to - from) / 1000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function countLabel(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? MISSING_TEXT : String(value);
}

/**
 * 状态卡四行：完成时间 / 耗时 / 原始数量 / 入围数量。
 * 缺失一律「无」——0 与空都不能冒充缺数据。
 */
export function discoveryRunStatusRows(
  run: HomeDiscoveryRun | null | undefined,
): DiscoveryRunStatusRow[] {
  return [
    { key: "completed", label: "完成时间", value: minuteStamp(run?.completed_at) },
    { key: "elapsed", label: "耗时", value: elapsedLabel(run?.started_at, run?.completed_at) },
    { key: "raw", label: "原始数量", value: countLabel(run?.raw_count) },
    { key: "shortlist", label: "入围数量", value: countLabel(run?.shortlist_count) },
  ];
}

export function discoveryRunStatusLabel(run: HomeDiscoveryRun | null | undefined): string {
  const status = String(run?.status || "").toLowerCase();
  return RUN_STATUS_LABELS[status] || status || MISSING_TEXT;
}

/** 成功态（绿点 + 绿字 + 状态文案）只在跑完时点亮，其余状态保持中性。 */
export function discoveryRunStatusOk(run: HomeDiscoveryRun | null | undefined): boolean {
  return String(run?.status || "").toLowerCase() === "completed";
}

/** 有效播放样本：`recent_views` 里的正数（缺失、0、非数字都不算样本）。 */
function playSamples(candidate: HomeDiscoveryCandidate | null | undefined): number[] {
  return (candidate?.recentViews || []).filter((value) => Number.isFinite(value) && value > 0);
}

/**
 * 「近10均播」：优先用 `recent_views` 的有效样本求平均（spec §字段规则），
 * 没有样本时才回退 Host 已算好的 `avg_plays_10`；都没有 → null（行上显示「无」）。
 */
export function playsValue(candidate: HomeDiscoveryCandidate | null | undefined): number | null {
  const samples = playSamples(candidate);
  if (samples.length) {
    return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  }
  const fallback = candidate?.avg_plays_10;
  return fallback == null || !Number.isFinite(fallback) || fallback <= 0 ? null : fallback;
}

/** 样本不足 10 条时把「N/10 条样本」写在均播旁边；足量时不占位。 */
export function sampleNote(
  candidate: HomeDiscoveryCandidate | null | undefined,
  expected = 10,
): string | null {
  const samples = playSamples(candidate);
  if (!samples.length || samples.length >= expected) return null;
  return `${samples.length}/${expected} 条样本`;
}

/**
 * 播放/粉丝比：Host 的 `view_follower_ratio` 是「播放 ÷ 粉丝」的倍数（真实数据 10.96 → 1096%）。
 * 缺失为「无」，不用 0 冒充。
 */
export function viewFollowerPercent(candidate: HomeDiscoveryCandidate | null | undefined): string {
  const ratio = candidate?.viewFollowerRatio;
  if (ratio == null || !Number.isFinite(ratio)) return MISSING_TEXT;
  const percent = ratio * 100;
  return `${percent >= 10 ? Math.round(percent) : Number(percent.toFixed(1))}%`;
}

/**
 * 置信度来自样本覆盖率（0–1）。0 是「没有样本」这个真实测量值，不是缺数据，
 * 因此 0 显示「低」而不是「无」；只有 null 才是「无」。
 */
export function confidenceLabel(candidate: HomeDiscoveryCandidate | null | undefined): string {
  const value = candidate?.confidence;
  if (value == null || !Number.isFinite(value)) return MISSING_TEXT;
  if (value >= 0.8) return "高";
  if (value >= 0.5) return "中";
  return "低";
}

/** 匹配理由必须是可复核信号；没有就说明没有，不编造。 */
export const MATCH_REASON_MISSING = "暂无足够内容证据";

export function matchReasonText(candidate: HomeDiscoveryCandidate | null | undefined): string {
  const text = String(candidate?.matchReason || "").trim();
  return text || MATCH_REASON_MISSING;
}

export function collectedAtMinute(candidate: HomeDiscoveryCandidate | null | undefined): string {
  return minuteStamp(candidate?.collectedAt);
}

export type DiscoverySourceState = { href: string } | { missing: true };

/** 「看来源」只在真有 URL 时可点；没有就按 spec 显示「来源链接缺失」。 */
export function sourceState(candidate: HomeDiscoveryCandidate | null | undefined): DiscoverySourceState {
  const href = String(candidate?.profileUrl || "").trim();
  return href ? { href } : { missing: true };
}

export const SOURCE_MISSING_LABEL = "来源链接缺失";

/** 在库状态三态文案。`pool` 已包含「在库但不在公海」——这是有意的折叠。 */
const LIBRARY_LABELS: Record<string, string> = {
  not_in_library: "未入库",
  pool: "已在库（含公海）",
  followed: "已关注",
};

export function libraryLabel(candidate: HomeDiscoveryCandidate | null | undefined): string {
  return LIBRARY_LABELS[String(candidate?.libraryStatus || "")] || LIBRARY_LABELS.not_in_library;
}

/** 推荐分构成：把 Host 给的分项摆出来，让总分可复核（spec §字段规则）。 */
export function scoreParts(candidate: HomeDiscoveryCandidate | null | undefined): string {
  const parts: string[] = [];
  if (candidate?.viewMean != null && Number.isFinite(candidate.viewMean)) {
    parts.push(`均播 ${Math.round(candidate.viewMean)}`);
  }
  if (candidate?.viewFollowerRatio != null && Number.isFinite(candidate.viewFollowerRatio)) {
    parts.push(`播粉比 ${viewFollowerPercent(candidate)}`);
  }
  if (candidate?.stability != null && Number.isFinite(candidate.stability)) {
    parts.push(`稳定度 ${Math.round(candidate.stability * 100)}%`);
  }
  if (candidate?.followers != null && Number.isFinite(candidate.followers)) {
    parts.push(`粉丝 ${candidate.followers}`);
  }
  return parts.length ? parts.join(" · ") : MISSING_TEXT;
}
