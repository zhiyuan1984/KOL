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
  creator_daily_tasks: "今日任务",
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

/* ---- 管理端知识治理（六子视图）文案 ---- */

export type KbAdminView = "todo" | "assets" | "detail" | "ingest" | "bindings" | "feedback";

export type KbAdminNavItem = {
  view: Exclude<KbAdminView, "detail">;
  path: string;
  label: string;
  question: string;
};

export const KB_ADMIN_DEFAULT_PATH = "/admin/knowledge";
export const KB_ADMIN_ASSETS_PATH = "/admin/knowledge/assets";

/** 子导航顺序 = 路由顺序；深链直接可达，不靠前端状态。 */
export const KB_ADMIN_NAV: KbAdminNavItem[] = [
  { view: "todo", path: KB_ADMIN_DEFAULT_PATH, label: "待办", question: "有什么在等我决定？" },
  { view: "assets", path: KB_ADMIN_ASSETS_PATH, label: "资产", question: "有哪些资产、什么状态、被谁用？" },
  { view: "ingest", path: "/admin/knowledge/ingest", label: "入库", question: "素材入库与提取成败？" },
  { view: "bindings", path: "/admin/knowledge/bindings", label: "引用", question: "哪些技能会拿到哪些知识、为什么？" },
  { view: "feedback", path: "/admin/knowledge/feedback", label: "反馈", question: "员工反馈了什么、怎么处置？" },
];

export const KB_ADMIN_VIEW_TITLE: Record<KbAdminView, string> = {
  todo: "知识待办",
  assets: "知识资产",
  detail: "资产详情",
  ingest: "资料入库",
  bindings: "知识引用",
  feedback: "反馈处置",
};

export const KB_ADMIN_VIEW_LEAD: Record<KbAdminView, string> = {
  todo: "待审、草稿、隔离提案与到期提醒汇总在这里；每行只把你带到详情。",
  assets: "全部知识资产与治理状态。行点开是详情；新建只写草稿，发布仍要审批。",
  detail: "这份资产的治理状态与影响面；主行动按当前状态唯一渲染。",
  ingest: "上传只进原文库；抽取只生成待审草稿，不会自动发布。",
  bindings: "绑定决定哪个技能在运行时取哪类知识。保存不等于已注入，下次运行才按新配置解析。",
  feedback: "员工隐藏知识的原因与处置；处置写审计与回执，不自动改主文档。",
};

/** 解析跳过原因（8 个枚举全覆盖）。 */
export const KB_SKIP_REASON_LABEL: Record<string, string> = {
  missing: "找不到这条知识",
  not_published: "未发布",
  scope_mismatch: "范围不匹配",
  not_cited: "使用者未启用",
  deprecated_by_user: "使用者已隐藏",
  expired: "已过期",
  shadowed_by_higher_priority: "被同类型更高优先级遮蔽",
  binding_disabled: "绑定已停用",
};

export function kbSkipReasonLabel(reason?: string): string {
  const code = String(reason || "").trim();
  if (!code) return "未给出原因";
  return KB_SKIP_REASON_LABEL[code] || code;
}

export const KB_ADMIN_ACTION = {
  viewDetail: "查看",
  edit: "编辑",
  approve: "审批发布",
  saveVersion: "保存为新版本",
  createDraft: "新建知识",
  saveDraft: "保存草稿",
  upload: "上传资料",
  extract: "抽取成待审页",
  retry: "重试",
  newBinding: "新增绑定",
  saveBinding: "保存绑定",
  preview: "试算",
  toRevision: "转修订",
  archive: "归档",
  ignore: "忽略",
  approveProposal: "批准",
  rejectProposal: "否决",
  rollback: "回滚",
  compare: "对比所选两版",
  clearCompare: "清除对比",
  expandVersion: "展开全文",
  collapseVersion: "收起全文",
} as const;

