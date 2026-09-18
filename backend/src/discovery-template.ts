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
    id: "beauty",
    label: "美妆护肤",
    keywords: ["clean beauty", "skincare routine", "drugstore makeup"],
  },
  {
    id: "fashion",
    label: "服饰穿搭",
    keywords: ["outfit of the day", "affordable fashion", "workwear"],
  },
  {
    id: "fitness",
    label: "健身运动",
    keywords: ["home workout", "pilates", "gym routine"],
  },
  {
    id: "food",
    label: "食品饮料",
    keywords: ["healthy recipes", "energy drink review", "snack haul"],
  },
  {
    id: "tech",
    label: "消费电子",
    keywords: ["gadget review", "unboxing", "charging tips"],
  },
  {
    id: "home",
    label: "家居生活",
    keywords: ["home organization", "apartment tour", "kitchen gadgets"],
  },
  {
    id: "parenting",
    label: "亲子家庭",
    keywords: ["mom routine", "toddler snacks", "family travel"],
  },
  {
    id: "auto",
    label: "汽车出行",
    keywords: ["EV review", "charging road trip", "car maintenance"],
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
    defaults: {
      brand: defaultBrand,
      region: defaultRegion,
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
