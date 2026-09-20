/**
 * Home AI发现 requirement template (design §3).
 * GET /api/home/discovery/template when present; otherwise this fallback.
 * Platforms are overseas only. Chips and Composer body stay in sync.
 */

export const DISCOVERY_INTENT = "creator_discovery";
export const DISCOVERY_LOCK_LABEL = "发现任务";
export const DISCOVERY_BODY_PREFIX = "【发现任务】";
export const DISCOVERY_NO_SIDE_EFFECT =
  "只检索红人线索。不会发信、不会改阶段、不会编造邮箱。";
export const DISCOVERY_CHIP_OVERRIDE_HINT = "已用芯片覆盖";
export const DISCOVERY_BRIEF_VERSION = "discovery-brief.v1";
export const MAX_DISCOVERY_DIRECTIONS = 8;

export type DiscoveryPlatformCode = "youtube" | "instagram" | "facebook";
export type DiscoveryRegionCode = "na" | "eu" | "sea" | "jpkr" | "mena" | "latam" | "global_en";
export type DiscoveryDirectionCode =
  | "camping"
  | "vanlife"
  | "portable_power"
  | "road_trip"
  | "off_grid"
  | "backup_power"
  | "camp_gear"
  | "boat_life";

export type DiscoveryOption<T extends string = string> = {
  code: T;
  label: string;
  keywords?: string[];
};

export type DiscoveryBrief = {
  platforms: DiscoveryPlatformCode[];
  region: DiscoveryRegionCode;
  directions: DiscoveryDirectionCode[];
  keywords: string[];
  min_followers: number;
  max_followers: number;
  min_avg_plays_10: number;
  expect_count: number;
};

export type DiscoveryTemplate = {
  version: string;
  platforms: Array<DiscoveryOption<DiscoveryPlatformCode>>;
  regions: Array<DiscoveryOption<DiscoveryRegionCode>>;
  directions: Array<DiscoveryOption<DiscoveryDirectionCode>>;
  thresholds: {
    min_followers: number;
    max_followers: number;
    min_avg_plays_10: number;
    expect_count: number;
  };
  defaults: DiscoveryBrief;
  body: string;
  source: "api" | "fallback";
};

export const OVERSEAS_DISCOVERY_PLATFORMS: Array<DiscoveryOption<DiscoveryPlatformCode>> = [
  { code: "youtube", label: "YouTube" },
  { code: "instagram", label: "Instagram" },
  { code: "facebook", label: "Facebook" },
];

export const DISCOVERY_REGION_OPTIONS: Array<DiscoveryOption<DiscoveryRegionCode>> = [
  { code: "na", label: "北美" },
  { code: "eu", label: "欧洲" },
  { code: "sea", label: "东南亚" },
  { code: "jpkr", label: "日韩" },
  { code: "mena", label: "中东非" },
  { code: "latam", label: "拉美" },
  { code: "global_en", label: "全球英文" },
];

export const DISCOVERY_DIRECTION_PACKS: Array<DiscoveryOption<DiscoveryDirectionCode>> = [
  { code: "camping", label: "户外露营", keywords: ["camping", "outdoor camping", "camping gear"] },
  { code: "vanlife", label: "房车", keywords: ["van life", "RV travel", "RV living"] },
  { code: "portable_power", label: "户外能源", keywords: ["portable power station", "solar generator", "energy storage"] },
  { code: "road_trip", label: "自驾旅行", keywords: ["road trip", "overland travel", "car camping"] },
  { code: "off_grid", label: "离网生活", keywords: ["off grid living", "off grid solar", "homestead power"] },
  { code: "backup_power", label: "应急备电", keywords: ["backup power", "power outage prep", "emergency power"] },
  { code: "camp_gear", label: "露营装备", keywords: ["camping equipment", "outdoor gear review", "camp kitchen"] },
  { code: "boat_life", label: "船用生活", keywords: ["boat life", "marine power", "sailboat living"] },
];

export const DEFAULT_DISCOVERY_THRESHOLDS = {
  min_followers: 10_000,
  max_followers: 2_000_000,
  min_avg_plays_10: 5_000,
  expect_count: 30,
} as const;

const DOMESTIC_PLATFORM = /^(douyin|dy|xhs|xiaohongshu|rednote|kuaishou|ks|bili|bilibili|weibo|wb|tieba|zhihu)$/i;

export function isDomesticPlatform(code: string): boolean {
  return DOMESTIC_PLATFORM.test(String(code || "").trim());
}

export function defaultDiscoveryBrief(): DiscoveryBrief {
  return {
    platforms: ["youtube"],
    region: "global_en",
    directions: [],
    keywords: ["camping", "portable power station"],
    ...DEFAULT_DISCOVERY_THRESHOLDS,
  };
}

