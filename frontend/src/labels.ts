/** Employee-facing names for API field keys, error codes, and stage codes. */

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
  advancement_mode: "推进方式",
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
  sessions: "会话",
  archived_sessions: "已归档会话",
  memories: "记忆",
  exam_attempts: "考试次数",
  database_bytes: "数据库占用",
  uploads_bytes: "上传文件",
  worker_boxes_bytes: "工作箱占用",
  retention_policy: "保留策略",
  stage_transitions: "阶段变更记录",
  session_days: "会话保留天数",
  audit_days: "审计保留天数",
  total: "总数",
  total_tasks: "任务数",
  remaining_budget: "剩余预算",
};

const ERROR_TITLES: Record<string, string> = {
  illegal_edge: "阶段不在可确认列表",
  stage_reason_required: "请填写阶段原因",
  unknown_stage: "未知阶段",
  locked_promise: "阶段已锁定",
  version_conflict: "阶段已更新",
  crawl_input_required: "还需要补充采集条件",
  crawl_platform_unsupported: "当前平台暂不支持采集",
  crawl_start_failed: "采集未能启动",
  worker_failed: "这次处理没有完成",
  proposal_collaboration_missing: "缺少合作对象",
  proposal_illegal_target: "阶段建议不合法",
  nudge_stage_gate: "当前阶段不能催大纲",
  nudge_incomplete: "催大纲信息不完整",
  ship_incomplete: "发货信息不完整",
  knowledge_incomplete: "知识模板未填完",
  no_collab: "需要指定合作",
  unknown_task_type: "未知任务",
  task_type_mismatch: "任务类型不一致",
  skill_not_granted: "技能未授权",
  generation_unavailable: "暂时无法生成",
  connector_disabled: "连接器未启用",
  connector_not_granted: "连接器未授权",
};

const USER_STATUS: Record<string, string> = {
  active: "在职",
  inactive: "已停用",
  disabled: "已停用",
  pending: "待激活",
};

const ROLE_LABELS: Record<string, string> = {
  employee: "员工",
  admin: "管理员",
  lead: "线索负责人",
  manager: "经理",
  zhang: "张总",
};

const CONNECTOR_STATUS: Record<string, string> = {
  mocked: "演示中",
  configured: "已配置",
  enabled: "已启用",
  disabled: "已停用",
  ready: "可用",
  error: "异常",
  pending: "待配置",
};

const PROFILE_NAMES: Record<string, string> = {
  Commander: "指挥",
  Lead: "触达",
  Opportunity: "意向",
  Negotiation: "商务",
  Execution: "履约",
  "Settlement-Growth": "结算增长",
  commander: "指挥",
  lead: "触达",
  opportunity: "意向",
  negotiation: "商务",
  execution: "履约",
  "settlement-growth": "结算增长",
};

const AUDIT_EVENTS: Record<string, string> = {
  "admin.setup": "完成初始设置",
  "admin.user.create": "新增员工",
  "admin.user.update": "更新员工",
  "admin.user.deactivate": "停用员工",
  "admin.skill.grant": "开通技能",
  "admin.skill.revoke": "收回技能",
  "admin.skill.replace": "更新技能授权",
  "admin.connector.create": "新增连接器",
  "admin.connector.update": "更新连接器",
  "admin.connector.delete": "删除连接器",
  "admin.connector.grant": "开通连接器",
  "admin.connector.revoke": "收回连接器",
  "admin.connector_grants.replace": "更新连接器授权",
  "admin.approval_role.bind": "绑定审批角色",
  "admin.approval_role.unbind": "解除审批角色",
  "admin.approval_roles.replace": "更新审批角色",
  "admin.exam.assign": "分配考试",
  "admin.exam.create": "创建考试",
  "admin.retention.update": "更新留存策略",
  "auth.login": "登录",
  "auth.password_changed": "修改密码",
  "knowledge.create": "新建知识",
  "knowledge.edit": "编辑知识",
  "knowledge.approve": "发布知识",
  "knowledge.archive": "归档知识",
  "knowledge.extract": "抽取知识",
  "knowledge.evolve.propose": "提交隔离提案",
  "knowledge.evolve.approve": "批准隔离提案",
  "knowledge.evolve.reject": "否决隔离提案",
  "skill.sop.save": "保存技能说明",
  "skill.sop.reset": "恢复技能说明",
  "skill.grant.save": "保存技能分配",
  "skill.create": "新建技能",
  "skill.market": "上架或下架技能",
  "skill.delete": "删除技能",
};

