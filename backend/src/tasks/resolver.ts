import { extractHandle } from "../host/intent.js";
import { parseQuoteOffer, parseQuoteRate } from "../host/quote-amount.js";
import { taskDefinition, taskDefinitions, type TaskDefinition } from "./registry.js";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;
const FROM_LABEL_RE = /(?:发件箱|发件邮箱|发件(?!给)|From)\s*[:：]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const TO_LABEL_RE = /(?:(?<!发)发给|收件邮箱|收件人|收件(?!箱)|To)\s*[:：]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;

export type ClarificationKind = "none" | "missing_fields" | "direction";

export type TaskResolution = {
  task_type: string | null;
  confidence: number;
  entities: Record<string, unknown>;
  missing_fields: string[];
  alternatives: { task_type: string; title: string; confidence: number }[];
  needs_clarification: boolean;
  clarification_kind: ClarificationKind;
};

const ENTITY_PATTERNS: Record<string, RegExp> = {
  tracking: /(?:运单号|运单|tracking)\s*[:：]?\s*([A-Z0-9]{6,})/i,
  carrier: /(?:承运商|carrier)\s*[:：]?\s*([A-Za-z0-9\u4e00-\u9fff]+)/i,
  eta: /(?:ETA|eta|预计)\s*[:：]?\s*(\S+)/,
};
const LIBRARY_QUERY_NOISE = /请|帮我|查询达人库|达人库查询|达人筛选|按关键词、合作阶段和风险标签分页查询红人库|\[关键词\]/gi;

/** Pull a library-search keyword from operator text without treating the skill description as a query. */
export function libraryQueryKeyword(text: string): string {
  const labeled = /(?:关键词|keyword)\s*[:：]\s*([^，,。；\n]+)/i.exec(text)?.[1]
    ?.replace(/\s*(?:状态|等级|合作阶段|风险标签?|负责人)\s*[:：].*$/, "")
    .trim()
    .replace(/^\[|\]$/g, "");
  if (labeled && labeled !== "关键词") return labeled;
  if (!/查询达人库|达人库查询|达人筛选/.test(text)) return "";
  const bracket = [...text.matchAll(/\[([^\[\]]+)\]/g)]
    .map((match) => match[1].trim())
    .find((value) => value && value !== "关键词");
  if (bracket) return bracket;
  const stripped = text.replace(LIBRARY_QUERY_NOISE, " ").replace(/\s+/g, " ").trim();
  if (!stripped || stripped.length > 80) return "";
  if (/合作阶段|风险标签|分页查询|红人库/.test(stripped)) return "";
  return stripped;
}

const PLATFORM_NAMES: Array<[RegExp, string]> = [
  [/youtube|油管|youtu\.be/i, "youtube"],
  [/instagram|\binsta\b|\big\b/i, "instagram"],
  [/facebook|\bfb\b/i, "facebook"],
  [/小红书|xhs/i, "xhs"],
  [/抖音|\bdy\b/i, "dy"],
  [/快手|\bks\b/i, "ks"],
  [/哔哩哔哩|B站|\bbili\b/i, "bili"],
  [/微博|\bwb\b/i, "wb"],
  [/贴吧|tieba/i, "tieba"],
  [/知乎|zhihu/i, "zhihu"],
];

