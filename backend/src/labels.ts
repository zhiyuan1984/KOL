/** User-visible names for API field keys. Keep in sync with frontend/src/labels.ts. */

const FIELD_LABELS: Record<string, string> = {
  collaboration_id: "合作红人",
  handle: "红人",
  session_id: "会话",
  task_type: "任务类型",
  skill_id: "技能",
  knowledge_id: "知识模板",
  approval_id: "审批",
  chain_id: "审批链",
  work_item_id: "工作项",
  project_id: "项目",
  stage_code: "阶段",
  official_stage: "正式阶段",
  current_stage: "当前阶段",
  expected_version: "阶段版本",
  amount_usd: "报价金额",
  tracking: "运单号",
  carrier: "承运商",
  eta: "预计到达",
  attachments: "附件",
  keywords: "关键词",
  specified_ids: "内容编号",
  creator_ids: "创作者编号",
  creator_id: "创作者编号",
  kolUid: "红人",
  kol_uid: "红人",
  kolName: "红人名称",
  kol_name: "红人名称",
  contactEmail: "联系邮箱",
  contactEmailMasked: "联系邮箱",
  languageKey: "语言",
  cooperationStageCode: "合作阶段",
  cooperationStageName: "合作阶段",
  crawlerSyncStatus: "同步状态",
  riskTagCode: "风险标签",
  riskTag: "风险标签",
  followType: "跟进方式",
  ownerUserName: "负责人",
  ownerMailbox: "负责人邮箱",
  ownerMailboxEmail: "负责人邮箱",
  mailboxEmail: "发件邮箱",
  from: "发件邮箱",
  conversationId: "邮件会话",
  mailboxId: "品牌邮箱",
  campaign_id: "项目编号",
  owner: "负责人",
  status: "状态",
  confirmed: "合作确认",
  notes: "备注",
  follow_style_tags: "跟进标签",
  followStyleTags: "跟进标签",
  nicheTags: "垂类标签",
  wechat: "微信",
  to: "收件邮箱",
  email: "邮箱",
  subject: "邮件主题",
  body: "正文",
  bodyText: "正文",
  preview: "正文",
  name: "达人名称",
  platform: "平台",
  followers: "粉丝数",
  views: "播放量",
  price: "报价",
  target_cpm: "目标 CPM",
  product: "产品",
  keyword: "关键词",
  parentKey: "筛选项",
  confirm_send: "确认发送",
  inbound_id: "来信",
  from_stage: "当前阶段",
  total: "总数",
  total_tasks: "任务数",
  remaining_budget: "剩余预算",
};

function looksLikeCode(value: string): boolean {
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(value) || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value) || /^[a-z]+[A-Z]/.test(value);
}

export function fieldLabel(field: string): string {
  const raw = String(field || "").trim();
  if (!raw) return "这项信息";
  if (raw.includes("/")) return raw.split("/").map((part) => fieldLabel(part.trim())).filter(Boolean).join("、");
  if (FIELD_LABELS[raw]) return FIELD_LABELS[raw];
  if (looksLikeCode(raw)) return "这项信息";
  return raw;
}

export function formatMissingFields(fields: unknown[]): string {
  return [...new Set(fields.map((field) => fieldLabel(String(field))).filter(Boolean))].join("、");
}

export function missingFieldsMessage(fields: unknown[], fallback = "必要字段"): string {
  return `还需要补充：${formatMissingFields(fields) || fallback}。`;
}
