import type { KnowledgeRow } from "./api";
import { stageLabel } from "./labels";

export const KB_FILL_STASH = "kb_fill_composer";

export const HIDE_REASONS = [
  {
    code: "outdated",
    label: "内容过时",
    result: "对本账号隐藏；写邮件时不再带上这份资料；已发信不受影响。",
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
  starter?: string;
  skill_id: string;
  body?: string;
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

/** Prefer the English mail body in the composer; fall back to the short starter. */
export function composerFillText(
  row: Partial<Pick<KnowledgeRow, "body_en" | "body" | "title" | "placeholders" | "starter">>,
): string {
  const body = String(row.body_en || row.body || "");
  if (body.trim()) return body;
  return composerStarter({
    title: row.title || "",
    placeholders: row.placeholders,
    starter: row.starter,
  });
}

export function composerHoldsTemplateBody(value: string, body?: string): boolean {
  const compact = (text: string) => text.replace(/\s+/g, " ").trim();
  const needle = compact(body || "");
  if (!needle) return false;
  return compact(value).includes(needle);
}

export function stashComposerFill(row: KnowledgeRow) {
  const payload: KbFillStash = {
    ...lockedTemplateFromRow(row),
    body: row.body || "",
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
    if (!parsed?.id) return null;
    if (!composerFillText(parsed).trim()) return null;
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

export const KB_FAVORITES_KEY = "kb:favorites";
export const KB_RECENT_KEY = "kb:recent";
export const KB_LEAD = "选择适合当前任务的资料，AI 会据此生成草稿。正式发送前仍需要你确认。";
export const KB_MARKET_LEAD = "这些是组织已发布、可直接选用的资料。选一份后，AI 会据此生成草稿。正式发送前仍需要你确认。";

export type KbBrowseTab = "all" | "mail" | "brand" | "sop" | "quote" | "recent";

export const KB_TAB_LABEL: Record<KbBrowseTab, string> = {
  all: "全部资料",
  sop: "KOL合作SOP",
  mail: "邮件模板",
  brand: "品牌与产品",
  quote: "报价与谈判",
  recent: "最近使用",
};

export function kbKicker(tab: KbBrowseTab) {
  return tab === "all" ? "知识库" : `知识库 · ${KB_TAB_LABEL[tab]}`;
}

export function kbSanitizeEmployeeCopy(text?: string) {
  return String(text || "")
    .replace(/Codex\s*harness/gi, "")
    .replace(/Codex/gi, "")
    .replace(/Harness/gi, "")
    .replace(/发送不等于推进阶段/g, "")
    .replace(/发送不等于改阶段/g, "")
    .replace(/\s+[。.]{2,}/g, "。")
    .replace(/\s+/g, " ")
    .trim();
}

function kbHaystack(row: Pick<KnowledgeRow, "title" | "tags" | "body" | "kind" | "subject">) {
  return [row.title, row.tags, row.body, row.kind, row.subject].filter(Boolean).join(" ");
}

export function kbIsMail(row: Pick<KnowledgeRow, "kind">) {
  return row.kind === "mail_template";
}

export function kbIsQuote(
  row: Pick<KnowledgeRow, "title" | "tags" | "body" | "kind" | "subject" | "stage_codes">,
) {
  const stages = row.stage_codes || [];
  if (stages.some((code) => code === "QUOTE_PENDING" || code === "NEGOTIATING")) return true;
  return /报价|谈判|审批带/.test(kbHaystack(row));
}

export function kbIsBrandProduct(
  row: Pick<KnowledgeRow, "title" | "tags" | "body" | "kind" | "subject">,
) {
  if (kbIsMail(row)) return false;
  return /品牌资料|产品资料|产品规格|卖点|参数表/.test(kbHaystack(row));
}

export function kbIsSop(
  row: Pick<KnowledgeRow, "title" | "tags" | "body" | "kind" | "subject" | "stage_codes">,
) {
  if (kbIsMail(row) || kbIsQuote(row) || kbIsBrandProduct(row)) return false;
  if (row.kind === "policy" || row.kind === "pattern") return true;
  return /SOP|口径|门槛|核验|流程/.test(kbHaystack(row));
}

export function kbMatchesTab(
  row: KnowledgeRow,
  tab: KbBrowseTab,
  recentIds: string[],
) {
  if (tab === "all") return true;
  if (tab === "mail") return kbIsMail(row);
  if (tab === "brand") return kbIsBrandProduct(row);
  if (tab === "sop") return kbIsSop(row);
  if (tab === "quote") return kbIsQuote(row);
  if (tab === "recent") return recentIds.includes(row.id);
  return true;
}

export function kbVisibleTabs(rows: KnowledgeRow[], recentIds: string[]): KbBrowseTab[] {
  const tabs: KbBrowseTab[] = ["all"];
  if (rows.some(kbIsSop)) tabs.push("sop");
  if (rows.some(kbIsMail)) tabs.push("mail");
  if (rows.some(kbIsBrandProduct)) tabs.push("brand");
  if (rows.some(kbIsQuote)) tabs.push("quote");
  tabs.push("recent");
  return tabs;
}

export function kbStatusLabel(row: Pick<KnowledgeRow, "deprecated" | "status">) {
  if (row.deprecated) return "已隐藏";
  if (!row.status || row.status === "published") return "已发布";
  return statusLabel(row.status);
}

export function kbScopeLine(row: Pick<KnowledgeRow, "stage_codes" | "brand" | "kind">) {
  const stages = (row.stage_codes || []).map((code) => stageLabel(code)).filter(Boolean);
  const brand = row.brand ? brandLabel(row.brand) : "";
  const parts: string[] = [];
  if (brand) parts.push(`品牌 ${brand}`);
  if (stages.length) parts.push(`阶段 ${stages.join(" / ")}`);
  if (!parts.length) return "";
  return `适用：${parts.join(" · ")}`;
}

export function kbSummary(row: Pick<KnowledgeRow, "kind" | "subject" | "body_en" | "body" | "title">) {
  const raw = kbIsMail(row)
    ? (row.subject || templateBodyExcerpt(row.body_en || row.body, 90))
    : templateBodyExcerpt(row.body, 90);
  return kbSanitizeEmployeeCopy(raw) || row.title || "暂无摘要。";
}

export function kbVariableLine(row: Pick<KnowledgeRow, "placeholders">) {
  const vars = (row.placeholders || []).map((part) => part.replace(/^\[|\]$/g, "")).filter(Boolean);
  if (!vars.length) return "";
  return `待填：${vars.join("、")}`;
}

export function kbProvenanceLine(
  row: Pick<KnowledgeRow, "current_version" | "updated_at" | "approved_at" | "created_at" | "created_by" | "status">,
) {
  const bits: string[] = [];
  if (row.current_version) bits.push(`第 ${row.current_version} 版`);
  const when = formatKbTime(row.updated_at || row.approved_at || row.created_at);
  if (when) bits.push(`更新于 ${when}`);
  bits.push(!row.created_by || row.created_by === "system" ? "来源 组织发布" : `来源 ${row.created_by}`);
  return bits.join(" · ");
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readKbFavorites(): string[] {
  const ids = readJson<string[]>(KB_FAVORITES_KEY, []);
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

export function writeKbFavorites(ids: string[]) {
  try {
    localStorage.setItem(KB_FAVORITES_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore quota / private mode */
  }
}

export function toggleKbFavorite(id: string): string[] {
  const current = readKbFavorites();
  const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
  writeKbFavorites(next);
  return next;
}

export function readKbRecent(): { id: string; at: number }[] {
  const rows = readJson<{ id: string; at: number }[]>(KB_RECENT_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row?.id).sort((a, b) => b.at - a.at);
}

export function rememberKbRecent(id: string): { id: string; at: number }[] {
  const next = [{ id, at: Date.now() }, ...readKbRecent().filter((row) => row.id !== id)].slice(0, 20);
  try {
    localStorage.setItem(KB_RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}
