/**
 * Home AI发现 client — field shapes match PR #63
 * (`backend/src/discovery.ts`, `backend/src/routers/discovery.ts`,
 * `docs/evidence-ai-discovery-backend-2026-09-14.md`).
 *
 * Wire: POST /api/discovery/requests (`start:false` = plan only),
 * POST /requests/:id/runs, GET /runs/:id, GET /runs/:id/candidates,
 * POST /candidates/:id/follow | dismiss.
 *
 * Mock fallback when those routes are absent (404/503). The mock never
 * starts crawl, send, or stage write. Swapping to a live backend is a
 * client change, not a panel rewrite.
 */

export type DiscoveryPlatform = "youtube" | "instagram" | "facebook";
export type DiscoveryMode = "search" | "detail" | "creator";
export type DiscoveryRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type CreatorCandidateStatus = "suggested" | "dismissed" | "followed";
export type DiscoveryPhase = "idle" | "plan" | "running" | "results" | "error";
export type DiscoveryRegion = "all" | "na" | "eu" | "sea";

export type DiscoveryFilters = {
  region?: DiscoveryRegion | string;
  niche?: string;
  [key: string]: unknown;
};

export type DiscoveryRequestInput = {
  keywords: string[];
  platforms: DiscoveryPlatform[];
  mode?: DiscoveryMode;
  filters?: DiscoveryFilters;
  brand?: string;
  scope?: Record<string, unknown>;
  start?: boolean;
};

export type CreatorCandidate = {
  id: string;
  request_id: string;
  run_id: string;
  platform: string;
  platform_creator_id: string;
  claw_creator_id?: string | null;
  handle: string;
  nickname: string;
  followers: number;
  score: number;
  signals: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: CreatorCandidateStatus;
  collaboration_id: string | null;
  dismissed_at: string | null;
  followed_at: string | null;
  created_at: string;
  updated_at: string;
  insight: boolean;
  contact_needed: boolean;
};

export type DiscoveryResult = {
  candidate_count: number;
  suggested_count: number;
  followed_count: number;
  dismissed_count: number;
  top_candidates: CreatorCandidate[];
  errors: string[];
  ready: boolean;
  source: "ai";
  pending_confirm: true;
};

export type DiscoveryRun = {
  id: string;
  request_id: string;
  crawl_job_id: string | null;
  work_item_id: string | null;
  platform: string;
  mode: string;
  parameters: Record<string, unknown>;
  remote_task_id: string | null;
  status: DiscoveryRunStatus;
  error: string | null;
  candidate_count: number;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
  result?: DiscoveryResult;
  duplicate?: boolean;
};

export type DiscoveryRequest = {
  id: string;
  owner_user_id?: string;
  keywords: string[];
  platforms: string[];
  mode: string;
  filters: DiscoveryFilters;
  brand: string | null;
  scope: Record<string, unknown>;
  status: string;
  error: string | null;
  latest_run: DiscoveryRun | null;
  result: DiscoveryResult;
  created_at: string;
  updated_at: string;
};

export type DiscoveryCandidatePage = {
  items: CreatorCandidate[];
  total: number;
  limit: number;
  offset: number;
  run: DiscoveryRun;
};

export type DiscoveryFollowResult = CreatorCandidate & {
  collaboration: {
    id: string;
    handle: string;
    display_name: string;
    platform: string;
    brand: string;
    stage_code: string;
    kol_uid: string;
    source: "discovery";
  };
  created: boolean;
};

export const OVERSEAS_DISCOVERY_PLATFORMS: DiscoveryPlatform[] = ["youtube", "instagram", "facebook"];

export const DISCOVERY_BANNED_JARGON = [
  "MCP",
  "Codex",
  "MediaCrawler",
  "Harness",
  "crawl_plan",
  "Thread",
] as const;

const PLATFORM_LABEL: Record<DiscoveryPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};

const REGION_LABEL: Record<DiscoveryRegion, string> = {
  all: "不限地区",
  na: "北美",
  eu: "欧洲",
  sea: "东南亚",
};

const REGION_NAME: Record<string, string> = {
  na: "北美",
  eu: "欧洲",
  sea: "东南亚",
};

