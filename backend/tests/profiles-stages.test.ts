import { describe, expect, it } from "vitest";
import { CODEX_PROFILES, profileFor } from "../src/profiles.js";
import {
  MAIN_STAGES,
  SIDE_STAGES,
  autoLegalTargets,
  evidencedPointer,
  groupedStageTracks,
  legalTargets,
  legalTargetsWithEvidence,
  isStarryAdjacentForward,
  mergeRemoteLibraryStage,
  normalizeStage,
  planStarryAdjacentWalk,
  preferLaterMainStage,
  toLegacyStarryStage,
  toStarryStage,
} from "../src/stages.js";

describe("Codex Profile capability domains", () => {
  it("defines six capability domains on one harness", () => {
    expect(CODEX_PROFILES.map((profile) => profile.name)).toEqual([
      "Commander",
      "Lead",
      "Opportunity",
      "Negotiation",
      "Execution",
      "Settlement-Growth",
    ]);
    expect(new Set(CODEX_PROFILES.map((profile) => profile.harness))).toEqual(
      new Set(["codex-app-server"]),
    );
    expect(CODEX_PROFILES.find((profile) => profile.id === "commander")?.canDeriveChildThreads).toBe(true);
    expect(CODEX_PROFILES.filter((profile) => profile.id !== "commander").every((profile) => !profile.canDeriveChildThreads)).toBe(true);
  });

  it("maps skills to profiles without creating separate runtimes", () => {
    expect(profileFor("creator_discovery").name).toBe("Lead");
    expect(profileFor("reply_analysis").name).toBe("Opportunity");
    expect(profileFor("deal_memory").name).toBe("Negotiation");
    expect(profileFor("confirm_stage").name).toBe("Opportunity");
    expect(profileFor("risk_scan").name).toBe("Commander");
    expect(profileFor("email_compose").name).toBe("Lead");
    expect(profileFor("creator_budget_report").name).toBe("Settlement-Growth");
  });
});

