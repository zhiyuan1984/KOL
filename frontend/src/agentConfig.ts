/** 调试视图：技能 → 远端执行面（员工端不渲染这些词）。 */

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

export type AgentTeam = {
  id: string;
  title: string;
  summary: string;
  profileIds: string[];
  steps: { skillId: string; prompt: string; label: string }[];
};

export const AGENT_TEAMS: AgentTeam[] = [
  {
    id: "reach-squad",
    title: "建联小队",
    summary: "发现达人 → 补画像 → 写合作邮件。发送不等于改阶段。",
    profileIds: ["lead"],
    steps: [
      { skillId: "creator_discovery", label: "达人发现", prompt: "发现达人 [平台或关键词]" },
      { skillId: "creator_profile", label: "达人画像", prompt: "达人画像 [达人昵称或主页]" },
      { skillId: "email_compose", label: "写合作邮件", prompt: "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]" },
    ],
  },
  {
    id: "advance-squad",
    title: "推进小队",
    summary: "回复分析 → 记状态 → Deal Memory。阶段写入需人确认。",
    profileIds: ["opportunity", "negotiation"],
    steps: [
      { skillId: "reply_analysis", label: "回复分析", prompt: "回复分析 [会话或红人]" },
      { skillId: "confirm_stage", label: "提出阶段变更", prompt: "提出阶段变更 [红人] 到 [目标阶段]" },
      { skillId: "deal_memory", label: "Deal Memory", prompt: "Deal Memory [红人或合作]" },
    ],
  },
  {
    id: "risk-squad",
    title: "风控小队",
    summary: "风险扫描与异常记状态。",
    profileIds: ["commander"],
    steps: [
      { skillId: "risk_scan", label: "超时/风险扫描", prompt: "超时/风险扫描" },
      { skillId: "confirm_stage", label: "提出阶段变更", prompt: "记状态 @红人" },
    ],
  },
  {
    id: "kol-agent",
    title: "KOL 智能体",
    summary: "SOP、草稿和阶段建议。发送不等于改阶段。",
    profileIds: ["lead", "opportunity", "negotiation", "execution"],
    steps: [
      { skillId: "stage_sop", label: "八个阶段 SOP", prompt: "阶段SOP" },
      { skillId: "email_compose", label: "写合作邮件", prompt: "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]" },
      { skillId: "confirm_stage", label: "提出阶段变更", prompt: "提出阶段变更 [红人] 到 [目标阶段]" },
    ],
  },
  {
    id: "approval-agent",
    title: "审批智能体",
    summary: "费用审批申请与催办。通过不等于已付款。",
    profileIds: ["commander", "settlement-growth"],
    steps: [
      { skillId: "business_approval", label: "费用审批", prompt: "费用审批" },
    ],
  },
  {
    id: "crawler-agent",
    title: "爬虫智能体",
    summary: "发现达人并转交，不自动发信。",
    profileIds: ["lead"],
    steps: [
      { skillId: "creator_discovery", label: "达人发现", prompt: "发现达人 [平台或关键词]" },
      { skillId: "creator_profile", label: "达人画像", prompt: "达人画像 [达人昵称或主页]" },
    ],
  },
];

export function remoteForSkill(skillId: string): RemoteBackend {
  if (skillId.startsWith("sop_") || skillId === "stage_sop") return "host";
  return SKILL_REMOTE[skillId] || "host";
}

export type AgentEntry = {
  id: "kol" | "approval" | "crawler";
  title: string;
  summary: string;
  skillId: string;
  prompt: string;
  profileIds: string[];
};

/** Three operator entries; they reuse the same Codex app-server engine, not separate runtimes. */
export const AGENT_ENTRIES: AgentEntry[] = [
  {
    id: "kol",
    title: "KOL 智能体",
    summary: "分析合作、展示适用 SOP、准备草稿和跟进建议。发信与正式阶段写入必须受控。",
    skillId: "stage_sop",
    prompt: "阶段SOP",
    profileIds: ["lead", "opportunity", "negotiation", "execution"],
  },
  {
    id: "approval",
    title: "审批智能体",
    summary: "补齐费用申请、匹配制度、催办和解释结果。AI 不代替审批人同意。",
    skillId: "business_approval",
    prompt: "费用审批",
    profileIds: ["commander", "settlement-growth"],
  },
  {
    id: "crawler",
    title: "爬虫智能体",
    summary: "把找人目标变成采集计划、跟踪和转交。不自动发信或创建合作承诺。",
    skillId: "creator_discovery",
    prompt: "发现达人",
    profileIds: ["lead"],
  },
];

/** 连接器 id → 远端执行面（只用于状态展示） */
export const CONNECTOR_REMOTE: Record<string, RemoteBackend> = {
  starrykol: "starry-kol-mcp",
  starry: "starry-kol-mcp",
  emailmcp: "starry-kol-mcp",
  enterprise_mail: "starry-kol-mcp",
  crawl: "media-crawl",
  mediacrawl: "media-crawl",
  kolclaw: "kol-agent",
  claw: "kol-agent",
  wecom: "business-approve-agent",
};

export function remoteForConnector(connectorId: string): RemoteBackend | undefined {
  return CONNECTOR_REMOTE[connectorId];
}
