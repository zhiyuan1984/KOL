import type { PoolKol } from "./kolContract";

export type PoolFilter = "all" | "new" | "overdue";
export type PoolSortField = "ingested" | "followers" | "score";
export type PoolSortDirection = "asc" | "desc";
export type PoolSort = "default" | `${PoolSortField}-${PoolSortDirection}`;

/** Counts are supplied by the same authorized server snapshot as the pool page. */
export type PoolGlobalCounts = {
  newCount: number;
  overdueCount: number;
};

/** A successful claim stays on its source row only as a release receipt. */
export type PoolClaimReceipt = {
  kolUid: string;
  followId: string;
  card: PoolKol;
};

export type PoolClaimReceipts = Readonly<Record<string, PoolClaimReceipt>>;

export type PoolClaimReceiptEvent =
  | { type: "claim-succeeded"; receipt: PoolClaimReceipt }
  | { type: "claim-failed" }
  | { type: "release-succeeded"; kolUid: string }
  | { type: "release-failed" }
  | { type: "scope-reset" };

export const EMPTY_POOL_CLAIM_RECEIPTS: PoolClaimReceipts = Object.freeze({});

/** Failed requests intentionally preserve the last committed receipt state. */
export function reducePoolClaimReceipts(
  current: PoolClaimReceipts,
  event: PoolClaimReceiptEvent,
): PoolClaimReceipts {
  if (event.type === "claim-succeeded") {
    return { ...current, [event.receipt.kolUid]: event.receipt };
  }
  if (event.type === "release-succeeded") {
    if (!current[event.kolUid]) return current;
    const { [event.kolUid]: _released, ...rest } = current;
    return rest;
  }
  if (event.type === "scope-reset") return EMPTY_POOL_CLAIM_RECEIPTS;
  return current;
}

export function poolReceiptFor(receipts: PoolClaimReceipts, kolUid: string): PoolClaimReceipt | undefined {
  return receipts[kolUid];
}

/** Receipt rows are not selectable/analyzable as remaining public-pool candidates. */
export function poolCandidateCards(cards: PoolKol[], receipts: PoolClaimReceipts): PoolKol[] {
  return cards.filter((card) => !receipts[card.kol_uid]);
}

/** A single in-flight pool ownership mutation prevents repeated clicks and races. */
export function canStartPoolMutation(busyKolUid: string | null, _kolUid: string): boolean {
  return busyKolUid === null;
}

/** Keep locally retained receipts out of the server-originated global filter badges. */
export function countsAfterPoolReceipts(counts: PoolGlobalCounts, receipts: PoolClaimReceipts): PoolGlobalCounts {
  let newCount = counts.newCount;
  let overdueCount = counts.overdueCount;
  for (const receipt of Object.values(receipts)) {
    if (isPoolOverdue(receipt.card)) overdueCount -= 1;
    else if (isPoolNew(receipt.card)) newCount -= 1;
  }
  return { newCount: Math.max(0, newCount), overdueCount: Math.max(0, overdueCount) };
}

export function isPoolNew(card: PoolKol): boolean {
  return (card.public_stage?.label || "").includes("未首次建联");
}

export function metricNumber(value?: string) {
  const raw = (value || "").trim();
  const number = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(number)) return 0;
  return number * (raw.includes("万") ? 10_000 : /k$/i.test(raw) ? 1_000 : 1);
}

export type PoolScorePlaceholder = {
  state: "scoring" | "unscored" | "low_confidence" | "failed";
  label: string;
  title: string;
};

/**
 * 「未评分」有三种不同的原因，界面上必须说清是哪一种：
 * 从未评过 / 评过但置信度低于 70% 不给分 / 评分调用失败；缺公开指标时直说缺哪几项。
 * Jev 只依据公开资料打分（见 backend/src/host/kol-jev-assessment.ts）。
 */
