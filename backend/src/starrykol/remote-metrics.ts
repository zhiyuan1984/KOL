/**
 * 远端 Starry 档案 → 本地公开指标的单一映射口径。
 *
 * board 同步（collaborations）与公海 A 表同步（kol_profile_index）此前各写一份，
 * 结果出现「我的红人显示 82万、公海显示 82」这类漂移：同一条远端档案，两处看到的
 * 量级不同，Jev 打分又只吃 A 表，于是模型把 82 万当成 82。指标口径只留这一处。
 */
import type { Json } from "../types.js";
import { firstString } from "./mail-fields.js";

/** 远端只保证 followerCountTenThousands（单位：万）；绝对数或已带「万」的字串一并兼容。 */
export function followersOf(profile: Json): string {
  const wan = profile.followerCountTenThousands ?? profile.followers_wan ?? profile.followerCountWan;
  if (typeof wan === "string" && wan.trim().endsWith("万")) return wan.trim();
  if (wan != null && wan !== "") {
    const n = Number(wan);
    if (Number.isFinite(n)) return `${n}万`;
  }
  const raw = firstString(profile.followers, profile.followerCount);
  if (!raw) return "";
  if (raw.endsWith("万")) return raw;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  return n >= 10_000 ? `${Math.round(n / 10_000)}万` : String(n);
}

/** 10 期均播：远端是 avgVideoViews10。 */
export function avgPlaysOf(profile: Json): string {
  return firstString(profile.avgVideoViews10, profile.avg_views_10, profile.avgPlays, profile.averagePlays);
}

/** 互动率：视频互动优先，帖子互动兜底。 */
export function engagementOf(profile: Json): string {
  return firstString(
    profile.avgVideoEngagementRate10,
    profile.engagementRate,
    profile.engagement_rate,
    profile.avgPostEngagementRate10,
  );
}

/** 地区：audienceGeo 是对象时取占比最高的一项，否则退回国家级字段。 */
export function geoOf(profile: Json): string {
  const geo = profile.audienceGeo || profile.audience_geo;
  if (geo && typeof geo === "object" && !Array.isArray(geo)) {
    const top = Object.entries(geo as Record<string, string>)
      .sort((a, b) => Number.parseFloat(String(b[1])) - Number.parseFloat(String(a[1])))[0];
    if (top?.[0]) return top[0];
  }
  return firstString(profile.countryName, profile.country, profile.audienceGeo, profile.audience_geo);
}

/**
 * Jev 只依据公开指标打分，缺任意一项都可能被判为「资料不足」；这里给出缺项清单，
 * 供同步回执与卡片如实说明「先补数据，再评分」。
 */
export function missingPublicMetrics(profile: Json): string[] {
  const missing: string[] = [];
  if (!followersOf(profile)) missing.push("粉丝数");
  if (!avgPlaysOf(profile)) missing.push("均播");
  if (!engagementOf(profile)) missing.push("互动率");
  if (!firstString(profile.niche, profile.nicheTagsText, profile.direction)) missing.push("内容方向");
  return missing;
}