type MockSeed = {
  id: string;
  platform: DiscoveryPlatform;
  platform_creator_id: string;
  handle: string;
  nickname: string;
  followers: number;
  score: number;
  region: string;
  niche: string;
  reason: string;
};

const MOCK_POOL: MockSeed[] = [
  {
    id: "disc_trailpower",
    platform: "youtube",
    platform_creator_id: "UC_trailpower",
    handle: "trailpower_reviews",
    nickname: "TrailPower Reviews",
    followers: 182000,
    score: 0.86,
    region: "北美",
    niche: "户外电源",
    reason: "近期多条电源续航评测，受众和品牌接近。",
  },
  {
    id: "disc_camp_lab",
    platform: "instagram",
    platform_creator_id: "ig_camp_lab",
    handle: "camp_lantern_lab",
    nickname: "Camp Lantern Lab",
    followers: 64000,
    score: 0.74,
    region: "北美",
    niche: "露营装备",
    reason: "露营灯和便携电源搭配内容多，适合先收藏。",
  },
  {
    id: "disc_vanlife",
    platform: "youtube",
    platform_creator_id: "UC_vanlife",
    handle: "vanlife_battery",
    nickname: "Vanlife Battery",
    followers: 91000,
    score: 0.71,
    region: "欧洲",
    niche: "房车电源",
    reason: "房车电路讲解清楚，可确认后再加入跟进。",
  },
  {
    id: "disc_fb_pack",
    platform: "facebook",
    platform_creator_id: "fb_sea_pack",
    handle: "sea_trek_power",
    nickname: "Sea Trek Power",
    followers: 210000,
    score: 0.68,
    region: "东南亚",
    niche: "户外电源",
    reason: "短视频评测节奏快，适合作为新候选人对照。",
  },
];

const mockRequests = new Map<string, DiscoveryRequest>();
const mockRuns = new Map<string, DiscoveryRun>();
const mockCandidates = new Map<string, CreatorCandidate[]>();

function nowIso(): string {
  return new Date().toISOString();
}

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function emptyResult(): DiscoveryResult {
  return {
    candidate_count: 0,
    suggested_count: 0,
    followed_count: 0,
    dismissed_count: 0,
    top_candidates: [],
    errors: [],
    ready: false,
    source: "ai",
    pending_confirm: true,
  };
}

function resultFrom(items: CreatorCandidate[]): DiscoveryResult {
  const suggested = items.filter((row) => row.status === "suggested");
  return {
    candidate_count: items.length,
    suggested_count: suggested.length,
    followed_count: items.filter((row) => row.status === "followed").length,
    dismissed_count: items.filter((row) => row.status === "dismissed").length,
    top_candidates: suggested.slice(0, 8),
    errors: [],
    ready: suggested.length > 0,
    source: "ai",
    pending_confirm: true,
  };
}

export function platformLabel(value: string): string {
  return PLATFORM_LABEL[value as DiscoveryPlatform] || value;
}

export function regionLabel(value: string): string {
  return REGION_LABEL[value as DiscoveryRegion] || value;
}