export function poolScorePlaceholder(
  assessment: {
    state?: "scored" | "scoring" | "unscored" | "low_confidence" | "failed";
    potential_confidence?: number | null;
    assessed_at?: string | null;
    criteria_summary?: string;
  } | undefined,
  missingMetrics: string[] = [],
): PoolScorePlaceholder {
  const confidence = Math.round(Number(assessment?.potential_confidence || 0) * 100);
  const at = assessment?.assessed_at ? new Date(assessment.assessed_at) : null;
  const atLabel = at && !Number.isNaN(at.getTime()) ? `评估于 ${at.toLocaleDateString("zh-CN")}。` : "";
  const criteriaLabel = assessment?.criteria_summary ? `口径 ${assessment.criteria_summary}。` : "";
  if (assessment?.state === "scoring") {
    return { state: "scoring", label: "评分中…", title: "正在依据已保存的公开资料与发现条件评分，可继续筛选。" };
  }
  if (assessment?.state === "failed") {
    return { state: "failed", label: "评分失败", title: `评分调用失败（已记录，可重试）。${atLabel}${criteriaLabel}` };
  }
  if (assessment?.state === "low_confidence" || (assessment?.assessed_at && assessment?.potential_confidence != null)) {
    return {
      state: "low_confidence",
      label: `已评估 · 置信度 ${confidence}%`,
      title: `评分已完成，公开资料不足或信号不明确，需要人工复核。${atLabel}${criteriaLabel}`,
    };
  }
  const missing = missingMetrics.length ? `缺 ${missingMetrics.join("、")}；` : "";
  return {
    state: "unscored",
    label: "未评分",
    title: `${missing}评分只依据公开资料，可用中栏「红人评分」执行；口径以执行前确认的条件为准。${criteriaLabel}`,
  };
}

export function isHighPoolScore(score?: number | null, confidence?: number | null): boolean {
  return Number(score || 0) >= 80 && Number(confidence || 0) >= 0.7;
}

export function isPoolOverdue(card: PoolKol): boolean {
  const stage = card.public_stage?.label || "";
  return stage.includes("14") && stage.includes("回复");
}

export function poolSortState(sort: PoolSort): { field: PoolSortField | null; direction: PoolSortDirection } {
  if (sort === "default") return { field: null, direction: "desc" };
  const [field, direction] = sort.split("-") as [PoolSortField, PoolSortDirection];
  return { field, direction };
}

export function nextPoolSort(sort: PoolSort, field: PoolSortField): PoolSort {
  const current = poolSortState(sort);
  if (current.field !== field) return `${field}-desc`;
  return `${field}-${current.direction === "desc" ? "asc" : "desc"}`;
}

function scoreValue(card: PoolKol): number {
  return Number(card.assessment?.potential_score || 0);
}

export function filterPoolCards(cards: PoolKol[], query: string, filter: PoolFilter, sort: PoolSort): PoolKol[] {
  const needle = query.trim().toLowerCase();
  const visible = cards.filter((card) => {
    const stage = card.public_stage?.label || "";
    const searchable = [
      card.identity.display,
      card.identity.platform,
      card.direction,
      card.region,
      card.style,
      stage,
      card.metrics.followers,
      card.metrics.avg_plays,
      card.metrics.engagement,
    ].join(" ").toLowerCase();
    const matchesFilter = filter === "all"
      || (filter === "overdue" ? isPoolOverdue(card) : isPoolNew(card));
    return matchesFilter && (!needle || searchable.includes(needle));
  });

  const { field, direction } = poolSortState(sort);
  if (!field) return visible;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...visible].sort((a, b) => {
    const aValue = field === "ingested" ? (Date.parse(a.ingested_at || "") || 0)
      : field === "followers" ? metricNumber(a.metrics.followers) : scoreValue(a);
    const bValue = field === "ingested" ? (Date.parse(b.ingested_at || "") || 0)
      : field === "followers" ? metricNumber(b.metrics.followers) : scoreValue(b);
    return (aValue - bValue) * multiplier;
  });
}
