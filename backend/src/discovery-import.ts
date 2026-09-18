/**
 * ADR-022 P0/P1 shared Host mapper: CreatorCandidate → crawler import row.
 * Thresholds and CSV live here so batch follow can reuse the same write-time mapping.
 * Never fabricates contactEmail. Never calls send / stage / decrypt.
 */
import { createHash } from "node:crypto";
import { employeeError } from "./discovery-errors.js";
import { HttpFail } from "./host/errors.js";
import type { Json, Row } from "./types.js";

export const IMPORT_CREATOR_POLICY = "import_creator";
export const IMPORT_CREATOR_TOOL = "importKolProfilesFromCrawler";
export const FORBIDDEN_FOLLOW_TOOLS = ["sendEmailNow", "changeLifecycleStage", "decryptKolContact"] as const;

const PLATFORM_DICT: Record<string, string> = {
  youtube: "YOUTUBE",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
};

export const CRAWLER_CSV_HEADERS = ["主平台", "红人名称", "账号", "粉丝数(万)", "近10均播", "主页链接"] as const;

export type FollowThresholds = {
  min_followers?: number;
  min_avg_views_10?: number;
  min_score?: number;
  platform?: string;
  region?: string;
};

export type CrawlerImportRow = {
  platform_dict: string;
  kol_name: string;
  account: string;
  followers_wan: string;
  avg_views_10: string;
  profile_url: string;
};

export type CrawlerImportFile = {
  fileName: string;
  fileBase64: string;
  csv: string;
  rows: CrawlerImportRow[];
};

export function isPlaceholderKolUid(value: unknown): boolean {
  return /^disc_/i.test(String(value || "").trim());
}

export function isRealKolUid(value: unknown): boolean {
  const uid = String(value || "").trim();
  return Boolean(uid) && !isPlaceholderKolUid(uid);
}

export function stableExternalIdOf(source: Row | Json): {
  platform: string;
  platform_creator_id: string;
  external_id: string;
} | null {
  const payload = asObject(source.payload);
  const platform = firstString(source.platform, payload.platform).toLowerCase();
  const creatorId = firstString(
    source.platform_creator_id,
    payload.platform_creator_id,
    payload.platformCreatorId,
  );
  if (!platform || !creatorId) return null;
  return {
    platform,
    platform_creator_id: creatorId,
    external_id: `${platform}:${creatorId}`,
  };
}

/** BIZ-10: no stable platform + platform_creator_id → refuse 入库. */
export function requireStableExternalId(source: Row | Json): {
  platform: string;
  platform_creator_id: string;
  external_id: string;
} {
  const id = stableExternalIdOf(source);
  if (!id) {
    throw new HttpFail(409, {
      code: "ingest_missing_external_id",
      message: "缺少稳定外部编号，无法入库公海。",
      biz: "BIZ-10",
    });
  }
  return id;
}

export function recentViewsOf(source: Row | Json): number[] {
  const payload = asObject(source.payload);
  const signals = asObject(source.signals);
  const raw = source.recent_views ?? payload.recent_views ?? signals.recent_views ?? payload.views;
  const list = Array.isArray(raw) ? raw : parseJsonArray(raw);
  return list.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Number((item as Json).views ?? (item as Json).view ?? (item as Json).play ?? 0);
    }
    return Number(item);
  }).filter((n) => Number.isFinite(n) && n >= 0);
}

export function avgViews10(source: Row | Json | number[]): number {
  const views = Array.isArray(source) ? source.filter((n) => Number.isFinite(n) && n >= 0) : recentViewsOf(source);
  if (!views.length) return 0;
  const sample = views.slice(0, 10);
  return sample.reduce((sum, n) => sum + n, 0) / sample.length;
}

