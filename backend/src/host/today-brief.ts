import type { Json } from "../types.js";
import { briefPointerTable, planTaskType, type PlanScope } from "./today-plan-context.js";

export { briefPointerTable, planTaskType };
export type { PlanScope };

export const BANNED_PRIMARY_COPY = /处理|待补阶段/;
export const BATCH_FORBIDDEN_VERBS = new Set(["follow"]);
export const BATCH_ALLOWED_VERBS = new Set(["retry_crawl", "open_batch", "analyze"]);

export type TodayBriefValidation =
  | { ok: true; brief: Json }
  | { ok: false; reason: string; brief: null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function objectTypeOf(value: unknown): string {
  const row = asRecord(value);
  return String(row?.object_type || row?.kind || "").toLowerCase();
}

function personIdOf(value: unknown): string {
  const row = asRecord(value);
  return String(row?.person_id || row?.collaboration_id || "").trim();
}

function isBatchObject(value: unknown): boolean {
  const type = objectTypeOf(value);
  if (type === "batch" || type === "discovery_batch" || type === "discovery") return true;
  return type !== "person" && !personIdOf(value) && /batch|discovery/.test(JSON.stringify(value || {}));
}

function collectActions(brief: Record<string, unknown>): Record<string, unknown>[] {
  const actions: Record<string, unknown>[] = [];
  if (asRecord(brief.primary)) actions.push(brief.primary as Record<string, unknown>);
  for (const key of ["suggestions", "recommended_actions", "actions"]) {
    const list = brief[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") actions.push({ verb: item, label: item });
      else if (asRecord(item)) actions.push(item as Record<string, unknown>);
    }
  }
  if (Array.isArray(brief.sections)) {
    for (const section of brief.sections) {
      const row = asRecord(section);
      const nested = row?.actions || row?.items;
      if (!Array.isArray(nested)) continue;
      for (const item of nested) if (asRecord(item) && item.verb) actions.push(item as Record<string, unknown>);
    }
  }
  return actions;
}

function sectionHasCopy(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((item) => {
    const row = asRecord(item);
    return row ? Boolean(String(row.title || row.body || "").trim() || (Array.isArray(row.items) && row.items.length))
      : typeof item === "string" && Boolean(item.trim());
  });
}

function hasDisplayTasks(brief: Record<string, unknown>): boolean {
  const list = Array.isArray(brief.display_tasks)
    ? brief.display_tasks
    : Array.isArray(brief.todo_layout) ? brief.todo_layout : null;
  if (!list) return false;
  if (list.length === 0) return true;
  return list.some((item) => Boolean(String(asRecord(item)?.work_item_id || asRecord(item)?.id || "").trim()));
}

/** Validate untrusted model output before the native transaction persists any artifact. */
export function validateTodayBrief(value: unknown): TodayBriefValidation {
  const brief = asRecord(value);
  if (!brief) return { ok: false, reason: "today_brief must be an object", brief: null };
  const lead = typeof brief.lead === "string" ? brief.lead.trim() : "";
  if (!lead && !sectionHasCopy(brief.sections)) return { ok: false, reason: "Codex did not produce lead or sections", brief: null };
  if (brief.sections != null && !Array.isArray(brief.sections)) return { ok: false, reason: "missing sections", brief: null };
  if (!hasDisplayTasks(brief)) return { ok: false, reason: "规划结果缺少有效的任务展示列表", brief: null };

  const primary = asRecord(brief.primary) || {};
  const primaryVerb = String(primary.verb || primary.action || "").trim().toLowerCase();
  const primaryLabel = String(primary.label || primary.title || brief.lead || "");
  if (BANNED_PRIMARY_COPY.test(primaryLabel) || BANNED_PRIMARY_COPY.test(primaryVerb)) {
    return { ok: false, reason: "banned primary copy", brief: null };
  }
  if (isBatchObject(primary) && BATCH_FORBIDDEN_VERBS.has(primaryVerb)) {
    return { ok: false, reason: "follow is forbidden on discovery batch", brief: null };
  }
  for (const action of collectActions(brief)) {
    const verb = String(action.verb || action.action || "").trim().toLowerCase();
    if (isBatchObject(action) && BATCH_FORBIDDEN_VERBS.has(verb)) {
      return { ok: false, reason: "follow is forbidden on discovery batch", brief: null };
    }
  }
  return { ok: true, brief: brief as Json };
}
