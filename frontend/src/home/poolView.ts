import type { PoolKol } from "./kolContract";

export type PoolFilter = "all" | "new" | "overdue";
export type PoolSortField = "ingested" | "followers" | "score";
export type PoolSortDirection = "asc" | "desc";
export type PoolSort = "default" | `${PoolSortField}-${PoolSortDirection}`;

export function metricNumber(value?: string) {
  const raw = (value || "").trim();
  const number = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(number)) return 0;
  return number * (raw.includes("万") ? 10_000 : /k$/i.test(raw) ? 1_000 : 1);
}

export type PoolScorePlaceholder = {
  state: "unscored" | "low_confidence" | "failed";
  label: string;
  title: string;
};

/**
 * 「未评分」有三种不同的原因，界面上必须说清是哪一种：
 * 从未评过 / 评过但置信度低于 70% 不给分 / 评分调用失败；缺公开指标时直说缺哪几项。
 * Jev 只依据公开资料打分（见 backend/src/host/kol-jev-assessment.ts）。
 */
export function poolScorePlaceholder(
  assessment: { state?: "scored" | "unscored" | "low_confidence" | "failed"; potential_confidence?: number | null; assessed_at?: string | null } | undefined,
  missingMetrics: string[] = [],
): PoolScorePlaceholder {
  const confidence = Math.round(Number(assessment?.potential_confidence || 0) * 100);
  const at = assessment?.assessed_at ? new Date(assessment.assessed_at) : null;
  const atLabel = at && !Number.isNaN(at.getTime()) ? `评估于 ${at.toLocaleDateString("zh-CN")}。` : "";
  if (assessment?.state === "failed") {
    return { state: "failed", label: "评分失败", title: `Jev 评分调用失败（已记录，可重试）。${atLabel}` };
  }
  if (assessment?.state === "low_confidence" || (assessment?.assessed_at && assessment?.potential_confidence != null)) {
    return {
      state: "low_confidence",
      label: `已评估 · 置信度 ${confidence}%`,
      title: `Jev 评估已完成，但置信度低于 70% 不给分：公开资料不足或信号不明确。${atLabel}`,
    };
  }
  const missing = missingMetrics.length ? `缺 ${missingMetrics.join("、")}；` : "";
  return { state: "unscored", label: "未评分", title: `${missing}Jev 评分只依据公开资料，可用中栏「KOL评分」执行。` };
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
      || (filter === "overdue" ? isPoolOverdue(card) : stage.includes("未首次建联"));
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
