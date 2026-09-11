/**
 * Host ↔ Starry email-agent MCP contract.
 * Official stage codes match backend/src/stages.ts. Legacy Starry codes stay read aliases only.
 */
import { FOLLOW_STYLE_PRESETS } from "../follow-style-tags.js";
import { BY_CODE, LEGACY_STAGE_ALIASES, MAIN_STAGES, SIDE_STAGES, codeFromLabel, label, normalizeStage } from "../stages.js";
import type { Json } from "../types.js";

export type StarryStageOption = {
  stageCode: string;
  stageName: string;
  stageOrder: number;
  main: boolean;
  terminal: boolean;
  aliases: string[];
  stageDefinition: string;
};

const STAGE_DEFINITIONS: Record<string, string> = {
  INITIAL_CONTACT: "已创建合作或已完成首次对外触达，等待明确合作反馈。",
  INTERESTED: "合作对象已明确表达对合作有兴趣，待完成合作评估。",
  EVALUATING: "正在收集和核验媒体包、受众、市场与历史案例等合作评估信息。",
  QUOTE_PENDING: "已收到或发出正式报价，待确认币种、税费、交付范围与授权。",
  NEGOTIATING: "费用、授权、排他、修改或其他关键条款仍在协商。",
  PLAN_PENDING: "最终产品、费用、内容形式及交付方案已发出，待双方确认。",
  CONTRACTING: "合同已发出或进入签署流程，待双方完成签署。",
  SAMPLE_PENDING: "合作需寄送样品，待确认地址、样品型号、数量和配送信息。",
  SHIPPED: "样品或商品已由承运商发出，待签收与测试。",
  TESTING: "合作对象已签收，正在测试产品或验证合作内容。",
  CONTENT_PLANNING: "正在明确核心卖点、脚本、场景和内容方向。",
  CONTENT_REVIEW: "已收到内容或素材，正在审核参数、链接、产品描述与表达。",
  PUBLISH_PENDING: "内容审核通过且发布计划已确认，待公开上线。",
  PUBLISHED: "公开内容已上线并完成链接或发布证据核验，待效果回传或结算。",
  SETTLING: "交付验收后进入结算，覆盖付款处理中和已付款核销状态。",
  PAUSED: "双方暂时不继续，但未来可能重启。",
  LOST: "红人失联或合作已流失，终态。",
  REJECTED: "红人明确拒绝本次合作。",
  CANCELLED: "双方确定不再继续本次合作。",
  DISPUTED: "异常问题处理中，主流程冻结，可回到指定正式阶段。",
  COMPLETED: "结算完成，合作终态。",
};

export function legacyCodesFor(official: string): string[] {
  const code = normalizeStage(official);
  return Object.entries(LEGACY_STAGE_ALIASES)
    .filter(([, mapped]) => mapped === code)
    .map(([legacy]) => legacy);
}

export function starryCooperationStageOptions(): StarryStageOption[] {
  return [...MAIN_STAGES, ...SIDE_STAGES].map((stage, index) => ({
    stageCode: stage.code,
    stageName: stage.label,
    stageOrder: index + 1,
    main: stage.main,
    terminal: Boolean(stage.terminal),
    aliases: legacyCodesFor(stage.code),
    stageDefinition: STAGE_DEFINITIONS[stage.code] || stage.label,
  }));
}

export function starryStageWriteFields(code: string): { cooperationStageCode: string; cooperationStageName: string } {
  const official = codeFromLabel(code) || normalizeStage(code);
  const known = BY_CODE[official];
  return {
    cooperationStageCode: official,
    cooperationStageName: known ? known.label : label(official),
  };
}

export const RISK_TAG_OPTIONS = [
  { code: "DELAY", name: "延期" },
  { code: "CONTENT", name: "内容风险" },
  { code: "LOST_CONTACT", name: "失联" },
] as const;

export const RISK_TAG_ALIASES: Record<string, string> = {
  overdue: "DELAY",
  DELAY_RISK: "DELAY",
  逾期: "DELAY",
  CONTENT_RISK: "CONTENT",
  内容风险: "CONTENT",
  LOST: "LOST_CONTACT",
  失联: "LOST_CONTACT",
  EXCEPTION_HANDLING: "DISPUTED",
};

export function normalizeRiskTag(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (RISK_TAG_OPTIONS.some((row) => row.code === raw)) return raw;
  const mapped = RISK_TAG_ALIASES[raw] || RISK_TAG_ALIASES[raw.toUpperCase()];
  if (mapped && mapped !== "DISPUTED") return mapped;
  return raw;
}

export const PLATFORM_DICTIONARY = [
  { code: "youtube", name: "YouTube" },
  { code: "instagram", name: "Instagram" },
  { code: "tiktok", name: "TikTok" },
  { code: "facebook", name: "Facebook" },
  { code: "bilibili", name: "B站" },
];

