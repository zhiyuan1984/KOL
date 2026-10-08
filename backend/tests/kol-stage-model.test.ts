import { describe, expect, it } from "vitest";
import {
  COOP_STAGES, COOP_STAGE_LABELS, COOP_TYPES, EXCEPTION_KINDS,
  LEAD_SOURCES, LEAD_STAGES, LEAD_STAGE_LABELS, stageMoveKind,
} from "../src/ticket-domain/kol-leads.js";

/**
 * KOL 阶段模型单测（无 PG 依赖）：
 * - 合作阶段写入码 = BIZ-08 15 正式主阶段 + exception（审宪 2026-10-08）
 * - 阶段推进判定：相邻 +1 前进原因可选；跨段/回退/进出异常必须写原因
 */
describe("kol stage model", () => {
  it("coop stages are the 15 formal BIZ-08 codes plus exception", () => {
    expect(COOP_STAGES).toHaveLength(16);
    expect(COOP_STAGES).toContain("INITIAL_CONTACT");
    expect(COOP_STAGES).toContain("SETTLING");
    expect(COOP_STAGES).toContain("exception");
    expect(COOP_STAGES).not.toContain("initiated");
    expect(COOP_STAGES).not.toContain("archived");
    expect(COOP_STAGES).not.toContain("cancelled");
  });

  it("every coop stage has a label", () => {
    for (const code of COOP_STAGES) {
      expect(COOP_STAGE_LABELS[code], code).toBeTruthy();
    }
  });

  it("exception kinds match stage-transitions.md (not product nodes)", () => {
    expect([...EXCEPTION_KINDS].sort()).toEqual(
      ["CANCELLED", "DISPUTED", "LOST", "PAUSED", "REJECTED"].sort(),
    );
  });

  it("coop types have no legacy typo values", () => {
    expect(COOP_TYPES).not.toContain("duanshipping");
    expect(COOP_TYPES).toContain("short_video");
  });

  it("lead stages keep the confirmed 7-code pursuit model", () => {
    expect(LEAD_STAGES).toHaveLength(7);
    for (const code of LEAD_STAGES) {
      expect(LEAD_STAGE_LABELS[code], code).toBeTruthy();
    }
    expect(LEAD_SOURCES).toContain("manual");
  });

  it("adjacent +1 forward needs no reason", () => {
    expect(stageMoveKind("PLAN_PENDING", "CONTRACTING")).toBe("adjacent");
    expect(stageMoveKind("INITIAL_CONTACT", "INTERESTED")).toBe("adjacent");
    expect(stageMoveKind("PUBLISHED", "SETTLING")).toBe("adjacent");
  });

  it("cross-stage, rollback and exception moves need reason", () => {
    expect(stageMoveKind("CONTRACTING", "CONTENT_PLANNING")).toBe("needs_reason"); // 跨段
    expect(stageMoveKind("CONTENT_REVIEW", "PLAN_PENDING")).toBe("needs_reason"); // 回退
    expect(stageMoveKind("NEGOTIATING", "exception")).toBe("needs_reason"); // 进异常
    expect(stageMoveKind("exception", "CONTRACTING")).toBe("needs_reason"); // 出异常
    expect(stageMoveKind("SETTLING", "SETTLING")).toBe("adjacent"); // 同值
  });
});