export function followersToWan(followers: unknown): string {
  const n = Number(followers || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  const wan = n / 10000;
  if (wan >= 10) return String(Math.round(wan * 10) / 10);
  if (wan >= 1) return String(Math.round(wan * 100) / 100);
  return String(Math.round(wan * 1000) / 1000);
}

export function platformDictCode(platform: unknown): string {
  const key = String(platform || "").trim().toLowerCase();
  if (PLATFORM_DICT[key]) return PLATFORM_DICT[key];
  const upper = String(platform || "").trim().toUpperCase();
  if (upper === "YOUTUBE" || upper === "INSTAGRAM" || upper === "FACEBOOK") return upper;
  return "";
}

export function creatorExternalId(platform: unknown, platformCreatorId: unknown): string {
  return `${String(platform || "").trim().toLowerCase()}:${String(platformCreatorId || "").trim()}`;
}

export function sourceBatchFor(candidate: Row, override?: unknown): string {
  const explicit = String(override || "").trim();
  if (explicit) return explicit;
  return [
    "disc",
    String(candidate.request_id || "").trim(),
    String(candidate.platform || "").trim().toLowerCase(),
    String(candidate.platform_creator_id || "").trim(),
  ].filter(Boolean).join(":");
}

/** One L3 confirm / idempotency key for a selected or conditional follow set. */
export function sourceBatchForFollowSet(input: {
  requestId?: unknown;
  candidateIds: string[];
  filter?: FollowThresholds | null;
  override?: unknown;
}): string {
  const explicit = String(input.override || "").trim();
  if (explicit) return explicit;
  const digest = createHash("sha1")
    .update(JSON.stringify({
      ids: [...input.candidateIds].map((id) => String(id || "").trim()).filter(Boolean).sort(),
      filter: input.filter || null,
    }))
    .digest("hex")
    .slice(0, 16);
  return ["disc", String(input.requestId || "").trim(), "batch", digest].filter(Boolean).join(":");
}

export function profileUrlOf(source: Row | Json): string {
  const payload = asObject(source.payload);
  const signals = asObject(source.signals);
  return firstString(
    source.profile_url,
    payload.profile_url,
    payload.profileUrl,
    payload.url,
    payload.link,
    payload.homepage,
    payload.channel_url,
    signals.profile_url,
  );
}

export function mapCandidateToCrawlerRow(candidate: Row): CrawlerImportRow {
  const payload = asObject(candidate.payload);
  const account = firstString(
    candidate.handle,
    payload.handle,
    payload.account,
    candidate.platform_creator_id,
    payload.platform_creator_id,
  );
  const name = firstString(candidate.nickname, candidate.handle, payload.nickname, payload.kolName, account);
  return {
    platform_dict: platformDictCode(candidate.platform || payload.platform),
    kol_name: name,
    account,
    followers_wan: followersToWan(candidate.followers ?? payload.followers),
    avg_views_10: formatAvgViews(avgViews10(candidate)),
    profile_url: profileUrlOf(candidate),
  };
}

export function buildCrawlerImportFile(rows: CrawlerImportRow[], fileName = "discovery-follow.csv"): CrawlerImportFile {
  const lines = [
    CRAWLER_CSV_HEADERS.join(","),
    ...rows.map((row) => [
      csvCell(row.platform_dict),
      csvCell(row.kol_name),
      csvCell(row.account),
      csvCell(row.followers_wan),
      csvCell(row.avg_views_10),
      csvCell(row.profile_url),
    ].join(",")),
  ];
  const csv = `\uFEFF${lines.join("\n")}\n`;
  return {
    fileName,
    fileBase64: Buffer.from(csv, "utf8").toString("base64"),
    csv,
    rows,
  };
}

export function crawlerFileContainsContactEmail(file: CrawlerImportFile): boolean {
  return /contactEmail|联系邮箱/i.test(file.csv);
}

export function parseImportedKolUid(result: Json): string {
  const nested = [
    result,
    asObject(result.data),
    asObject(result.result),
    asObject(result.creator),
    firstObject(result.list),
    firstObject(result.records),
    firstObject(asObject(result.data).list),
    firstObject(asObject(result.data).records),
  ];
  for (const source of nested) {
    const uid = firstString(source.kolUid, source.kol_uid, source.uid);
    if (isRealKolUid(uid)) return uid;
  }
  const text = firstString(result.text, result.message);
  const match = text.match(/\bKOL[A-Z0-9]{4,}\b/i);
  return match && isRealKolUid(match[0]) ? match[0] : "";
}

/** P0 single follow (mode A): thresholds optional — omit = allow. Mode C (later) will require fans / avg / score + plan platform/region. This PR does not force FE defaults. */
export function parseFollowThresholds(raw: unknown): FollowThresholds | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpFail(400, { code: "invalid_thresholds", message: "跟进条件格式不正确。" });
  }
  const input = raw as Record<string, unknown>;
  const out: FollowThresholds = {};
  if (hasValue(input.min_followers) || hasValue(input.followers)) {
    out.min_followers = asPositiveNumber(input.min_followers ?? input.followers, "min_followers");
  }
  if (hasValue(input.min_avg_views_10) || hasValue(input.avg_views_10)) {
    out.min_avg_views_10 = asPositiveNumber(input.min_avg_views_10 ?? input.avg_views_10, "min_avg_views_10");
  }
  if (hasValue(input.min_score) || hasValue(input.score)) {
    out.min_score = asPositiveNumber(input.min_score ?? input.score, "min_score");
  }
  if (hasValue(input.platform)) out.platform = String(input.platform).trim().toLowerCase();
  if (hasValue(input.region)) out.region = String(input.region).trim().toLowerCase();
  return Object.keys(out).length ? out : null;
}