export function fallbackDiscoveryTemplate(): DiscoveryTemplate {
  const defaults = defaultDiscoveryBrief();
  return {
    version: DISCOVERY_BRIEF_VERSION,
    platforms: OVERSEAS_DISCOVERY_PLATFORMS,
    regions: DISCOVERY_REGION_OPTIONS,
    directions: DISCOVERY_DIRECTION_PACKS,
    thresholds: { ...DEFAULT_DISCOVERY_THRESHOLDS },
    defaults,
    body: renderDiscoveryBody(defaults),
    source: "fallback",
  };
}

export function platformLabel(code: string, options = OVERSEAS_DISCOVERY_PLATFORMS): string {
  return options.find((row) => row.code === code)?.label || code;
}

export function regionLabel(code: string, options = DISCOVERY_REGION_OPTIONS): string {
  return options.find((row) => row.code === code)?.label || code;
}

export function directionPack(code: string, options = DISCOVERY_DIRECTION_PACKS) {
  return options.find((row) => row.code === code);
}

export function directionLabel(code: string, options = DISCOVERY_DIRECTION_PACKS): string {
  return directionPack(code, options)?.label || code;
}

export function keywordsForDirections(
  codes: string[],
  options = DISCOVERY_DIRECTION_PACKS,
): string[] {
  const next: string[] = [];
  for (const code of codes) {
    for (const word of directionPack(code, options)?.keywords || []) {
      if (!next.some((item) => item.toLowerCase() === word.toLowerCase())) next.push(word);
    }
  }
  return next;
}

export function canSubmitDiscovery(brief: Pick<DiscoveryBrief, "platforms" | "keywords">): boolean {
  return brief.platforms.length > 0 && brief.keywords.some((word) => String(word || "").trim());
}

