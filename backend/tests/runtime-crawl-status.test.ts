import { describe, expect, it } from "vitest";
import { remoteCrawlStatusValue } from "../src/crawl/runtime-gates.js";

describe("remoteCrawlStatusValue", () => {
  it("reads status/data.status/state in order", () => {
    expect(remoteCrawlStatusValue({ status: "running" })).toBe("running");
    expect(remoteCrawlStatusValue({ data: { status: "completed" } })).toBe("completed");
    expect(remoteCrawlStatusValue({ state: "idle" })).toBe("idle");
    expect(remoteCrawlStatusValue({ status: "failed", data: { status: "running" } })).toBe("failed");
  });
  it("lowercases and tolerates junk", () => {
    expect(remoteCrawlStatusValue({ status: "Running" })).toBe("running");
    expect(remoteCrawlStatusValue(null)).toBe("");
    expect(remoteCrawlStatusValue("running")).toBe("");
    expect(remoteCrawlStatusValue({})).toBe("");
  });
});