const APPROVAL_STATUS: Record<string, string> = {
  pending: "待处理",
  approved: "已同意",
  rejected: "已驳回",
  cancelled: "已取消",
  waiting: "等待中",
  forwarded: "已转交",
  consumed: "已办结",
  sent: "已办结",
};

const DRAFT_STATUS: Record<string, string> = {
  draft: "草稿",
  sent: "已发送",
  queued: "排队中",
  failed: "发送失败",
  waiting_approval: "待审批",
  blocked: "已拦截",
};

const STAGE_LABELS: Record<string, string> = {
  INITIAL_CONTACT: "初步接触",
  INTERESTED: "已回复-有兴趣",
  EVALUATING: "合作评估",
  QUOTE_PENDING: "报价待确认",
  NEGOTIATING: "商务谈判",
  PLAN_PENDING: "方案待确认",
  CONTRACTING: "合同签署",
  SAMPLE_PENDING: "待寄样",
  SHIPPED: "已发货",
  TESTING: "已签收-测试中",
  CONTENT_PLANNING: "内容策划",
  CONTENT_REVIEW: "内容审核",
  PUBLISH_PENDING: "待发布",
  PUBLISHED: "已发布",
  SETTLING: "结算中 / 已付款",
  PAUSED: "已暂停",
  LOST: "已流失",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  DISPUTED: "争议中",
  COMPLETED: "已完成",
};

function looksLikeCode(value: string): boolean {
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(value) || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value) || /^[a-z]+[A-Z]/.test(value);
}

export function fieldLabel(field: string): string {
  const raw = String(field || "").trim();
  if (!raw) return "这项信息";
  if (raw.includes("/")) return raw.split("/").map((part) => fieldLabel(part.trim())).filter(Boolean).join("、");
  if (FIELD_LABELS[raw]) return FIELD_LABELS[raw];
  if (STAGE_LABELS[raw]) return STAGE_LABELS[raw];
  if (ERROR_TITLES[raw]) return ERROR_TITLES[raw];
  if (looksLikeCode(raw)) return "这项信息";
  return raw;
}

export function formatMissingFields(fields: string[]): string {
  return [...new Set(fields.map(fieldLabel).filter(Boolean))].join("、");
}

export function missingFieldsMessage(fields: string[], suffix = ""): string {
  const labels = formatMissingFields(fields);
  if (!labels) return `请补充任务所需信息后再执行。${suffix}`;
  return `还需要补充：${labels}。${suffix}`;
}

export function stageLabel(code?: string | null, fallback?: string | null): string {
  const raw = String(code || "").trim();
  if (fallback && !looksLikeCode(fallback)) return fallback;
  if (STAGE_LABELS[raw]) return STAGE_LABELS[raw];
  if (fallback) return fallback;
  return raw && !looksLikeCode(raw) ? raw : "";
}

export function errorTitle(code?: string | null): string {
  const raw = String(code || "").trim();
  return ERROR_TITLES[raw] || (looksLikeCode(raw) ? "这次处理需要你确认" : raw) || "需要处理";
}

export function userStatusLabel(status?: string | null): string {
  const raw = String(status || "").trim();
  return USER_STATUS[raw] || raw || "在职";
}

export function roleLabel(role?: string | null): string {
  const raw = String(role || "").trim();
  return ROLE_LABELS[raw] || raw;
}