export function renderDiscoveryBody(
  brief: DiscoveryBrief,
  catalog?: Pick<DiscoveryTemplate, "platforms" | "regions" | "directions">,
): string {
  const platforms = catalog?.platforms || OVERSEAS_DISCOVERY_PLATFORMS;
  const regions = catalog?.regions || DISCOVERY_REGION_OPTIONS;
  const directions = catalog?.directions || DISCOVERY_DIRECTION_PACKS;
  const platformLine = brief.platforms.length
    ? brief.platforms.map((code) => platformLabel(code, platforms)).join(" / ")
    : "（未选）";
  const directionLine = brief.directions.length
    ? brief.directions.map((code) => directionLabel(code, directions)).join("、")
    : "（未选）";
  const keywordLine = brief.keywords.length ? brief.keywords.join(", ") : "（未填）";
  return [
    DISCOVERY_BODY_PREFIX,
    `平台：${platformLine}`,
    `地区：${regionLabel(brief.region, regions)}`,
    `方向：${directionLine}`,
    `关键词：${keywordLine}`,
    `粉丝：${brief.min_followers}–${brief.max_followers}`,
    `近10条均播 ≥ ${brief.min_avg_plays_10}`,
    `期望人数：${brief.expect_count}`,
    "",
    DISCOVERY_NO_SIDE_EFFECT,
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,，、/\s]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function clampDirections(
  codes: string[],
  options: Array<DiscoveryOption> = DISCOVERY_DIRECTION_PACKS,
): DiscoveryDirectionCode[] {
  const allowed = new Set<string>([
    ...DISCOVERY_DIRECTION_PACKS.map((row) => row.code),
    ...options.map((row) => row.code),
  ]);
  const next: DiscoveryDirectionCode[] = [];
  for (const raw of codes) {
    const code = String(raw || "").trim() as DiscoveryDirectionCode;
    if (!allowed.has(code) || next.includes(code)) continue;
    if (next.length >= MAX_DISCOVERY_DIRECTIONS) break;
    next.push(code);
  }
  return next;
}

function clampPlatforms(codes: string[]): DiscoveryPlatformCode[] {
  const allowed = new Set(OVERSEAS_DISCOVERY_PLATFORMS.map((row) => row.code));
  const next: DiscoveryPlatformCode[] = [];
  for (const raw of codes) {
    const code = String(raw || "").trim().toLowerCase() as DiscoveryPlatformCode;
    if (isDomesticPlatform(code) || !allowed.has(code) || next.includes(code)) continue;
    next.push(code);
  }
  return next;
}

function clampRegion(value: string | undefined, fallback: DiscoveryRegionCode = "na"): DiscoveryRegionCode {
  const allowed = new Set(DISCOVERY_REGION_OPTIONS.map((row) => row.code));
  const code = String(value || "").trim() as DiscoveryRegionCode;
  return allowed.has(code) ? code : fallback;
}

function parseNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function parseDiscoveryBody(text: string): Partial<DiscoveryBrief> {
  const lines = String(text || "").split(/\r?\n/);
  const out: Partial<DiscoveryBrief> = {};
  for (const line of lines) {
    const platform = line.match(/^\s*平台[：:]\s*(.+)\s*$/);
    if (platform) {
      const tokens = platform[1]
        .split(/[/、,，]/)
        .map((item) => item.trim())
        .filter((item) => item && item !== "（未选）");
      const codes = tokens.map((token) => {
        const hit = OVERSEAS_DISCOVERY_PLATFORMS.find((row) => (
          row.code === token.toLowerCase() || row.label.toLowerCase() === token.toLowerCase()
        ));
        return hit?.code || token.toLowerCase();
      });
      out.platforms = clampPlatforms(codes);
      continue;
    }
    const region = line.match(/^\s*地区[：:]\s*(.+)\s*$/);
    if (region) {
      const token = region[1].trim();
      const hit = DISCOVERY_REGION_OPTIONS.find((row) => row.code === token || row.label === token);
      if (hit) out.region = hit.code;
      continue;
    }
    const direction = line.match(/^\s*方向[：:]\s*(.+)\s*$/);
    if (direction) {
      const tokens = direction[1]
        .split(/[、,/，]/)
        .map((item) => item.trim())
        .filter((item) => item && item !== "（未选）");
      const codes = tokens.map((token) => {
        const hit = DISCOVERY_DIRECTION_PACKS.find((row) => row.code === token || row.label === token);
        return hit?.code || token;
      });
      out.directions = clampDirections(codes);
      continue;
    }
    const keywords = line.match(/^\s*关键词[：:]\s*(.+)\s*$/);
    if (keywords) {
      const raw = keywords[1].trim();
      out.keywords = raw === "（未填）" ? [] : asStringList(raw);
      continue;
    }
    const followers = line.match(/^\s*粉丝[：:]\s*(\d+)\s*[–\-至到]\s*(\d+)/);
    if (followers) {
      out.min_followers = Number(followers[1]);
      out.max_followers = Number(followers[2]);
      continue;
    }
    const plays = line.match(/^\s*近10条均播\s*≥\s*(\d+)/);
    if (plays) {
      out.min_avg_plays_10 = Number(plays[1]);
      continue;
    }
    const expect = line.match(/^\s*期望人数[：:]\s*(\d+)/);
    if (expect) out.expect_count = Number(expect[1]);
  }
  return out;
}

export function mergeDiscoveryBrief(
  current: DiscoveryBrief,
  patch: Partial<DiscoveryBrief>,
): DiscoveryBrief {
  const directions = patch.directions
    ? clampDirections(patch.directions)
    : current.directions;
  const keywords = patch.keywords
    ? asStringList(patch.keywords)
    : current.keywords;
  return {
    platforms: patch.platforms ? clampPlatforms(patch.platforms) : current.platforms,
    region: patch.region ? clampRegion(patch.region, current.region) : current.region,
    directions,
    keywords,
    min_followers: patch.min_followers ?? current.min_followers,
    max_followers: patch.max_followers ?? current.max_followers,
    min_avg_plays_10: patch.min_avg_plays_10 ?? current.min_avg_plays_10,
    expect_count: patch.expect_count ?? current.expect_count,
  };
}

export function sameClassConflict(
  fromBody: Partial<DiscoveryBrief>,
  fromChips: DiscoveryBrief,
): boolean {
  if (fromBody.platforms && fromBody.platforms.join() !== fromChips.platforms.join()) return true;
  if (fromBody.region && fromBody.region !== fromChips.region) return true;
  if (fromBody.directions && fromBody.directions.join() !== fromChips.directions.join()) return true;
  return false;
}

export function applyChipOverride(body: string, brief: DiscoveryBrief): string {
  const rendered = renderDiscoveryBody(brief);
  const renderedLines = rendered.split("\n");
  const incoming = String(body || "").split(/\r?\n/);
  const keyed = new Map<string, string>();
  for (const line of renderedLines) {
    const key = line.match(/^(【发现任务】|平台|地区|方向|关键词|粉丝|近10条均播|期望人数|只检索)/)?.[1];
    if (key) keyed.set(key, line);
  }
  const next = incoming.map((line) => {
    const key = line.match(/^(【发现任务】|平台|地区|方向|关键词|粉丝|近10条均播|期望人数|只检索)/)?.[1];
    if (key && keyed.has(key)) {
      const replacement = keyed.get(key)!;
      keyed.delete(key);
      return replacement;
    }
    return line;
  });
  if (!incoming.some((line) => line.startsWith(DISCOVERY_BODY_PREFIX))) {
    next.unshift(DISCOVERY_BODY_PREFIX);
    keyed.delete("【发现任务】");
  }
  const leftovers = [...keyed.values()].filter((line) => line && !next.includes(line));
  if (leftovers.length) {
    const insertAt = next.findIndex((line) => line.startsWith(DISCOVERY_BODY_PREFIX));
    next.splice(insertAt + 1, 0, ...leftovers);
  }
  return next.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function togglePlatform(current: DiscoveryPlatformCode[], code: DiscoveryPlatformCode): DiscoveryPlatformCode[] {
  if (isDomesticPlatform(code)) return current;
  return current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
}

export function toggleDirection(
  current: DiscoveryDirectionCode[],
  code: DiscoveryDirectionCode,
): { directions: DiscoveryDirectionCode[]; atMax: boolean } {
  if (current.includes(code)) {
    const directions = current.filter((item) => item !== code);
    return { directions, atMax: directions.length >= MAX_DISCOVERY_DIRECTIONS };
  }
  if (current.length >= MAX_DISCOVERY_DIRECTIONS) {
    return { directions: current, atMax: true };
  }
  return { directions: [...current, code], atMax: current.length + 1 >= MAX_DISCOVERY_DIRECTIONS };
}

export function asDiscoveryTemplate(raw: unknown): DiscoveryTemplate | null {
  const row = asRecord(raw);
  if (!row || (!row.platforms && !row.body && !row.defaults && !row.regions)) return null;
  const fallback = fallbackDiscoveryTemplate();
  const platforms = Array.isArray(row.platforms)
    ? (row.platforms as unknown[])
      .map((item) => {
        const rec = asRecord(item);
        const code = String(rec.code || rec.id || "").toLowerCase();
        if (isDomesticPlatform(code) || !["youtube", "instagram", "facebook"].includes(code)) return null;
        return {
          code: code as DiscoveryPlatformCode,
          label: String(rec.label || platformLabel(code)),
        };
      })
      .filter(Boolean) as Array<DiscoveryOption<DiscoveryPlatformCode>>
    : fallback.platforms;
  const regions = Array.isArray(row.regions)
    ? (row.regions as unknown[]).map((item) => {
        const rec = asRecord(item);
        return {
          code: clampRegion(String(rec.code || rec.id || "")),
          label: String(rec.label || regionLabel(String(rec.code || ""))),
        };
      })
    : fallback.regions;
  const directions = Array.isArray(row.directions)
    ? (row.directions as unknown[])
      .map((item) => {
        const rec = asRecord(item);
        const code = String(rec.code || rec.id || "").trim();
        if (!code) return null;
        const local = DISCOVERY_DIRECTION_PACKS.find((pack) => pack.code === code);
        return {
          code: code as DiscoveryDirectionCode,
          label: String(rec.label || local?.label || code),
          keywords: asStringList(rec.keywords).length ? asStringList(rec.keywords) : local?.keywords,
        };
      })
      .filter(Boolean) as Array<DiscoveryOption<DiscoveryDirectionCode>>
    : fallback.directions;
  const thresholds = {
    min_followers: parseNumber(asRecord(row.thresholds).min_followers, fallback.thresholds.min_followers),
    max_followers: parseNumber(asRecord(row.thresholds).max_followers, fallback.thresholds.max_followers),
    min_avg_plays_10: parseNumber(
      asRecord(row.thresholds).min_avg_plays_10 ?? asRecord(row.thresholds).min_avg_views_10,
      fallback.thresholds.min_avg_plays_10,
    ),
    expect_count: parseNumber(asRecord(row.thresholds).expect_count, fallback.thresholds.expect_count),
  };
  const defaultsRaw = asRecord(row.defaults);
  const defaults = mergeDiscoveryBrief(fallback.defaults, {
    platforms: clampPlatforms(asStringList(defaultsRaw.platforms)),
    region: clampRegion(String(defaultsRaw.region || fallback.defaults.region)),
    directions: clampDirections(asStringList(defaultsRaw.directions), directions),
    keywords: asStringList(defaultsRaw.keywords).length
      ? asStringList(defaultsRaw.keywords)
      : fallback.defaults.keywords,
    ...thresholds,
  });
  const body = String(row.body || "").trim().startsWith(DISCOVERY_BODY_PREFIX)
    ? String(row.body)
    : renderDiscoveryBody(defaults, { platforms, regions, directions });
  return {
    version: String(row.version || row.expected_brief_version || DISCOVERY_BRIEF_VERSION),
    platforms: platforms.length ? platforms : fallback.platforms,
    regions: regions.length ? regions : fallback.regions,
    directions: directions.length ? directions : fallback.directions,
    thresholds,
    defaults,
    body,
    source: "api",
  };
}
