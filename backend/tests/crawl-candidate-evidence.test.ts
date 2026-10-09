import { describe, expect, it } from "vitest";
import { candidateAnalysisView, followerEvidence } from "../src/crawl/candidate-evidence.js";
import { candidateView } from "../src/crawl/results.js";

const evidence = { state: "source_recorded", raw_text: "@Go4x4 1.8M subscribers 99 videos",
  source_field: "dom.subscriberText", captured_at: "2026-10-04T23:00:00+08:00", parser_version: "youtube-subscribers/v1" };

describe("subscriber source evidence", () => {
  it("retains bounded source, field, parser and original read time", () => {
    const candidate = candidateView({ id: "channel", followers: 1800000, followers_evidence: evidence }, "youtube");
    expect(candidate.followers_evidence).toEqual({ ...evidence, captured_at: "2026-10-04T15:00:00.000Z" });
    expect(candidateAnalysisView(candidate)).toMatchObject({ followers: 1800000, reported_followers: 1800000 });
    expect(String(followerEvidence({ ...evidence, raw_text: "a".repeat(1000) }).raw_text)).toHaveLength(256);
  });
  it("preserves an old number for audit but withholds it from verified threshold analysis", () => {
    const original = { id: "old-channel", followers: 4 };
    expect(candidateAnalysisView(original)).toMatchObject({ followers: null, reported_followers: 4,
      followers_evidence: { state: "missing_source" } });
    expect(original.followers).toBe(4);
  });
  it.each([
    { ...evidence, raw_text: "" }, { ...evidence, captured_at: "invalid" },
    { ...evidence, source_field: "profile title" }, { ...evidence, parser_version: "unreviewed" },
  ])("does not treat incomplete or unknown evidence as recorded source (%j)", (value) => {
    expect(candidateAnalysisView({ followers: 4, followers_evidence: value })).toMatchObject({ followers: null,
      followers_evidence: { state: "missing_source" } });
  });
  it("keeps an explicitly unknown refresh unknown even if a stale count exists", () => {
    expect(candidateAnalysisView({ followers: 4, followers_evidence: { ...evidence, state: "unavailable" } }))
      .toMatchObject({ followers: null, reported_followers: 4, followers_evidence: { state: "unavailable" } });
  });
});

describe("candidate avatar normalization", () => {
  it("picks up avatar urls under non-standard remote field names", () => {
    expect(candidateView({ id: "a", profile_pic: "https://img/x.jpg" }, "youtube").avatar_url)
      .toBe("https://img/x.jpg");
    expect(candidateView({ id: "a", thumbnail: "https://img/y.png" }, "youtube").avatar_url)
      .toBe("https://img/y.png");
  });
  it("still only accepts http(s) urls", () => {
    expect(candidateView({ id: "a", avatar: "ftp://img/x.jpg" }, "youtube").avatar_url).toBeNull();
    expect(candidateView({ id: "a" }, "youtube").avatar_url).toBeNull();
  });
});

describe("candidate contact normalization", () => {
  it.each([
    { contact_email: "real@example.com" }, { contactEmail: "real@example.com" }, { email: "real@example.com" },
    { payload: { contactEmail: "real@example.com" } },
  ])("preserves the email actually supplied by the crawler %j", value => {
    expect(candidateView({ id: "channel", ...value }, "youtube").contact_email).toBe("real@example.com");
  });
  it("does not invent contact data from channel name or homepage", () => {
    const row = candidateView({ id: "channel", name: "Real", profile_url: "https://youtube.com/@real" }, "youtube");
    expect(row).not.toHaveProperty("contact_email");
  });
});