export const NICHE_DICTIONARY = [
  { code: "energy-storage", name: "储能" },
  { code: "home-office", name: "居家办公" },
  { code: "consumer-electronics", name: "3C数码" },
  { code: "rv-battery", name: "房车电池" },
  { code: "outdoors", name: "户外" },
  { code: "beauty", name: "美妆" },
  { code: "parenting", name: "母婴" },
];

export const BRAND_DICTIONARY = [
  { code: "LT", name: "LiTime" },
  { code: "RO", name: "Renogy" },
  { code: "PQ", name: "Power Queen" },
];

export function followStyleDictionary(): Array<{ code: string; name: string }> {
  return FOLLOW_STYLE_PRESETS.map((tag) => ({ code: tag.id, name: tag.label }));
}

export function dictionaryOptionsFor(parentKey: string): Array<{ code: string; name: string }> {
  const key = String(parentKey || "").trim();
  if (key === "kol_primary_platform") return PLATFORM_DICTIONARY.map((row) => ({ ...row }));
  if (key === "kol_niche") return NICHE_DICTIONARY.map((row) => ({ ...row }));
  if (key === "kol_follow_style") return followStyleDictionary();
  if (key === "kol_risk_tag") return RISK_TAG_OPTIONS.map((row) => ({ code: row.code, name: row.name }));
  if (key === "mailbox_brand_affiliation" || key === "brand") {
    return BRAND_DICTIONARY.map((row) => ({ code: row.code, name: row.name }));
  }
  if (key === "cooperation_stage" || key === "stages") {
    return starryCooperationStageOptions().map((row) => ({ code: row.stageCode, name: row.stageName }));
  }
  return [];
}

export const PROFILE_LIST_WHITELIST = [
  "kolUid",
  "kolId",
  "kolName",
  "ownerName",
  "ownerUserName",
  "ownerUserId",
  "ownerMailbox",
  "brandName",
  "brandCode",
  "platform",
  "primaryPlatform",
  "accountHandle",
  "profileUrl",
  "countryName",
  "followerCountTenThousands",
  "avgVideoViews10",
  "avgVideoEngagementRate10",
  "avgPostEngagementRate10",
  "audienceGeo",
  "nicheTagsText",
  "nicheTags",
  "crawlerSyncStatus",
  "cooperationStageCode",
  "cooperationStageName",
  "daysInStage",
  "riskTag",
  "riskTagCodes",
  "contactEmailMasked",
  "notes",
  "wechat",
  "lastConversationId",
  "followStyleTags",
] as const;

const NICHE_BY_LABEL = new Map(NICHE_DICTIONARY.map((row) => [row.name, row]));
const NICHE_BY_CODE = new Map(NICHE_DICTIONARY.map((row) => [row.code, row]));

export function parseNicheTags(text: unknown): Array<{ code: string; name: string }> {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parts = raw.split(/[；;、，,/|]+/).map((part) => part.trim()).filter(Boolean);
  const out: Array<{ code: string; name: string }> = [];
  for (const part of parts) {
    const known = NICHE_BY_LABEL.get(part) || NICHE_BY_CODE.get(part);
    if (known) {
      if (!out.some((row) => row.code === known.code)) out.push({ ...known });
      continue;
    }
    if (/^hot$/i.test(part)) continue;
    const code = part.toLowerCase().replace(/\s+/g, "-").slice(0, 24);
    if (!out.some((row) => row.code === code || row.name === part)) out.push({ code, name: part });
  }
  return out;
}

export function maskContactEmail(email: string): string {
  const trimmed = String(email || "").trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return "";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
}

export function enrichListProfile(profile: Json): Json {
  const stage = starryStageWriteFields(String(
    profile.cooperationStageCode || profile.stageCode || profile.cooperationStageName || "",
  ));
  if (!BY_CODE[stage.cooperationStageCode]) {
    Object.assign(stage, starryStageWriteFields("INITIAL_CONTACT"));
  }
  const knownStage = BY_CODE[stage.cooperationStageCode];
  const nicheTags = Array.isArray(profile.nicheTags)
    ? profile.nicheTags
    : parseNicheTags(profile.nicheTagsText);
  const riskRaw = profile.riskTagCodes || profile.riskTag || profile.riskTagCode;
  const riskCodes = (Array.isArray(riskRaw) ? riskRaw.map(String) : String(riskRaw || "").split(/[,\s]+/))
    .map((item) => normalizeRiskTag(item))
    .filter((code) => RISK_TAG_OPTIONS.some((row) => row.code === code));
  return {
    ...profile,
    ...stage,
    cooperationStageName: knownStage ? knownStage.label : stage.cooperationStageName,
    daysInStage: Number(profile.daysInStage ?? profile.days_in_stage ?? 0) || 0,
    nicheTags,
    riskTag: riskCodes[0] || profile.riskTag || null,
    riskTagCodes: riskCodes,
    followStyleTags: Array.isArray(profile.followStyleTags) ? profile.followStyleTags : [],
    lastConversationId: profile.lastConversationId ?? profile.last_conversation_id ?? null,
    notes: profile.notes ?? null,
    wechat: profile.wechat ?? null,
  };
}
