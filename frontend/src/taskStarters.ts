import type { TaskDefinition } from "./api";

/**
 * Fill-in copy shown in the home composer when a task template is chosen.
 * Read-only skills keep their catalog title. Write skills include [placeholders].
 */
const STARTERS: Record<string, string> = {
  email_compose: "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]",
  email_conversation_list: "邮件会话 [关键词或红人]",
  email_conversation_read: "读邮件会话 [会话编号]",
  email_mailbox_list: "品牌邮箱列表",
  email_app_conversation_list: "应用邮件会话",
  creator_discovery: "发现达人 [平台或关键词]",
  creator_outreach: "达人建联话术 [达人昵称或主页]",
  creator_profile: "达人画像 [达人昵称或主页]",
  creator_library_query: "达人库查询 [关键词]",
  creator_library_all: "达人库全量",
  creator_library_sync: "达人同步入库 [达人昵称或主页]",
  creator_scoring: "达人评分 [达人昵称或主页]",
  creator_status_update: "达人状态更新 [达人] [新状态]",
  creator_owner_update: "更新红人负责人 [达人] [负责人]",
  creator_contact_decrypt: "解密达人联系方式 [达人]",
  creator_filter_options: "达人筛选字典",
  creator_lifecycle_kanban: "合作生命周期看板",
  creator_risk_conversations: "达人风险会话",
  creator_daily_tasks: "今日 KOL 任务",
  creator_budget_report: "KOL 预算报告",
  business_approval: "Expense approval [requester] [amount] [currency]",
  deal_memory: "Deal Memory [红人或合作]",
  confirm_stage: "提出阶段变更 [红人] 到 [目标阶段]",
  reply_analysis: "回复分析 [会话或红人]",
  risk_scan: "超时/风险扫描",
  content_nudge: "催大纲 [红人或合作]",
};

export function starterPrompt(definition: Pick<TaskDefinition, "id" | "prompt" | "title">): string {
  return STARTERS[definition.id] || definition.prompt || definition.title;
}