export function candidateRegionOf(source: Row | Json): string {
  return firstString(
    asObject(source.payload).region,
    asObject(source.signals).region,
    asObject(source.payload).country,
    source.region,
  ).toLowerCase();
}

/** Honest detect only. Never invents a contact email for import. */
export function candidateHasContactEmail(source: Row | Json): boolean {
  const payload = asObject(source.payload);
  const signals = asObject(source.signals);
  const email = firstString(
    source.contact_email,
    source.email,
    payload.contact_email,
    payload.contactEmail,
    payload.email,
    signals.contact_email,
    signals.contactEmail,
    signals.email,
  );
  return /@/.test(email);
}

export function planRegionOf(request: Row | null | undefined): string {
  return String(asObject(request?.filters).region || "all").trim().toLowerCase() || "all";
}

/** Plan region is set and the candidate has no region field. P0: audit-warn only; do not invent region. */
export function shouldWarnMissingCandidateRegion(
  candidate: Row,
  request: Row | null | undefined,
): boolean {
  const plan = planRegionOf(request);
  return Boolean(plan && plan !== "all" && !candidateRegionOf(candidate));
}

export type FollowFilterEvaluation =
  | { ok: true }
  | { ok: false; code: "follow_filter_rejected"; message: string };

/** List preview + write-time recheck. Missing region is not a reject (audit warn only). */
export function evaluateFollowFilters(
  candidate: Row,
  request: Row | null | undefined,
  thresholds: FollowThresholds | null | undefined,
): FollowFilterEvaluation {
  if (!thresholds) return { ok: true };
  const followers = Number(candidate.followers || 0);
  const score = Number(candidate.score || 0);
  const avg = avgViews10(candidate);
  const platform = String(candidate.platform || "").trim().toLowerCase();
  const planPlatforms = parseJsonArray(request?.platforms).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  const planRegion = planRegionOf(request);
  const candidateRegion = candidateRegionOf(candidate);

  if (thresholds.min_followers != null && followers < thresholds.min_followers) {
    return { ok: false, code: "follow_filter_rejected", message: "该线索粉丝数未达到跟进条件，未加入跟进。" };
  }
  if (thresholds.min_avg_views_10 != null && avg < thresholds.min_avg_views_10) {
    return { ok: false, code: "follow_filter_rejected", message: "该线索近 10 条均播放未达到跟进条件，未加入跟进。" };
  }
  if (thresholds.min_score != null && score < thresholds.min_score) {
    return { ok: false, code: "follow_filter_rejected", message: "该线索评分未达到跟进条件，未加入跟进。" };
  }
  const wantPlatform = thresholds.platform || (planPlatforms.length === 1 ? planPlatforms[0] : "");
  if (wantPlatform && platform && platform !== wantPlatform) {
    return { ok: false, code: "follow_filter_rejected", message: "该线索平台与当前计划不一致，未加入跟进。" };
  }
  const wantRegion = thresholds.region && thresholds.region !== "all" ? thresholds.region : "";
  const planWant = !thresholds.region && planRegion && planRegion !== "all" ? planRegion : "";
  const expectedRegion = wantRegion || planWant;
  // Missing candidate region is not a reject (P0/P1 audit warn). Do not invent region.
  if (expectedRegion && candidateRegion && candidateRegion !== expectedRegion) {
    return { ok: false, code: "follow_filter_rejected", message: "该线索地区与当前计划不一致，未加入跟进。" };
  }
  return { ok: true };
}

export function recheckFollowFilters(
  candidate: Row,
  request: Row | null | undefined,
  thresholds: FollowThresholds | null | undefined,
): void {
  const result = evaluateFollowFilters(candidate, request, thresholds);
  if (!result.ok) failFilter(result.message);
}

export function employeeImportError(error: unknown, fallback = "写入红人档案失败，未加入跟进。请稍后重试。"): string {
  const mapped = employeeError(error);
  if (!mapped) return fallback;
  if (/达人库未配置|主档写入未开启|档案未回传|未加入跟进|不符合|未达到/.test(mapped)) return mapped;
  if (/未配置|not[_ ]configured|starrykol_not_configured/i.test(String(mapped))) {
    return "达人库未配置，无法加入跟进。";
  }
  return fallback;
}

function failFilter(message: string): never {
  throw new HttpFail(409, { code: "follow_filter_rejected", message });
}

function formatAvgViews(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function asObject(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstObject(value: unknown): Json {
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") return value[0] as Json;
  return asObject(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function hasValue(value: unknown): boolean {
  return value != null && value !== "";
}

function asPositiveNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpFail(400, { code: "invalid_thresholds", message: "跟进条件须为不小于 0 的数字。", field });
  }
  return n;
}