export function keywordsFromQuery(query: string): string[] {
  return query
    .split(/[\s,，、]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function candidateReason(row: CreatorCandidate): string {
  const signals = row.signals || {};
  const payload = row.payload || {};
  return String(signals.reason || payload.reason || signals.summary || "").trim();
}

function matchesSeed(seed: MockSeed, request: DiscoveryRequest): boolean {
  if (request.platforms.length && !request.platforms.includes(seed.platform)) return false;
  const region = String(request.filters.region || "all");
  if (region !== "all" && seed.region !== (REGION_NAME[region] || region)) return false;
  const niche = String(request.filters.niche || "").trim();
  const hay = `${seed.handle} ${seed.nickname} ${seed.niche} ${seed.reason} ${request.keywords.join(" ")}`.toLowerCase();
  const needles = [...request.keywords, niche].map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return true;
  return needles.every((needle) => hay.includes(needle) || hay.includes(needle.replace(/达人|红人|评测/g, "")));
}

function toCandidate(seed: MockSeed, request: DiscoveryRequest, runId: string): CreatorCandidate {
  const stamp = nowIso();
  return {
    id: seed.id,
    request_id: request.id,
    run_id: runId,
    platform: seed.platform,
    platform_creator_id: seed.platform_creator_id,
    claw_creator_id: null,
    handle: seed.handle,
    nickname: seed.nickname,
    followers: seed.followers,
    score: seed.score,
    signals: { reason: seed.reason, region: seed.region, niche: seed.niche },
    payload: { origin: "discovery" },
    status: "suggested",
    collaboration_id: null,
    dismissed_at: null,
    followed_at: null,
    created_at: stamp,
    updated_at: stamp,
    insight: true,
    contact_needed: true,
  };
}

function buildMockRequest(input: DiscoveryRequestInput): DiscoveryRequest {
  const stamp = nowIso();
  const keywords = input.keywords.filter(Boolean);
  const platforms = (input.platforms.length ? input.platforms : ["youtube"]) as DiscoveryPlatform[];
  return {
    id: nid("dreq"),
    owner_user_id: "usr_sriphy",
    keywords,
    platforms,
    mode: input.mode || "search",
    filters: input.filters || {},
    brand: input.brand || null,
    scope: input.scope || {},
    status: "open",
    error: null,
    latest_run: null,
    result: emptyResult(),
    created_at: stamp,
    updated_at: stamp,
  };
}

export function planSummary(request: DiscoveryRequest): string {
  const query = request.keywords.join(" ") || "户外电源评测达人";
  const platforms = request.platforms.map(platformLabel).join(" / ");
  const region = regionLabel(String(request.filters.region || "all"));
  const niche = String(request.filters.niche || "").trim();
  return `按「${query}」检索${niche ? ` · ${niche}` : ""} · ${platforms} · ${region}。先确认计划，不会自动发信或改阶段。`;
}

export function planSteps(request: DiscoveryRequest): Array<{ id: string; label: string }> {
  return [
    { id: "scope", label: `按关键词「${request.keywords.join(" ") || "…"}」和平台缩小范围` },
    { id: "dedupe", label: "对照已跟进名单去掉重复对象" },
    { id: "review", label: "列出候选人，收藏或确认后加入跟进" },
  ];
}

type LiveOk<T> = { ok: true; status: number; body: T };
type LiveMiss = { ok: false; status: number; body?: unknown };

async function tryLive<T>(path: string, init?: RequestInit): Promise<LiveOk<T> | LiveMiss> {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 || response.status === 501 || response.status === 502 || response.status === 503) {
      return { ok: false, status: response.status, body };
    }
    if (!response.ok) return { ok: false, status: response.status, body };
    return { ok: true, status: response.status, body: body as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

function liveErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const row = body as { message?: string; detail?: string; code?: string };
    if (row.message) return String(row.message);
    if (typeof row.detail === "string") return row.detail;
  }
  return fallback;
}

export async function createDiscoveryRequest(input: DiscoveryRequestInput): Promise<DiscoveryRequest> {
  const payload = {
    keywords: input.keywords,
    platforms: input.platforms,
    mode: input.mode || "search",
    filters: input.filters || {},
    brand: input.brand,
    scope: input.scope || {},
    start: false,
  };
  const live = await tryLive<DiscoveryRequest>("/api/discovery/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (live.ok && live.body.id) {
    mockRequests.set(live.body.id, live.body);
    return live.body;
  }
  if (live.status === 400) {
    throw new Error(liveErrorMessage(live.body, "发现条件不完整。"));
  }
  await sleep(120);
  const request = buildMockRequest({ ...input, start: false });
  mockRequests.set(request.id, request);
  return request;
}

export async function startDiscoveryRun(
  requestId: string,
  opts?: { platform?: string },
): Promise<DiscoveryRun> {
  const live = await tryLive<DiscoveryRun>(`/api/discovery/requests/${encodeURIComponent(requestId)}/runs`, {
    method: "POST",
    body: JSON.stringify({ platform: opts?.platform, live: false }),
  });
  if (live.ok && live.body.id) {
    mockRuns.set(live.body.id, live.body);
    return live.body;
  }
  await sleep(420);
  const request = mockRequests.get(requestId) || buildMockRequest({
    keywords: ["户外电源"],
    platforms: ["youtube"],
  });
  const stamp = nowIso();
  const runId = nid("drun");
  const items = MOCK_POOL.filter((seed) => matchesSeed(seed, request)).map((seed) => toCandidate(seed, request, runId));
  const source = items.length ? items : MOCK_POOL.map((seed) => toCandidate(seed, request, runId));
  const result = resultFrom(source);
  const run: DiscoveryRun = {
    id: runId,
    request_id: request.id,
    crawl_job_id: null,
    work_item_id: null,
    platform: opts?.platform || request.platforms[0] || "youtube",
    mode: request.mode,
    parameters: { keywords: request.keywords, filters: request.filters },
    remote_task_id: null,
    status: "succeeded",
    error: null,
    candidate_count: source.length,
    created_at: stamp,
    started_at: stamp,
    updated_at: stamp,
    completed_at: stamp,
    result,
  };
  mockRuns.set(run.id, run);
  mockCandidates.set(run.id, source);
  request.latest_run = run;
  request.result = result;
  request.status = "completed";
  request.updated_at = stamp;
  mockRequests.set(request.id, request);
  return run;
}

export async function getDiscoveryRun(runId: string): Promise<DiscoveryRun> {
  const live = await tryLive<DiscoveryRun>(`/api/discovery/runs/${encodeURIComponent(runId)}`);
  if (live.ok && live.body.id) return live.body;
  const mock = mockRuns.get(runId);
  if (mock) return mock;
  throw new Error("未找到该发现运行");
}

export async function listRunCandidates(
  runId: string,
  query?: { status?: string; limit?: number; offset?: number },
): Promise<DiscoveryCandidatePage> {
  const search = new URLSearchParams();
  if (query?.status) search.set("status", query.status);
  if (query?.limit) search.set("limit", String(query.limit));
  if (query?.offset) search.set("offset", String(query.offset));
  const qs = search.size ? `?${search}` : "";
  const live = await tryLive<DiscoveryCandidatePage>(
    `/api/discovery/runs/${encodeURIComponent(runId)}/candidates${qs}`,
  );
  if (live.ok && Array.isArray(live.body.items)) return live.body;
  const items = mockCandidates.get(runId) || [];
  const run = mockRuns.get(runId);
  if (!run) {
    throw new Error("未找到该发现运行");
  }
  const status = query?.status;
  const filtered = status ? items.filter((row) => row.status === status) : items;
  const limit = query?.limit || 20;
  const offset = query?.offset || 0;
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
    run,
  };
}