export function extractTaskEntities(text: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};
  for (const [key, pattern] of Object.entries(ENTITY_PATTERNS)) {
    const match = pattern.exec(text);
    if (match) entities[key] = match[1];
  }
  const rate = parseQuoteRate(text);
  const offer = parseQuoteOffer(text);
  if (rate.amount_usd != null) {
    entities.amount_usd = rate.amount_usd;
    entities.currency = rate.currency || "USD";
    if (rate.rate_unit) entities.rate_unit = rate.rate_unit;
  }
  if (offer.deliverables) entities.deliverables = offer.deliverables;
  // Same handle rules as Host classify(): skill mentions such as
  // @写合作邮件 are not KOL handles, and a later @红人 still binds.
  const handle = extractHandle(text);
  if (handle) entities.handle = handle;
  const platform = PLATFORM_NAMES.find(([pattern]) => pattern.test(text))?.[1];
  if (platform) entities.platform = platform;
  const creatorId = /(?:达人|creator)[ _-]?(?:ID|id|编号)\s*[:：]?\s*(\d+)/i.exec(text)?.[1];
  if (creatorId) entities.creator_id = Number(creatorId);
  const kolUid = /(?:红人|达人|KOL)[ _-]?(?:UID|uid|编号)\s*[:：]?\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1]
    || /kolUid\s*[:：]?\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1];
  if (kolUid) entities.kolUid = kolUid;
  const followers = /(?:粉丝数?|followers?)\s*[:：]?\s*(\d+)/i.exec(text)?.[1];
  if (followers) entities.followers = Number(followers);
  const viewsText = /(?:最近)?(?:播放量|播放|views?)\s*[:：]?\s*([0-9、，,\s]+)/i.exec(text)?.[1];
  if (viewsText) {
    const views = viewsText.split(/[、，,\s]+/).map(Number).filter(Number.isFinite);
    if (views.length) entities.views = views;
  }
  const price = /(?:当前)?(?:报价|价格|price)\s*[:：]?\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1];
  if (price) entities.price = Number(price);
  const targetCpm = /(?:目标)?CPM\s*[:：]?\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1];
  if (targetCpm) entities.target_cpm = Number(targetCpm);
  const campaignId = /(?:项目|campaign)[ _-]?(?:ID|id|编号)\s*[:：]?\s*(\d+)/i.exec(text)?.[1];
  if (campaignId) entities.campaign_id = Number(campaignId);
  const grade = /(?:等级|评级|grade)\s*[:：]?\s*([SABCD])/i.exec(text)?.[1];
  if (grade) entities.grade = grade.toUpperCase();
  const status = /(?:建联)?状态\s*[:：]?\s*(未建联|待建联|已建联|已回复(?:-有兴趣)?|确定合作|已签约|初步接触)/.exec(text)?.[1]
    || /(?:标记为|改成|改为)\s*(未建联|待建联|已建联|已回复(?:-有兴趣)?|确定合作|已签约|初步接触)/.exec(text)?.[1];
  if (status) entities.status = status;
  const confirmed = /(?:合作确认|confirmed)\s*[:：]?\s*(确定合作|放弃)/i.exec(text)?.[1];
  if (confirmed) entities.confirmed = confirmed;
  const wechat = /(?:微信|wechat)\s*[:：]?\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1];
  if (wechat) entities.wechat = wechat;
  const notes = /(?:备注|沟通记录)\s*[:：]?\s*([^。；]+)/.exec(text)?.[1]?.trim();
  if (notes) entities.notes = notes;
  const product = /(?:产品|product)\s*[:：]?\s*([^，,。；]+)/i.exec(text)?.[1]?.trim();
  if (product) entities.product = product;
  const creatorName = (
    /(?:达人名称|达人昵称|名称|昵称)\s*[:：]\s*[“"]?([^，,。；\s”"]+)/.exec(text)?.[1]
    || /(?:达人画像|达人评分|达人建联话术|达人状态更新|达人同步入库|生成建联话术|更新达人状态|记录达人跟进|添加达人|同步达人)\s+[:：]?\s*[“"]?([^，,。；\s”"]+)/.exec(text)?.[1]
  );
  if (
    creatorName
    && !/[:：]/.test(creatorName)
    && !/^(粉丝|播放量|播放|状态|备注|等级|查询|达人ID|ID|编号|目标|产品|微信)/i.test(creatorName)
  ) {
    entities.name = creatorName;
  }
  const foundEmails = [...text.matchAll(EMAIL_RE)].map((match) => match[0]);
  const labeledFrom = FROM_LABEL_RE.exec(text)?.[1] || "";
  const labeledTo = TO_LABEL_RE.exec(text)?.[1] || "";
  if (labeledFrom) entities.mailboxEmail = labeledFrom;
  if (foundEmails.length) {
    const to = foundEmails.filter((email) => email.toLowerCase() !== labeledFrom.toLowerCase());
    if (labeledTo) {
      entities.to = [labeledTo, ...to.filter((email) => email.toLowerCase() !== labeledTo.toLowerCase())];
      entities.email = labeledTo;
    } else if (to.length) {
      entities.to = to;
      entities.email = to[0];
    } else if (!labeledFrom) {
      entities.to = foundEmails;
      entities.email = foundEmails[0];
    }
  }
  const conversationId = /(?:会话|conversation|thread)[ _-]?(?:ID|id|编号)?\s*[:：]?\s*(\d+)/i.exec(text)?.[1];
  if (conversationId) entities.conversationId = Number(conversationId);
  const mailboxId = /(?:邮箱|mailbox)[ _-]?(?:ID|id|编号)\s*[:：]?\s*(\d+)/i.exec(text)?.[1];
  if (mailboxId) entities.mailboxId = Number(mailboxId);
  const keyword = libraryQueryKeyword(text);
  if (keyword) entities.keyword = keyword;
  const owner = /(?:红人)?负责人\s*[:：]\s*([^\s，,。；]+)/.exec(text)?.[1];
  if (owner) entities.owner = owner;
  const parentKey = /(?:parentKey|字典)\s*[:：]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1];
  if (parentKey) entities.parentKey = parentKey;
  const subject = /(?:主题|subject)\s*[:：]\s*([^。；\n]+)/i.exec(text)?.[1]
    ?.trim()
    .replace(/\s*(确认发送|confirm[_ ]?send)\s*$/i, "")
    .trim();
  // Template prompts such as “主题：[主题]” describe a missing field; they
  // must not be treated as a real subject and accidentally pass the resolver.
  if (subject && !/^\[(?:主题|subject)\]$/i.test(subject)) entities.subject = subject;
  if (/确认发送|confirm[_ ]?send/i.test(text)) entities.confirm_send = true;
  if (/加一封|再发一封|再写一封|再来一封/.test(text)) entities.another_letter = true;
  if (/(搜索|查找|寻找|发现).*(达人|KOL|创作者)/i.test(text)) {
    const keywordText = PLATFORM_NAMES.reduce((value, [pattern]) => value.replace(pattern, " "), text)
      .replace(/搜索|查找|寻找|发现|达人|KOL|创作者|请|帮我/gi, " ")
      .replace(/[“”"'。！？]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const keywords = keywordText.split(/[、，,]/).map((value) => value.trim()).filter(Boolean);
    if (keywords.length) entities.keywords = keywords;
  }
  return entities;
}

export function mergeExtractedOntoIntent(
  intent: { amount_usd: number | null; tracking: string | null; carrier: string | null; eta: string | null; extras: Record<string, unknown> },
  extracted: Record<string, unknown>,
): void {
  if (intent.amount_usd == null && extracted.amount_usd != null && Number.isFinite(Number(extracted.amount_usd))) {
    intent.amount_usd = Number(extracted.amount_usd);
  }
  if (!intent.tracking && extracted.tracking) intent.tracking = String(extracted.tracking);
  if (!intent.carrier && extracted.carrier) intent.carrier = String(extracted.carrier);
  if (!intent.eta && extracted.eta) intent.eta = String(extracted.eta);
  if (extracted.rate_unit && intent.extras.rate_unit == null) {
    intent.extras = { ...intent.extras, rate_unit: extracted.rate_unit };
  }
  if (extracted.deliverables && intent.extras.deliverables == null) {
    intent.extras = { ...intent.extras, deliverables: extracted.deliverables };
  }
}

function namedMailCommand(text: string): boolean {
  return /催大纲|发货通知|核对地址|寄样地址核对/.test(text);
}

function missing(
  definition: TaskDefinition,
  entities: Record<string, unknown>,
  supplied: Record<string, unknown>,
  text = "",
): string[] {
  return definition.required_inputs.filter((field) => {
    if (field === "collaboration_id" && (entities.handle || supplied.handle)) return false;
    if (
      definition.id === "email_compose"
      && (entities.conversationId || supplied.conversationId)
    ) return false;
    // Existing collaboration / @红人 locks From/To (and the stage letter
    // supplies the subject). Do not keep the employee on the home intake card.
    if (
      definition.id === "email_compose"
      && (entities.handle || supplied.handle || entities.collaboration_id || supplied.collaboration_id)
      && (field === "mailboxEmail" || field === "to" || field === "subject")
    ) return false;
    // Named letters (催大纲 / 核地址 / 发货) have their own Host supplement
    // or stage gate. Do not block them on the first-touch From/To/Subject card.
    if (
      definition.id === "email_compose"
      && namedMailCommand(text)
      && (field === "mailboxEmail" || field === "to" || field === "subject")
    ) return false;
    const value = supplied[field] ?? entities[field];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

function names(definition: TaskDefinition): string[] {
  return [definition.id, definition.title, ...definition.aliases].sort((a, b) => b.length - a.length);
}

/** Stub-only natural-language routes. Production never uses this to pick a skill. */
function matchStarryKolIntent(text: string, entities: Record<string, unknown> = {}): string | null {
  if (/分析回复|回复分析|看邮件阶段/.test(text)) return "reply_analysis";
  if (/确认发送|发送测试邮件|写合作邮件|写邮件|邮件草稿|写报价|报价邮件|报价信|一份报价|催大纲|发货通知|首封建联|核对地址|寄样地址核对|要媒体包|写谈判|请确认方案|合同沟通|发内容brief|发brief|初稿反馈|确认排期|请开发票|核对公开链接|核对链接|加一封|再发一封|再写一封|再来一封|回复会话|写阶段跟进|阶段跟进邮件|写跟进邮件|写跟进信|写跟进/.test(text)) return "email_compose";
  if (entities.mailboxEmail && entities.to && entities.subject) return "email_compose";
  if (/读取邮件会话|查看邮件会话|邮件会话详情/.test(text)) return "email_conversation_read";
  if (/邮件会话列表|查询邮件会话|收件会话|查收件箱|查收件/.test(text)) return "email_conversation_list";
  if (/品牌邮箱|邮箱列表|查询邮箱|发件箱|邮箱授权|nylas/i.test(text)) return "email_mailbox_list";
  if (/达人筛选项|合作阶段选项|风险标签选项|达人筛选字典/.test(text)) return "creator_filter_options";
  if (/查询达人库|达人库查询|达人筛选/.test(text)) return "creator_library_query";
  if (/全量达人库|全部红人画像|达人库全量/.test(text)) return "creator_library_all";
  if (/添加达人|同步达人|达人同步入库/.test(text)) return "creator_library_sync";
  if (/更新红人负责人|更新达人负责人|分配红人负责人|改红人负责人/.test(text)) return "creator_owner_update";
  if (/解密联系方式|解密红人联系方式|解密达人联系方式/.test(text)) return "creator_contact_decrypt";
  if (/生命周期看板|合作看板/.test(text)) return "creator_lifecycle_kanban";
  if (/风险会话|红人风险会话/.test(text)) return "creator_risk_conversations";
  if (/风险扫描|超时扫描|失联扫描|延期扫描|扫描在途风险|\bT8\b|^(请|帮我)?扫描$/.test(text.trim())) {
    return "risk_scan";
  }
  if (/延期关怀|合作延期|内容延期|失联跟进|失联邮件/.test(text)) return "risk_scan";
  if (/记状态|提出阶段变更|确认阶段|推进阶段|标记为已建联|标记为待联系|标记为已签约|改成已签约/.test(text)) {
    return "confirm_stage";
  }
  if (/交易记忆|谈判纪要|deal memory/i.test(text)) return "deal_memory";
  if (/应用邮件|应用侧会话/.test(text)) return "email_app_conversation_list";
  if (/更新达人状态|记录达人跟进/.test(text)) {
    return "creator_status_update";
  }
  return null;
}

function defaultClarificationAlternatives(text: string): { task_type: string; title: string; confidence: number }[] {
  const ids = /(邮件|邮箱|发件|收件|nylas)/i.test(text)
    ? ["email_mailbox_list", "email_conversation_list", "email_compose"]
    : ["creator_lifecycle_kanban", "reply_analysis", "risk_scan"];
  return ids
    .map((id) => taskDefinition(id))
    .filter((definition): definition is TaskDefinition => Boolean(definition))
    .map((definition) => ({
      task_type: definition.id,
      title: definition.title,
      confidence: 0.4,
    }));
}

function lockedResolution(
  taskType: string,
  entities: Record<string, unknown>,
  supplied: Record<string, unknown>,
  text = "",
): TaskResolution {
  const definition = taskDefinition(taskType);
  if (!definition) {
    return {
      task_type: null,
      confidence: 0,
      entities,
      missing_fields: [],
      alternatives: [],
      needs_clarification: true,
      clarification_kind: "direction",
    };
  }
  const missingFields = missing(definition, entities, supplied, text);
  return {
    task_type: definition.id,
    confidence: 1,
    entities,
    missing_fields: missingFields,
    alternatives: [],
    needs_clarification: missingFields.length > 0,
    clarification_kind: missingFields.length ? "missing_fields" : "none",
  };
}

/**
 * Production resolver: never picks a skill from regex/substring.
 * With a human- or judge-locked task_type, only validates required fields.
 */
export function resolveTaskIntent(input: {
  text?: string;
  task_type?: string | null;
  entities?: Record<string, unknown>;
  input?: Record<string, unknown>;
}): TaskResolution {
  const text = String(input.text || "").trim();
  const entities = { ...extractTaskEntities(text), ...(input.entities || {}) };
  const supplied = input.input || {};
  if (input.task_type) return lockedResolution(String(input.task_type), entities, supplied, text);
  return {
    task_type: null,
    confidence: 0,
    entities,
    missing_fields: [],
    alternatives: defaultClarificationAlternatives(text),
    needs_clarification: true,
    clarification_kind: "direction",
  };
}

/** Tests / INTENT_LLM_MODE=stub only. Production recognize uses Luna or Codex turn items. */
export function stubResolveTaskIntent(input: {
  text?: string;
  task_type?: string | null;
  entities?: Record<string, unknown>;
  input?: Record<string, unknown>;
}): TaskResolution {
  const text = String(input.text || "").trim();
  const entities = { ...extractTaskEntities(text), ...(input.entities || {}) };
  const supplied = input.input || {};
  if (input.task_type) return lockedResolution(String(input.task_type), entities, supplied, text);

  const lower = text.toLowerCase();
  if (/(搜索|查找|寻找|发现).*(达人|KOL|创作者)/i.test(text)) {
    const definition = taskDefinition("creator_discovery");
    if (definition) {
      return {
        task_type: definition.id,
        confidence: 0.97,
        entities,
        missing_fields: [],
        alternatives: [],
        needs_clarification: false,
        clarification_kind: "none",
      };
    }
  }
  const emailTask = matchStarryKolIntent(text, entities);
  if (emailTask) {
    const definition = taskDefinition(emailTask);
    if (definition) {
      const missingFields = missing(definition, entities, supplied, text);
      return {
        task_type: definition.id,
        confidence: 0.97,
        entities,
        missing_fields: missingFields,
        alternatives: [],
        needs_clarification: missingFields.length > 0,
        clarification_kind: missingFields.length ? "missing_fields" : "none",
      };
    }
  }
  const scored = taskDefinitions().flatMap((definition) => {
    const hit = names(definition).find((name) => lower.includes(name.toLowerCase()));
    if (!hit) return [];
    const confidence = hit === definition.id || hit === definition.title ? 0.98 : 0.92;
    return [{ definition, confidence, hitLength: hit.length }];
  }).sort((a, b) => b.hitLength - a.hitLength || b.confidence - a.confidence);

  const best = scored[0];
  const alternatives = scored.slice(1, 4).map(({ definition, confidence }) => ({
    task_type: definition.id,
    title: definition.title,
    confidence,
  }));
  if (!best || best.confidence < 0.75) {
    const fallbackAlternatives = alternatives.length
      ? alternatives
      : defaultClarificationAlternatives(text);
    return {
      task_type: null,
      confidence: best?.confidence || 0,
      entities,
      missing_fields: [],
      alternatives: fallbackAlternatives,
      needs_clarification: true,
      clarification_kind: "direction",
    };
  }
  const missingFields = missing(best.definition, entities, supplied, text);
  return {
    task_type: best.definition.id,
    confidence: best.confidence,
    entities,
    missing_fields: missingFields,
    alternatives,
    needs_clarification: missingFields.length > 0,
    clarification_kind: missingFields.length ? "missing_fields" : "none",
  };
}
