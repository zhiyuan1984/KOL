import type { KnowledgeRow } from "./api";

export const KB_FILL_STASH = "kb_fill_composer";

export const HIDE_REASONS = [
  {
    code: "outdated",
    label: "内容过时",
    result: "对本账号隐藏；写邮件不再带进 Codex；已发信不受影响。",
  },
  {
    code: "brand_mismatch",
    label: "品牌用不上",
    result: "不是我负责的品牌；仅本账号隐藏，别人和已发信都不变。",
  },
  {
    code: "pep_risk",
    label: "发出去容易被拦",
    result: "缺收件人、中文正文或模板不符时系统会拦发送。仅本账号隐藏，不会改已发信。",
  },
] as const;

const KIND_LABEL: Record<string, string> = {
  mail_template: "邮件模板",
  policy: "口径",
  pattern: "写法样例",
  glossary: "用词",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审批",
  published: "已发布",
  archived: "已归档",
};

const BRAND_LABEL: Record<string, string> = {
  LT: "LiTime",
  RO: "Renogy",
  PQ: "PowerQueen",
  "*": "全品牌",
};

const SKILL_LABEL: Record<string, string> = {
  email_compose: "写合作邮件",
  confirm_stage: "提出阶段变更",
  reply_analysis: "回复分析",
  risk_scan: "超时/风险扫描",
  deal_memory: "合作备忘",
  creator_discovery: "达人发现",
  creator_profile: "达人画像",
  creator_scoring: "达人评分",
  creator_outreach: "达人建联话术",
  creator_library_query: "达人库查询",
  creator_library_all: "达人库全量",
  creator_library_sync: "达人同步入库",
  creator_filter_options: "达人筛选字典",
  creator_status_update: "达人状态更新",
  creator_owner_update: "更新红人负责人",
  creator_contact_decrypt: "解密达人联系方式",
  creator_lifecycle_kanban: "合作生命周期看板",
  creator_risk_conversations: "达人风险会话",
  creator_daily_tasks: "今日 KOL 任务",
  creator_budget_report: "KOL 预算报告",
  email_conversation_list: "邮件会话列表",
  email_conversation_read: "邮件会话详情",
  email_mailbox_list: "品牌邮箱列表",
  email_app_conversation_list: "应用邮件会话",
};

const PROPOSAL_KIND: Record<string, string> = {
  skill_patch: "技能补丁（隔离）",
  template_patch: "模板补丁（隔离）",
  brand_transfer: "复制到另一品牌邮箱",
};

const PROPOSAL_STATUS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准（未改线上技能说明）",
  rejected: "已否决并留档",
};

const JOB_STATUS: Record<string, string> = {
  queued: "排队中",
  running: "抽取中",
  done: "已抽出待审页",
  failed: "抽取失败",
};

export type LockedMailTemplate = {
  id: string;
  title: string;
  subject?: string;
  body_en?: string;
};

export type KbFillStash = LockedMailTemplate & {
  starter: string;
  skill_id: string;
};

export function lockedTemplateFromRow(
  row: Pick<KnowledgeRow, "id" | "title"> & Partial<Pick<KnowledgeRow, "subject" | "body_en" | "body">>,
): LockedMailTemplate {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject || "",
    body_en: row.body_en || row.body || "",
  };
}

export function pickDefaultMailTemplate<T extends Pick<KnowledgeRow, "id" | "stage_codes">>(
  rows: T[],
  stageCode?: string | null,
): T | null {
  if (!rows.length) return null;
  const stage = String(stageCode || "").trim();
  const staged = stage
    ? rows.filter((row) => {
      const codes = row.stage_codes || [];
      return !codes.length || codes.includes(stage);
    })
    : rows;
  return staged[0] || null;
}

export function templateBodyExcerpt(body?: string, max = 160) {
  const compact = String(body || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trimEnd()}…`;
}

export function kindLabel(kind?: string) {
  return KIND_LABEL[kind || ""] || kind || "知识";
}

export function statusLabel(status?: string) {
  return STATUS_LABEL[status || ""] || status || "";
}

export function brandLabel(brand?: string) {
  if (!brand) return "全品牌";
  return BRAND_LABEL[brand] || brand;
}

export function skillLabel(skill?: string) {
  if (!skill) return "未绑定技能";
  return SKILL_LABEL[skill] || (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(skill) ? "技能" : skill);
}

export const SKILL_OPTIONS = Object.entries(SKILL_LABEL).map(([id, label]) => ({ id, label }));

export function proposalKindLabel(kind?: string) {
  return PROPOSAL_KIND[kind || ""] || kind || "提案";
}

export function proposalStatusLabel(status?: string) {
  return PROPOSAL_STATUS[status || ""] || status || "";
}

export function jobStatusLabel(status?: string) {
  return JOB_STATUS[status || ""] || status || "";
}

export function hideReasonLabel(code?: string) {
  return HIDE_REASONS.find((item) => item.code === code)?.label || code || "";
}

export function composerStarter(row: Pick<KnowledgeRow, "title" | "placeholders" | "starter">) {
  if (row.starter) return row.starter;
  const title = (row.title || "").trim();
  const placeholders = row.placeholders || [];
  if (!placeholders.length) return title;
  return `${title} ${placeholders.map((part) => (part.startsWith("[") ? part : `[${part}]`)).join(" ")}`;
}

export function stashComposerFill(row: KnowledgeRow) {
  const payload: KbFillStash = {
    ...lockedTemplateFromRow(row),
    starter: composerStarter(row),
    skill_id: row.skill_id || row.intent || "",
  };
  try {
    sessionStorage.setItem(KB_FILL_STASH, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
  return payload;
}

export function peekComposerFill(): KbFillStash | null {
  try {
    const raw = sessionStorage.getItem(KB_FILL_STASH);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KbFillStash;
    if (!parsed?.id || !parsed.starter) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearComposerFill() {
  try {
    sessionStorage.removeItem(KB_FILL_STASH);
  } catch {
    /* ignore */
  }
}

export function formatKbTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function versionLine(ver: Record<string, unknown>) {
  const n = Number(ver.version || 0);
  const when = formatKbTime(String(ver.created_at || ""));
  const note = String(ver.note || "").trim() || "保存";
  return `第 ${n} 版${when ? ` · ${when}` : ""} · ${note}`;
}
