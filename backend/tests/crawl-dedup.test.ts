import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEDUP_WINDOW_DAYS,
  dedupeBatch,
  isUsableCreatorKey,
  normalizeCreatorKey,
  poolVerdict,
  suspectSamePersonAcrossPlatforms,
} from "../src/crawl/dedup.js";
import { normalizeSystemTemplate } from "../src/cron/contracts.js";

describe("dedup identity key", () => {
  it("normalizes platform and creator id (BIZ-15: only platform + stable external id)", () => {
    expect(normalizeCreatorKey("YouTube", "  UCabc123  ")).toBe("youtube:ucabc123");
    expect(normalizeCreatorKey("instagram", "@Foo.Bar")).toBe("instagram:@foo.bar");
  });

  it("rejects unusable keys", () => {
    expect(isUsableCreatorKey(":")).toBe(false);
    expect(isUsableCreatorKey("youtube:")).toBe(false);
    expect(isUsableCreatorKey(":uc123")).toBe(false);
    expect(isUsableCreatorKey("youtube:uc123")).toBe(true);
  });
});

describe("dedupeBatch", () => {
  it("keeps the first occurrence per key and reports duplicates", () => {
    const items = [
      { platform: "youtube", id: "UC1", v: 1 },
      { platform: "youtube", id: "UC2", v: 2 },
      { platform: "YouTube", id: " uc1 ", v: 3 },
    ];
    const { unique, duplicates } = dedupeBatch(items, (item) =>
      normalizeCreatorKey(item.platform, item.id),
    );
    expect(unique.map((item) => item.v)).toEqual([1, 2]);
    expect(duplicates.map((entry) => entry.item.v)).toEqual([3]);
  });

  it("treats unusable keys as duplicates (never silently kept)", () => {
    const { unique, duplicates } = dedupeBatch([{ id: "" }], (item) =>
      normalizeCreatorKey("youtube", item.id),
    );
    expect(unique).toEqual([]);
    expect(duplicates).toHaveLength(1);
  });
});

describe("suspectSamePersonAcrossPlatforms", () => {
  it("flags the same normalized handle on different platforms without merging", () => {
    const suspects = suspectSamePersonAcrossPlatforms([
      { platform: "youtube", handle: "@FitGuru" },
      { platform: "instagram", handle: "fitguru" },
      { platform: "youtube", handle: "@Other" },
    ]);
    expect(suspects).toEqual([{ handle: "fitguru", platforms: ["youtube", "instagram"] }]);
  });

  it("ignores same-platform repeats", () => {
    expect(
      suspectSamePersonAcrossPlatforms([
        { platform: "youtube", handle: "@A" },
        { platform: "youtube", handle: "@A" },
      ]),
    ).toEqual([]);
  });
});

describe("poolVerdict", () => {
  const match = {
    id: "pool_1",
    platform: "youtube",
    platform_creator_id: "UC1",
    last_seen_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    seen_count: 2,
    days_since_seen: 5,
  };
  it("dedups within the window", () => {
    expect(poolVerdict(match, 30).kind).toBe("duplicate_within_window");
  });
  it("allows re-entry outside the window", () => {
    expect(poolVerdict(match, 3).kind).toBe("seen_outside_window");
  });
  it("treats missing match as new", () => {
    expect(poolVerdict(undefined, 30).kind).toBe("new");
  });
  it("defaults the window to 30 days", () => {
    expect(DEFAULT_DEDUP_WINDOW_DAYS).toBe(30);
  });
});

describe("system template dedup config", () => {
  it("parses window_days with clamping and default", () => {
    expect(normalizeSystemTemplate({ dedup: { window_days: 7 } }).dedup).toEqual({
      dedup_by: "platform_creator_id",
      window_days: 7,
    });
    expect(normalizeSystemTemplate({}).dedup.window_days).toBe(30);
    expect(normalizeSystemTemplate({ dedup: { window_days: 9999 } }).dedup.window_days).toBe(365);
    expect(normalizeSystemTemplate({ dedup: { window_days: 0 } }).dedup.window_days).toBe(1);
  });
});
