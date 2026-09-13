/** Operator-visible Chinese copy for confirm-stage click outcomes. */

export type ConfirmStageMcpSync = {
  error?: boolean;
  message?: string;
  skipped?: boolean;
  reason?: string;
  updated?: boolean;
};

export type ConfirmStageResult = {
  already_there?: boolean;
  waiting_approval?: boolean;
  stage_changed?: boolean;
  stage_code?: string;
  stage_label?: string;
  target?: string;
  target_label?: string;
  mcp_sync?: ConfirmStageMcpSync | null;
};

export const MISSING_TARGET_STAGE_COPY = "请选择具体目标阶段后再确认，不能用「下一阶段」。";

export const HOME_CONFIRM_STAGE_BLOCKED_COPY = "当前不能写入正式阶段：请先选定具体目标阶段。";

export const HOME_OPENED_EXISTING_SESSION_COPY = "未改正式阶段。正在打开已有会话，请在工作台确认推进。";

export const HOME_OPENED_EXISTING_SESSION_LANDED_COPY = "未改正式阶段。已打开已有会话，请在工作台确认推进。";

const MCP_SKIP_REASONS: Record<string, string> = {
  live_side_effects_disabled: "当前环境关闭了远程副作用",
  kol_not_in_live_test_allowlist: "该红人不在现场测试白名单",
  missing_kol_uid: "该合作未绑定远端 UID",
  mcp_not_configured: "未配置远程连接",
  not_adjacent_forward: "远程只接受相邻前进，本次纠正或异常未写远程",
  missing_from_stage: "缺少变更前阶段，无法同步",
};

export function mcpSyncReasonCopy(reason?: string | null): string {
  const raw = String(reason || "").trim();
  if (!raw) return "远程未写入";
  return MCP_SKIP_REASONS[raw] || raw;
}

export function mcpSyncOperatorCopy(mcp?: ConfirmStageMcpSync | null): string {
  if (!mcp) return "";
  if (mcp.error) return `远程 Starry 未写入：${String(mcp.message || "同步失败").trim() || "同步失败"}。`;
  if (mcp.skipped) return `远程 Starry 未写入：${mcpSyncReasonCopy(mcp.reason)}。`;
  if (mcp.updated) return "已同步到远程合作阶段。";
  return "";
}

export function alreadyThereCopy(label?: string | null): string {
  const name = String(label || "").trim();
  return name ? `正式阶段已是「${name}」，无需再次写入。` : "正式阶段已是该目标，无需再次写入。";
}

export function waitingApprovalCopy(current?: string | null, target?: string | null): string {
  const from = String(current || "").trim() || "当前阶段";
  const to = String(target || "").trim();
  return to
    ? `阶段尚未变更，仍是「${from}」。已提交「${to}」审批，请到「工作审批」。`
    : `阶段尚未变更，仍是「${from}」。已提交审批，请到「工作审批」。`;
}

export function confirmStageOutcomeCopy(result: ConfirmStageResult): { tone: "info" | "error"; text: string } {
  const label = String(result.stage_label || result.target_label || "").trim();
  if (result.already_there) {
    return { tone: "info", text: alreadyThereCopy(label) };
  }
  if (result.waiting_approval) {
    return { tone: "info", text: waitingApprovalCopy(result.stage_label, result.target_label) };
  }
  const mcp = mcpSyncOperatorCopy(result.mcp_sync);
  if (result.mcp_sync?.error) {
    const local = result.stage_changed === false ? "" : "本地已按确认处理。";
    return { tone: "error", text: `${local}${mcp}`.trim() };
  }
  if (result.mcp_sync?.skipped) {
    const local = result.stage_changed ? "本地已按确认处理。" : "";
    return { tone: "info", text: `${local}${mcp}`.trim() };
  }
  if (result.stage_changed) {
    const updated = label ? `正式阶段已按你的确认更新：${label}。未发信。` : "正式阶段已按你的确认更新。未发信。";
    return { tone: "info", text: mcp ? `${updated} ${mcp}` : updated };
  }
  if (mcp) return { tone: "info", text: mcp };
  return { tone: "info", text: "这次确认没有改正式阶段。" };
}
