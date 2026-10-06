import type {
  DiscoveryBrief,
  DiscoveryDirectionCode,
  DiscoveryOption,
  DiscoveryPlatformCode,
  DiscoveryRegionCode,
} from "./discoveryTemplate";
import {
  directionLabel as directionLabelOf,
  platformLabel as platformLabelOf,
  regionLabel as regionLabelOf,
} from "./discoveryTemplate";

/**
 * 实际采集参数的展示模型（纯函数，不发请求、不做业务判断）。
 *
 * 权威来源是 crawler_collect 的待确认动作 arguments：只有进入远端调用的参数才
 * 属于「本次实际执行参数」；地区、粉丝、均播与期望人数按技能已登记的边界
 * （backend/skills/crawler_collect/SKILL.md 的 constraints）属于候选到达后核对。
 */
export type DiscoveryParamItem = {
  key: string;
  label: string;
  value: string;
  state: "executed" | "checked_after";
};

export type DiscoveryParamCheck = {
  executed: DiscoveryParamItem[];
  checkedAfter: DiscoveryParamItem[];
};

export type DiscoveryParamCatalog = {
  platforms?: Array<DiscoveryOption<DiscoveryPlatformCode>>;
  regions?: Array<DiscoveryOption<DiscoveryRegionCode>>;
  directions?: Array<DiscoveryOption<DiscoveryDirectionCode>>;
};

/** arguments 中已知键的中文名；未知键按原样列出，不隐藏、不猜测语义。 */
const ARG_LABELS: Record<string, string> = {
  platforms: "平台",
  platform: "平台",
  crawler_type: "采集模式",
  mode: "采集模式",
  keywords: "关键词",
  specified_ids: "指定账号 ID",
  creator_ids: "指定创作者 ID",
  max_notes_count: "内容数量上限（单次检索/模式）",
  enable_comments: "采集评论",
  enable_sub_comments: "采集子评论",
};

const DISCOVERY_PLATFORM_CODES = ["youtube", "instagram", "facebook"];

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  return text ? [text] : [];
}

function formatArg(key: string, value: unknown, catalog?: DiscoveryParamCatalog): string | null {
  if (key === "platforms" || key === "platform") {
    const labels = stringList(value).map((code) => (
      DISCOVERY_PLATFORM_CODES.includes(code) ? platformLabelOf(code, catalog?.platforms) : code
    ));
    return labels.length ? labels.join("、") : null;
  }
  if (Array.isArray(value)) {
    const items = stringList(value);
    return items.length ? items.join("、") : null;
  }
  if (typeof value === "boolean") return value ? "开" : "关";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US") : String(value);
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : null;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length ? keys.join("、") : null;
  }
  return null;
}

function formatFollowerRange(brief: DiscoveryBrief): string {
  const min = brief.min_followers.toLocaleString("en-US");
  const max = brief.max_followers === null ? "不限" : brief.max_followers.toLocaleString("en-US");
  return `${min}–${max}`;
}

export function discoveryParamCheck(input: {
  brief: DiscoveryBrief;
  /** crawler_collect 待确认动作的 arguments；还没有提案时为 null。 */
  args: Record<string, unknown> | null;
  catalog?: DiscoveryParamCatalog;
}): DiscoveryParamCheck {
  const { brief, args, catalog } = input;
  const executed: DiscoveryParamItem[] = [];
  for (const [key, raw] of Object.entries(args || {})) {
    const value = formatArg(key, raw, catalog);
    if (value === null) continue;
    if (executed.some((row) => row.key === key)) continue;
    executed.push({ key, label: ARG_LABELS[key] || key, value, state: "executed" });
  }
  const checkedAfter: DiscoveryParamItem[] = [
    { key: "region", label: "地区", value: regionLabelOf(brief.region, catalog?.regions), state: "checked_after" },
    {
      key: "directions",
      label: "方向",
      value: brief.directions.length
        ? brief.directions.map((code) => directionLabelOf(code, catalog?.directions)).join("、")
        : "（未选）",
      state: "checked_after",
    },
    { key: "followers", label: "粉丝数", value: formatFollowerRange(brief), state: "checked_after" },
    {
      key: "min_avg_plays_10",
      label: "近10条均播",
      value: `≥ ${brief.min_avg_plays_10.toLocaleString("en-US")}`,
      state: "checked_after",
    },
    { key: "expect_count", label: "期望人数", value: String(brief.expect_count), state: "checked_after" },
  ];
  return { executed, checkedAfter };
}

/** 参数核对是否已失效：卡片在提交后被改回编辑态，旧核对不得再用于确认。 */
export function discoveryParamsStale(input: { submitted: boolean; editing: boolean }): boolean {
  return input.submitted && input.editing;
}