export async function followCandidate(id: string): Promise<DiscoveryFollowResult> {
  const live = await tryLive<DiscoveryFollowResult>(
    `/api/discovery/candidates/${encodeURIComponent(id)}/follow`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (live.ok && live.body.id) return live.body;
  const stamp = nowIso();
  for (const [runId, rows] of mockCandidates) {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) continue;
    const current = rows[index];
    const next: CreatorCandidate = {
      ...current,
      status: "followed",
      followed_at: current.followed_at || stamp,
      updated_at: stamp,
      insight: false,
    };
    rows[index] = next;
    mockCandidates.set(runId, rows);
    return {
      ...next,
      collaboration: {
        id: `col_mock_${id}`,
        handle: next.handle,
        display_name: next.nickname,
        platform: next.platform,
        brand: "LT",
        stage_code: "INITIAL_CONTACT",
        kol_uid: `disc_${next.platform}_${next.platform_creator_id}`,
        source: "discovery",
      },
      created: true,
    };
  }
  throw new Error("未找到该发现候选人");
}

export async function dismissCandidate(id: string): Promise<CreatorCandidate> {
  const live = await tryLive<CreatorCandidate>(
    `/api/discovery/candidates/${encodeURIComponent(id)}/dismiss`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (live.ok && live.body.id) return live.body;
  const stamp = nowIso();
  for (const [runId, rows] of mockCandidates) {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) continue;
    const current = rows[index];
    if (current.status === "followed") throw new Error("已跟进的候选人不能驳回。");
    const next: CreatorCandidate = {
      ...current,
      status: "dismissed",
      dismissed_at: current.dismissed_at || stamp,
      updated_at: stamp,
      insight: false,
    };
    rows[index] = next;
    mockCandidates.set(runId, rows);
    return next;
  }
  throw new Error("未找到该发现候选人");
}
