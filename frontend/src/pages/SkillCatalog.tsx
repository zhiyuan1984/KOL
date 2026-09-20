import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
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

const TABS = [
  { id: "all", label: "全部" },
  { id: "frequent", label: "常用" },
  { id: "recent", label: "最近使用" },
  { id: "recommend", label: "推荐" },
  { id: "reach", label: "建联" },
  { id: "intent", label: "意向" },
  { id: "biz", label: "报价" },
  { id: "sample", label: "寄样" },
  { id: "settle", label: "成交" },
  { id: "content", label: "数据分析" },
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

// 推荐技能（静态规则）
const RECOMMENDED_IDS = ["creator_discovery", "creator_library_query", "creator_scoring", "creator_daily_tasks"];

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

// 技能来源映射
const SKILL_SOURCE: Record<string, string> = {
  creator_discovery: "MediaCrawler",
  creator_library_query: "Starry KOL",
  creator_library_all: "Starry KOL",
  creator_profile: "Starry KOL",
  creator_contact_decrypt: "Starry KOL",
  creator_risk_conversations: "Starry KOL",
  creator_lifecycle_kanban: "Starry KOL",
  creator_status_update: "Starry KOL",
  creator_owner_update: "Starry KOL",
  creator_filter_options: "Starry KOL",
  creator_daily_tasks: "KOL Agent",
  creator_scoring: "KOL Agent",
  creator_outreach: "KOL Agent",
  kol_analyze: "KOL Agent",
  today_plan: "KOL Agent",
  today_analyze: "KOL Agent",
  reply_analysis: "KOL Agent",
  confirm_stage: "内核部门",
  stage_sop: "内核部门",
  discovery_plan: "内核部门",
  discovery_brief: "内核部门",
  risk_scan: "内核部门",
  business_approval: "内核部门",
  email_compose: "Starry KOL",
  email_conversation_list: "Starry KOL",
  email_conversation_read: "Starry KOL",
  email_mailbox_list: "Starry KOL",
  deal_memory: "Starry KOL",
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
    <svg viewBox="0 0 24 24" className="skill-card-svg" aria-hidden>
      <path d={d} fill="currentColor" />
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

function skillSource(id: string): string {
  return SKILL_SOURCE[id] || "Starry KOL";
}

function SkillCard({
  skill,
  onSelect,
  onUse,
  onNewSession,
  isFrequent,
  selected,
}: {
  skill: SkillRow;
  onSelect: (skill: SkillRow) => void;
  onUse: (skill: SkillRow) => void;
  onNewSession: (skill: SkillRow) => void;
  isFrequent: boolean;
  selected: boolean;
}) {
  return (
    <div
      className={"skill-card" + (selected ? " is-selected" : "")}
      data-skill-id={skill.id}
      onClick={() => onSelect(skill)}
    >
      {isFrequent && <span className="skill-card-star" aria-hidden>★</span>}
      <div className="skill-card-head">
        <div className="skill-card-icon">
          <SkillIcon id={skill.id} />
        </div>
        <div className="skill-card-title">
          {skill.title}
          <span className="skill-card-source">{skillSource(skill.id)}</span>
        </div>
      </div>
      <p className="skill-card-desc">{skill.summary || skill.title}</p>
      <div className="skill-card-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="skill-btn skill-btn-primary" onClick={() => onUse(skill)}>
          <span className="skill-btn-icon">+</span>
          插入当前会话
        </button>
        <button type="button" className="skill-btn skill-btn-secondary" onClick={() => onNewSession(skill)}>
          新建会话
        </button>
      </div>
    </div>
  );
}

function PreviewPanel({ skill }: { skill: SkillRow | null }) {
  if (!skill) {
    return (
      <div className="skill-preview-empty">
        <p>点击左侧技能卡片查看详情</p>
      </div>
    );
  }

  const scenes = SCENE_TAGS[skill.id] || [skill.funnel || "通用"];
  const io = IO_MAP[skill.id] || {
    inputs: ["相关参数"],
    outputs: ["分析结果"],
    example: [skill.summary || skill.title],
  };

  return (
    <div className="skill-preview">
      <div className="skill-preview-header">
        <h3>预览</h3>
        <button type="button" className="skill-preview-expand" aria-label="展开">
          ⤢
        </button>
      </div>
      <div className="skill-preview-body">
        <div className="skill-preview-title">
          <h2>{skill.title}</h2>
          <span className="skill-preview-tag">{skillKind(skill)}</span>
          <span className="skill-preview-agent">{skillSource(skill.id)}</span>
        </div>
        <p className="skill-preview-desc">{skill.summary || skill.title}</p>

        <div className="skill-preview-section">
          <h4>适用场景</h4>
          <div className="skill-preview-tags">
            {scenes.map((s) => (
              <span key={s} className="skill-preview-tag-item">{s}</span>
            ))}
          </div>
        </div>

        <div className="skill-preview-section">
          <h4>输入内容</h4>
          <p className="skill-preview-hint">提供以下信息，生成更个性化的话术：</p>
          <div className="skill-preview-tags">
            {io.inputs.map((s) => (
              <span key={s} className="skill-preview-tag-item">{s}</span>
            ))}
          </div>
        </div>

        <div className="skill-preview-section">
          <h4>输出结果</h4>
          <div className="skill-preview-tags">
            {io.outputs.map((s) => (
              <span key={s} className="skill-preview-tag-item">{s}</span>
            ))}
          </div>
        </div>

        <div className="skill-preview-section">
          <h4>内容示例</h4>
          <div className="skill-preview-thread">
            {(io.thread || [{ role: "ai" as const, lines: io.example }]).map((msg, i) => (
              <div key={i} className={"skill-preview-msg is-" + msg.role}>
                <span className="skill-preview-avatar" aria-hidden>{msg.role === "ai" ? "AI" : "我"}</span>
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
      </div>
      <div className="skill-preview-footer">
        <button type="button" className="skill-btn skill-btn-primary skill-btn-large">
          <span className="skill-btn-icon">+</span>
          插入当前会话
        </button>
        <button type="button" className="skill-btn skill-btn-secondary skill-btn-large">
          查看详情
        </button>
      </div>
    </div>
  );
}

export function SkillCatalog() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [selectedSkill, setSelectedSkill] = useState<SkillRow | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadUsage());
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const nav = useNavigate();
  const location = useLocation();

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
  }, []);

  // 默认选中常用技能第一个（无使用记录时用推荐技能第一个）
  useEffect(() => {
    if (skills.length > 0 && !selectedSkill) {
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

  const groupedSkills = useMemo(() => {
    const groups: Record<string, SkillRow[]> = {};
    for (const group of GROUPS) {
      groups[group.id] = filteredSkills.filter((s) => group.funnel.includes(s.funnel || ""));
    }
    return groups;
  }, [filteredSkills]);

  const useSkill = async (skill: SkillRow) => {
    recordUsage(skill.id);
    setUsage(loadUsage());
    setRecent(loadRecent());

    const sessionMatch = location.pathname.match(/^\/s\/([^/]+)/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      try {
        await api.postMessage(sessionId, { text: `@${skill.label || skill.title}`, intent: skill.id });
        window.location.reload();
      } catch (e) {
        setErr(String(e));
      }
      return;
    }

    try {
      const prompt = `@${skill.label || skill.title}`;
      const ses = await api.createSession(prompt.slice(0, 24));
      storePending(ses.id, { text: prompt, intent: skill.id });
      rememberJourney({ kind: "skill", skillId: skill.id, skillLabel: skill.label || skill.title });
      nav(`/s/${ses.id}`);
    } catch (e) {
      setErr(String(e));
    }
  };

  const newSession = async (skill: SkillRow) => {
    recordUsage(skill.id);
    setUsage(loadUsage());
    setRecent(loadRecent());

    try {
      const prompt = `@${skill.label || skill.title}`;
      const ses = await api.createSession(prompt.slice(0, 24));
      storePending(ses.id, { text: prompt, intent: skill.id });
      rememberJourney({ kind: "skill", skillId: skill.id, skillLabel: skill.label || skill.title });
      nav(`/s/${ses.id}`);
    } catch (e) {
      setErr(String(e));
    }
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
            className="skill-search"
            placeholder="搜索技能 / SOP / 场景"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </header>

      <div className="skill-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`skill-tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <p className="error" role="alert">{err}</p>}
      {loading && !err && <p className="muted">正在加载技能…</p>}

      <div className="skill-catalog-main">
        <div className="skill-catalog-content">
          {tab === "all" && !q && (
            <section className="skill-group skill-group-frequent">
              <div className="skill-group-header">
                <span className="skill-group-icon skill-group-icon-star">★</span>
                <h2>常用技能</h2>
                <span className="skill-group-hint">你经常使用的技能，点击即可快速调用</span>
                <Link to="/skills?tab=frequent" className="skill-group-more">查看全部</Link>
              </div>
              <div className="skill-grid skill-grid-4">
                {frequentSkills.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    onSelect={(skill) => setSelectedSkill(skill)}
                    onUse={(skill) => void useSkill(skill)}
                    onNewSession={(skill) => void newSession(skill)}
                    isFrequent={true}
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
                <div className="skill-grid skill-grid-3">
                  {groupSkills.map((s) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      onSelect={(skill) => setSelectedSkill(skill)}
                      onUse={(skill) => void useSkill(skill)}
                      onNewSession={(skill) => void newSession(skill)}
                      isFrequent={(usage[s.id] || 0) > 0}
                      selected={selectedSkill?.id === s.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {!loading && filteredSkills.length === 0 && (
            <p className="muted">没有匹配的技能</p>
          )}
        </div>

        <aside className="skill-catalog-preview">
          <PreviewPanel skill={selectedSkill} />
        </aside>
      </div>
    </div>
  );
}
