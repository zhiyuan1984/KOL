import { describe, expect, it } from "vitest";
import { FOLLOW_STYLE_PRESETS } from "../src/follow-style-tags.js";
import { MAIN_STAGES, SIDE_STAGES, normalizeStage } from "../src/stages.js";
import {
  dictionaryOptionsFor,
  enrichListProfile,
  normalizeRiskTag,
  PROFILE_LIST_WHITELIST,
  RISK_TAG_OPTIONS,
  starryCooperationStageOptions,
  starryStageWriteFields,
} from "../src/starrykol/remote-contract.js";

describe("Starry remote MCP contract", () => {
  it("lists 15 main stages plus 6 side/terminal codes with legacy aliases", () => {
    const options = starryCooperationStageOptions();
    expect(options).toHaveLength(21);
    expect(options.filter((row) => row.main).map((row) => row.stageCode)).toEqual(MAIN_STAGES.map((row) => row.code));
    expect(options.filter((row) => !row.main).map((row) => row.stageCode)).toEqual(SIDE_STAGES.map((row) => row.code));
    expect(options.find((row) => row.stageCode === "INTERESTED")?.aliases).toContain("INTEREST_CONFIRMED");
    expect(options.find((row) => row.stageCode === "DISPUTED")?.aliases).toContain("EXCEPTION_HANDLING");
    expect(options.find((row) => row.stageCode === "SETTLING")?.stageName).toBe("结算中 / 已付款");
  });

  it("writes official stage code and Chinese name, never the legacy code", () => {
    expect(starryStageWriteFields("INTEREST_CONFIRMED")).toEqual({
      cooperationStageCode: "INTERESTED",
      cooperationStageName: "已回复-有兴趣",
    });
    expect(starryStageWriteFields("已签约")).toEqual({
      cooperationStageCode: "CONTRACTING",
      cooperationStageName: "合同签署",
    });
    expect(starryStageWriteFields("EXCEPTION_HANDLING")).toEqual({
      cooperationStageCode: "DISPUTED",
      cooperationStageName: "争议中",
    });
  });

  it("normalizes risk tags onto DELAY / CONTENT / LOST_CONTACT", () => {
    expect(RISK_TAG_OPTIONS.map((row) => row.code)).toEqual(["DELAY", "CONTENT", "LOST_CONTACT"]);
    expect(normalizeRiskTag("overdue")).toBe("DELAY");
    expect(normalizeRiskTag("CONTENT_RISK")).toBe("CONTENT");
    expect(normalizeRiskTag("失联")).toBe("LOST_CONTACT");
  });

  it("exposes niche and follow-style dictionaries separately from risk tags", () => {
    expect(dictionaryOptionsFor("kol_follow_style").map((row) => row.code)).toEqual(
      FOLLOW_STYLE_PRESETS.map((tag) => tag.id),
    );
    expect(dictionaryOptionsFor("kol_niche").some((row) => row.name === "储能")).toBe(true);
    expect(dictionaryOptionsFor("kol_risk_tag").map((row) => row.code)).toEqual(["DELAY", "CONTENT", "LOST_CONTACT"]);
    expect(FOLLOW_STYLE_PRESETS.some((tag) => /DELAY|CONTENT|LOST_CONTACT/.test(tag.id))).toBe(false);
  });

  it("fills list-all whitelist stage, tags, and masked email", () => {
    const row = enrichListProfile({
      kolUid: "KOL1",
      kolName: "Wendell Fishing",
      nicheTagsText: "居家办公；储能",
      cooperationStageCode: "INTEREST_CONFIRMED",
      riskTag: "overdue",
    });
    expect(row.cooperationStageCode).toBe("INTERESTED");
    expect(row.cooperationStageName).toBe("已回复-有兴趣");
    expect(row.riskTagCodes).toEqual(["DELAY"]);
    expect(row.nicheTags).toEqual([
      { code: "home-office", name: "居家办公" },
      { code: "energy-storage", name: "储能" },
    ]);
    expect(PROFILE_LIST_WHITELIST).toContain("cooperationStageCode");
    expect(PROFILE_LIST_WHITELIST).toContain("followStyleTags");
    expect(normalizeStage(String(row.cooperationStageCode))).toBe("INTERESTED");
  });
});
