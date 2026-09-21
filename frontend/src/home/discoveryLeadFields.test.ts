import { describe, expect, it } from "vitest";
import { asHomeCandidate, asHomeRun, type HomeDiscoveryRun } from "./discoveryHome";
import {
  collectedAtMinute,
  confidenceLabel,
  contactEmail,
  contactEmailHref,
  discoveryRunStatusLabel,
  discoveryRunStatusOk,
  discoveryRunStatusRows,
  elapsedLabel,
  libraryLabel,
  matchReasonText,
  minuteStamp,
  playsValue,
  sampleNote,
  scoreParts,
  sourceState,
  viewFollowerPercent,
} from "./discoveryLeadFields";

function run(overrides: Partial<HomeDiscoveryRun> = {}): HomeDiscoveryRun {
  return {
    id: "drun_1",
    headline: "",
    raw_count: null,
    shortlist_count: null,
    status: "completed",
    brief_version: 1,
    ...overrides,
  };
}

describe("discovery run status rows", () => {
  it("shows the four rows and reads each value off the run", () => {
    const rows = discoveryRunStatusRows(run({
      raw_count: 40,
      shortlist_count: 12,
      started_at: "2026-09-20T03:40:00.000Z",
      completed_at: "2026-09-20T03:43:01.069Z",
    }));
    expect(rows.map((row) => row.key)).toEqual(["completed", "elapsed", "raw", "shortlist"]);
    expect(rows.map((row) => row.label)).toEqual(["完成时间", "耗时", "原始数量", "入围数量"]);
    expect(rows[0].value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(rows[1].value).toBe("3 分 1 秒");
    expect(rows[2].value).toBe("40");
    expect(rows[3].value).toBe("12");
  });

  it("falls back to 无 instead of 0 when a value is missing", () => {
    expect(discoveryRunStatusRows(null).map((row) => row.value)).toEqual(["无", "无", "无", "无"]);
    expect(discoveryRunStatusRows(run()).map((row) => row.value)).toEqual(["无", "无", "无", "无"]);
  });

  it("reports 无 for the elapsed time when either end is missing or reversed", () => {
    expect(elapsedLabel(null, "2026-09-20T03:43:01.069Z")).toBe("无");
    expect(elapsedLabel("2026-09-20T03:40:00.000Z", null)).toBe("无");
    expect(elapsedLabel("2026-09-20T03:43:01.069Z", "2026-09-20T03:40:00.000Z")).toBe("无");
    expect(elapsedLabel(undefined, undefined)).toBe("无");
  });

  it("keeps 无 for a missing or unparseable stamp", () => {
    expect(minuteStamp("")).toBe("无");
    expect(minuteStamp(null)).toBe("无");
    expect(minuteStamp("not-a-date")).toBe("无");
  });

  it("reads 原始数量 from brief.counts.raw when the run row has no raw_count", () => {
    const parsed = asHomeRun({ id: "drun_2", status: "completed", brief: { counts: { raw: 37 } } });
    expect(discoveryRunStatusRows(parsed)[2].value).toBe("37");
  });

  it("treats a non-positive count as missing and reuses the on-screen shortlist", () => {
    // 跑失败的 run 也带 0；0 不能冒充「采集到 0 条」。
    expect(discoveryRunStatusRows(run({ raw_count: 0, shortlist_count: 0 })).map((row) => row.value))
      .toEqual(["无", "无", "无", "无"]);
    // 入围数量缺失时与结果区表头同口径（同一个回退值）。
    expect(discoveryRunStatusRows(run({ shortlist_count: null }), 7)[3].value).toBe("7");
    // 有真值就不看回退值。
    expect(discoveryRunStatusRows(run({ shortlist_count: 7 }), 3)[3].value).toBe("7");
  });

  it("only reports the success tone for a completed run", () => {
    expect(discoveryRunStatusOk(run({ status: "completed" }))).toBe(true);
    expect(discoveryRunStatusOk(run({ status: "succeeded" }))).toBe(true);
    expect(discoveryRunStatusOk(run({ status: "rank_failed" }))).toBe(false);
    expect(discoveryRunStatusOk(null)).toBe(false);
    expect(discoveryRunStatusLabel(run({ status: "completed" }))).toBe("已完成");
    expect(discoveryRunStatusLabel(run({ status: "rank_failed" }))).toBe("筛选未完成");
    expect(discoveryRunStatusLabel(run({ status: "succeeded" }))).toBe("已完成");
    expect(discoveryRunStatusLabel(null)).toBe("无");
  });
});

describe("creator lead row fields", () => {
  const base = {
    id: "c1",
    nickname: "CleanGlow",
    platform: "youtube",
    platformCreatorId: "yt-1",
    handle: null,
    followers: 153000,
    avg_plays_10: 8000,
    recentViews: [8000, 9000, 7000],
    viewMean: 8597,
    viewMedian: 8100,
    stability: 0.9,
    viewFollowerRatio: 10.96,
    confidence: 1,
    sampleSize: 10,
    score: 88,
    matchReason: "名称含 camping",
    fit: "户外露营",
    source_url: null,
    profileUrl: null,
    avatarUrl: null,
    matchedKeywords: ["camping"],
    collectedAt: "2026-09-20T03:43:01.069Z",
    email: "clean.glow@mailcreators.example",
    libraryStatus: "pool" as const,
    why: "名称含 camping",
    band: "high",
    in_library: true,
    status: "suggested",
  };

  it("averages the real samples and says how few there are", () => {
    // 3 条有效样本 → 平均 8000，并明确写出 3/10
    expect(playsValue(base)).toBe(8000);
    expect(sampleNote(base)).toBe("3/10 条样本");
    // 没样本时回退 Host 的均播，且不谎报样本数
    expect(playsValue({ ...base, recentViews: [] })).toBe(8000);
    expect(sampleNote({ ...base, recentViews: [] })).toBe(null);
    // 有效样本 0/负数不算样本
    expect(playsValue({ ...base, recentViews: [0, -5], avg_plays_10: null })).toBe(null);
    // 足量样本不占位
    const ten = { ...base, recentViews: Array.from({ length: 10 }, () => 5000) };
    expect(sampleNote(ten)).toBe(null);
    expect(playsValue(ten)).toBe(5000);
  });

  it("renders the view/follower ratio as a percentage, missing as 无", () => {
    expect(viewFollowerPercent(base)).toBe("1096%");
    expect(viewFollowerPercent({ ...base, viewFollowerRatio: 0.056 })).toBe("5.6%");
    expect(viewFollowerPercent({ ...base, viewFollowerRatio: null })).toBe("无");
  });

  it("takes confidence from sample coverage (0 is a real 低, null is 无)", () => {
    expect(confidenceLabel(base)).toBe("高");
    expect(confidenceLabel({ ...base, confidence: 0.6 })).toBe("中");
    expect(confidenceLabel({ ...base, confidence: 0 })).toBe("低");
    expect(confidenceLabel({ ...base, confidence: null })).toBe("无");
  });

  it("shows the contact email only when it is a real address, never a stand-in", () => {
    expect(contactEmail(base)).toBe("clean.glow@mailcreators.example");
    expect(contactEmailHref(base)).toBe("mailto:clean.glow@mailcreators.example");
    // 缺失或不是地址 → null（卡片这一行不渲染），不用「无」占位。
    expect(contactEmail({ ...base, email: null })).toBe(null);
    expect(contactEmail({ ...base, email: "" })).toBe(null);
    expect(contactEmail({ ...base, email: "暂无" })).toBe(null);
    expect(contactEmailHref({ ...base, email: null })).toBe(null);
    expect(contactEmail(null)).toBe(null);
  });

  it("never invents a match reason or a source link", () => {
    expect(matchReasonText(base)).toBe("名称含 camping");
    expect(matchReasonText({ ...base, matchReason: "" })).toBe("暂无足够内容证据");
    expect(sourceState(base)).toEqual({ missing: true });
    expect(sourceState({ ...base, profileUrl: "https://youtube.com/@x" }))
      .toEqual({ href: "https://youtube.com/@x" });
    expect(collectedAtMinute(base)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(collectedAtMinute({ ...base, collectedAt: null })).toBe("无");
    expect(libraryLabel(base)).toBe("已在库（含公海）");
    expect(libraryLabel({ ...base, libraryStatus: "followed" })).toBe("已关注");
    expect(libraryLabel({ ...base, libraryStatus: "not_in_library" })).toBe("未入库");
    expect(scoreParts(base)).toContain("均播 8597");
    expect(scoreParts({ ...base, viewMean: null, viewFollowerRatio: null, stability: null, followers: null }))
      .toBe("无");
    // 推荐分构成里的粉丝数和行上一样走 displayMetric，别在同一行出现两种写法。
    expect(scoreParts(base)).toContain("粉丝 153k");
  });
});

describe("host payload mapping", () => {
  it("keeps the ratio missing when followers are unknown", () => {
    const noFollowers = asHomeCandidate({
      id: "c1",
      followers: 0,
      view_mean: 1000,
      view_follower_ratio: 0,
    });
    expect(noFollowers?.viewFollowerRatio).toBe(null);
    expect(viewFollowerPercent(noFollowers)).toBe("无");
    const known = asHomeCandidate({ id: "c2", followers: 1000, view_follower_ratio: 10.96 });
    expect(viewFollowerPercent(known)).toBe("1096%");
  });

  it("reads 来源 from source_url and folds already_in_library into 已在库", () => {
    const row = asHomeCandidate({ id: "c3", source_url: "https://youtube.com/@x", already_in_library: true });
    expect(row?.profileUrl).toBe("https://youtube.com/@x");
    expect(sourceState(row)).toEqual({ href: "https://youtube.com/@x" });
    expect(libraryLabel(row)).toBe("已在库（含公海）");
  });
});
