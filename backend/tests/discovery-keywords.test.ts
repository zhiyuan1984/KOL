import { describe, expect, it } from "vitest";
import {
  emptyDiscoveryHint,
  expandOverseasSearchKeywords,
  isPrimarilyCjk,
  stripDiscoveryFillers,
} from "../src/discovery-keywords.js";

describe("expandOverseasSearchKeywords", () => {
  it("maps known Chinese niches and strips filler tokens", () => {
    expect(expandOverseasSearchKeywords({
      keywords: ["找北美户外评测达人"],
      directions: ["户外电源"],
      region: "us",
    })).toEqual(["outdoor review", "portable power station", "USA"]);
  });

  it("expands each direction preset to English", () => {
    expect(expandOverseasSearchKeywords({ keywords: [], directions: ["户外露营"] })).toEqual(["camping outdoors"]);
    expect(expandOverseasSearchKeywords({ keywords: [], directions: ["装备评测"] })).toEqual(["gear review"]);
    expect(expandOverseasSearchKeywords({ keywords: [], directions: ["房车旅行"] })).toEqual(["van life", "RV travel"]);
    expect(expandOverseasSearchKeywords({ keywords: [], directions: ["徒步旅行"] })).toEqual(["hiking"]);
    expect(expandOverseasSearchKeywords({ keywords: [], directions: ["家庭旅行"] })).toEqual(["family travel"]);
  });

  it("keeps already-English keywords and does not invent a geo filter", () => {
    expect(expandOverseasSearchKeywords({
      keywords: ["portable power station"],
      directions: [],
      region: "all",
    })).toEqual(["portable power station"]);
  });

  it("appends a soft region hint when region is not all", () => {
    expect(expandOverseasSearchKeywords({
      keywords: ["portable power"],
      directions: ["户外电源"],
      region: "ca",
    })).toEqual(["portable power", "portable power station", "Canada"]);
  });

  it("falls back to the submitted text when nothing maps", () => {
    expect(expandOverseasSearchKeywords({ keywords: ["完全未知词"] })).toEqual(["完全未知词"]);
  });

  it("strips fillers from a spaced query without dropping the English remainder", () => {
    expect(stripDiscoveryFillers("找 portable power 达人")).toBe("portable power");
    expect(isPrimarilyCjk("找北美户外评测达人")).toBe(true);
    expect(isPrimarilyCjk("portable power station")).toBe(false);
  });
});

describe("emptyDiscoveryHint", () => {
  it("names the product search terms without collector jargon", () => {
    expect(emptyDiscoveryHint(["portable power station", "USA"]))
      .toBe("按「portable power station」没有找到线索，可换词再试。");
    expect(emptyDiscoveryHint([])).toBe("这次计划没有找到红人线索，可换关键词再试。");
    expect(emptyDiscoveryHint(["portable power station", "outdoor review"]))
      .toBe("按「portable power station / outdoor review」没有找到线索，可换词再试。");
    expect(emptyDiscoveryHint(["portable power station"])).not.toMatch(/MCP|MediaCrawler|Job|crawl/i);
  });
});
