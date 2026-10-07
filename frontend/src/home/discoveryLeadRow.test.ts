import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DiscoveryLeadRow from "./DiscoveryLeadRow";
import type { HomeDiscoveryCandidate } from "./discoveryHome";

const candidate: HomeDiscoveryCandidate = {
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
  ingestReadiness: "ready",
  ingestBlockReason: null,
  libraryStatus: "pool",
  why: "名称含 camping",
  band: "high",
  in_library: true,
  status: "suggested",
};

const brief = {
  platforms: ["youtube"],
  region: "global_en",
  directions: [],
  keywords: ["camping"],
  min_followers: 10_000,
  max_followers: null,
  min_avg_plays_10: 5_000,
  expect_count: 30,
};

function render(
  overrides: Partial<HomeDiscoveryCandidate> = {},
  props: { followUp?: boolean } = {},
): string {
  return renderToStaticMarkup(createElement(DiscoveryLeadRow, {
    candidate: { ...candidate, ...overrides },
    brief,
    selected: false,
    expanded: false,
    followUp: props.followUp ?? false,
    onToggleSelect: () => undefined,
    onToggleExpand: () => undefined,
    onToggleFollowUp: () => undefined,
    onIgnore: () => undefined,
  }));
}

describe("discovery lead row", () => {
  it("shows a masked contact email behind the data-lead-email hook", () => {
    const html = render();
    expect(html).toContain("data-lead-email");
    expect(html).toContain("cl***@mailcreators.example");
    expect(html).not.toContain("clean.glow@mailcreators.example");
  });

  it("renders no email line when the candidate has no contact email", () => {
    expect(render({ email: null })).not.toContain("data-lead-email");
    expect(render({ email: "" })).not.toContain("data-lead-email");
  });

  it("uses the collected avatar when available and a cartoon fallback otherwise", () => {
    const fallback = render();
    expect(fallback).toContain('data-discovery-avatar="cartoon"');
    expect(fallback).toContain("默认头像");
    expect(render({ avatarUrl: "https://images.example/clean-glow.jpg" }))
      .toContain('data-discovery-avatar="source"');
  });

  it("renders the source URL as a link whenever the candidate has one", () => {
    const html = render({ profileUrl: "https://youtube.com/@CleanGlow" });
    expect(html).toContain('data-discovery-source="c1"');
    expect(html).toContain('href="https://youtube.com/@CleanGlow"');
    expect(html).toContain("看来源");
  });

  it("offers per-row follow-up triage on selectable candidates", () => {
    const html = render();
    expect(html).toContain('data-discovery-followup="c1"');
    expect(html).toContain("跟进");
    expect(html).not.toContain("data-lead-followup");
    const marked = render({}, { followUp: true });
    expect(marked).toContain("data-lead-followup");
    expect(marked).toContain("待跟进");
    expect(marked).toContain("取消跟进");
    expect(marked).toContain('aria-pressed="true"');
  });

  it("hides the follow-up action when the candidate cannot be ingested", () => {
    const html = render({ ingestReadiness: "needs_contact" });
    expect(html).not.toContain("data-discovery-followup");
    const existing = render({ ingestReadiness: "already_in_library" });
    expect(existing).not.toContain("data-discovery-followup");
  });

  it("renders the brief-fit decision line from thresholds", () => {
    const html = render();
    expect(html).toContain("data-lead-fit");
    // 153000 粉丝 ≥ 10000，8000 均播 ≥ 5000
    expect(html).toContain("粉丝符合门槛(≥10,000)");
    expect(html).toContain("均播符合门槛(≥5,000)");
    const low = render({ followers: 5000, avg_plays_10: 1000 });
    expect(low).toContain("粉丝不符合门槛(≥10,000)");
    expect(low).toContain("均播低于门槛(≥5,000)");
    const missing = render({ followers: null, avg_plays_10: null });
    expect(missing).toContain("粉丝无法核验");
    expect(missing).toContain("近10条资料不足");
  });

  it("marks missing-contact candidates as non-selectable with the Host reason", () => {
    const html = render({
      ingestReadiness: "needs_contact",
      ingestBlockReason: "缺少经采集验证的联系邮箱，不能入库。",
    });
    expect(html).toContain('data-lead-readiness="needs_contact"');
    expect(html).toContain("缺联系邮箱");
    expect(html).toContain("disabled");
    expect(html).toContain("缺少经采集验证的联系邮箱，不能入库。");
  });
});
