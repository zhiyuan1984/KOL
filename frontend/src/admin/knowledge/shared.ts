import { useCallback, useEffect, useState } from "react";
import type { KnowledgeRow } from "../../api";
import { MAIN_STAGE_TABS } from "../../kolStages";
import {
  brandLabel,
  kindLabel,
  skillLabel,
  statusLabel,
} from "../../knowledgeCopy";

export type Row = Record<string, unknown>;
export type KbAssetRow = KnowledgeRow & {
  ref_skills?: string[];
  effective_at?: string;
  expires_at?: string;
};
export type KbSub = (message: string) => void;
export type KbFail = (error: unknown, fallback?: string) => void;
export type KbFeed = { notify: KbSub; fail: KbFail };

export const KB_KINDS = ["mail_template", "policy", "pattern", "glossary"] as const;
export const KB_BRANDS = ["LT", "RO", "PQ"] as const;
export const KB_LANGS = ["en", "zh"] as const;
export const KB_STATUSES = ["draft", "pending_review", "published", "archived"] as const;
export const KB_STAGE_OPTIONS = MAIN_STAGE_TABS.map((stage) => ({ code: stage.code, label: stage.label }));
export const KB_SELECTOR_KEYS = ["ids", "kinds", "tags", "stage_codes", "brand", "lang"] as const;

/** 描述一条知识对员工的意义：状态 + 版本 + 范围。 */
export function kbRowSummary(row: KnowledgeRow): string {
  return `${kindLabel(row.kind)} · ${statusLabel(row.status)} · 第 ${row.current_version || 1} 版`;
}

export function kbScopeLine(row: KnowledgeRow): string {
  const stages = (row.stage_codes || []).map((code) => MAIN_STAGE_TABS.find((item) => item.code === code)?.label || code);
  const parts = [brandLabel(row.brand), row.lang ? `语言 ${row.lang}` : ""].filter(Boolean);
  if (stages.length) parts.push(`阶段 ${stages.join(" / ")}`);
  return parts.join(" · ");
}

export function kbSkillNames(skills?: string[]): string[] {
  return (skills || []).map((skill) => skillLabel(skill)).filter(Boolean);
}

export function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

export function listText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join(" / ");
  return String(value ?? "").trim();
}

export function splitList(value: string): string[] {
  return String(value || "").split(/[\s,，、]+/).map((item) => item.trim()).filter(Boolean);
}

export function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value ?? "").trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    /* 非 JSON 时按分隔符拆 */
  }
  return splitList(text);
}

/** 选择器摘要：这一条绑定会拿去哪些知识。 */
export function selectorSummary(selector: Row | undefined): string {
  const source = selector || {};
  const parts: string[] = [];
  const ids = asArray(source.ids);
  const kinds = asArray(source.kinds);
  const tags = asArray(source.tags);
  const stages = asArray(source.stage_codes);
  const brand = textValue(source.brand);
  const lang = textValue(source.lang);
  if (ids.length) parts.push(`显式 id：${ids.join("、")}`);
  if (kinds.length) parts.push(`类型：${kinds.map((kind) => kindLabel(kind)).join("、")}`);
  if (tags.length) parts.push(`标签：${tags.join("、")}`);
  if (stages.length) parts.push(`阶段：${stages.map((code) => MAIN_STAGE_TABS.find((item) => item.code === code)?.label || code).join("、")}`);
  if (brand) parts.push(`品牌：${brandLabel(brand)}`);
  if (lang) parts.push(`语言：${lang}`);
  return parts.length ? parts.join(" · ") : "全部已发布知识";
}

export function hasGrantRow(grants: { org: string[]; team: string[]; user: string[] }): boolean {
  return grants.org.length + grants.team.length + grants.user.length > 0;
}

/** 30 天内到期（含已过期）的提醒行：只提示，不自动动作。 */
export function expirySoon(expiresAt?: string, withinDays = 30): boolean {
  const raw = textValue(expiresAt);
  if (!raw) return false;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at)) return false;
  return at - Date.now() <= withinDays * 86_400_000;
}

export function errorMessage(error: unknown, fallback = "操作失败"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 资产详情的深链：/admin/knowledge/assets/:id。 */
export function detailPath(id: string): string {
  return `/admin/knowledge/assets/${encodeURIComponent(id)}`;
}

export function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 0;
}

export function useKbData<T>(loader: () => Promise<T>, deps: unknown[] = []): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError("");
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorMessage(cause, "无法加载治理数据"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick, ...deps]);

  return { data, error, loading, reload };
}
