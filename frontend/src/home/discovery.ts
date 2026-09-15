/**
 * Home AI发现 client — live `/api/discovery/*` (PR #63).
 * Discovery plan / candidate projection. Surface law: CONSTITUTION §4.2.
 *
 * POST /requests persists a plan only (`status=open`, no crawl).
 * POST /requests/:id/runs starts a Run after employee confirm.
 * GET /requests/:id/results is panel-ready.
 * POST /candidates/:id/follow is the only path that creates Collaboration.
 */
import { api } from "../api";

export type DiscoveryPlatform = "youtube" | "instagram" | "facebook";
export type DiscoveryMode = "search" | "detail" | "creator";
export type DiscoveryRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type CreatorCandidateStatus = "suggested" | "dismissed" | "followed";
export type DiscoveryPhase = "idle" | "planning" | "plan" | "running" | "results" | "error";
export const DISCOVERY_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
export const DISCOVERY_WAIT_TIMEOUT_MS = 180_000;
export const DISCOVERY_WAIT_POLL_MS = 1_000;
export const DISCOVERY_FAVORITES_KEY = "discovery:favorites";
export const DISCOVERY_RUN_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "采集中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export type DiscoveryRegion = "all" | "us" | "ca" | "eu" | "au" | "na" | "sea";

export type DiscoveryFilters = {
  region: string;
  directions: string[];
};

export type DiscoveryRequestInput = {
  keywords: string[];
  platforms: DiscoveryPlatform[];
  mode?: DiscoveryMode;
  filters?: DiscoveryFilters;
  brand?: string;
  scope?: Record<string, unknown>;
};

export type CreatorCandidate = {
  id: string;
  request_id?: string;
  run_id?: string;
  platform: string;
  handle: string;
  nickname: string;
  followers: number;
  avg_views_10?: number;
  score: number;
  has_contact_email?: boolean;
  region?: string | null;
  avatar_url?: string | null;
  title?: string;
  reason?: string;
  summary?: string;
  source?: "ai";
  source_label?: string;
  intent?: string;
  signals?: Record<string, unknown>;
  status: CreatorCandidateStatus;
  collaboration_id?: string | null;
  dismissed_at?: string | null;
  followed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DiscoveryConnectionStatus = "not_configured" | "unchecked" | "unreachable" | "ok";

export type DiscoveryConnection = {
  status: DiscoveryConnectionStatus | string;
  credentials_present: boolean;
  reachable: boolean | null;
  connected: boolean | null;
  checked_at?: string | null;
  message: string;
  status_label?: string;
};

export type DiscoveryRun = {
  id: string;
  request_id?: string;
  platform?: string;
  status: DiscoveryRunStatus | string;
  status_label?: string;
  error?: string | null;
  candidate_count?: number;
  created_at?: string;
  started_at?: string | null;
  updated_at?: string;
  completed_at?: string | null;
  duplicate?: boolean;
  connection?: DiscoveryConnection;
  search_keywords?: string[];
  empty_hint?: string | null;
};

export type DiscoveryRequest = {
  id: string;
  status: string;
  status_label?: string;
  keywords: string[];
  platforms: string[];
  title?: string;
  plan_summary?: string;
  brand?: string | null;
  latest_run?: DiscoveryRun | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  filters?: DiscoveryFilters;
  mode?: string;
  connection?: DiscoveryConnection;
};

export type DiscoveryResults = {
  id: string;
  status: string;
  status_label?: string;
  keywords: string[];
  platforms: string[];
  title?: string;
  plan_summary?: string;
  request: DiscoveryRequest;
  run: DiscoveryRun | null;
  candidates: CreatorCandidate[];
  counts?: {
    candidate_count?: number;
    suggested_count?: number;
    followed_count?: number;
    dismissed_count?: number;
  };
  ready?: boolean;
  pending_confirm?: boolean;
  error?: string | null;
  connection?: DiscoveryConnection;
  search_keywords?: string[];
  empty_hint?: string | null;
};

export type DiscoveryFollowResult = CreatorCandidate & {
  collaboration?: {
    id: string;
    handle: string;
    display_name?: string;
    platform: string;
    brand?: string;
    stage_code?: string;
    kol_uid?: string;
    source?: string;
  };
  created?: boolean;
  skipped_duplicate?: boolean;
};

export type FollowFilter = {
  min_followers?: number;
  min_avg_views_10?: number;
  min_score?: number;
  platform?: string;
  region?: string;
};

export type DiscoveryFollowFail = {
  candidate_id: string;
  handle?: string;
  code?: string;
  message: string;
};

export type DiscoveryFollowBatchResult = {
  source_batch?: string;
  confirmed?: boolean;
  preview?: boolean;
  followed: DiscoveryFollowResult[];
  failed: DiscoveryFollowFail[];
  skipped_duplicate: DiscoveryFollowResult[];
  filter?: FollowFilter | null;
  counts: {
    selected?: number;
    preview?: number;
    followed: number;
    failed: number;
    skipped_duplicate: number;
    missing_email?: number;
  };
  message?: string;
  sent?: boolean;
  stage_changed?: boolean;
};

export const OVERSEAS_DISCOVERY_PLATFORMS: DiscoveryPlatform[] = ["youtube", "instagram", "facebook"];

export const CHIP_REGION_CODES = ["all", "us", "ca", "eu", "au"] as const;
export type ChipRegion = (typeof CHIP_REGION_CODES)[number];

export const DISCOVERY_REGION_OPTIONS: Array<{ value: ChipRegion; label: string }> = [
  { value: "all", label: "不限地区" },
  { value: "us", label: "美国" },
  { value: "ca", label: "加拿大" },
  { value: "eu", label: "欧洲" },
  { value: "au", label: "澳洲" },
];

export const DIRECTION_PRESETS = ["户外露营", "户外电源", "房车旅行", "徒步旅行", "装备评测", "家庭旅行"] as const;

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  region: "all",
  directions: [],
};

