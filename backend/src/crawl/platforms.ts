/**
 * Crawl platform codes accepted by Host start-crawl / ingestion.
 *
 * Overseas codes match `docs/median_mcp_server.md` (`start_crawl`:
 * YouTube, Instagram, Facebook). Domestic codes stay for legacy plans
 * and existing snapshots. Automated crawl tests must use overseas codes
 * only and must not treat dy/xhs/ks/bili/wb/tieba/zhihu as the scenario
 * under test.
 */
export const OVERSEAS_CRAWL_PLATFORMS = ["youtube", "instagram", "facebook"] as const;
export const LEGACY_DOMESTIC_CRAWL_PLATFORMS = ["xhs", "dy", "ks", "bili", "wb", "tieba", "zhihu"] as const;
export const CRAWL_PLATFORMS = [
  ...OVERSEAS_CRAWL_PLATFORMS,
  ...LEGACY_DOMESTIC_CRAWL_PLATFORMS,
] as const;

export type CrawlPlatformCode = (typeof CRAWL_PLATFORMS)[number];

export const CRAWL_PLATFORM_SET = new Set<string>(CRAWL_PLATFORMS);
