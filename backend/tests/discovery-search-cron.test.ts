import { describe, expect, it } from "vitest";
import { HttpFail } from "../src/host/errors.js";
import {
  DEFAULT_DISCOVERY_SYSTEM_TEMPLATE,
  normalizeSystemTemplate,
} from "../src/cron/contracts.js";
import {
  assertBackgroundCrawlArgs,
  backgroundCrawlContext,
  BACKGROUND_CRAWL_SKILL,
} from "../src/crawl/background-crawl.js";
import { PLATFORM_PRINCIPAL, PLATFORM_SYNC_AGENT } from "../src/runtime/platform-principal.js";

function failCode(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpFail);
    return String((error as HttpFail).detail && ((error as HttpFail).detail as { code?: string }).code);
  }
  throw new Error("expected HttpFail");
}

describe("normalizeSystemTemplate", () => {
  it("默认模板规整为空关键词（合法，handler 届时如实 skipped）", () => {
    expect(normalizeSystemTemplate(undefined)).toEqual(DEFAULT_DISCOVERY_SYSTEM_TEMPLATE);
    expect(normalizeSystemTemplate({}).keywords).toEqual([]);
  });

  it("关键词去空白、去空、上限 20", () => {
    const keywords = ["  AI红人 ", "", "美妆", ...Array.from({ length: 30 }, (_, i) => `kw${i}`)];
    const template = normalizeSystemTemplate({ platform: "instagram", keywords });
    expect(template.platform).toBe("instagram");
    expect(template.keywords[0]).toBe("AI红人");
    expect(template.keywords).toHaveLength(20);
  });

  it("平台大小写不敏感、非法平台 400", () => {
    expect(normalizeSystemTemplate({ platform: "YouTube" }).platform).toBe("youtube");
    expect(failCode(() => normalizeSystemTemplate({ platform: "tiktok" }))).toBe("invalid_template_platform");
  });

  it("filters 只允许 max_notes_count 并校验范围", () => {
    expect(normalizeSystemTemplate({ filters: { max_notes_count: 50 } }).filters).toEqual({ max_notes_count: 50 });
    expect(normalizeSystemTemplate({}).filters).toEqual({});
    expect(failCode(() => normalizeSystemTemplate({ filters: { region: "US" } }))).toBe("invalid_template_filter");
    expect(failCode(() => normalizeSystemTemplate({ filters: { max_notes_count: 0 } }))).toBe("invalid_template_filter");
    expect(failCode(() => normalizeSystemTemplate({ filters: { max_notes_count: 10001 } }))).toBe(
      "invalid_template_filter",
    );
  });

  it("dedup 缺省为 platform_creator_id", () => {
    expect(normalizeSystemTemplate({}).dedup).toEqual({ dedup_by: "platform_creator_id" });
    expect(normalizeSystemTemplate({ dedup: { dedup_by: "url" } }).dedup).toEqual({ dedup_by: "url" });
  });
});

describe("backgroundCrawlContext", () => {
  it("使用平台主体与平台系统智能体身份", () => {
    const context = backgroundCrawlContext("cron:cjob:run1");
    expect(context.userId).toBe(PLATFORM_PRINCIPAL);
    expect(context.agentId).toBe(PLATFORM_SYNC_AGENT);
    expect(context.skillId).toBe(BACKGROUND_CRAWL_SKILL);
    expect(context.runId).toBe("cron:cjob:run1");
  });
});

describe("assertBackgroundCrawlArgs", () => {
  const valid = { platforms: ["youtube"], crawler_type: "search", keywords: "AI红人" };

  it("合法参数通过", () => {
    expect(() => assertBackgroundCrawlArgs(valid)).not.toThrow();
    expect(() =>
      assertBackgroundCrawlArgs({ ...valid, max_notes_count: 100 }),
    ).not.toThrow();
  });

  it("非法平台 / 模式 / 未知字段 / 空关键词抛错", () => {
    expect(failCode(() => assertBackgroundCrawlArgs({ ...valid, platforms: ["tiktok"] }))).toBe(
      "runtime_crawl_platform_invalid",
    );
    expect(failCode(() => assertBackgroundCrawlArgs({ ...valid, crawler_type: "hack" }))).toBe(
      "runtime_crawl_mode_invalid",
    );
    expect(failCode(() => assertBackgroundCrawlArgs({ ...valid, region: "US" }))).toBe(
      "runtime_crawl_scope_invalid",
    );
    expect(failCode(() => assertBackgroundCrawlArgs({ ...valid, keywords: "  " }))).toBe(
      "runtime_crawl_input_required",
    );
  });
});