export const MAX_DIRECTIONS = 8;
export const MAX_DIRECTION_CHARS = 30;

export {
  DISCOVERY_BANNED_JARGON,
  DISCOVERY_CANCELLED_MESSAGE,
  DISCOVERY_CANCELLED_TITLE,
  DISCOVERY_CONNECTION_MESSAGE,
  DISCOVERY_CONNECTION_TITLE,
  DISCOVERY_CRAWL_ACTIVE_MESSAGE,
  DISCOVERY_GENERIC_FALLBACK,
  DISCOVERY_GENERIC_TITLE,
  DISCOVERY_TIMEOUT_MESSAGE,
  DISCOVERY_TIMEOUT_TITLE,
  DiscoveryWaitCancelledError,
  DiscoveryWaitTimeoutError,
  isDiscoveryConnectionFailure,
  presentDiscoveryError,
  type DiscoveryErrorKind,
  type DiscoveryErrorView,
  type DiscoveryRecoverAction,
} from "./discovery-error";

const PLATFORM_LABEL: Record<DiscoveryPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};

const REGION_LABEL: Record<DiscoveryRegion, string> = {
  all: "不限地区",
  us: "美国",
  ca: "加拿大",
  eu: "欧洲",
  au: "澳洲",
  na: "北美",
  sea: "东南亚",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return [];
}

export function asConnection(value: unknown): DiscoveryConnection | undefined {
  const item = asRecord(value);
  if (!item.status && item.credentials_present == null && item.reachable == null) return undefined;
  const status = String(item.status || (item.credentials_present ? "unchecked" : "not_configured"));
  return {
    status,
    credentials_present: Boolean(item.credentials_present),
    reachable: item.reachable == null ? null : Boolean(item.reachable),
    connected: item.connected == null ? null : Boolean(item.connected),
    checked_at: item.checked_at == null ? null : String(item.checked_at),
    message: String(item.message || ""),
    status_label: item.status_label ? String(item.status_label) : undefined,
  };
}

