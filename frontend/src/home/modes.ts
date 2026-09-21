export type HomeMode = "today" | "todo" | "discovery" | "lifecycle" | "pool";

/** Visible Home top-bar tabs in「新工作任务」. */
export const HOME_MODES: HomeMode[] = ["today", "todo", "discovery", "pool", "lifecycle"];

/** docs/PRODUCT.md PROD-PLAT-02 Home mode names (KOL pilot). */
export const HOME_MODE_LABELS: Record<HomeMode, string> = {
  today: "今日任务",
  todo: "我的待办",
  discovery: "AI发现",
  lifecycle: "我跟进的红人",
  pool: "公海",
};

const HOME_MODE_ALIASES: Record<string, HomeMode> = {
  today: "today",
  todo: "todo",
  discovery: "discovery",
  lifecycle: "lifecycle",
  pool: "pool",
  ai: "today",
};

const LEGACY_AI_DISCOVERY_LABELS = new Set(["AI发现", "AI 发现", "✦ AI发现", "✦ AI 发现"]);

/** Old「AI发现」task-recommendation copy → 今天推荐 (Home). */
export function recommendationSourceLabel(item: { source?: string; source_label?: string }): string {
  const raw = String(item.source_label || "").trim();
  if (LEGACY_AI_DISCOVERY_LABELS.has(raw) || (!raw && item.source === "ai")) return "今天推荐";
  if (raw) return raw;
  if (item.source === "catalog") return "任务模板";
  return "按阶段";
}

export function todayTaskOriginLabel(source?: string): string {
  return source === "ai" ? "今天推荐" : "我的任务";
}

export function todayTaskSourceLabel(source?: string): string {
  return source === "ai" ? "今天推荐" : "手动创建";
}

export function parseHomeMode(value: string | null): HomeMode {
  if (!value) return "today";
  return HOME_MODE_ALIASES[value] || "today";
}

export function homeModeQuery(next: HomeMode): HomeMode | null {
  return next === "today" ? null : next;
}
