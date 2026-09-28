/**
 * Jev 评分的「评分口径」：员工在 AI 发现里设定的目标条件（平台 / 地区 / 方向 / 关键词 / 粉丝与均播门槛 / 期望人数）。
 *
 * 为什么要有它：`topic`、`region` 这类信号只有在「我们要找什么」已知时才是匹配信号，否则模型只能把
 * 「有方向 / 有地区」当成资料完整度。这里把口径收成一个受控对象，随评分一起提交给模型，并写进
 * 评分回执与卡片 tooltip（口径不同的两次评分不该看起来一样）。
 */
import { getConn, type SqliteConn } from "../db.js";
import {
  DEFAULT_DISCOVERY_THRESHOLDS,
  DISCOVERY_PLATFORMS,
  MAX_DISCOVERY_DIRECTIONS,
  isDiscoveryPlatform,
  isDiscoveryRegion,
} from "../discovery-template.js";
import type { Json, Row } from "../types.js";

export type KolScoringCriteria = {
  platforms: string[];
  region: string;
  directions: string[];
  keywords: string[];
  min_followers: number;
  max_followers: number;
  min_avg_plays_10: number;
  expect_count: number;
  brand: string | null;
};

const MAX_KEYWORDS = 8;
const MAX_TEXT = 40;
const MAX_FOLLOWERS = 1_000_000_000;
const MAX_AVG_PLAYS = 100_000_000;
const MAX_EXPECT = 80;

function boundedText(value: unknown, max = MAX_TEXT): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedList(value: unknown, limit: number, guard?: (item: string) => boolean): string[] {
  const raw = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of raw) {
    const text = boundedText(item);
    if (!text || out.includes(text)) continue;
    if (guard && !guard(text)) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * 收紧一份（可能来自客户端的）条件：平台/地区必须命中字典，其余按上限截断；
 * 门槛保持区间关系（min ≤ max），避免模型看到自相矛盾的条件。
 */
export function normalizeScoringCriteria(value: unknown): KolScoringCriteria | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Json;
  const platforms = boundedList(raw.platforms, DISCOVERY_PLATFORMS.length, isDiscoveryPlatform);
  const regionRaw = boundedText(raw.region);
  const region = isDiscoveryRegion(regionRaw) ? regionRaw : "";
  const directions = boundedList(raw.directions, MAX_DISCOVERY_DIRECTIONS);
  const keywords = boundedList(raw.keywords, MAX_KEYWORDS);
  const thresholds = (raw.thresholds && typeof raw.thresholds === "object" ? raw.thresholds : raw) as Json;
  const minFollowers = boundedNumber(
    thresholds.min_followers, DEFAULT_DISCOVERY_THRESHOLDS.min_followers, 0, MAX_FOLLOWERS,
  );
  const maxFollowers = boundedNumber(
    thresholds.max_followers, DEFAULT_DISCOVERY_THRESHOLDS.max_followers, minFollowers, MAX_FOLLOWERS,
  );
  const minAvgPlays = boundedNumber(
    thresholds.min_avg_plays_10 ?? thresholds.min_avg_views_10,
    DEFAULT_DISCOVERY_THRESHOLDS.min_avg_views_10,
    0,
    MAX_AVG_PLAYS,
  );
  const expectCount = boundedNumber(
    thresholds.expect_count ?? thresholds.target_count,
    DEFAULT_DISCOVERY_THRESHOLDS.target_count,
    1,
    MAX_EXPECT,
  );
  const brand = boundedText(raw.brand, 20) || null;
  if (!platforms.length && !region && !directions.length && !keywords.length && !brand) return null;
  return {
    platforms, region, directions, keywords,
    min_followers: minFollowers, max_followers: maxFollowers,
    min_avg_plays_10: minAvgPlays, expect_count: expectCount, brand,
  };
}

function storedList(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function safeJson(value: string): Json {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Json : {};
  } catch {
    return {};
  }
}

/**
 * 员工最近一次 AI 发现请求的条件：这是他自己声明过的目标，属于他自己写下的意图，不是推断。
 * 没有记录就返回 null——此时按公开资料的通用口径评分，并在回执里说明。
 */
export function latestDiscoveryCriteria(employeeId: string, db: SqliteConn = getConn()): KolScoringCriteria | null {
  let row: Row | undefined;
  try {
    row = db.prepare(
      "SELECT * FROM discovery_requests WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 1",
    ).get(employeeId) as Row | undefined;
  } catch {
    return null;
  }
  if (!row) return null;
  const filters = (typeof row.filters === "string" ? safeJson(String(row.filters)) : row.filters) as Json;
  return normalizeScoringCriteria({
    platforms: storedList(row.platforms),
    keywords: storedList(row.keywords),
    region: filters.region,
    directions: filters.directions,
    brand: row.brand,
    thresholds: {
      min_followers: filters.min_followers,
      max_followers: filters.max_followers,
      min_avg_plays_10: filters.min_avg_views_10 ?? filters.min_avg_plays_10,
      expect_count: filters.target_count ?? filters.expect_count,
    },
  });
}

/** 提交给模型的条件状态：与 public_profile 同样用 JSON 文本，缺失即表示未设置。 */
export function criteriaState(criteria: KolScoringCriteria): string {
  return JSON.stringify({
    target_criteria: {
      platforms: criteria.platforms.length ? criteria.platforms : "未设置",
      region: criteria.region || "未设置",
      directions: criteria.directions.length ? criteria.directions : "未设置",
      keywords: criteria.keywords.length ? criteria.keywords : "未设置",
      followers_range: `${criteria.min_followers}-${criteria.max_followers}`,
      min_avg_plays_10: criteria.min_avg_plays_10,
      expect_count: criteria.expect_count,
      brand: criteria.brand || "未设置",
    },
  });
}

function wan(value: number): string {
  if (!Number.isFinite(value)) return "未设置";
  return value >= 10_000 ? `${Math.round(value / 10_000)}万` : String(value);
}

/** 一行人类可读口径：回执、卡片 tooltip 与审计都用它，保证「同样的分 = 同样的口径」。 */
export function criteriaSummary(criteria: KolScoringCriteria | null): string {
  if (!criteria) return "";
  const parts = [
    criteria.platforms.length ? `平台 ${criteria.platforms.join("/")}` : "",
    criteria.region ? `地区 ${criteria.region}` : "",
    criteria.directions.length ? `方向 ${criteria.directions.join("/")}` : "",
    criteria.keywords.length ? `关键词 ${criteria.keywords.join(", ")}` : "",
    `粉丝 ${wan(criteria.min_followers)}–${wan(criteria.max_followers)}`,
    `近10条均播 ≥${criteria.min_avg_plays_10}`,
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 300);
}
