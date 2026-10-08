import { describe, expect, it } from "vitest";
import {
  REMOTE_CRAWL_STALE_MS,
  discoveryRemoteCrawlView,
  formatAgo,
  remoteCrawlLabel,
} from "./discoveryEvents";

const NOW = Date.parse("2026-10-08T12:00:00+08:00");
const iso = (ms: number) => new Date(ms).toISOString();

describe("discoveryRemoteCrawlView", () => {
  it("无快照时返回 null", () => {
    expect(discoveryRemoteCrawlView(null, NOW)).toBeNull();
    expect(discoveryRemoteCrawlView(undefined, NOW)).toBeNull();
  });

  it("非推进状态不展示", () => {
    for (const state of ["succeeded", "failed", "cancelled", "uncertain"]) {
      expect(
        discoveryRemoteCrawlView(
          { state, remote_status: "running", updated_at: iso(NOW - 1000) },
          NOW,
        ),
      ).toBeNull();
    }
  });

  it("采集中展示远端状态与更新时间", () => {
    const view = discoveryRemoteCrawlView(
      { state: "running", remote_status: "running", updated_at: iso(NOW - 8000) },
      NOW,
    );
    expect(view).not.toBeNull();
    expect(view?.label).toBe("采集中");
    expect(view?.status).toBe("running");
    expect(view?.ago).toBe("8 秒前更新");
    expect(view?.stale).toBe(false);
  });

  it("超过阈值未更新判停滞", () => {
    const view = discoveryRemoteCrawlView(
      {
        state: "running",
        remote_status: "running",
        updated_at: iso(NOW - REMOTE_CRAWL_STALE_MS - 1000),
      },
      NOW,
    );
    expect(view?.stale).toBe(true);
    expect(view?.ago).toBe("2 分钟前更新");
  });

  it("尚无远端回执时展示连接中，不编造状态", () => {
    const view = discoveryRemoteCrawlView(
      { state: "starting", remote_status: "", updated_at: null },
      NOW,
    );
    expect(view?.label).toBe("连接中");
    expect(view?.ago).toBe("");
    expect(view?.stale).toBe(false);
  });

  it("远端失败原文映射为中文标签", () => {
    const view = discoveryRemoteCrawlView(
      { state: "running", remote_status: "failed", updated_at: iso(NOW - 1000) },
      NOW,
    );
    expect(view?.label).toBe("远端失败");
  });
});

describe("remoteCrawlLabel", () => {
  it("未知状态原文透出", () => {
    expect(remoteCrawlLabel("weird_state")).toBe("weird_state");
    expect(remoteCrawlLabel("")).toBe("未知");
  });
});

describe("formatAgo", () => {
  it("秒/分/小时三档", () => {
    expect(formatAgo(5000)).toBe("5 秒前");
    expect(formatAgo(125_000)).toBe("2 分钟前");
    expect(formatAgo(3_700_000)).toBe("1 小时前");
  });
});
