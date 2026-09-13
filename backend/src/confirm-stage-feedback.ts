/** Operator-visible Chinese notes for confirm-stage MCP sync. Keep in sync with frontend/src/confirmStageFeedback.ts. */

const MCP_SKIP_REASONS: Record<string, string> = {
  live_side_effects_disabled: "当前环境关闭了远程副作用",
  kol_not_in_live_test_allowlist: "该红人不在现场测试白名单",
  missing_kol_uid: "该合作未绑定远端 UID",
  mcp_not_configured: "未配置远程连接",
  not_adjacent_forward: "远程只接受相邻前进，本次纠正或异常未写远程",
  missing_from_stage: "缺少变更前阶段，无法同步",
};

export function mcpSyncAssistantNote(mcp: {
  error?: unknown;
  message?: unknown;
  skipped?: unknown;
  reason?: unknown;
  updated?: unknown;
} | null | undefined): string {
  if (!mcp) return "";
  if (mcp.error) return ` 远程阶段未写入：${String(mcp.message || "Starry MCP 失败")}。`;
  if (mcp.skipped) {
    const reason = String(mcp.reason || "").trim();
    const human = MCP_SKIP_REASONS[reason] || (reason ? reason : "远程未写入");
    return ` 远程 Starry 未写入：${human}。`;
  }
  if (mcp.updated) return " 已同步到远程合作阶段。";
  return "";
}
