/** 调试视图：技能 → 远端执行面（员工端不渲染这些词）。业务目录来自 Agent manifest。 */

export type RemoteBackend =
  | "host"
  | "starry-kol-mcp"
  | "media-crawl"
  | "kol-agent"
  | "business-approve-agent";

export const REMOTE_BACKEND_LABEL: Record<RemoteBackend, string> = {
  host: "内核闸门",
  "starry-kol-mcp": "Starry KOL MCP",
  "media-crawl": "MediaCrawler",
  "kol-agent": "KOL Agent (Claw)",
  "business-approve-agent": "费用审批规则引擎",
};

/** 技能 → 远端执行面（与 backend starrykol/kolclaw/crawl/approval 一致） */
export const SKILL_REMOTE: Record<string, RemoteBackend> = {
  creator_profile: "starry-kol-mcp",
  creator_library_query: "starry-kol-mcp",
  creator_library_all: "starry-kol-mcp",
  creator_library_sync: "starry-kol-mcp",
  creator_status_update: "starry-kol-mcp",
  creator_owner_update: "starry-kol-mcp",
  creator_contact_decrypt: "starry-kol-mcp",
  creator_filter_options: "starry-kol-mcp",
  creator_lifecycle_kanban: "starry-kol-mcp",
  creator_risk_conversations: "starry-kol-mcp",
  reply_analysis: "starry-kol-mcp",
  email_compose: "starry-kol-mcp",
  email_conversation_read: "starry-kol-mcp",
  email_conversation_list: "starry-kol-mcp",
  email_mailbox_list: "starry-kol-mcp",
  email_app_conversation_list: "starry-kol-mcp",
  risk_scan: "starry-kol-mcp",
  creator_discovery: "media-crawl",
  creator_scoring: "kol-agent",
  creator_outreach: "kol-agent",
  creator_daily_tasks: "kol-agent",
  creator_budget_report: "kol-agent",
  business_approval: "business-approve-agent",
  confirm_stage: "host",
  deal_memory: "host",
};

/**
 * 执行面以目录接口派生的 `connectors`（已挂载的连接器，未挂载时为声明的连接器）为准；
 * 只有拿不到目录数据的调用点才回落到上面的按技能 ID 兜底表。
 */
export function remoteForSkill(skillId: string, connectors?: readonly string[] | null): RemoteBackend {
  if (connectors) {
    for (const id of connectors) {
      const remote = CONNECTOR_REMOTE[id];
      if (remote) return remote;
    }
    if (connectors.length === 0) return "host";
  }
  if (skillId === "stage_sop") return "host";
  return SKILL_REMOTE[skillId] || "host";
}

/** 连接器 id → 远端执行面（只用于状态展示） */
export const CONNECTOR_REMOTE: Record<string, RemoteBackend> = {
  starrykol: "starry-kol-mcp",
  starry: "starry-kol-mcp",
  emailmcp: "starry-kol-mcp",
  enterprise_mail: "starry-kol-mcp",
  crawl: "media-crawl",
  mediacrawl: "media-crawl",
  mediacrawler: "media-crawl",
  kolclaw: "kol-agent",
  claw: "kol-agent",
  wecom: "business-approve-agent",
};

export function remoteForConnector(connectorId: string): RemoteBackend | undefined {
  return CONNECTOR_REMOTE[connectorId];
}
