import {
  directionLabel,
  platformLabel,
  regionLabel,
  type DiscoveryBrief,
  type DiscoveryTemplate,
} from "./discoveryTemplate";

export type DiscoverySummaryRow = { key: string; label: string; value: string; wide?: boolean };

type Catalog = Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null | undefined;

/** 「发现任务」摘要：上=用户配置，下=AI 将执行的任务摘要；顺序即线框稿顺序。 */
export function discoveryTaskSummaryRows(brief: DiscoveryBrief, catalog?: Catalog): DiscoverySummaryRow[] {
  const platforms = catalog?.platforms;
  const regions = catalog?.regions;
  const directions = catalog?.directions;
  return [
    {
      key: "platforms",
      label: "平台",
      value: brief.platforms.length
        ? brief.platforms.map((code) => platformLabel(code, platforms)).join(" / ")
        : "（未选）",
    },
    { key: "region", label: "地区", value: regionLabel(brief.region, regions) },
    {
      key: "directions",
      label: "方向",
      value: brief.directions.length
        ? brief.directions.map((code) => directionLabel(code, directions)).join("、")
        : "（未选）",
    },
    {
      key: "keywords",
      label: "关键词",
      value: brief.keywords.length ? brief.keywords.join(", ") : "（未填）",
      wide: true,
    },
    { key: "followers", label: "粉丝", value: `${brief.min_followers}–${brief.max_followers}` },
    { key: "plays", label: "近10条均播", value: `≥ ${brief.min_avg_plays_10}` },
    { key: "count", label: "期望人数", value: String(brief.expect_count) },
  ];
}

export function clampCountInput(raw: string, fallback: number): number {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}