export function asCandidate(row: unknown): CreatorCandidate {
  const item = asRecord(row);
  const handle = String(item.handle || item.nickname || "");
  const status = String(item.status || "suggested") as CreatorCandidateStatus;
  return {
    id: String(item.id || ""),
    request_id: item.request_id ? String(item.request_id) : undefined,
    run_id: item.run_id ? String(item.run_id) : undefined,
    platform: String(item.platform || ""),
    handle,
    nickname: String(item.nickname || item.handle || ""),
    followers: Number(item.followers || 0),
    avg_views_10: Number(item.avg_views_10 || 0),
    score: Number(item.score || 0),
    has_contact_email: Boolean(item.has_contact_email),
    region: item.region == null || item.region === "" ? null : String(item.region),
    avatar_url: item.avatar_url == null ? null : String(item.avatar_url),
    title: item.title ? String(item.title) : undefined,
    reason: item.reason ? String(item.reason) : undefined,
    summary: item.summary ? String(item.summary) : undefined,
    source: "ai",
    source_label: item.source_label ? String(item.source_label) : "AI发现",
    intent: item.intent ? String(item.intent) : "creator_profile",
    signals: asRecord(item.signals),
    status: status === "dismissed" || status === "followed" ? status : "suggested",
    collaboration_id: item.collaboration_id == null ? null : String(item.collaboration_id),
    dismissed_at: item.dismissed_at == null ? null : String(item.dismissed_at),
    followed_at: item.followed_at == null ? null : String(item.followed_at),
    created_at: item.created_at ? String(item.created_at) : undefined,
    updated_at: item.updated_at ? String(item.updated_at) : undefined,
  };
}

export function asRun(row: unknown): DiscoveryRun {
  const item = asRecord(row);
  return {
    id: String(item.id || ""),
    request_id: item.request_id ? String(item.request_id) : undefined,
    platform: item.platform ? String(item.platform) : undefined,
    status: String(item.status || "queued"),
    status_label: item.status_label ? String(item.status_label) : undefined,
    error: item.error == null ? null : String(item.error),
    candidate_count: Number(item.candidate_count || 0),
    created_at: item.created_at ? String(item.created_at) : undefined,
    started_at: item.started_at == null ? null : String(item.started_at),
    updated_at: item.updated_at ? String(item.updated_at) : undefined,
    completed_at: item.completed_at == null ? null : String(item.completed_at),
    duplicate: Boolean(item.duplicate),
    connection: asConnection(item.connection),
    search_keywords: asStringList(item.search_keywords),
    empty_hint: item.empty_hint == null ? null : String(item.empty_hint),
  };
}

export function asRequest(row: unknown): DiscoveryRequest {
  const item = asRecord(row);
  return {
    id: String(item.id || ""),
    status: String(item.status || "open"),
    status_label: item.status_label ? String(item.status_label) : undefined,
    keywords: asStringList(item.keywords),
    platforms: asStringList(item.platforms),
    title: item.title ? String(item.title) : undefined,
    plan_summary: item.plan_summary ? String(item.plan_summary) : undefined,
    brand: item.brand == null ? null : String(item.brand),
    latest_run: item.latest_run ? asRun(item.latest_run) : null,
    error: item.error == null ? null : String(item.error),
    created_at: item.created_at ? String(item.created_at) : undefined,
    updated_at: item.updated_at ? String(item.updated_at) : undefined,
    filters: asFilters(item.filters),
    mode: item.mode ? String(item.mode) : undefined,
    connection: asConnection(item.connection),
  };
}

export function asResults(row: unknown): DiscoveryResults {
  const item = asRecord(row);
  const request = asRequest(item.request || item);
  const candidates = Array.isArray(item.candidates)
    ? item.candidates.map(asCandidate)
    : [];
  return {
    id: String(item.id || request.id),
    status: String(item.status || request.status),
    status_label: item.status_label ? String(item.status_label) : request.status_label,
    keywords: asStringList(item.keywords).length ? asStringList(item.keywords) : request.keywords,
    platforms: asStringList(item.platforms).length ? asStringList(item.platforms) : request.platforms,
    title: item.title ? String(item.title) : request.title,
    plan_summary: item.plan_summary ? String(item.plan_summary) : request.plan_summary,
    request,
    run: item.run ? asRun(item.run) : request.latest_run || null,
    candidates,
    counts: asRecord(item.counts) as DiscoveryResults["counts"],
    ready: Boolean(item.ready),
    pending_confirm: Boolean(item.pending_confirm),
    error: item.error == null ? request.error ?? null : String(item.error),
    connection: asConnection(item.connection) || asConnection(item.collector_status) || request.connection,
    search_keywords: asStringList(item.search_keywords).length
      ? asStringList(item.search_keywords)
      : asStringList(item.run && typeof item.run === "object" ? (item.run as { search_keywords?: unknown }).search_keywords : []),
    empty_hint: item.empty_hint == null ? null : String(item.empty_hint),
  };
}

