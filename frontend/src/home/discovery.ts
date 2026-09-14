/**
 * Wire-ready Home discovery contracts.
 * Backend discovery is out of scope; this module falls back to a local mock
 * that never triggers LIVE send / stage / crawl side effects.
 */

export type DiscoveryPlatform = "all" | "youtube" | "instagram" | "tiktok";
export type DiscoveryRegion = "all" | "na" | "eu" | "sea";
export type DiscoveryPhase = "idle" | "plan" | "running" | "results" | "error";

export type DiscoveryFilters = {
  platform: DiscoveryPlatform;
  region: DiscoveryRegion;
  niche: string;
};

export type DiscoveryPlanStep = {
  id: string;
  label: string;
};

export type DiscoveryPlan = {
  id: string;
  query: string;
  filters: DiscoveryFilters;
  summary: string;
  steps: DiscoveryPlanStep[];
  estimated_candidates: number;
  live: false;
  side_effects: "none";
};

export type DiscoveryRun = {
  id: string;
  plan_id: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  live: false;
};

export type DiscoveryCandidate = {
  id: string;
  handle: string;
  display_name: string;
  platform: string;
  niche: string;
  region: string;
  followers: number;
  reason: string;
  favorited: boolean;
  follow_requested: boolean;
  origin: "discovery";
};

export type DiscoveryFollowResult = {
  ok: true;
  candidate_id: string;
  live: false;
  added_to_followed: false;
};

export const DISCOVERY_BANNED_JARGON = [
  "MCP",
  "Codex",
  "MediaCrawler",
  "Harness",
  "crawl_plan",
  "Thread",
] as const;

