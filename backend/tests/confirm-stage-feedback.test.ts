import { describe, expect, it } from "vitest";
import { mcpSyncAssistantNote } from "../src/confirm-stage-feedback.js";
import {
  HOME_CONFIRM_STAGE_BLOCKED_COPY,
  HOME_OPENED_EXISTING_SESSION_COPY,
  MISSING_TARGET_STAGE_COPY,
  alreadyThereCopy,
  confirmStageOutcomeCopy,
  waitingApprovalCopy,
} from "../../frontend/src/confirmStageFeedback.js";

describe("confirm-stage operator copy", () => {
  it("turns known mcp_sync skip reasons into Chinese", () => {
    expect(mcpSyncAssistantNote({ skipped: true, reason: "missing_from_stage" })).toContain(
      "缺少变更前阶段",
    );
    expect(mcpSyncAssistantNote({ skipped: true, reason: "live_side_effects_disabled" })).toContain(
      "当前环境关闭了远程副作用",
    );
    expect(mcpSyncAssistantNote({ skipped: true, reason: "kol_not_in_live_test_allowlist" })).toContain(
      "该红人不在现场测试白名单",
    );
    expect(mcpSyncAssistantNote({ skipped: true, reason: "missing_kol_uid" })).toContain(
      "该合作未绑定远端 UID",
    );
    expect(mcpSyncAssistantNote({ skipped: true, reason: "not_adjacent_forward" })).toContain(
      "物理适配",
    );
    expect(mcpSyncAssistantNote({ skipped: true, reason: "not_adjacent_forward" })).not.toContain(
      "产品只允许相邻",
    );
    expect(mcpSyncAssistantNote({ skipped: true, reason: "not_supported_by_remote" })).toContain(
      "不是产品禁止",
    );
  });

  it("keeps Starry refuse / failure as a remote-not-written note", () => {
    expect(mcpSyncAssistantNote({ error: true, message: "Starry refuse" })).toBe(
      " 远程阶段未写入：Starry refuse。",
    );
    expect(mcpSyncAssistantNote({ updated: true })).toBe(" 已同步到远程合作阶段。");
    expect(mcpSyncAssistantNote(null)).toBe("");
  });

  it("explains already_there, waiting_approval, skipped remote, and missing target", () => {
    expect(alreadyThereCopy("初步接触")).toBe("正式阶段已是「初步接触」，无需再次写入。");
    expect(waitingApprovalCopy("内容策划", "内容审核")).toContain("请到「工作审批」");
    expect(waitingApprovalCopy("内容策划", "内容审核")).toContain("阶段尚未变更");
    expect(confirmStageOutcomeCopy({
      already_there: true,
      stage_changed: false,
      stage_label: "初步接触",
    }).text).toContain("无需再次写入");
    expect(confirmStageOutcomeCopy({
      waiting_approval: true,
      stage_changed: false,
      stage_label: "内容策划",
      target_label: "内容审核",
    }).text).toContain("工作审批");
    expect(confirmStageOutcomeCopy({
      stage_changed: true,
      mcp_sync: { skipped: true, reason: "live_side_effects_disabled" },
    }).text).toContain("关闭了远程副作用");
    expect(confirmStageOutcomeCopy({
      stage_changed: true,
      mcp_sync: { error: true, message: "Starry refuse" },
    }).tone).toBe("error");
    expect(MISSING_TARGET_STAGE_COPY).toContain("具体目标阶段");
    expect(HOME_CONFIRM_STAGE_BLOCKED_COPY).toContain("不能写入正式阶段");
    expect(HOME_OPENED_EXISTING_SESSION_COPY).toContain("未改正式阶段");
  });
});
