import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { hostConfirmStage } from "../src/host/api.js";
import { seedAll } from "../src/seed.js";
import { approvalKindForStage } from "../src/stages.js";
import {
  assertStageTransition,
  evaluateStageTransition,
  loadStageTransitionGraph,
  resetStageTransitionGraphCache,
} from "../src/stage-transitions-graph.js";

function insertCollab(id: string, handle: string, stageCode: string): void {
  getConn().prepare(
    `INSERT OR REPLACE INTO collaborations
     (id, handle, display_name, brand, platform, followers, email, mailbox_from,
      lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
      stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, handle, handle, "LT", "YouTube", "1万", `${id}@litime.example`, "kol.lt@litime.example",
    `lc_${id}`, `cv_${id}`, stageCode, 0, "", 0,
    0, handle, "", "", "美国", "", "LT-MINI-12", "1", 0,
  );
}

describe("stage transition graph (ADR-027 Host gate)", () => {
  afterEach(() => {
    delete process.env.STAGE_TRANSITIONS_PATH;
    resetStageTransitionGraphCache();
  });

  it("loads config/stage-transitions.json", () => {
    const graph = loadStageTransitionGraph({ refresh: true });
    expect(graph.nodes?.some((node) => node.id === "CONTRACTING")).toBe(true);
    expect(graph.human_policy?.forward_skip).toContain("allow_human");
    expect(graph.auto_policy?.forward_skip).toContain("forbid");
  });

  it("allows a legal human jump when a reason is present", () => {
    const decision = assertStageTransition("CONTRACTING", "CONTENT_PLANNING", "human", "这次不寄样");
    expect(decision.allowed).toBe(true);
    expect(decision.kind).toBe("forward_skip");
    expect(decision.require_reason).toBe(true);
    expect(decision.require_approval).toBe(false);
  });

  it("rejects a human jump without a reason", () => {
    expect(() => assertStageTransition("CONTRACTING", "CONTENT_PLANNING", "human", "")).toThrow(HttpFail);
    try {
      assertStageTransition("CONTRACTING", "CONTENT_PLANNING", "human", "  ");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpFail);
      expect((error as HttpFail & { detail: { code: string } }).detail).toMatchObject({
        code: "stage_reason_required",
      });
    }
  });

  it("forbids leaving a terminal exception and forbids unknown nodes", () => {
    const leave = evaluateStageTransition("LOST", "INTERESTED", "human");
    expect(leave.allowed).toBe(false);
    expect(leave.forbid).toBe(true);
    expect(leave.code).toBe("forbidden_edge");
    const unknown = evaluateStageTransition("INITIAL_CONTACT", "NOT_A_STAGE", "human");
    expect(unknown.allowed).toBe(false);
    expect(unknown.code).toBe("unknown_node");
  });

  it("keeps auto stricter than human", () => {
    const humanSkip = evaluateStageTransition("INITIAL_CONTACT", "NEGOTIATING", "human");
    const autoSkip = evaluateStageTransition("INITIAL_CONTACT", "NEGOTIATING", "auto");
    const humanRollback = evaluateStageTransition("NEGOTIATING", "INTERESTED", "human");
    const autoRollback = evaluateStageTransition("NEGOTIATING", "INTERESTED", "auto");
    expect(humanSkip.allowed).toBe(true);
    expect(autoSkip.allowed).toBe(false);
    expect(autoSkip.flags).toContain("forbid");
    expect(humanRollback.allowed).toBe(true);
    expect(autoRollback.allowed).toBe(false);
    expect(evaluateStageTransition("INITIAL_CONTACT", "INTERESTED", "auto").allowed).toBe(true);
  });

  it("allows exception enter/leave for humans with reason; auto leave only if returnable", () => {
    const enter = assertStageTransition("INITIAL_CONTACT", "PAUSED", "human", "对方暂缓");
    expect(enter.kind).toBe("enter_exception");
    expect(enter.require_reason).toBe(true);
    const leave = assertStageTransition("PAUSED", "EVALUATING", "human", "恢复评估");
    expect(leave.kind).toBe("leave_exception");
    expect(evaluateStageTransition("PAUSED", "EVALUATING", "auto").allowed).toBe(true);
    expect(evaluateStageTransition("CANCELLED", "EVALUATING", "auto").allowed).toBe(false);
    expect(evaluateStageTransition("INITIAL_CONTACT", "LOST", "auto").allowed).toBe(true);
  });

  it("marks require_approval on graph enter targets used by Host approvalKindForStage", () => {
    for (const code of ["PLAN_PENDING", "CONTRACTING", "CONTENT_REVIEW", "PUBLISH_PENDING", "SETTLING"]) {
      expect(evaluateStageTransition("INITIAL_CONTACT", code, "human").require_approval).toBe(true);
      expect(approvalKindForStage(code)).toBeTruthy();
    }
  });

  it("fails closed with a clear error when the graph file is missing", () => {
    process.env.STAGE_TRANSITIONS_PATH = path.join(os.tmpdir(), "missing-stage-transitions.json");
    resetStageTransitionGraphCache();
    expect(() => loadStageTransitionGraph({ refresh: true })).toThrow(HttpFail);
    try {
      loadStageTransitionGraph({ refresh: true });
    } catch (error) {
      const fail = error as HttpFail & { status: number; detail: { code: string; message: string } };
      expect(fail.status).toBe(503);
      expect(fail.detail.code).toBe("stage_graph_unavailable");
      expect(fail.detail.message).toMatch(/fail-closed|找不到/);
    }
  });
});

describe("hostConfirmStage enforces the graph (no LIVE)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-graph-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    process.env.AUTH_MODE = "disabled";
    resetConn();
    seedAll();
    resetStageTransitionGraphCache();
  });

  afterEach(() => {
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.STAGE_TRANSITIONS_PATH;
    resetStageTransitionGraphCache();
  });

  it("accepts a legal human jump with reason and refuses the same jump for auto", () => {
    insertCollab("col_graph_jump", "graph-jump", "CONTRACTING");
    const jumped = hostConfirmStage("graph-jump", "CONTENT_PLANNING", "col_graph_jump", 0, "这次不寄样", {});
    expect(jumped.stage_changed).toBe(true);
    expect(jumped.stage_code).toBe("CONTENT_PLANNING");

    insertCollab("col_graph_auto", "graph-auto", "CONTRACTING");
    expect(() => hostConfirmStage(
      "graph-auto",
      "CONTENT_PLANNING",
      "col_graph_auto",
      0,
      "auto must not skip",
      { recommender: "fact_advance" },
    )).toThrow(HttpFail);
  });

  it("accepts exception enter and leave with reason", () => {
    insertCollab("col_graph_ex", "graph-ex", "INITIAL_CONTACT");
    const entered = hostConfirmStage("graph-ex", "PAUSED", "col_graph_ex", 0, "对方暂缓", {});
    expect(entered.stage_changed).toBe(true);
    expect(entered.stage_code).toBe("PAUSED");
    const left = hostConfirmStage("graph-ex", "EVALUATING", "col_graph_ex", 1, "恢复评估", {});
    expect(left.stage_changed).toBe(true);
    expect(left.stage_code).toBe("EVALUATING");
  });

  it("rejects a forbid edge at confirm_stage time", () => {
    insertCollab("col_graph_lost", "graph-lost", "LOST");
    try {
      hostConfirmStage("graph-lost", "INTERESTED", "col_graph_lost", 0, "想拉回来", {});
      throw new Error("expected forbid");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpFail);
      expect((error as HttpFail & { detail: { code: string } }).detail.code).toBe("forbidden_edge");
    }
  });
});