export function asFilters(value: unknown): DiscoveryFilters {
  const item = asRecord(value);
  const directions = asStringList(item.directions);
  const niche = String(item.niche || "").trim();
  return {
    region: String(item.region || DEFAULT_DISCOVERY_FILTERS.region),
    directions: addDirections([], directions.length ? directions : (niche ? [niche] : [])).directions,
  };
}

/** POST body for Host #69: only `{ region, directions }`, never `niche`. */
export function requestFilters(input?: DiscoveryFilters): DiscoveryFilters {
  const parsed = asFilters(input);
  const region = CHIP_REGION_CODES.includes(parsed.region as ChipRegion)
    ? parsed.region
    : parsed.region || "all";
  return {
    region,
    directions: parsed.directions.slice(0, MAX_DIRECTIONS),
  };
}

export function platformLabel(value: string): string {
  return PLATFORM_LABEL[value as DiscoveryPlatform] || value;
}

export function regionLabel(value: string): string {
  return REGION_LABEL[value as DiscoveryRegion] || value;
}

export function guessPlatformFromQuery(query: string): DiscoveryPlatform | undefined {
  const text = query.toLowerCase();
  if (/(instagram|\bins\b|\big\b)/i.test(text)) return "instagram";
  if (/(facebook|\bfb\b|脸书)/i.test(text)) return "facebook";
  if (/(youtube|\byt\b|油管)/i.test(text)) return "youtube";
  return undefined;
}

export function guessRegionFromQuery(query: string): DiscoveryRegion | undefined {
  if (/加拿大|canada/i.test(query)) return "ca";
  if (/美国|美國|北美|usa|\bunited states\b/i.test(query)) return "us";
  if (/欧洲|歐洲|欧盟|europe/i.test(query)) return "eu";
  if (/澳洲|澳大利亚|澳大利亞|australia/i.test(query)) return "au";
  return undefined;
}

export function splitDirectionDraft(raw: string): { complete: string[]; rest: string } {
  const parts = raw.split(/[,，、]/);
  if (parts.length <= 1) return { complete: [], rest: raw };
  return {
    complete: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? "",
  };
}

