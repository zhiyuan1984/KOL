import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DiscoveryLeadRow from "./DiscoveryLeadRow";
import DiscoveryResultPane from "./DiscoveryResultPane";
import type { DiscoveryState } from "./useDiscovery";
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
  props: { followedUp?: boolean } = {},
): string {
  return renderToStaticMarkup(createElement(DiscoveryLeadRow, {
    candidate: { ...candidate, ...overrides },
    brief,
    selected: false,
    expanded: false,
    followedUp: props.followedUp ?? false,
    onToggleSelect: () => undefined,
    onToggleExpand: () => undefined,
    onIngestCandidate: () => Promise.resolve(),
    onFollowUpCandidate: () => Promise.resolve(),
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

  it("uses shared source avatars or a neutral initial without fabricated portraits", () => {
    const fallback = render();
    expect(fallback).toContain('data-kol-avatar="fallback"');
    expect(fallback).toContain('data-kol-unified="discovery"');
    expect(fallback).not.toContain("discovery-lead-avatar");
    expect(render({ avatarUrl: "https://images.example/clean-glow.jpg" }))
      .toContain('data-kol-avatar="source"');
  });

  it("renders the source URL as a link whenever the candidate has one", () => {
    const html = render({ profileUrl: "https://youtube.com/@CleanGlow" });
    expect(html).toContain('data-discovery-source="c1"');
    expect(html).toContain('href="https://youtube.com/@CleanGlow"');
    expect(html).toContain("看来源");
  });

  it("offers a real follow-up action that creates a lead (not a local triage flag)", () => {
    const html = render();
    expect(html).toContain('data-discovery-followup="c1"');
    expect(html).toContain("跟进");
    expect(html).not.toContain("data-lead-followup");
    const followed = render({}, { followedUp: true });
    expect(followed).toContain("data-lead-followup");
    expect(followed).toContain("已跟进");
    expect(followed).not.toContain("data-discovery-followup");
  });

  it("shows 加入公海 only before the candidate is in the library", () => {
    const notInLibrary = render({ in_library: false });
    expect(notInLibrary).toContain('data-lead-ingest="c1"');
    expect(notInLibrary).toContain("加入公海");
    const inLibrary = render({ in_library: true });
    expect(inLibrary).not.toContain("data-lead-ingest");
    expect(inLibrary).not.toContain("加入公海");
  });

  it("uses L3 text buttons only on the card (no L2): 加入公海 is a quiet text button", () => {
    const html = render({ in_library: false });
    expect(html).not.toContain("pool-claim-button");
    expect(html).toContain('data-lead-ingest="c1"');
    expect(html).toContain("加入公海");
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

  it("the saved-run fallback in DiscoveryResultPane actually mounts the shared row", () => {
    const noop = () => undefined;
    const state = {
      sessionId: "fixture-session", run: { id: "fixture-run" }, runId: "fixture-run",
      available: [candidate], visible: [candidate], resultFilter: "all", setResultFilter: noop,
      selected: [], selectableVisible: [candidate], selectedIds: [], selectedPlatforms: [],
      followUpIds: [], followUpCount: 0, expandedIds: [], actions: [], analysisMessages: [],
      startAction: null, startPhase: "succeeded", crawlPhase: "succeeded", stage: "success",
      toggleSelected: noop, toggleExpanded: noop, ignoreCandidate: noop, selectAll: noop,
      openIngest: noop, confirmIngest: noop, cancelIngest: noop, refreshAnalysis: noop,
      followUpCandidate: noop, ingestCandidate: noop,
    } as unknown as DiscoveryState;
    const html = renderToStaticMarkup(createElement(DiscoveryResultPane, { state, brief }));
    expect(html).toContain('data-kol-unified="discovery"');
    expect(html).toContain('data-candidate-id="c1"');
    expect(html).not.toContain('class="discovery-lead');
    expect(html).toContain("cl***@mailcreators.example");
  });
});
