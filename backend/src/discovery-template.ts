/**
 * Home AI发现 template dictionary. Zero model.
 * Platforms: youtube | instagram | facebook only.
 */
import { allowedFromMailboxes, normalizeBrandCode } from "./host/pep.js";
import { currentUser } from "./host/persona.js";
import type { Json } from "./types.js";

export const DISCOVERY_PLATFORMS = ["youtube", "instagram", "facebook"] as const;
export const DOMESTIC_PLATFORM_CODES = ["xhs", "dy", "ks", "bili", "wb", "tieba", "zhihu"] as const;
export const DISCOVERY_REGION_CODES = ["na", "eu", "sea", "jpkr", "mena", "latam", "global_en"] as const;
export const DISCOVERY_MODES = ["search", "detail", "creator"] as const;

export const DEFAULT_DISCOVERY_THRESHOLDS = {
  min_followers: 10000,
  max_followers: 2000000,
  min_avg_views_10: 5000,
  target_count: 30,
} as const;

export const MAX_DISCOVERY_TARGET = 80;
export const MAX_DISCOVERY_DIRECTIONS = 8;

export type DiscoveryPlatform = (typeof DISCOVERY_PLATFORMS)[number];
export type DiscoveryRegion = (typeof DISCOVERY_REGION_CODES)[number];

export const DISCOVERY_KEYWORD_PACKS = [
  {
    id: "camping",
    label: "户外露营",
    keywords: ["camping", "outdoor camping", "camping gear"],
  },
  {
    id: "vanlife",
    label: "房车",
    keywords: ["van life", "RV travel", "RV living"],
  },
  {
    id: "portable_power",
    label: "户外能源",
    keywords: ["portable power station", "solar generator", "energy storage"],
  },
  {
    id: "road_trip",
    label: "自驾旅行",
    keywords: ["road trip", "overland travel", "car camping"],
  },
  {
    id: "off_grid",
    label: "离网生活",
    keywords: ["off grid living", "off grid solar", "homestead power"],
  },
  {
    id: "backup_power",
    label: "应急备电",
    keywords: ["backup power", "power outage prep", "emergency power"],
  },
  {
    id: "camp_gear",
    label: "露营装备",
    keywords: ["camping equipment", "outdoor gear review", "camp kitchen"],
  },
  {
    id: "boat_life",
    label: "船用生活",
    keywords: ["boat life", "marine power", "sailboat living"],
  },
] as const;

export const DISCOVERY_REGION_LABELS: Record<DiscoveryRegion, string> = {
  na: "北美",
  eu: "欧洲",
  sea: "东南亚",
  jpkr: "日韩",
  mena: "中东非",
  latam: "拉美",
  global_en: "全球英文",
};

export const DISCOVERY_PLATFORM_LABELS: Record<DiscoveryPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};

export function isDiscoveryPlatform(code: string): code is DiscoveryPlatform {
  return (DISCOVERY_PLATFORMS as readonly string[]).includes(code);
}

export function isDomesticPlatform(code: string): boolean {
  return (DOMESTIC_PLATFORM_CODES as readonly string[]).includes(code);
}

export function isDiscoveryRegion(code: string): code is DiscoveryRegion {
  return (DISCOVERY_REGION_CODES as readonly string[]).includes(code);
}

export function employeeAuthorizedBrands(): string[] {
  return allowedFromMailboxes(currentUser(), null).map((row) => row.brand);
}

export function employeeDefaultBrand(): string | null {
  const brands = employeeAuthorizedBrands();
  const preferred = normalizeBrandCode(brands[0]);
  return preferred || brands[0] || null;
}

export function employeeDefaultRegion(): DiscoveryRegion {
  return "global_en";
}

export function discoveryTemplate(): Json {
  const brands = employeeAuthorizedBrands();
  const defaultBrand = employeeDefaultBrand();
  const defaultRegion = employeeDefaultRegion();
  return {
    entry: "memory",
    kind: "memory",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    platforms: DISCOVERY_PLATFORMS.map((id) => ({
      id,
      label: DISCOVERY_PLATFORM_LABELS[id],
    })),
    regions: DISCOVERY_REGION_CODES.map((id) => ({
      id,
      label: DISCOVERY_REGION_LABELS[id],
    })),
    modes: [...DISCOVERY_MODES],
    keyword_packs: DISCOVERY_KEYWORD_PACKS.map((pack) => ({
      id: pack.id,
      label: pack.label,
      keywords: [...pack.keywords],
    })),
    directions: DISCOVERY_KEYWORD_PACKS.map((pack) => ({
      id: pack.id,
      label: pack.label,
      keywords: [...pack.keywords],
    })),
    defaults: {
      brand: defaultBrand,
      region: defaultRegion,
      platforms: [],
      directions: [],
      keywords: ["camping", "portable power station"],
      thresholds: { ...DEFAULT_DISCOVERY_THRESHOLDS },
    },
    employee: {
      brands,
      default_brand: defaultBrand,
      default_region: defaultRegion,
    },
    thresholds: { ...DEFAULT_DISCOVERY_THRESHOLDS },
    max_directions: MAX_DISCOVERY_DIRECTIONS,
    max_target_count: MAX_DISCOVERY_TARGET,
  };
}
