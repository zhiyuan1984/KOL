import type { KnowledgeRow } from "./api";
import { stageLabel } from "./labels";
import { MAIN_STAGE_TABS } from "./kolStages";

export const KB_FILL_STASH = "kb_fill_composer";

export const HIDE_REASONS = [
  {
    code: "not_helpful",
    label: "这条对我没帮助",
    result: "已记录反馈，并仅对本账号隐藏；管理员可在反馈处置中跟进。",
  },
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
  prompt: "提示词",
  policy: "口径",
  pattern: "写法样例",
  glossary: "用词",
  question_template: "问题模板",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审批",
  published: "已发布",
  archived: "已停用",
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

/** 列表行元信息的日期（只到日，不带时间）。 */
export function kbDateOnly(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
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

/** 分类选择（族 → 域 → 库）：`?cat=` 启发式 tab 已退役，分类只来自服务端分类字段。 */
export const KB_SCOPE_LEAD = "按 业务族 → 业务域 → 知识库 查找资料；只列出你有权查看的分类。";
export const KB_SCOPE_ALL = "全部";
export const KB_SCOPE_FAMILY = "业务族";
export const KB_SCOPE_DOMAIN = "业务域";
export const KB_SCOPE_BASE = "知识库";
export const KB_SCOPE_NONE = "暂无分类信息。";
export const KB_EMPTY_SCOPE = "这个分类下暂时没有资料。换个分类或清空选择。";
export const KB_SCOPE_CURRENT = "当前范围";
export const KB_SCOPE_CLEAR = "清空筛选";

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

export function kbIsMail(row: Pick<KnowledgeRow, "kind">) {
  return row.kind === "mail_template";
}

/** 行内分类行：族 / 域 / 库，缺字段时诚实省略，不猜。 */
export function kbTaxonomyLine(
  row: Pick<KnowledgeRow, "family_name" | "domain_name" | "base_name" | "base_id">,
): string {
  const parts = [row.family_name, row.domain_name, row.base_name].map((item) => String(item || "").trim());
  if (parts.some(Boolean)) return parts.filter(Boolean).join(" / ");
  return row.base_id ? String(row.base_id) : "";
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

/* ---- 管理端知识治理（六子视图）文案 ----
 * IA（规格 §5.2）：/admin/knowledge 视图枚举 = review | catalog | base | entry | ingest | bindings。
 * 治理只在 Admin；员工面（/kb）不得出现发布 / 停用 / 启用这类治理动作。
 */

export type KbAdminView = "review" | "catalog" | "base" | "entry" | "ingest" | "bindings";

export type KbAdminNavItem = {
  view: KbAdminView;
  path: string;
  label: string;
  question: string;
  /**
   * 深层视图（base / entry）：没有当前对象时是「先去目录选一个」的入口，
   * 页面按 URL 里的 id 决定实际链接；有对象时高亮为当前页。
   */
  contextual?: boolean;
};

export const KB_ADMIN_DEFAULT_PATH = "/admin/knowledge";
export const KB_ADMIN_CATALOG_PATH = "/admin/knowledge/catalog";
export const KB_ADMIN_BASES_PATH = "/admin/knowledge/bases";
export const KB_ADMIN_ENTRIES_PATH = "/admin/knowledge/entries";
export const KB_ADMIN_INGEST_PATH = "/admin/knowledge/ingest";
export const KB_ADMIN_BINDINGS_PATH = "/admin/knowledge/bindings";

/** 子导航顺序 = 路由顺序；深链直接可达，不靠前端状态。 */
export const KB_ADMIN_NAV: KbAdminNavItem[] = [
  { view: "review", path: KB_ADMIN_DEFAULT_PATH, label: "待处置", question: "有什么在等我决定？" },
  { view: "catalog", path: KB_ADMIN_CATALOG_PATH, label: "目录", question: "知识分在哪几个业务域 / 业务主题 / 知识库？" },
  { view: "base", path: KB_ADMIN_BASES_PATH, label: "库", question: "这个库里有哪些条目、什么状态？", contextual: true },
  { view: "entry", path: KB_ADMIN_ENTRIES_PATH, label: "条目", question: "这条知识的治理状态与影响面？", contextual: true },
  { view: "ingest", path: KB_ADMIN_INGEST_PATH, label: "入库", question: "素材入库与提取成败？" },
  { view: "bindings", path: KB_ADMIN_BINDINGS_PATH, label: "引用", question: "哪些技能会拿到哪些知识、为什么？" },
];

export const KB_ADMIN_VIEW_TITLE: Record<KbAdminView, string> = {
  review: "知识待处置",
  catalog: "知识目录",
  base: "知识库",
  entry: "条目详情",
  ingest: "资料入库",
  bindings: "知识引用",
};

export const KB_ADMIN_VIEW_LEAD: Record<KbAdminView, string> = {
  review: "待审、草稿、隔离提案、到期提醒与员工反馈处置汇总在这里；每行只把你带到条目详情。",
  catalog: "业务域 → 业务主题 → 知识库的目录树：分类只做业务归类，不承载权限；权限仍按组织范围与授权。",
  base: "这个库里有哪些内容、处于什么状态；新建只写草稿，发布仍要走审批。",
  entry: "这条知识的治理状态与影响面；主行动按当前状态唯一渲染。",
  ingest: "素材入库与提取的进展与成败。",
  bindings: "绑定决定哪个技能在运行时取哪类知识。保存不等于已注入，下次运行才按新配置解析。",
};

/** 解析跳过原因（含库类型不匹配）。 */
export const KB_SKIP_REASON_LABEL: Record<string, string> = {
  missing: "找不到这条知识",
  not_published: "未发布",
  scope_mismatch: "范围不匹配",
  not_cited: "使用者未启用",
  deprecated_by_user: "使用者已隐藏",
  expired: "已过期",
  shadowed_by_higher_priority: "被同类型更高优先级遮蔽",
  binding_disabled: "绑定已停用",
  wrong_base_type: "所属知识库不是结构化库",
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
  newEntry: "新建条目",
  newBase: "新建知识库",
  newDomain: "新建业务主题",
  newFamily: "新建业务域",
  saveBase: "保存知识库",
  saveDomain: "保存分类",
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
  catalog: "还没有分类。先建「业务域」，再建「业务主题」，最后建「知识库」。",
  domains: "还没有业务域 / 业务主题；知识库必须挂在业务主题下。",
  bases: "这个分类下还没有知识库。",
  basesFiltered: "没有符合当前筛选的知识库。",
  baseMissing: "找不到这个知识库，可能已被归档或删除。",
  entries: "这个库里还没有条目。新建只会写草稿，发布仍要审批。",
  entriesFiltered: "没有符合当前筛选的条目。",
  entryMissing: "找不到这条知识，可能已被删除。",
  structured: "这份知识没有结构化字段（正文即内容）。",
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

/* ---- 分类与结构化（规格 §4.3 / §5.2）---- */

export const KB_LEVEL_FAMILY = "family";
export const KB_LEVEL_DOMAIN = "domain";

export const KB_LEVEL_LABEL: Record<string, string> = {
  family: "业务域",
  domain: "业务主题",
};

export const KB_BASE_KIND_LABEL: Record<string, string> = {
  structured: "结构化",
  unstructured: "非结构化",
};

export function kbLevelLabel(level?: string): string {
  const code = String(level || "").trim();
  return KB_LEVEL_LABEL[code] || code || "分类";
}

export function kbBaseKindLabel(kind?: string): string {
  const code = String(kind || "").trim();
  return KB_BASE_KIND_LABEL[code] || code || "未标类型";
}

export const KB_BASE_STATUS_LABEL: Record<string, string> = {
  active: "启用",
  archived: "已停用",
};

/** 非结构化库（P1，2026-10-02）：解析与检索由 PageIndex 本地承担；先接入 PDF。 */
export const KB_UNSTRUCTURED_P1_NOTE =
  "非结构化资料由 PageIndex 本地承担规整与检索；先接入 PDF，音视频 / PPTX 后续批次。";

export const KB_INGEST_LEAD =
  "上传只写原文库；规整与建索引产出待审资料，发布后才参与检索（审核后生效）。";

/* ---- 非结构化资料（P1）：状态、进度与文案 ---- */

export const KB_DOC_STATUS_LABEL: Record<string, string> = {
  draft: "草稿（未解析）",
  uploaded: "排队中（待加工）",
  normalizing: "规整中",
  indexing: "建索引中",
  pending_review: "待提交审批",
  published: "已发布",
  archived: "已停用",
  failed: "失败",
  cancelled: "已取消",
};

export const KB_DOC_JOB_KIND_LABEL: Record<string, string> = { normalize: "规整", index: "索引" };

export const KB_DOC_JOB_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  done: "完成",
  failed: "失败",
  cancelled: "已取消",
};

export const KB_DOC_ACTION = {
  upload: "上传资料",
  submit: "上传并开始加工",
  retry: "重试",
  cancel: "取消",
  remove: "删除",
  publish: "发布",
  reprocess: "重新加工",
  archive: "归档",
  detail: "详情",
  collapse: "收起",
  openSource: "打开原文件",
  trial: "试算",
  trialRun: "运行试算",
} as const;

export const KB_DOC_EMPTY = {
  bases: "还没有非结构化知识库；先在「目录」里创建一个，再回来上传 PDF。",
  documents: "还没有资料；到「入库」上传 PDF。",
  documentsAll: "还没有资料。上传一份 PDF，加工完成后到「待处置」发布。",
  jobs: "暂无作业记录。",
  trial: "还没有试算结果；发布资料后在这里直接提问。",
  preview: "暂无留档稿（转写稿 / 抽取稿）。",
} as const;

export const KB_DOC_TRIAL_LEAD =
  "试算直接返回 PageIndex 的答案与页级引用；未发布资料默认不参与，审批单份资料时可用「仅审核试算」。";

export function kbDocStatusLabel(status?: string): string {
  const code = String(status || "").trim();
  return KB_DOC_STATUS_LABEL[code] || code || "—";
}

/** 真实进度文案：只来自最新作业的真实分子/分母；索引阶段无细分进度就如实写明。 */
export function kbDocProgressText(doc: {
  latest_job?: { kind?: string; status?: string; progress_done?: number; progress_total?: number } | null;
}): string {
  const job = doc.latest_job;
  if (!job) return "";
  const kind = String(job.kind || "");
  const status = String(job.status || "");
  if (status === "queued") return "排队中";
  if (status !== "running") return "";
  if (kind === "index") return "建索引中（无细分进度）";
  const done = Number(job.progress_done || 0);
  const total = Number(job.progress_total || 0);
  return total > 0 ? `规整中 ${done}/${total}` : "规整中";
}

export const KB_STRUCTURED_LEAD =
  "结构化字段按类型定义渲染（与 config/knowledge-kinds.yaml 同步）；保存只写草稿，发布仍要审批。";

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

/** 到期显示的语义状态；无期限或超过 30 天不显示。 */
export function kbExpiryState(expiresAt?: string): "expired" | "soon" | null {
  const raw = String(expiresAt || "").trim();
  const at = new Date(raw).getTime();
  if (!raw || Number.isNaN(at)) return null;
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  if (days < 0) return "expired";
  return days <= 30 ? "soon" : null;
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

/** 阶段代码按 SOP 自然序排序（筛选标签展示用）；未知代码排最后。 */
export function sortStageCodes(codes: string[]): string[] {
  const rank = (code: string) => {
    const index = MAIN_STAGE_TABS.findIndex((item) => item.code === code);
    return index < 0 ? MAIN_STAGE_TABS.length : index;
  };
  return [...codes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** 适用 chips：阶段给中文标签、品牌只留值；单行行内省阶段（withStage=false），右栏保留。没有就诚实写「全阶段 / 通用」。 */
export function kbScopeTags(
  row: Pick<KnowledgeRow, "stage_codes" | "brand">,
  opts?: { withStage?: boolean },
): string[] {
  const stages = (row.stage_codes || []).map((code) => stageLabel(code)).filter(Boolean);
  const brand = String(row.brand || "").trim();
  const tags: string[] = [];
  if (opts?.withStage !== false) tags.push(stages.length ? `阶段：${stages.join(" / ")}` : "全阶段");
  tags.push(brand && brand !== "*" ? brand : "通用");
  return tags;
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