export const KB_ADMIN_EMPTY = {
  review: "没有待审批的知识。",
  drafts: "没有还没发布的草稿。",
  proposals: "暂无隔离提案。",
  expiry: "30 天内没有到期的知识。",
  assets: "还没有知识资产。可以新建一份草稿，或先去「入库」上传素材。",
  assetsFiltered: "没有符合当前筛选的资产。",
  detailMissing: "找不到这份知识，可能已被删除。",
  versions: "还没有版本记录。",
  refs: "暂时没有技能绑定会解析到这份知识。",
  grants: "没有授权行：已发布即对全部账号可见。",
  ingestRaw: "暂无原文。失败会话（催大纲缺创作者、报价被拦）会自动出现在这里。",
  ingestJobs: "还没有提取作业。",
  bindings: "还没有绑定：技能会按现行「本人已启用 + 阶段优先」回退挑选。",
  bindingsFiltered: "没有符合当前筛选的绑定。",
  previewResolved: "这次试算没有命中任何知识。",
  previewSkipped: "这次试算没有跳过项。",
  feedback: "还没有员工反馈。",
  feedbackAggregate: "暂无可聚合的反馈原因。",
};

export function kbFeedbackActionLabel(action?: string): string {
  const map: Record<string, string> = { to_revision: "已转修订", archive: "已归档", ignore: "已忽略" };
  const code = String(action || "").trim();
  return map[code] || code || "—";
}

export function kbFeedbackReasonLabel(reason?: string): string {
  return hideReasonLabel(reason) || reason || "";
}

/** 到期提醒只做提示，不自动动作。 */
export function kbExpiryLabel(expiresAt?: string): string {
  const raw = String(expiresAt || "").trim();
  if (!raw) return "";
  const at = new Date(raw).getTime();
  if (Number.isNaN(at)) return `到期时间：${raw}`;
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  return `${days} 天后到期`;
}

/* ---- 员工端 /kb：服务端搜索、适用筛选与来源溯源（阶段 3）---- */

export const KB_SEARCH_LABEL = "搜索资料";
export const KB_SEARCH_PLACEHOLDER = "搜标题、主题或正文关键词";
export const KB_SEARCH_CLEAR = "清空搜索";
export const KB_FILTER_ALL = "全部";
export const KB_FILTER_LABEL: Record<"stage" | "brand", string> = {
  stage: "适用阶段",
  brand: "适用品牌",
};
export const KB_LOADING = "正在加载资料…";
export const KB_EMPTY_SEARCH = "没有匹配的资料。换个关键词，或清空搜索看全部。";
export const KB_EMPTY_FILTER = "没有符合当前适用筛选的资料。放宽阶段或品牌再看。";
export const KB_PROVENANCE_TITLE = "来源与版本";
export const KB_PROVENANCE_LABEL = {
  author: "发布人",
  version: "版本",
  updated: "更新时间",
  scope: "适用",
} as const;

/** 行内适用 chips：有阶段/品牌就显示代码，没有就诚实写「全阶段 / 通用」。 */
export function kbScopeTags(row: Pick<KnowledgeRow, "stage_codes" | "brand">): string[] {
  const stages = (row.stage_codes || []).map((code) => String(code || "").trim()).filter(Boolean);
  const brand = String(row.brand || "").trim();
  return [
    stages.length ? `阶段：${stages.join(" / ")}` : "全阶段",
    brand && brand !== "*" ? `品牌：${brand}` : "通用",
  ];
}

/** 与后端 knowledgeListFilters 同口径：无阶段/无品牌行视为通用，不被筛选排除。 */
export function kbMatchesFilter(
  row: Pick<KnowledgeRow, "stage_codes" | "brand">,
  stage: string,
  brand: string,
): boolean {
  if (stage) {
    const codes = row.stage_codes || [];
    if (codes.length && !codes.includes(stage)) return false;
  }
  if (brand) {
    const code = String(row.brand || "*");
    if (code !== "*" && code !== brand) return false;
  }
  return true;
}

export function kbRowVersionLine(
  row: Pick<KnowledgeRow, "current_version" | "updated_at" | "approved_at" | "created_at">,
): string {
  const bits: string[] = [];
  if (row.current_version) bits.push(`第 ${row.current_version} 版`);
  const when = formatKbTime(row.updated_at || row.approved_at || row.created_at);
  if (when) bits.push(`更新于 ${when}`);
  return bits.join(" · ");
}

export function kbAuthorLabel(createdBy?: string): string {
  const name = String(createdBy || "").trim();
  return !name || name === "system" ? "组织发布" : name;
}

export function kbVersionTag(version?: number): string {
  return version ? `v${version}` : "版本未知";
}
