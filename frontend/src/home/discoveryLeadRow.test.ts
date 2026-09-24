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

function render(overrides: Partial<HomeDiscoveryCandidate> = {}): string {
  return renderToStaticMarkup(createElement(DiscoveryLeadRow, {
    candidate: { ...candidate, ...overrides },
    selected: false,
    expanded: false,
    onToggleSelect: () => undefined,
    onToggleExpand: () => undefined,
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