export function isAdminAccount(me?: {
  available_modes?: string[] | null;
  roles?: string[] | null;
} | null): boolean {
  return Boolean(me?.available_modes?.includes("admin") || me?.roles?.includes("admin"));
}

/** Sidebar account chip: who is signed in, not demo handle / exam jargon. */
export function accountChipLabel(me?: {
  name?: string | null;
  exam_passed?: boolean;
  available_modes?: string[] | null;
  roles?: string[] | null;
  role?: string | null;
} | null): string {
  const name = String(me?.name || "").trim() || "当前账户";
  if (me?.exam_passed === false) return `${name} · 待完成考试`;
  const admin = isAdminAccount(me);
  return `${name} · ${admin ? "管理员" : (roleLabel(me?.role) || "员工")}`;
}

export function connectorStatusLabel(status?: string | null): string {
  const raw = String(status || "").trim();
  return CONNECTOR_STATUS[raw] || (looksLikeCode(raw) ? "未配置" : raw) || "未配置";
}

export function profileNameLabel(name?: string | null): string {
  const raw = String(name || "").trim();
  return PROFILE_NAMES[raw] || raw;
}

export function auditEventLabel(eventType?: string | null): string {
  const raw = String(eventType || "").trim();
  if (AUDIT_EVENTS[raw]) return AUDIT_EVENTS[raw];
  if (!raw) return "操作记录";
  return raw.split(".").map((part) => fieldLabel(part)).filter((part) => part && part !== "这项信息").join(" · ") || "操作记录";
}

export const APPROVAL_ROLE_OPTIONS = [
  { id: "lead", label: "线索负责人" },
  { id: "manager", label: "经理" },
  { id: "zhang", label: "张总" },
] as const;

export function approvalStatusLabel(status?: string | null): string {
  const raw = String(status || "").trim();
  return APPROVAL_STATUS[raw] || raw || "—";
}

export function stripApprovalRecordIds(text?: string | null): string {
  return String(text || "")
    .replace(/\s*(approval_id|chain_id)=\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function draftStatusLabel(status?: string | null): string {
  const raw = String(status || "").trim();
  return DRAFT_STATUS[raw] || raw || "草稿";
}

export function dataSummaryLabel(key: string): string {
  return FIELD_LABELS[key] || fieldLabel(key);
}

export function formatDataSummaryValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (key === "stage_transitions") return "删除会话后仍保留，作为合规记录";
  if (key.endsWith("_bytes") && typeof value === "number") {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (key === "retention_policy" && value && typeof value === "object") {
    const row = value as { session_days?: number; audit_days?: number };
    return `会话 ${row.session_days ?? "—"} 天 · 审计 ${row.audit_days ?? "—"} 天`;
  }
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>)
    .map(([inner, item]) => `${fieldLabel(inner)} ${String(item)}`)
    .join(" · ");
  return String(value);
}

export function friendlyError(error: unknown, fallback = "操作未完成，请稍后重试"): string {
  const raw = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (!raw) return fallback;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as { message?: string; code?: string; detail?: { message?: string; code?: string } };
      const message = parsed.message || parsed.detail?.message;
      if (message && !looksLikeCode(message)) return message;
      return errorTitle(parsed.code || parsed.detail?.code);
    } catch {
      return fallback;
    }
  }
  if (/illegal_edge|unknown_stage|version_conflict|stage_code|collaboration_id/.test(raw)) {
    return raw
      .replace(/必须指定具体目标 stage_code/g, "必须指定具体目标阶段")
      .replace(/不能从当前阶段直接跳到该目标，请按相邻阶段推进/g, "请从主流程、分支流程或异常流程中选择具体阶段")
      .replace(/非法阶段边/g, "请从主流程、分支流程或异常流程中选择具体阶段")
      .replace(/collaboration not found/g, "找不到对应合作")
      .replace(/collaboration_id/g, "合作红人");
  }
  return raw;
}