export function addDirections(current: string[], incoming: Iterable<string>): {
  directions: string[];
  atMax: boolean;
} {
  const next = [...current];
  for (const raw of incoming) {
    const name = String(raw || "").trim();
    if (!name || name.length > MAX_DIRECTION_CHARS) continue;
    if (next.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    if (next.length >= MAX_DIRECTIONS) break;
    next.push(name);
  }
  return { directions: next, atMax: next.length >= MAX_DIRECTIONS };
}

const QUERY_FILLER = /^(找|寻找|尋找|达人|達人|网红|網紅|博主|kol|请|請|一下)$/i;

export function keywordsFromQuery(query: string): string[] {
  return query
    .split(/[\s,，、]+/)
    .map((part) => part.trim())
    .filter((part) => part && !QUERY_FILLER.test(part));
}

export function emptyResultsHint(searchKeywords: string[]): string {
  const shown = searchKeywords.map((item) => String(item || "").trim()).filter(Boolean);
  if (!shown.length) return "这次计划没有找到红人线索，可换关键词再试。";
  return `按「${shown.slice(0, 2).join(" / ")}」没有找到线索，可换词再试。`;
}

/** Empty success copy: payload `empty_hint` / `search_keywords` only. Never invents terms. */
export function discoveryEmptyCopy(input: {
  empty_hint?: string | null;
  search_keywords?: string[];
  run?: { empty_hint?: string | null; search_keywords?: string[] } | null;
}): string {
  const hint = String(input.empty_hint || input.run?.empty_hint || "").trim();
  if (hint) return hint;
  const keywords = input.search_keywords?.length
    ? input.search_keywords
    : input.run?.search_keywords || [];
  return emptyResultsHint(keywords);
}

export function formatFollowers(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

/** Nickname only when it is not the same token as the handle. */
export function distinctNickname(row: Pick<CreatorCandidate, "handle" | "nickname">): string {
  const handle = String(row.handle || "").trim().replace(/^@/, "");
  const nickname = String(row.nickname || "").trim();
  if (!nickname) return "";
  const norm = (value: string) => value.replace(/^@/, "").toLowerCase();
  if (handle && norm(nickname) === norm(handle)) return "";
  return nickname;
}

/** Quiet meta: 粉丝 · 均播 · 匹配度 — platform is a chip, not a metric. */
export function candidateMetrics(row: CreatorCandidate): string {
  const bits = [
    formatFollowers(Number(row.followers || 0)),
    Number(row.avg_views_10) > 0 ? `均播 ${Math.round(Number(row.avg_views_10))}` : "",
    Number(row.score) > 0 ? `匹配度 ${row.score}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

const RESTATEMENT_STATUS = /^(待加入跟进|已加入跟进|已确认跟进|发现候选人|已忽略)$/;

function normalizeReasonToken(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function followerReasonVariants(followers: number): string[] {
  const formatted = formatFollowers(followers);
  if (!formatted) return [];
  const wan = followers >= 10000 ? `${Math.round(followers / 10000)}万` : "";
  return [
    formatted,
    `${formatted}粉`,
    String(Math.round(followers)),
    `${Math.round(followers)}粉`,
    wan,
    wan ? `${wan}粉` : "",
  ].filter(Boolean);
}

function isRestatementPart(part: string, row: CreatorCandidate): boolean {
  const text = part.trim();
  if (!text) return true;
  if (RESTATEMENT_STATUS.test(text)) return true;
  const handle = String(row.handle || "").trim().replace(/^@/, "");
  const nickname = String(row.nickname || "").trim();
  const platform = String(row.platform || "").trim();
  const score = Number(row.score || 0);
  const views = Number(row.avg_views_10 || 0);
  const known = [
    platform,
    platformLabel(platform),
    handle,
    handle ? `@${handle}` : "",
    nickname,
    nickname ? `@${nickname.replace(/^@/, "")}` : "",
    ...followerReasonVariants(Number(row.followers || 0)),
    score > 0 ? `评分 ${score}` : "",
    score > 0 ? `匹配度 ${score}` : "",
    score > 0 ? String(score) : "",
    views > 0 ? `近10均播 ${Math.round(views)}` : "",
    views > 0 ? `均播 ${Math.round(views)}` : "",
    views > 0 ? String(Math.round(views)) : "",
  ].filter(Boolean).map(normalizeReasonToken);
  const norm = normalizeReasonToken(text);
  if (known.includes(norm)) return true;
  if (score > 0 && /^(评分|匹配度|score)/i.test(norm)) {
    const parsed = Number(norm.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed) && Math.abs(parsed - score) < 0.051) return true;
  }
  if (Number(row.followers) > 0 && /(粉|followers?|k)$/i.test(text)) {
    const parsed = Number(text.replace(/[^\d.]/g, ""));
    const followers = Number(row.followers);
    if (
      Number.isFinite(parsed)
      && (parsed === followers
        || parsed === Math.round(followers / 1000)
        || parsed === Math.round(followers / 10000))
    ) {
      return true;
    }
  }
  return false;
}

function isRestatementBlob(text: string, row: CreatorCandidate): boolean {
  if (isRestatementPart(text, row)) return true;
  let leftover = normalizeReasonToken(text);
  const handle = String(row.handle || "").trim().replace(/^@/, "");
  const fragments = [
    String(row.platform || ""),
    platformLabel(row.platform),
    handle,
    handle ? `@${handle}` : "",
    String(row.nickname || ""),
    ...followerReasonVariants(Number(row.followers || 0)),
    Number(row.score) > 0 ? `评分${row.score}` : "",
    Number(row.score) > 0 ? `匹配度${row.score}` : "",
    Number(row.score) > 0 ? String(row.score) : "",
    Number(row.avg_views_10) > 0 ? `近10均播${Math.round(Number(row.avg_views_10))}` : "",
    Number(row.avg_views_10) > 0 ? `均播${Math.round(Number(row.avg_views_10))}` : "",
    "待加入跟进",
    "已加入跟进",
    "已确认跟进",
    "发现候选人",
    "已忽略",
  ].filter(Boolean).map(normalizeReasonToken).sort((a, b) => b.length - a.length);
  for (const fragment of fragments) {
    leftover = leftover.split(fragment).join("");
  }
  leftover = leftover.replace(/[·•|,./:\-@_]/g, "");
  return leftover.length === 0;
}

/** Match reason only when it is not a restatement of platform / handle / score / followers. */
export function candidateReason(row: CreatorCandidate): string {
  const signals = row.signals || {};
  const raw = String(row.reason || row.summary || signals.reason || signals.summary || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s*[·•|]\s*/).map((item) => item.trim()).filter(Boolean);
  const unique = parts.filter((part) => !isRestatementPart(part, row) && !isRestatementBlob(part, row));
  if (!unique.length) return "";
  const joined = unique.join(" · ");
  return isRestatementBlob(joined, row) ? "" : joined;
}

export function planSummary(request: DiscoveryRequest): string {
  const summary = String(request.plan_summary || request.title || "").trim();
  const suffix = "先确认计划，不会自动发信或改阶段。";
  if (summary) return summary.includes("不会自动") ? summary : `${summary}。${suffix}`;
  const query = request.keywords.join(" ") || "户外电源评测达人";
  const platforms = request.platforms.map(platformLabel).join(" / ");
  return `按「${query}」检索 · ${platforms}。${suffix}`;
}

export function planSteps(request: DiscoveryRequest): Array<{ id: string; label: string }> {
  return [
    { id: "scope", label: `按关键词「${request.keywords.join(" ") || "…"}」和平台缩小范围` },
    { id: "dedupe", label: "对照已跟进名单去掉重复对象" },
    { id: "review", label: "列出红人线索，收藏或确认后加入跟进" },
  ];
}

export async function createDiscoveryRequest(input: DiscoveryRequestInput): Promise<DiscoveryRequest> {
  const body = await api.createDiscoveryRequest({
    keywords: input.keywords,
    platforms: input.platforms,
    mode: input.mode || "search",
    filters: requestFilters(input.filters),
    brand: input.brand,
    scope: input.scope,
    start: false,
  });
  return asRequest(body);
}

export async function getDiscoveryRequest(id: string): Promise<DiscoveryRequest> {
  return asRequest(await api.discoveryRequest(id));
}

export async function getDiscoveryResults(id: string): Promise<DiscoveryResults> {
  return asResults(await api.discoveryResults(id));
}

export async function listDiscoveryRequests(): Promise<DiscoveryRequest[]> {
  const rows = await api.discoveryRequests();
  return (Array.isArray(rows) ? rows : []).map(asRequest);
}

export async function startDiscoveryRun(
  requestId: string,
  opts?: { platform?: string },
): Promise<DiscoveryRun> {
  return asRun(await api.startDiscoveryRun(requestId, {
    platform: opts?.platform,
  }));
}

export async function getDiscoveryRun(runId: string): Promise<DiscoveryRun> {
  return asRun(await api.discoveryRun(runId));
}

export function isDiscoveryTerminalStatus(status?: string | null): boolean {
  return DISCOVERY_TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

/** Terminal only when the run (or failed request without a run) has settled. Candidates alone are not done. */
export function isDiscoveryTerminal(results: Pick<DiscoveryResults, "run" | "status" | "request">): boolean {
  if (isDiscoveryTerminalStatus(results.run?.status)) return true;
  if (!results.run && isDiscoveryTerminalStatus(results.status || results.request?.status)) return true;
  return false;
}

export function discoveryRunStatusLabel(status?: string | null, fallback?: string | null): string {
  const key = String(status || "").toLowerCase();
  return String(fallback || "").trim() || DISCOVERY_RUN_STATUS_LABEL[key] || "检索中";
}

export function discoveryWaitTimeoutMs(): number {
  if (typeof window !== "undefined") {
    const override = Number((window as Window & { __discoveryWaitTimeoutMs?: number }).__discoveryWaitTimeoutMs);
    if (Number.isFinite(override) && override > 0) return override;
  }
  return DISCOVERY_WAIT_TIMEOUT_MS;
}

export type DiscoveryWaitResult =
  | { reason: "ready"; results: DiscoveryResults }
  | { reason: "timeout"; results: DiscoveryResults }
  | { reason: "cancelled" };

function sleep(ms: number, signal?: AbortSignal): Promise<"ok" | "cancelled"> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve("cancelled");
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve("ok");
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve("cancelled");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForDiscoveryResults(
  requestId: string,
  opts?: {
    timeoutMs?: number;
    delayMs?: number;
    signal?: AbortSignal;
    onUpdate?: (results: DiscoveryResults) => void;
  },
): Promise<DiscoveryWaitResult> {
  const timeoutMs = opts?.timeoutMs ?? discoveryWaitTimeoutMs();
  const delayMs = opts?.delayMs ?? DISCOVERY_WAIT_POLL_MS;
  const started = Date.now();
  let latest = await getDiscoveryResults(requestId);
  opts?.onUpdate?.(latest);
  while (!isDiscoveryTerminal(latest)) {
    if (opts?.signal?.aborted) return { reason: "cancelled" };
    if (Date.now() - started >= timeoutMs) return { reason: "timeout", results: latest };
    if (await sleep(delayMs, opts?.signal) === "cancelled") return { reason: "cancelled" };
    latest = await getDiscoveryResults(requestId);
    opts?.onUpdate?.(latest);
  }
  return { reason: "ready", results: latest };
}

export function readDiscoveryFavorites(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(DISCOVERY_FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.filter((id) => typeof id === "string" && id).map((id) => [id, true]));
    }
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, value]) => value === true),
      ) as Record<string, boolean>;
    }
  } catch {
    /* ignore quota / private mode / bad JSON */
  }
  return {};
}

export function writeDiscoveryFavorites(map: Record<string, boolean>): void {
  try {
    const ids = Object.entries(map).filter(([, on]) => on).map(([id]) => id);
    window.localStorage.setItem(DISCOVERY_FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota / private mode */
  }
}

function asFollowResult(body: unknown): DiscoveryFollowResult {
  const row = asRecord(body);
  return {
    ...asCandidate(body),
    collaboration: row.collaboration && typeof row.collaboration === "object"
      ? {
          id: String((row.collaboration as { id?: string }).id || ""),
          handle: String((row.collaboration as { handle?: string }).handle || ""),
          display_name: (row.collaboration as { display_name?: string }).display_name,
          platform: String((row.collaboration as { platform?: string }).platform || ""),
          brand: (row.collaboration as { brand?: string }).brand,
          stage_code: (row.collaboration as { stage_code?: string }).stage_code,
          kol_uid: (row.collaboration as { kol_uid?: string }).kol_uid,
          source: (row.collaboration as { source?: string }).source,
        }
      : undefined,
    created: Boolean(row.created),
    skipped_duplicate: Boolean(row.skipped_duplicate),
  };
}

export function parseFollowFilterInput(input: {
  min_followers?: string;
  min_avg_views_10?: string;
  min_score?: string;
}): FollowFilter | undefined {
  const out: FollowFilter = {};
  const followers = String(input.min_followers || "").trim();
  const avg = String(input.min_avg_views_10 || "").trim();
  const score = String(input.min_score || "").trim();
  if (followers) out.min_followers = Number(followers);
  if (avg) out.min_avg_views_10 = Number(avg);
  if (score) out.min_score = Number(score);
  const clean = Object.fromEntries(
    Object.entries(out).filter(([, value]) => Number.isFinite(value) && Number(value) >= 0),
  ) as FollowFilter;
  return Object.keys(clean).length ? clean : undefined;
}

export function candidateMatchesFollowFilter(
  candidate: CreatorCandidate,
  filter?: FollowFilter | null,
  plan?: { platforms?: string[]; region?: string },
): boolean {
  if (!filter && !plan) return true;
  const minFollowers = filter?.min_followers;
  const minAvg = filter?.min_avg_views_10;
  const minScore = filter?.min_score;
  if (minFollowers != null && Number(candidate.followers || 0) < minFollowers) return false;
  if (minAvg != null && Number(candidate.avg_views_10 || 0) < minAvg) return false;
  if (minScore != null && Number(candidate.score || 0) < minScore) return false;
  const wantPlatform = String(filter?.platform || (plan?.platforms?.length === 1 ? plan.platforms[0] : "") || "")
    .trim()
    .toLowerCase();
  const platform = String(candidate.platform || "").trim().toLowerCase();
  if (wantPlatform && platform && platform !== wantPlatform) return false;
  const wantRegion = String(filter?.region || plan?.region || "").trim().toLowerCase();
  const expected = wantRegion && wantRegion !== "all" ? wantRegion : "";
  const actual = String(candidate.region || "").trim().toLowerCase();
  if (expected && actual && actual !== expected) return false;
  return true;
}

export function missingContactEmail(candidate: CreatorCandidate): boolean {
  return !candidate.has_contact_email;
}

export function summarizeFollowFilter(filter?: FollowFilter | null): string {
  if (!filter) return "";
  const bits = [
    filter.min_followers != null ? `粉丝 ≥ ${filter.min_followers}` : "",
    filter.min_avg_views_10 != null ? `近10均播 ≥ ${filter.min_avg_views_10}` : "",
    filter.min_score != null ? `评分 ≥ ${filter.min_score}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export async function followCandidate(
  id: string,
  extra?: Record<string, unknown>,
): Promise<DiscoveryFollowResult> {
  return asFollowResult(await api.followDiscoveryCandidate(id, extra));
}

export async function followCandidatesBatch(input: {
  confirmed?: boolean;
  preview?: boolean;
  candidate_ids?: string[];
  request_id?: string;
  run_id?: string;
  filter?: FollowFilter;
  source_batch?: string;
}): Promise<DiscoveryFollowBatchResult> {
  const body = await api.followDiscoveryCandidatesBatch({
    confirmed: input.confirmed,
    preview: input.preview,
    candidate_ids: input.candidate_ids,
    request_id: input.request_id,
    run_id: input.run_id,
    filter: input.filter,
    source_batch: input.source_batch,
  });
  const row = asRecord(body);
  const counts = asRecord(row.counts);
  const failed = Array.isArray(row.failed)
    ? row.failed.map((item) => {
        const fail = asRecord(item);
        return {
          candidate_id: String(fail.candidate_id || fail.id || ""),
          handle: fail.handle ? String(fail.handle) : undefined,
          code: fail.code ? String(fail.code) : undefined,
          message: String(fail.message || "加入跟进没有完成。"),
        };
      })
    : [];
  const followed = (Array.isArray(row.followed) ? row.followed : []).map(asFollowResult);
  const skipped = (Array.isArray(row.skipped_duplicate) ? row.skipped_duplicate : []).map(asFollowResult);
  return {
    source_batch: row.source_batch ? String(row.source_batch) : undefined,
    confirmed: Boolean(row.confirmed),
    preview: Boolean(row.preview),
    followed,
    failed,
    skipped_duplicate: skipped,
    filter: row.filter && typeof row.filter === "object" ? row.filter as FollowFilter : null,
    counts: {
      selected: Number(counts.selected || 0),
      preview: Number(counts.preview || 0),
      followed: Number(counts.followed ?? followed.length),
      failed: Number(counts.failed ?? failed.length),
      skipped_duplicate: Number(counts.skipped_duplicate ?? skipped.length),
      missing_email: Number(counts.missing_email || 0),
    },
    message: row.message ? String(row.message) : undefined,
    sent: Boolean(row.sent),
    stage_changed: Boolean(row.stage_changed),
  };
}

export async function dismissCandidate(id: string): Promise<CreatorCandidate> {
  return asCandidate(await api.dismissDiscoveryCandidate(id));
}

export async function checkDiscoveryConnection(): Promise<DiscoveryConnection> {
  return asConnection(await api.checkDiscoveryConnection()) || {
    status: "unchecked",
    credentials_present: false,
    reachable: null,
    connected: null,
    checked_at: null,
    message: "采集服务待检查",
  };
}