describe("15-stage state machine", () => {
  it("defines the exact main stages and side/terminal states", () => {
    expect(MAIN_STAGES.map((stage) => stage.code)).toEqual([
      "INITIAL_CONTACT",
      "INTERESTED",
      "EVALUATING",
      "QUOTE_PENDING",
      "NEGOTIATING",
      "PLAN_PENDING",
      "CONTRACTING",
      "SAMPLE_PENDING",
      "SHIPPED",
      "TESTING",
      "CONTENT_PLANNING",
      "CONTENT_REVIEW",
      "PUBLISH_PENDING",
      "PUBLISHED",
      "SETTLING",
    ]);
    expect(SIDE_STAGES.map((stage) => stage.code)).toEqual([
      "PAUSED",
      "LOST",
      "REJECTED",
      "CANCELLED",
      "DISPUTED",
      "COMPLETED",
    ]);
  });

  it("normalizes legacy codes and lists human confirm targets without adjacent constraint", () => {
    expect(normalizeStage("INTEREST_CONFIRMED")).toBe("INTERESTED");
    expect(normalizeStage("EXCEPTION_HANDLING")).toBe("DISPUTED");
    expect(legalTargets("INITIAL_CONTACT")).toContain("INTERESTED");
    expect(legalTargets("INITIAL_CONTACT")).toContain("PAUSED");
    expect(legalTargets("INITIAL_CONTACT")).toContain("PUBLISHED");
    expect(legalTargets("INITIAL_CONTACT")).toContain("CONTENT_PLANNING");
    expect(legalTargets("INTERESTED")).toContain("INITIAL_CONTACT");
    expect(legalTargets("CONTRACTING")).toContain("CONTENT_PLANNING");
    expect(legalTargets("COMPLETED")).toEqual([]);
    expect(legalTargets("SETTLING")).toContain("COMPLETED");
    expect(autoLegalTargets("INITIAL_CONTACT")).not.toContain("CONTENT_PLANNING");
    expect(autoLegalTargets("INITIAL_CONTACT")).not.toContain("PUBLISHED");
  });

  it("allows evidence-backed jumps but not over unfinished priors", () => {
    expect(legalTargetsWithEvidence("INITIAL_CONTACT", [])).toEqual(autoLegalTargets("INITIAL_CONTACT"));
    expect(legalTargetsWithEvidence("INITIAL_CONTACT", ["INTERESTED", "EVALUATING"])).toContain("QUOTE_PENDING");
    expect(legalTargetsWithEvidence("INITIAL_CONTACT", ["INTERESTED", "EVALUATING"])).toContain("INTERESTED");
    expect(legalTargetsWithEvidence("INITIAL_CONTACT", ["PUBLISHED"])).not.toContain("PUBLISHED");
    expect(legalTargetsWithEvidence("INITIAL_CONTACT", ["INTERESTED", "PUBLISHED"])).toContain("EVALUATING");
    expect(legalTargetsWithEvidence("INITIAL_CONTACT", ["INTERESTED", "PUBLISHED"])).not.toContain("PUBLISHED");
    expect(toStarryStage("INTERESTED")).toBe("INTEREST_CONFIRMED");
    expect(toStarryStage("NEGOTIATING")).toBe("BUSINESS_NEGOTIATION");
    expect(toStarryStage("DISPUTED")).toBe("EXCEPTION_HANDLING");
    expect(toStarryStage("INITIAL_CONTACT")).toBe("INITIAL_CONTACT");
    expect(toLegacyStarryStage("INTERESTED")).toBe("INTEREST_CONFIRMED");
    expect(toLegacyStarryStage("NEGOTIATING")).toBe("BUSINESS_NEGOTIATION");
    expect(toLegacyStarryStage("DISPUTED")).toBe("EXCEPTION_HANDLING");
    expect(evidencedPointer("INITIAL_CONTACT", ["INTERESTED"])).toEqual({ pointer: "INTERESTED", completed: [] });
    expect(evidencedPointer("INITIAL_CONTACT", ["INTERESTED", "EVALUATING"])).toEqual({
      pointer: "EVALUATING",
      completed: ["INTERESTED"],
    });
    expect(evidencedPointer("INITIAL_CONTACT", ["PUBLISHED"])).toEqual({ pointer: "INTERESTED", completed: [] });
  });

  it("maps Starry stage codes and Chinese labels onto official codes", async () => {
    const { codeFromLabel } = await import("../src/stages.js");
    expect(codeFromLabel("初步接触")).toBe("INITIAL_CONTACT");
    expect(codeFromLabel("INTEREST_CONFIRMED")).toBe("INTERESTED");
    expect(codeFromLabel("已回复-有兴趣")).toBe("INTERESTED");
    expect(codeFromLabel("意向")).toBe("INTERESTED");
    expect(codeFromLabel("建联")).toBe("INITIAL_CONTACT");
    expect(codeFromLabel("EXCEPTION_HANDLING")).toBe("DISPUTED");
    expect(codeFromLabel("")).toBeNull();
  });

  it("does not let Starry list-all regress a confirmed official stage", () => {
    expect(mergeRemoteLibraryStage("INTERESTED", "INITIAL_CONTACT", 1)).toBe("INTERESTED");
    expect(mergeRemoteLibraryStage("INTERESTED", null, 1)).toBe("INTERESTED");
    expect(mergeRemoteLibraryStage(preferLaterMainStage("INITIAL_CONTACT", "INTERESTED"), "INITIAL_CONTACT", 1)).toBe("INTERESTED");
    expect(mergeRemoteLibraryStage("INTERESTED", "EVALUATING", 1)).toBe("EVALUATING");
    expect(mergeRemoteLibraryStage(null, "INITIAL_CONTACT", 0)).toBe("INITIAL_CONTACT");
    expect(mergeRemoteLibraryStage("PAUSED", "INITIAL_CONTACT", 1)).toBe("PAUSED");
    expect(preferLaterMainStage("INITIAL_CONTACT", "INTERESTED")).toBe("INTERESTED");
    expect(preferLaterMainStage("SHIPPED", "INTERESTED")).toBe("SHIPPED");
  });

  it("lists main / branch / exception tracks for human confirm; auto facts stay on next stage", () => {
    const tracks = groupedStageTracks("CONTRACTING");
    expect(tracks.map((row) => row.id)).toEqual(["main", "branch", "exception"]);
    expect(tracks[0].items.some((item) => item.kind === "adjacent" && item.code === "SAMPLE_PENDING")).toBe(true);
    expect(tracks[0].items.some((item) => item.kind === "correct" && item.code === "NEGOTIATING")).toBe(true);
    const noSample = tracks[1].items.find((item) => item.code === "CONTENT_PLANNING");
    expect(noSample?.kind).toBe("skip");
    expect(noSample?.note).toContain("不寄样");
    expect(tracks[2].items.map((item) => item.code)).toEqual([
      "PAUSED", "DISPUTED", "LOST", "REJECTED", "CANCELLED",
    ]);
    expect(legalTargets("CONTRACTING")).toContain("SAMPLE_PENDING");
    expect(legalTargets("CONTRACTING")).toContain("CONTENT_PLANNING");
    expect(legalTargets("CONTRACTING")).toContain("INTERESTED");
    expect(autoLegalTargets("CONTRACTING")).toEqual([
      "SAMPLE_PENDING", "PAUSED", "LOST", "REJECTED", "CANCELLED", "DISPUTED",
    ]);
  });

  it("plans skip as successive Starry-native adjacent forwards", () => {
    expect(planStarryAdjacentWalk("QUOTE_PENDING", "NEGOTIATING")).toEqual({
      from: "QUOTE_PENDING",
      to: "NEGOTIATING",
      hops: ["NEGOTIATING"],
      nativeHops: ["BUSINESS_NEGOTIATION"],
      kind: "adjacent",
    });
    expect(planStarryAdjacentWalk("QUOTE_PENDING", "商务谈判")).toMatchObject({
      hops: ["NEGOTIATING"],
      nativeHops: ["BUSINESS_NEGOTIATION"],
      kind: "adjacent",
    });
    expect(isStarryAdjacentForward("INTERESTED", "EVALUATING")).toBe(true);
    expect(planStarryAdjacentWalk("INTEREST_CONFIRMED", "COOPERATION_EVALUATION")).toMatchObject({
      hops: ["EVALUATING"],
      nativeHops: ["COOPERATION_EVALUATION"],
      kind: "adjacent",
    });
    expect(planStarryAdjacentWalk("INITIAL_CONTACT", "NEGOTIATING")).toEqual({
      from: "INITIAL_CONTACT",
      to: "NEGOTIATING",
      hops: ["INTERESTED", "EVALUATING", "QUOTE_PENDING", "NEGOTIATING"],
      nativeHops: [
        "INTEREST_CONFIRMED",
        "COOPERATION_EVALUATION",
        "QUOTE_PENDING",
        "BUSINESS_NEGOTIATION",
      ],
      kind: "walk",
    });
    expect(planStarryAdjacentWalk("CONTRACTING", "CONTENT_PLANNING")).toEqual({
      from: "CONTRACTING",
      to: "CONTENT_PLANNING",
      hops: ["SAMPLE_PENDING", "SHIPPED", "TESTING", "CONTENT_PLANNING"],
      nativeHops: ["SAMPLE_PENDING", "SHIPPED", "DELIVERED_TESTING", "CONTENT_PLANNING"],
      kind: "walk",
    });
    expect(planStarryAdjacentWalk("NEGOTIATING", "INTERESTED").kind).toBe("not_forward");
    expect(planStarryAdjacentWalk("INITIAL_CONTACT", "PAUSED").kind).toBe("not_forward");
    expect(isStarryAdjacentForward("INITIAL_CONTACT", "NEGOTIATING")).toBe(false);
    expect(planStarryAdjacentWalk("SETTLING", "COMPLETED")).toMatchObject({
      hops: ["COMPLETED"],
      nativeHops: ["COMPLETED"],
      kind: "adjacent",
    });
  });
});
