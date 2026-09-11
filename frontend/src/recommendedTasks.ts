import type { RecommendedTask, TaskDefinition } from "./api";
import { starterPrompt } from "./taskStarters";

export const MAX_RECOMMENDED_TASKS = 8;

const INTENT_ICON: Record<string, string> = {
  email_compose: "✉️",
  reply_analysis: "💬",
  creator_profile: "👤",
  confirm_stage: "📍",
  risk_scan: "⚠",
  deal_memory: "📝",
  creator_budget_report: "📊",
  creator_discovery: "🔎",
  creator_daily_tasks: "📋",
};

const CATALOG_INTENTS = [
  "email_compose",
  "reply_analysis",
  "creator_profile",
  "confirm_stage",
  "risk_scan",
  "deal_memory",
  "creator_discovery",
  "creator_daily_tasks",
] as const;

const CATALOG_TITLE: Record<string, string> = {
  email_compose: "写合作邮件",
  reply_analysis: "回复分析",
  creator_profile: "达人画像",
  confirm_stage: "记状态",
  risk_scan: "超时/风险扫描",
  deal_memory: "Deal Memory",
  creator_discovery: "发现达人",
  creator_daily_tasks: "今日 KOL 任务",
};

const CATALOG_REASON: Record<string, string> = {
  email_compose: "从任务模板开始一封合作邮件",
  reply_analysis: "先粘贴达人回复",
  creator_profile: "先补这位红人的画像",
  confirm_stage: "人确认后再改阶段",
  risk_scan: "扫一眼卡住的合作",
  deal_memory: "整理谈判纪要",
  creator_discovery: "按平台或关键词找达人",
  creator_daily_tasks: "看今天还能推进谁",
};

export function recIcon(intent?: string): string {
  return INTENT_ICON[String(intent || "")] || "○";
}

export function catalogRecommendedTasks(definitions: TaskDefinition[] = []): RecommendedTask[] {
  return CATALOG_INTENTS.map((intent) => {
    const definition = definitions.find((row) => row.id === intent);
    return {
      id: `rec-catalog-${intent}`,
      n: 0,
      icon: recIcon(intent),
      title: definition?.title || CATALOG_TITLE[intent] || intent,
      reason: CATALOG_REASON[intent] || "任务模板",
      source: "catalog",
      source_label: "任务模板",
      act: "ask" as const,
      intent,
      prompt: definition ? starterPrompt(definition) : starterPrompt({ id: intent, title: CATALOG_TITLE[intent] || intent }),
    };
  });
}

export function withRecommendedDisplay(items: RecommendedTask[], definitions: TaskDefinition[] = []): RecommendedTask[] {
  const padded = [...items];
  for (const filler of catalogRecommendedTasks(definitions)) {
    if (padded.length >= MAX_RECOMMENDED_TASKS) break;
    if (padded.some((row) => row.id === filler.id || (row.source === "catalog" && row.intent === filler.intent))) continue;
    padded.push(filler);
  }
  const source = padded.length ? padded : catalogRecommendedTasks(definitions);
  return source.slice(0, MAX_RECOMMENDED_TASKS).map((item, index) => ({
    ...item,
    n: index + 1,
    icon: item.icon || recIcon(item.intent),
    act: "ask",
  }));
}
