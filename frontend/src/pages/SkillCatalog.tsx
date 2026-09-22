import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { isWriteSkill } from "../composer/catalog";
import { applyComposerDraft } from "../composer/draft";
import { skillFillText } from "../composer/skillFill";
import { RECOMMENDED_SKILL_IDS as RECOMMENDED_IDS } from "../composer/recommended";
import { rememberJourney } from "../journey";
import { skillKind, type SkillRow } from "./SkillHub";

// 分组配置
const GROUPS: { id: string; label: string; hint: string; funnel: string[] }[] = [
  { id: "reach", label: "建联阶段", hint: "寻找目标达人，建立初步联系", funnel: ["reach"] },
  { id: "intent", label: "意向评估", hint: "评估达人质量与合作可能性", funnel: ["intent"] },
  { id: "biz", label: "报价与寄样", hint: "推进合作，处理报价与寄样流程", funnel: ["biz", "sample"] },
  { id: "settle", label: "成交与沉淀", hint: "完善合作并沉淀数据资产", funnel: ["settle"] },
  { id: "content", label: "内容发布", hint: "内容发布与效果追踪", funnel: ["content"] },
  { id: "exception", label: "异常旁路", hint: "风险扫描与异常处理", funnel: ["exception"] },
];

// 筛选条分两类（shadcn TabsList ×2）：
//   mode  = 取数口径（全部 / 常用 / 最近 / 推荐），彼此并列；
//   stage = 业务阶段漏斗（建联 → 意向 → 报价 → 寄样 → 成交 → 内容），有先后递进关系，
//           渲染时用 › 分隔，把这层递进显式表达出来（此前只是一排等权胶囊）。
const TABS: { id: string; label: string; kind: "mode" | "stage" }[] = [
  { id: "all", label: "全部", kind: "mode" },
  { id: "frequent", label: "常用", kind: "mode" },
  { id: "recent", label: "最近使用", kind: "mode" },
  { id: "recommend", label: "推荐", kind: "mode" },
  { id: "reach", label: "建联", kind: "stage" },
  { id: "intent", label: "意向", kind: "stage" },
  { id: "biz", label: "报价", kind: "stage" },
  { id: "sample", label: "寄样", kind: "stage" },
  { id: "settle", label: "成交", kind: "stage" },
  { id: "content", label: "内容发布", kind: "stage" },
];

const USAGE_KEY = "skill:usage";
const RECENT_KEY = "skill:recent";

function loadUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveUsage(usage: Record<string, number>) {
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function recordUsage(skillId: string) {
  const usage = loadUsage();
  usage[skillId] = (usage[skillId] || 0) + 1;
  saveUsage(usage);

  const recent = loadRecent().filter((id) => id !== skillId);
  recent.unshift(skillId);
  saveRecent(recent.slice(0, 20));
}

// 默认预览技能
const DEFAULT_SKILL_ID = "creator_outreach";

// 技能图标映射（SVG paths，全部使用 fill 渲染的封闭路径）
const SKILL_ICONS: Record<string, string> = {
  creator_discovery: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z", // 放大镜
  creator_profile: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z", // 人物
  creator_scoring: "M20 18h-3v-7h3v7zm-5 2h-3V4h3v16zm-5-4H7V9h3v7zM4 18H1v-5h3v5z", // 柱状图
  creator_daily_tasks: "M18 4h-1V2h-2v2H9V2H7v2H6c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H6V8h12v12zm-9-8H8v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z", // 日历
  creator_outreach: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 13H6.83L6 15.83V5h14v10z", // 对话
  creator_library_query: "M12 2c4.42 0 8 .95 8 2.12v13.76c0 1.17-3.58 2.12-8 2.12s-8-.95-8-2.12V4.12C4 2.95 7.58 2 12 2zm0 2.12c-3.75 0-6.3.78-6.3 1.5S8.25 7.12 12 7.12s6.3-.78 6.3-1.5S15.75 4.12 12 4.12zM5.7 8.8c1.25.58 3.65 1.03 6.3 1.03s5.05-.45 6.3-1.03v3.12c0 .72-2.55 1.5-6.3 1.5s-6.3-.78-6.3-1.5V8.8zm0 5.25c1.25.58 3.65 1.03 6.3 1.03s5.05-.45 6.3-1.03v3.12c0 .72-2.55 1.5-6.3 1.5s-6.3-.78-6.3-1.5v-3.12z", // 数据库
  creator_library_all: "M12 2c4.42 0 8 .95 8 2.12v13.76c0 1.17-3.58 2.12-8 2.12s-8-.95-8-2.12V4.12C4 2.95 7.58 2 12 2zm0 2.12c-3.75 0-6.3.78-6.3 1.5S8.25 7.12 12 7.12s6.3-.78 6.3-1.5S15.75 4.12 12 4.12zM5.7 8.8c1.25.58 3.65 1.03 6.3 1.03s5.05-.45 6.3-1.03v3.12c0 .72-2.55 1.5-6.3 1.5s-6.3-.78-6.3-1.5V8.8zm0 5.25c1.25.58 3.65 1.03 6.3 1.03s5.05-.45 6.3-1.03v3.12c0 .72-2.55 1.5-6.3 1.5s-6.3-.78-6.3-1.5v-3.12z", // 数据库
  creator_filter_options: "M3 5h18v3H3V5zm4 6h10v3H7v-3zm-4 6h18v3H3v-3z", // 筛选
  creator_lifecycle_kanban: "M3 5h7v7H3V5zm0 9h7v7H3v-7zm9-9h9v7h-9V5zm0 9h9v7h-9v-7z", // 看板
  creator_status_update: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L4.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z", // 刷新
  creator_owner_update: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm5-9h5v2h-5v2h-2V7h2V5z", // 人物+编辑
  kol_analyze: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-6h2v6zm4 0h-2V6h2v10z", // 分析
  today_plan: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5H11v7.25l5.25 3.15.75-1.23-4.5-2.67V7z", // 时间规划
  today_analyze: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 13h-2v-6h2v6zm0-8h-2V7h2v2z", // 今日分析
  reply_analysis: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 13H5.2L4 18.2V7h16v10z", // 邮件
  email_compose: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4.5l-8 5-8-5V6l8 5 8-5v2.5z", // 邮件编辑
  email_conversation_list: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 13H5.2L4 17.2V4h16v11z", // 邮件列表
  email_conversation_read: "M4 6h16v3H4V6zm0 5h16v3H4v-3zm0 5h16v3H4v-3z", // 邮件详情
  email_mailbox_list: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z", // 邮箱
  deal_memory: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z", // 文档
  confirm_stage: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z", // 确认
  stage_sop: "M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z", // 阶段/SOP
  risk_scan: "M12 2L2 22h20L12 2zm0 3.5L18.5 20h-13L12 5.5zM11 10v6h2v-6h-2zM11 18v2h2v-2h-2z", // 风险
  creator_budget_report: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.15-1.46-3.27-3.4h1.96c.1 1.05 1.18 1.91 2.53 1.91 1.29 0 2.13-.62 2.13-1.66 0-.87-.57-1.23-2.11-1.76l-.6-.19C9.27 13.48 8 12.81 8 10.96c0-1.65 1.24-2.86 3.01-3.21V6h2.67v1.73c1.38.31 2.74 1.18 2.83 3.01h-1.97c-.05-1.02-.99-1.64-2.08-1.64-1.21 0-1.95.59-1.95 1.5 0 .78.48 1.11 1.91 1.61l.6.2c2.36.74 3.37 1.55 3.37 3.4 0 1.93-1.57 3.18-3.57 3.5z", // 预算
  creator_contact_decrypt: "M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 6c1.1 0 2 .9 2 2v2h-4V8c0-1.1.9-2 2-2z", // 解锁
  creator_sync: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L4.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z", // 同步
  discovery_plan: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z", // 发现
  discovery_brief: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z", // 简报
  business_approval: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3 .8-1.2-4.5-2.7V7z", // 审批
};

// 默认图标
const DEFAULT_ICON = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z";

// 技能来源映射 —— 面向市场推广 / KOL 运营同事的业务语言，不用引擎名或内部系统名。
// 依据：`specs/UX-EMPLOYEE.md` 员工禁词（员工表面不摊 MCP / Codex / Thread / 引擎名）；
//       同仓库 `DISCOVERY_BANNED_JARGON` 亦把引擎名列为需清洗的词。
const SKILL_SOURCE: Record<string, string> = {
  creator_discovery: "平台采集",
  creator_library_query: "达人库",
  creator_library_all: "达人库",
  creator_profile: "达人库",
  creator_contact_decrypt: "达人库",
  creator_risk_conversations: "达人库",
  creator_lifecycle_kanban: "达人库",
  creator_status_update: "达人库",
  creator_owner_update: "达人库",
  creator_filter_options: "达人库",
  creator_daily_tasks: "AI 助理",
  creator_scoring: "AI 助理",
  creator_outreach: "AI 助理",
  kol_analyze: "AI 助理",
  today_plan: "AI 助理",
  today_analyze: "AI 助理",
  reply_analysis: "AI 助理",
  confirm_stage: "平台内置",
  stage_sop: "平台内置",
  discovery_plan: "平台内置",
  discovery_brief: "平台内置",
  risk_scan: "平台内置",
  business_approval: "平台内置",
  email_compose: "达人库",
  email_conversation_list: "达人库",
  email_conversation_read: "达人库",
  email_mailbox_list: "达人库",
  email_app_conversation_list: "达人库",
  creator_library_sync: "达人库",
  creator_budget_report: "达人库",
  deal_memory: "达人库",
};

// 分组图标（SVG paths）
const GROUP_ICONS: Record<string, string> = {
  reach: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
  intent: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
  biz: "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z",
  settle: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
  content: "M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z",
  exception: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
};

// 场景标签映射
const SCENE_TAGS: Record<string, string[]> = {
  creator_discovery: ["建联阶段", "私信触达"],
  creator_profile: ["建联阶段", "达人分析"],
  creator_scoring: ["意向评估", "评分排序"],
  creator_outreach: ["建联阶段", "私信触达", "加微信话术"],
  email_compose: ["报价", "邮件沟通"],
  today_plan: ["日常运营", "任务规划"],
  reply_analysis: ["意向评估", "邮件分析"],
  deal_memory: ["成交", "商务谈判"],
};

type PreviewMessage = { role: "ai" | "user"; lines: string[]; time?: string };

/**
 * 每项技能的「可以直接查到」/「需要走确认或 AI 助理」两段口径。
 * 来源：`docs/BUSINESS.md`「快捷查询与思考覆盖表」——权威，覆盖仓库当前 41 个 Skill ID。
 * 技能详情列按这张表逐项设计，**不按技能名猜，也不编**（AGENTS.md）。
 */
const SKILL_ENTRY: Record<string, { quick: string; agent: string }> = (() => {
  const rows: [string[], string, string][] = [
    [
      ["creator_library_all", "creator_library_query", "creator_filter_options", "creator_profile"],
      "授权档案、画像、筛选与已有摘要",
      "新画像分析、补查新事实走 AI 助理或已配置同步",
    ],
    [
      ["creator_daily_tasks", "creator_lifecycle_kanban", "creator_risk_conversations", "risk_scan"],
      "我的任务、阶段索引、已识别风险",
      "新风险分析与跟进建议走 AI 助理；确定的定时规则走后台",
    ],
    [
      ["email_app_conversation_list", "email_conversation_list", "email_conversation_read", "email_mailbox_list"],
      "已同步邮件列表、往来摘要与已授权邮箱索引",
      "新回复理解走 AI 助理；读取敏感正文仍执行权限规则",
    ],
    [
      ["creator_budget_report", "creator_scoring"],
      "已有预算报告与评分",
      "新评分、预测、策略与报表解读走 AI 助理",
    ],
    [
      ["deal_memory"],
      "明确内容的记忆记录、修改、查询",
      "修改远端正式档案备注是业务写入，不能与本地记忆混为一谈",
    ],
    [
      ["creator_discovery", "creator_library_sync"],
      "已有发现批次与同步结果",
      "新发现分析、异步采集；正式导入独立确认",
    ],
    [
      ["creator_outreach", "email_compose", "reply_analysis"],
      "已保存的草稿、回复分析摘要",
      "建联方案、写信、改信、理解回复走 AI 助理；发送独立确认",
    ],
    [
      [
        "creator_contact_decrypt",
        "creator_owner_update",
        "creator_status_update",
        "confirm_stage",
        "business_approval",
      ],
      "已授权结果、归属、备注、阶段和审批状态",
      "解密、改归属、改档案、改阶段、提交审批均为受控动作；备注不等于正式阶段",
    ],
  ];
  const out: Record<string, { quick: string; agent: string }> = {};
  for (const [ids, quick, agent] of rows) for (const id of ids) out[id] = { quick, agent };

  // SOP 一组（stage_sop + 15 个阶段 SOP）共用同一口径。
  const sopIds = [
    "stage_sop",
    "sop_initial_contact",
    "sop_interested",
    "sop_evaluating",
    "sop_quote_pending",
    "sop_negotiating",
    "sop_plan_pending",
    "sop_contracting",
    "sop_sample_pending",
    "sop_shipped",
    "sop_testing",
    "sop_content_planning",
    "sop_content_review",
    "sop_publish_pending",
    "sop_published",
    "sop_settling",
  ];
  const sopEntry = {
    quick: "已发布 SOP 的索引、适用说明",
    agent: "结合当前达人选择做法、分析缺口及生成行动方案走 AI 助理",
  };
  for (const id of sopIds) out[id] = sopEntry;
  return out;
})();

// 输入/输出描述
const IO_MAP: Record<string, { inputs: string[]; outputs: string[]; example: string[]; thread?: PreviewMessage[] }> = {
  creator_outreach: {
    inputs: ["达人名称", "平台（如小红书/抖音）", "粉丝量", "合作目标（如寄样、推广、长期合作）"],
    outputs: ["首轮私信话术", "跟进话术", "微信添加文案"],
    example: [
      "Hi@夏天的旅行日记 👋",
      "我是 LiTime 的产品运营，关注到你分享的户外生活内容，非常喜欢！我们正在做一款适合户外场景的便携装备，想和你合作体验。不知道你是否有兴趣？期待你的回复~",
    ],
    thread: [
      {
        role: "ai",
        time: "10:24",
        lines: [
          "Hi@夏天的旅行日记 👋",
          "我是 LiTime 的产品运营，关注到你分享的户外生活内容，非常喜欢！我们正在做一款适合户外场景的便携装备，想和你合作体验。不知道你是否有兴趣？期待你的回复~",
        ],
      },
      { role: "user", time: "10:28", lines: ["你好！可以先发下产品资料看看~"] },
    ],
  },
  creator_discovery: {
    inputs: ["关键词", "平台", "粉丝量范围"],
    outputs: ["候选达人列表", "达人基础信息"],
    example: ["关键词：户外露营", "平台：小红书", "粉丝量：1万-10万"],
    thread: [{ role: "ai", time: "10:24", lines: ["关键词：户外露营", "平台：小红书", "粉丝量：1万-10万"] }],
  },
  creator_profile: {
    inputs: ["达人UID或昵称"],
    outputs: ["达人详情", "平台数据", "负责人信息"],
    example: ["达人：夏天的旅行日记", "UID：xxx"],
    thread: [{ role: "ai", time: "10:24", lines: ["达人：夏天的旅行日记", "UID：xxx"] }],
  },
  creator_scoring: {
    inputs: ["达人UID列表"],
    outputs: ["影响力评分", "合作适配度评分"],
    example: ["待评分达人列表"],
    thread: [{ role: "ai", time: "10:24", lines: ["待评分达人列表"] }],
  },
};

function SkillIcon({ id }: { id: string }) {
  const d = SKILL_ICONS[id] || DEFAULT_ICON;
  return (
    <svg viewBox="0 0 24 24" className="skill-row-svg" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function UserGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
        fill="currentColor"
      />
    </svg>
  );
}

function GroupIcon({ id }: { id: string }) {
  const d = GROUP_ICONS[id] || GROUP_ICONS.reach;
  return (
    <svg viewBox="0 0 24 24" className="skill-group-svg" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** 来源徽章：只用业务语言。未登记的技能一律落到中性词——兜底**不得**回落到引擎名或内部系统名。 */
function skillSource(id: string): string {
  return SKILL_SOURCE[id] || "平台内置";
}

/**
 * 工具风险档只区分「只读」与「需确认」两档。
 * 细分 L2（草稿）/ L3（敏感写入）须按 `docs/07-mcp-data-contract.md` 的工具风险目录逐条登记后再拆，
 * **不得按技能名猜**（AGENTS.md「凭文件名猜法律层级」禁令）。
 */
const RISK_LABEL: Record<"read" | "write", string> = { read: "只读", write: "需确认" };

/* 员工向词表：员工表面不摊引擎词（specs/UX-EMPLOYEE.md §员工禁词：MCP / Codex / Thread /
   英文 Skill 时序 / 原始堆栈）。下面四张表把接口返回的 id 翻成业务语言；查不到时回落到
   业务兜底，**绝不回落成原始 id**。 */
const ACTION_LABEL: Record<string, string> = {
  analyze: "读取授权范围内的信息并分析",
  present_sop: "展示这项技能的标准流程",
  update: "更新你指定的字段",
  sync: "同步最新数据",
  propose_stage: "生成阶段变更建议（需你确认）",
  create_draft: "生成草稿（需你确认）",
  create_approval: "发起审批（需你确认）",
  claim_follow: "认领跟进",
  compose_draft: "生成回复草稿",
  confirm_send: "发送前确认",
  confirm_stage: "阶段写入前确认",
  open_thread: "打开对应会话",
  release_follow: "释放跟进",
  handoff: "交接给同事",
  retry_sync: "失败后重试同步",
  none: "无额外步骤",
};

const OUTPUT_LABEL: Record<string, string> = {
  task_result: "任务结果",
  today_brief: "今日任务简报",
  propose_stage: "阶段变更建议",
  kol_analyze_brief: "达人分析简报",
  crawl_plan: "采集计划",
};

const TOOL_LABEL: Record<string, string> = {
  "starry.get_collaboration": "合作记录查询",
  "starry.list_collaborations": "合作记录列表",
  "starry.deal_memory": "成交记忆",
  "starrykol.getKolProfileDetail": "达人详情",
  "starrykol.pageKolProfiles": "达人库分页查询",
  "starrykol.listAllKolProfiles": "达人库全量列表",
  "starrykol.getKolProfileSidebarMetrics": "达人库侧栏指标",
  "starrykol.addKolProfile": "新增达人",
  "starrykol.updateKolProfile": "更新达人资料",
  "starrykol.listKolPlatformData": "平台数据查询",
  "starrykol.decryptKolContact": "解密达人联系方式（受控）",
  "starrykol.pageRiskConversations": "风险对话列表",
  "starrykol.summarizeRiskConversations": "风险对话摘要",
  "starrykol.listRiskTagOptions": "风险标签字典",
  "starrykol.getStageRiskMatrix": "阶段风险矩阵",
  "starrykol.pageEmailConversations": "邮件会话列表",
  "starrykol.pageAppEmailConversations": "应用邮件会话",
  "starrykol.getEmailConversation": "邮件会话详情",
  "starrykol.getEmailConversationSubjectGroups": "邮件主题分组",
  "starrykol.translateEmailToChinese": "邮件翻译",
  "starrykol.previewEmailDraft": "邮件草稿预览",
  "starrykol.pageMailboxes": "邮箱列表",
  "starrykol.listNylasAccounts": "邮箱账号列表",
  "starrykol.pageLifecycleKanban": "生命周期看板",
  "starrykol.listCooperationStageOptions": "合作阶段字典",
  "starrykol.listDictionaryOptions": "业务字典查询",
  "kolclaw.list_creators": "达人任务列表",
  "kolclaw.get_daily_tasks": "每日任务",
  "kolclaw.get_budget_report": "预算报表",
};

const PERMISSION_LABEL: Record<string, string> = {
  "starrykol:read": "达人库读取",
  "starrykol:write": "达人库写入",
  "kolclaw:read": "业绩与任务读取",
  "claw:write": "业绩与任务写入",
};

/** 工具行名称：业务名优先，其次动作词表，最后只留连接器 / 平台动作 —— 不摊原始 ref。 */
function toolLabel(ref: string, kind?: string): string {
  return TOOL_LABEL[ref] || ACTION_LABEL[ref] || (kind === "mcp" ? "平台连接器" : "平台动作");
}

/**
 * 异步作业：同一时间只跑一个，必须有进度 / 取消 / 重试。
 * 依据 `docs/07-mcp-data-contract.md`「MediaCrawler 是异步作业…不得把它伪装成同步 Skill」。
 */
const ASYNC_SKILL_IDS = new Set(["creator_discovery"]);

/** 「填入输入框」的语义图标：箭头进入输入区。用 SVG，不用 emoji 或文字符号当图标。 */
function AddToComposerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="skill-link-svg" aria-hidden>
      <path
        d="M12 4v9m0 0-3.5-3.5M12 13l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 18.5h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** 搜索框的清除图标：一个「×」。图标按钮必须带 aria-label（语义不能只靠图形象征）。 */
function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="skill-search-clear-svg" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SkillCard({
  skill,
  onSelect,
  onUse,
  isFrequent,
  selected,
}: {
  skill: SkillRow;
  onSelect: (skill: SkillRow) => void;
  onUse: (skill: SkillRow) => void;
  isFrequent: boolean;
  selected: boolean;
}) {
  const tier = isWriteSkill(skill) ? "write" : "read";
  const isAsync = ASYNC_SKILL_IDS.has(skill.id);
  // 规则 10「只标例外」：只读是默认态，不标注；只有 L3 与异步才打标记。
  const marks: { cls: string; text: string }[] = [];
  if (tier === "write") marks.push({ cls: "is-write", text: RISK_LABEL.write });
  if (isAsync) marks.push({ cls: "is-async", text: "异步 · 可取消" });
  return (
    <div
      className={
        "skill-row"
        + (selected ? " is-selected" : "")
        + (tier === "write" ? " is-write" : "")
        + (isAsync ? " is-async" : "")
      }
      data-skill-id={skill.id}
      onClick={() => onSelect(skill)}
    >
      <div className="skill-row-icon">
        <SkillIcon id={skill.id} />
      </div>
      {/* 名称是行的键盘可达入口，同时暴露选中态（选中只靠颜色不合规，docs/DESIGN.md §不变量 4）。
          ★ 只在非「常用」分组出现——那一组整块都是常用，逐行再标一次等于把例外信号用成装饰。 */}
      <button
        type="button"
        className="skill-row-name"
        aria-pressed={selected}
        onClick={() => onSelect(skill)}
      >
        <span className="skill-row-name-text">{skill.title}</span>
        {isFrequent && <span className="skill-row-star" aria-hidden>★</span>}
      </button>
      <p className="skill-row-desc">{skill.summary || skill.title}</p>
      {marks.length > 0 && (
        <div className="skill-row-marks">
          {marks.map((m) => (
            <span key={m.cls} className={"skill-mark " + m.cls}>{m.text}</span>
          ))}
        </div>
      )}
      {/* 每行只保留一个动作，走链接式（语义图标 + 常驻下划线），不再占用整行按钮位。
          「新建会话」已移除——部分技能需要先填参数，直接开会话是错误承诺。
          动作名定为「填入输入框」：它只把技能填进输入框，补完参数后由员工自己发送，不含执行。 */}
      <div className="skill-row-actions" onClick={(e) => e.stopPropagation()}>
        {/* 行内动作退出 Tab 顺序：键盘路径＝行名 → 详情列 CTA。否则 51 行 × 2 个焦点会把详情列
            推到 120 次 Tab 之外（docs/DESIGN.md §三轴适配 · 输入模态轴）。鼠标 / 触摸不受影响。 */}
        <button
          type="button"
          className="skill-link"
          tabIndex={-1}
          title="把这项技能填进输入框，补完参数后由你发送"
          onClick={() => onUse(skill)}
        >
          <AddToComposerIcon />
          填入输入框
        </button>
      </div>
    </div>
  );
}

/** 展开 / 收窄的语义图标：向外箭头＝展开，向内箭头＝收窄。 */
function ExpandIcon({ wide }: { wide: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="skill-detail-toggle-svg" aria-hidden>
      <path
        d={
          wide
            ? "M20 10h-6V4M4 14h6v6M14 10 20 4M10 14 4 20"
            : "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 关闭图标。不用 `✕` 文字符号——§5 规则 8 要求图标必须是 SVG，且必须落在尺寸阶梯里。 */
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="skill-detail-close-svg" aria-hidden>
      <path
        d="M6.5 6.5l11 11M17.5 6.5l-11 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SkillDetail({
  skill,
  onInsert,
  wide,
  onToggleWide,
  onClose,
}: {
  skill: SkillRow | null;
  onInsert: (skill: SkillRow) => void;
  wide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
}) {
  if (!skill) {
    return (
      <div className="skill-detail-empty">
        <p>在左侧选择一项技能，这里会展开它的用法、需要你提供的信息和产出。</p>
      </div>
    );
  }

  const scenes = SCENE_TAGS[skill.id];
  const io = IO_MAP[skill.id];
  const entry = SKILL_ENTRY[skill.id];
  const tier = isWriteSkill(skill) ? "write" : "read";
  const isAsync = ASYNC_SKILL_IDS.has(skill.id);
  const outputs = io?.outputs || (skill.output ? [skill.output] : null);
  const learning = skill.learning;
  // 步骤：已知动作 id → 业务语言；已经是中文的原样保留；纯 ASCII 的未知 id **不渲染**
  // （员工表面不摊英文 Skill 时序，specs/UX-EMPLOYEE.md §员工禁词）。
  const steps = (learning?.steps || [])
    .map((step) => ACTION_LABEL[step] ?? (/^[\x20-\x7E]+$/.test(step) ? "" : step))
    .filter(Boolean);
  const execution = skill.execution;

  return (
    <div className="skill-detail" data-skill-detail>
      <div className="skill-detail-header">
        <h3>技能详情</h3>
        <button
          type="button"
          className="skill-detail-toggle"
          aria-expanded={wide}
          aria-label={wide ? "收窄技能详情" : "展开技能详情"}
          title={wide ? "收窄" : "展开"}
          onClick={onToggleWide}
        >
          <ExpandIcon wide={wide} />
        </button>
        <button
          type="button"
          className="skill-detail-close"
          aria-label="关闭技能详情"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="skill-detail-body">
        <div className="skill-detail-head">
          <div className="skill-row-icon">
            <SkillIcon id={skill.id} />
          </div>
          <div>
            <h2>{skill.title}</h2>
            <p className="skill-detail-sub">{skill.summary || skill.title}</p>
          </div>
        </div>

        <div className="skill-detail-marks">
          <span className="skill-preview-tag">{skillKind(skill)}</span>
          <span className="skill-preview-agent">{skillSource(skill.id)}</span>
          <span className={"skill-mark is-" + tier}>{RISK_LABEL[tier]}</span>
          {isAsync && <span className="skill-mark is-async">异步 · 可取消</span>}
        </div>

        {/* 段落次序按员工的决策顺序排：先「什么时候用 / 我要准备什么 / 能拿到什么」，
            再是能力边界与治理口径（可以直接查到 / 需要走确认 → 执行边界 → 调用关系）。 */}
        {scenes && (
          <div className="skill-detail-section">
            <h4>适用场景</h4>
            <div className="skill-detail-tags">
              {scenes.map((s) => (
                <span key={s} className="skill-preview-tag-item">{s}</span>
              ))}
            </div>
          </div>
        )}

        {io && (
          <div className="skill-detail-section">
            <h4>需要你提供</h4>
            <div className="skill-detail-tags">
              {io.inputs.map((s) => (
                <span key={s} className="skill-preview-tag-item">{s}</span>
              ))}
            </div>
          </div>
        )}

        {outputs && (
          <div className="skill-detail-section">
            <h4>产出</h4>
            <div className="skill-detail-tags">
              {outputs.map((s) => (
                <span key={s} className="skill-preview-tag-item">{s}</span>
              ))}
            </div>
          </div>
        )}

        {entry ? (
          <>
            <div className="skill-detail-section">
              <h4>可以直接查到</h4>
              <p className="skill-detail-note">{entry.quick}</p>
            </div>
            <div className="skill-detail-section">
              <h4>需要走确认或 AI 助理</h4>
              <p className="skill-detail-note">{entry.agent}</p>
            </div>
          </>
        ) : (
          <p className="skill-detail-warn">
            这项技能还没登记进 BUSINESS.md 的覆盖表，入口口径待业务专家补齐。
            补齐前请照它的说明与产出判断用法，不要假定它可以被直接执行。
          </p>
        )}

        {learning && (
          <>
            <div className="skill-detail-section">
              <h4>使用步骤</h4>
              {steps.length ? (
                <ol className="skill-detail-steps">
                  {steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
                </ol>
              ) : (
                <p className="skill-detail-note">
                  这项技能的步骤说明还没翻成业务语言；先按上面的场景与产出判断用法。
                </p>
              )}
            </div>
            <div className="skill-detail-section">
              <h4>执行边界</h4>
              <p className="skill-detail-note">
                结果：{OUTPUT_LABEL[learning.result || ""] || "任务结果"}。{learning.confirmation || "按当前权限执行"}
              </p>
            </div>
          </>
        )}

        {execution && (
          <details className="skill-execution-details">
            <summary>查看调用关系与安全边界</summary>
            <div className="skill-detail-section">
              <h4>调用工具</h4>
              {execution.tools?.length ? (
                <div className="skill-execution-tools">
                  {execution.tools.map((tool, index) => (
                    <div className="skill-execution-tool" key={`${tool.ref}-${index}`}>
                      <span className="skill-execution-tool-name">{toolLabel(tool.ref || "", tool.kind)}</span>
                      <span className={"skill-mark" + (tool.risk === "L3" ? " is-write" : "")}>
                        {tool.risk === "L3" ? "L3 · 执行前确认" : "L1 · 只读"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="skill-detail-note">本 Skill 当前不直接调用外部工具。</p>}
            </div>
            {execution.permissions?.length ? (
              <div className="skill-detail-section">
                <h4>所需权限</h4>
                <div className="skill-detail-tags">
                  {execution.permissions.map((permission) => (
                    <span key={permission} className="skill-preview-tag-item">
                      {PERMISSION_LABEL[permission]
                        || (permission.endsWith(":write") ? "业务数据写入" : "业务数据读取")}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {execution.async?.enabled && (
              <div className="skill-detail-section">
                <h4>异步执行</h4>
                <p className="skill-detail-note">
                  {execution.async.status || "需要查看进度"}；
                  {execution.async.cancelable ? "支持取消" : "不支持取消"}；
                  {execution.async.retryable ? "支持重试" : "不支持重试"}。
                </p>
              </div>
            )}
            <p className="skill-detail-note">
              {execution.receipt_required ? "受控动作会留下执行回执。" : "当前没有登记需要回执的正式写入动作。"}
            </p>
          </details>
        )}

        {io && (
          <div className="skill-detail-section">
            <h4>内容示例</h4>
            <div className="skill-preview-thread">
              {(io.thread || [{ role: "ai" as const, lines: io.example }]).map((msg, i) => (
                <div key={i} className={"skill-preview-msg is-" + msg.role}>
                  <span className="skill-preview-avatar" aria-hidden>
                    {msg.role === "ai" ? "AI" : <UserGlyph />}
                  </span>
                  <div className="skill-preview-bubble">
                    {msg.lines.map((line, j) => (
                      <p key={j}>{line}</p>
                    ))}
                    {msg.time && <span className="skill-preview-time">{msg.time}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!io && (
          <p className="skill-detail-note">
            这项技能的输入与产出示例尚未补录。上面的口径来自 BUSINESS.md
            的覆盖表，可以直接用；要看实际结果，用下面的「填入输入框」把它挂到输入区跑一次。
          </p>
        )}

        {skill.keeps_stage && (
          <p className="skill-detail-warn">
            这项技能不会推进正式阶段。要改阶段请用「正式阶段变更」，另走一次确认。
          </p>
        )}
        {isAsync && (
          <p className="skill-detail-warn">
            这是异步作业，同一时间只跑一个。有进度、取消和重试入口，不会伪装成即时完成。
          </p>
        )}
        {tier === "write" && (
          <p className="skill-detail-warn">
            这是受控动作：执行前会揭示对象和范围、要求确认，并留下回执。
          </p>
        )}
      </div>

      <div className="skill-detail-footer">
        {/* 本视口唯一的实底主 CTA（docs/DESIGN.md §不变量 1）。动作名与列表行统一为「填入输入框」；
            「新建会话」已按 §不变量 2（先补参数再外发）移除。 */}
        <button
          type="button"
          className="skill-btn skill-btn-primary skill-btn-large"
          title="把这项技能填进输入框，补完参数后由你发送"
          onClick={() => onInsert(skill)}
        >
          填入输入框
        </button>
      </div>
    </div>
  );
}

export function SkillCatalog() {
  const location = useLocation();
  const nav = useNavigate();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  // tab 与 URL 同步：`/skills?tab=frequent` 这类深链（「查看全部」链接）必须真正生效。
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("tab") || "all");
  const [selectedSkill, setSelectedSkill] = useState<SkillRow | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadUsage());
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [reloadKey, setReloadKey] = useState(0);
  // 详情列：`detailWide` 控制宽度档；`detailOpen` 只在窄屏的覆盖态下起作用（≥900px 常驻）。
  const [detailWide, setDetailWide] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // 选中技能＝同时展开详情；窄屏下这一步才会把覆盖层打开。
  const selectSkill = (s: SkillRow) => {
    setSelectedSkill(s);
    setDetailOpen(true);
  };

  useEffect(() => {
    setTab(new URLSearchParams(location.search).get("tab") || "all");
  }, [location.search]);

  useEffect(() => {
    setLoading(true);
    api.skills()
      .then((data: unknown) => {
        const rows = Array.isArray(data) ? (data as SkillRow[]) : [];
        setSkills(rows);
        setErr("");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载技能目录"))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  // 默认预览：优先选中达人建联话术，其次常用技能第一个
  useEffect(() => {
    if (skills.length > 0 && !selectedSkill) {
      const preferred = skills.find((s) => s.id === DEFAULT_SKILL_ID);
      if (preferred) {
        setSelectedSkill(preferred);
        return;
      }
      const frequent = skills.filter((s) => RECOMMENDED_IDS.includes(s.id));
      setSelectedSkill(frequent[0] || skills[0]);
    }
  }, [skills, selectedSkill]);

  const filteredSkills = useMemo(() => {
    let list = skills;

    if (tab === "frequent") {
      list = list.filter((s) => (usage[s.id] || 0) > 0).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
    } else if (tab === "recent") {
      list = recent.map((id) => skills.find((s) => s.id === id)).filter(Boolean) as SkillRow[];
    } else if (tab === "recommend") {
      list = list.filter((s) => RECOMMENDED_IDS.includes(s.id));
    } else if (tab !== "all") {
      list = list.filter((s) => s.funnel === tab);
    }

    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((s) =>
        s.title.toLowerCase().includes(needle) ||
        (s.summary || "").toLowerCase().includes(needle) ||
        (s.label || "").toLowerCase().includes(needle)
      );
    }

    return list;
  }, [skills, tab, q, usage, recent]);

  const frequentSkills = useMemo(() => {
    const used = skills
      .filter((s) => (usage[s.id] || 0) > 0)
      .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
    if (used.length >= 4) return used.slice(0, 4);
    const recommended = skills.filter((s) => RECOMMENDED_IDS.includes(s.id));
    const seen = new Set(used.map((s) => s.id));
    return [...used, ...recommended.filter((s) => !seen.has(s.id))].slice(0, 4);
  }, [skills, usage]);

  // 有使用记录才叫「常用技能」；没有记录时那几行是推荐补的，标题与星标都得照实说
  // （不得把推荐说成"你经常使用"：根 AGENTS.md §4）。
  const hasUsage = useMemo(() => skills.some((s) => (usage[s.id] || 0) > 0), [skills, usage]);

  const groupedSkills = useMemo(() => {
    const groups: Record<string, SkillRow[]> = {};
    for (const group of GROUPS) {
      groups[group.id] = filteredSkills.filter((s) => group.funnel.includes(s.funnel || ""));
    }
    return groups;
  }, [filteredSkills]);

  // 「使用」＝ 只把技能挂到工作台 Composer 上：用户还能补完 Prompt 再自己发送。
  // 不提供「直接开新会话」——部分技能需要先填参数，且外发属 L3，不能由「使用技能」一步完成
  // （docs/DESIGN.md 员工端实施细则 §不变量 2）。
  const useSkill = (skill: SkillRow) => {
    recordUsage(skill.id);
    setUsage(loadUsage());
    setRecent(loadRecent());
    rememberJourney({ kind: "skill", skillId: skill.id, skillLabel: skill.label || skill.title });
    applyComposerDraft({
      text: skillFillText(skill),
      chips: [{
        kind: "skill",
        id: skill.id,
        label: skill.label || skill.title,
        write: isWriteSkill(skill),
      }],
    });
    nav("/");
  };

  return (
    <div className="skill-catalog-page" data-skill-catalog>
      <header className="skill-catalog-header">
        <div>
          <h1>技能目录</h1>
          <p className="skill-catalog-subtitle">按业务阶段查找并调用技能，可直接插入当前会话。</p>
        </div>
        <label className="skill-search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16.4 20 20.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            className="skill-search"
            placeholder="搜索技能 / SOP / 场景"
            aria-label="搜索技能 / SOP / 场景"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="skill-search-clear"
              aria-label="清除搜索"
              title="清除"
              onClick={() => {
                setQ("");
                searchRef.current?.focus();
              }}
            >
              <ClearIcon />
            </button>
          )}
        </label>
      </header>

      {/* shadcn `TabsList` ×2：口径 / 阶段各一个容器，容器承担成组控件的可见边界。 */}
      <div className="skill-tabs" role="group" aria-label="技能筛选">
        {(["mode", "stage"] as const).map((kind) => (
          <div key={kind} className="skill-tabs-list">
            {TABS.filter((t) => t.kind === kind).map((t, i) => (
              <Fragment key={t.id}>
                {kind === "stage" && i > 0 && (
                  <span className="skill-tab-sep" aria-hidden>›</span>
                )}
                <button
                  type="button"
                  className={`skill-tab${tab === t.id ? " on" : ""}`}
                  aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              </Fragment>
            ))}
          </div>
        ))}
        {/* 窄屏下这排 pill 会横向滚动：右缘渐隐是「还有内容」的可视信号（sticky 在滚动容器内）。
            宽屏放得下时它只盖在背景上，不产生视觉噪声。 */}
        <span className="skill-tabs-fade" aria-hidden />
      </div>

      {err && (
        <div className="skill-state" role="alert">
          <p className="error">{err}</p>
          <button
            type="button"
            className="skill-btn skill-btn-outline"
            onClick={() => setReloadKey((n) => n + 1)}
          >
            重试
          </button>
        </div>
      )}
      {loading && !err && (
        <div className="skill-state" aria-busy="true">
          <p className="muted">正在加载技能…</p>
        </div>
      )}

      <div className="skill-catalog-main">
        <div className="skill-catalog-content">
          {tab === "all" && !q && (
            <section className="skill-group skill-group-frequent">
              <div className="skill-group-header">
                <span className="skill-group-icon skill-group-icon-star">★</span>
                <h2>{hasUsage ? "常用技能" : "推荐技能"}</h2>
                <span className="skill-group-hint">
                  {hasUsage ? "你经常使用的技能，点击即可快速调用" : "按你所在阶段挑的几项，先试这些"}
                </span>
                <Link
                  to={hasUsage ? "/skills?tab=frequent" : "/skills?tab=recommend"}
                  className="skill-group-more"
                >
                  查看全部
                </Link>
              </div>
              <div className="skill-list">
                {frequentSkills.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    onSelect={selectSkill}
                    onUse={(skill) => void useSkill(skill)}
                    isFrequent={false}
                    selected={selectedSkill?.id === s.id}
                  />
                ))}
              </div>
            </section>
          )}

          {GROUPS.map((group) => {
            const groupSkills = groupedSkills[group.id] || [];
            if (groupSkills.length === 0) return null;
            return (
              <section key={group.id} className="skill-group">
                <div className="skill-group-header">
                  <span className="skill-group-icon">
                    <GroupIcon id={group.id} />
                  </span>
                  <h2>{group.label}</h2>
                  <span className="skill-group-hint">{group.hint}</span>
                  <Link to={`/skills?tab=${group.id}`} className="skill-group-more">查看全部</Link>
                </div>
                <div className="skill-list">
                  {groupSkills.map((s) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      onSelect={selectSkill}
                      onUse={(skill) => void useSkill(skill)}
                        isFrequent={(usage[s.id] || 0) > 0}
                      selected={selectedSkill?.id === s.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {!loading && filteredSkills.length === 0 && (
            <div className="skill-state">
              <p className="muted">没有匹配的技能</p>
              <button
                type="button"
                className="skill-btn skill-btn-outline"
                onClick={() => {
                  setQ("");
                  setTab("all");
                  nav("/skills");
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={"skill-detail-scrim" + (detailOpen ? " is-open" : "")}
          aria-label="关闭技能详情"
          onClick={() => setDetailOpen(false)}
        />
        <aside
          className={
            "skill-detail-pane" + (detailWide ? " is-wide" : "") + (detailOpen ? " is-open" : "")
          }
          aria-label="技能详情"
        >
          <SkillDetail
            skill={selectedSkill}
            onInsert={(s) => void useSkill(s)}
            wide={detailWide}
            onToggleWide={() => setDetailWide((v) => !v)}
            onClose={() => setDetailOpen(false)}
          />
        </aside>
      </div>
    </div>
  );
}
