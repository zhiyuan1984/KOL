import type { PoolKol } from "./kolContract";

export type PoolFilter = "all" | "new" | "overdue" | "high-potential" | "high-risk";
export type PoolSort = "default" | "newest" | "followers" | "potential";

export function metricNumber(value?: string) {
  const raw = (value || "").trim();
  const number = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(number)) return 0;
  return number * (raw.includes("万") ? 10_000 : /k$/i.test(raw) ? 1_000 : 1);
}

export function isHighPoolScore(score?: number | null, confidence?: number | null): boolean {
  return Number(score || 0) >= 80 && Number(confidence || 0) >= 0.7;
}

export function isPoolOverdue(card: PoolKol): boolean {
  const stage = card.public_stage?.label || "";
  return stage.includes("14") && stage.includes("回复");
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
      || (filter === "overdue" ? isPoolOverdue(card) : filter === "new" ? stage.includes("未首次建联")
        : filter === "high-potential" ? isHighPoolScore(card.assessment?.potential_score, card.assessment?.potential_confidence)
          : isHighPoolScore(card.assessment?.risk_score, card.assessment?.risk_confidence));
    return matchesFilter && (!needle || searchable.includes(needle));
  });

  if (sort === "newest") return [...visible].sort((a, b) => (Date.parse(b.ingested_at || "") || 0) - (Date.parse(a.ingested_at || "") || 0));
  if (sort === "followers") return [...visible].sort((a, b) => metricNumber(b.metrics.followers) - metricNumber(a.metrics.followers));
  if (sort === "potential") return [...visible].sort((a, b) => Number(b.assessment?.potential_score || 0) - Number(a.assessment?.potential_score || 0));
  return visible;
}