const PLATFORM_LABEL: Record<DiscoveryPlatform, string> = {
  all: "不限平台",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const REGION_LABEL: Record<DiscoveryRegion, string> = {
  all: "不限地区",
  na: "北美",
  eu: "欧洲",
  sea: "东南亚",
};

const MOCK_POOL: Array<Omit<DiscoveryCandidate, "favorited" | "follow_requested" | "origin">> = [
  {
    id: "disc_trailpower",
    handle: "trailpower_reviews",
    display_name: "TrailPower Reviews",
    platform: "YouTube",
    niche: "户外电源",
    region: "北美",
    followers: 182000,
    reason: "近期多条电源续航评测，受众和品牌接近。",
  },
  {
    id: "disc_camp_lab",
    handle: "camp_lantern_lab",
    display_name: "Camp Lantern Lab",
    platform: "Instagram",
    niche: "露营装备",
    region: "北美",
    followers: 64000,
    reason: "露营灯和便携电源搭配内容多，适合先收藏。",
  },
  {
    id: "disc_vanlife",
    handle: "vanlife_battery",
    display_name: "Vanlife Battery",
    platform: "YouTube",
    niche: "房车电源",
    region: "欧洲",
    followers: 91000,
    reason: "房车电路讲解清楚，可确认后再加入跟进。",
  },
  {
    id: "disc_sea_trek",
    handle: "sea_trek_power",
    display_name: "Sea Trek Power",
    platform: "TikTok",
    niche: "户外电源",
    region: "东南亚",
    followers: 210000,
    reason: "短视频评测节奏快，适合作为新候选人对照。",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeFilters(filters?: Partial<DiscoveryFilters>): DiscoveryFilters {
  return {
    platform: filters?.platform || "all",
    region: filters?.region || "all",
    niche: String(filters?.niche || "").trim(),
  };
}

function matchesFilters(
  row: (typeof MOCK_POOL)[number],
  filters: DiscoveryFilters,
  query: string,
): boolean {
  if (filters.platform !== "all" && row.platform.toLowerCase() !== filters.platform) return false;
  if (filters.region !== "all") {
    const regionMap: Record<DiscoveryRegion, string> = { all: "", na: "北美", eu: "欧洲", sea: "东南亚" };
    if (row.region !== regionMap[filters.region]) return false;
  }
  const hay = `${row.handle} ${row.display_name} ${row.niche} ${row.reason} ${query} ${filters.niche}`.toLowerCase();
  const needles = [query, filters.niche].map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return true;
  return needles.every((needle) => hay.includes(needle) || hay.includes(needle.replace(/达人|红人|评测/g, "")));
}

export function platformLabel(value: DiscoveryPlatform): string {
  return PLATFORM_LABEL[value];
}

export function regionLabel(value: DiscoveryRegion): string {
  return REGION_LABEL[value];
}

export function buildDiscoveryPlan(query: string, filters?: Partial<DiscoveryFilters>): DiscoveryPlan {
  const nextFilters = normalizeFilters(filters);
  const text = query.trim() || "户外电源评测达人";
  const estimated = MOCK_POOL.filter((row) => matchesFilters(row, nextFilters, text)).length || MOCK_POOL.length;
  return {
    id: `dplan_${Date.now().toString(36)}`,
    query: text,
    filters: nextFilters,
    summary: `按「${text}」检索${nextFilters.niche ? ` · ${nextFilters.niche}` : ""} · ${platformLabel(nextFilters.platform)} · ${regionLabel(nextFilters.region)}。先确认计划，不会自动发信或改阶段。`,
    steps: [
      { id: "scope", label: "按关键词、平台和地区缩小范围" },
      { id: "dedupe", label: "对照已跟进名单去掉重复对象" },
      { id: "review", label: "列出候选人，收藏或确认后加入跟进" },
    ],
    estimated_candidates: estimated,
    live: false,
    side_effects: "none",
  };
}

export function mockDiscoveryCandidates(plan: DiscoveryPlan): DiscoveryCandidate[] {
  const matched = MOCK_POOL.filter((row) => matchesFilters(row, plan.filters, plan.query));
  const source = matched.length ? matched : MOCK_POOL;
  return source.map((row) => ({
    ...row,
    favorited: false,
    follow_requested: false,
    origin: "discovery" as const,
  }));
}

async function tryLive<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function requestDiscoveryPlan(query: string, filters?: Partial<DiscoveryFilters>): Promise<DiscoveryPlan> {
  const body = { query: query.trim(), filters: normalizeFilters(filters), live: false };
  const live = await tryLive<DiscoveryPlan>("/api/discovery/plans", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (live?.id && live.live === false) return { ...live, live: false, side_effects: "none" };
  await sleep(160);
  return buildDiscoveryPlan(query, filters);
}

export async function startDiscoveryRun(plan: DiscoveryPlan): Promise<DiscoveryRun> {
  const live = await tryLive<DiscoveryRun>("/api/discovery/runs", {
    method: "POST",
    body: JSON.stringify({ plan_id: plan.id, live: false }),
  });
  if (live?.id) return { ...live, live: false };
  await sleep(420);
  return {
    id: `drun_${plan.id}`,
    plan_id: plan.id,
    status: "completed",
    live: false,
  };
}

export async function loadDiscoveryCandidates(run: DiscoveryRun, plan: DiscoveryPlan): Promise<DiscoveryCandidate[]> {
  const live = await tryLive<{ candidates?: DiscoveryCandidate[] }>(`/api/discovery/runs/${encodeURIComponent(run.id)}`);
  if (Array.isArray(live?.candidates)) {
    return live.candidates.map((row) => ({
      ...row,
      origin: "discovery" as const,
      favorited: Boolean(row.favorited),
      follow_requested: Boolean(row.follow_requested),
    }));
  }
  return mockDiscoveryCandidates(plan);
}

export async function favoriteDiscoveryCandidate(id: string, next: boolean): Promise<{ ok: true; live: false }> {
  await tryLive(`/api/discovery/candidates/${encodeURIComponent(id)}/favorite`, {
    method: "POST",
    body: JSON.stringify({ favorited: next, live: false }),
  });
  return { ok: true, live: false };
}

export async function followDiscoveryCandidate(id: string, confirm: true): Promise<DiscoveryFollowResult> {
  if (!confirm) {
    throw new Error("加入跟进需要确认");
  }
  const live = await tryLive<DiscoveryFollowResult>(`/api/discovery/candidates/${encodeURIComponent(id)}/follow`, {
    method: "POST",
    body: JSON.stringify({ confirm: true, live: false }),
  });
  if (live?.ok) {
    return { ok: true, candidate_id: id, live: false, added_to_followed: false };
  }
  return { ok: true, candidate_id: id, live: false, added_to_followed: false };
}
