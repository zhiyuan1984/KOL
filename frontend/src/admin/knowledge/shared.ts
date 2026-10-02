import { useCallback, useEffect, useState } from "react";
import type { KnowledgeBaseRow, KnowledgeDomainRow, KnowledgeRow } from "../../api";
import { MAIN_STAGE_TABS } from "../../kolStages";
import {
  brandLabel,
  kbBaseKindLabel,
  kbLevelLabel,
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
export type { KnowledgeBaseRow, KnowledgeDomainRow };

/* ---- kind → 结构化字段 ----
 * **前端唯一来源**：与 `config/knowledge-kinds.yaml` 同步维护（同步于 2026-10-01）。
 * 前端不把字段表复制到别的文件；后端校验以 config 为准（错误 400
 * `knowledge_structured_invalid` 带 errors[]）。待后端提供只读 kinds 接口后，
 * 这份常量整体替换为服务端返回，调用点（kindSpec / kindFields）不变。
 */

export type StructuredFieldType = "text" | "longtext" | "string_list";

export type StructuredFieldSpec = {
  key: string;
  label: string;
  type: StructuredFieldType;
  required: boolean;
};

export type KnowledgeKindSpec = {
  code: string;
  label: string;
  /** structured=false：无专有字段、正文即内容。 */
  structured: boolean;
  baseKinds: Array<"structured" | "unstructured">;
  summary: string;
  fields: StructuredFieldSpec[];
};

export const KNOWLEDGE_KIND_SPECS: KnowledgeKindSpec[] = [
  {
    code: "mail_template",
    label: "邮件模板",
    structured: true,
    baseKinds: ["structured"],
    summary: "主题 + 英文正文 + 占位符；注入时编译为载荷，不注入原文。",
    fields: [
      { key: "subject", label: "主题", type: "text", required: true },
      { key: "body_en", label: "英文正文", type: "longtext", required: true },
      { key: "placeholders", label: "占位符", type: "string_list", required: false },
      { key: "internal_zh", label: "中文内部译稿", type: "longtext", required: false },
    ],
  },
  {
    code: "prompt",
    label: "提示词",
    structured: true,
    baseKinds: ["structured"],
    summary: "供技能或数字员工使用的提示词模板；按技能 + 品牌精确取用。",
    fields: [
      { key: "body", label: "提示词正文", type: "longtext", required: true },
      { key: "variables", label: "变量", type: "string_list", required: false },
      { key: "model_hint", label: "建议模型", type: "text", required: false },
    ],
  },
  {
    code: "glossary",
    label: "术语表",
    structured: true,
    baseKinds: ["structured"],
    summary: "术语与释义；用于统一口径与内部译法。",
    fields: [
      { key: "term", label: "术语", type: "text", required: true },
      { key: "definition", label: "释义", type: "longtext", required: true },
      { key: "aliases", label: "别名", type: "string_list", required: false },
    ],
  },
  {
    code: "question_template",
    label: "问答模板",
    structured: true,
    baseKinds: ["structured"],
    summary: "标准问 + 参考答 + 追问要点。",
    fields: [
      { key: "question", label: "标准问", type: "longtext", required: true },
      { key: "answer", label: "参考答", type: "longtext", required: true },
      { key: "followups", label: "追问要点", type: "string_list", required: false },
    ],
  },
  {
    code: "policy",
    label: "制度与政策",
    structured: false,
    baseKinds: ["structured", "unstructured"],
    summary: "以正文为准的制度类知识；正文即内容。",
    fields: [],
  },
  {
    code: "pattern",
    label: "方法与套路",
    structured: false,
    baseKinds: ["structured", "unstructured"],
    summary: "可复用的方法、经验与话术骨架；正文即内容。",
    fields: [],
  },
];

export const KB_KINDS = KNOWLEDGE_KIND_SPECS.map((spec) => spec.code);
export const KB_BRANDS = ["LT", "RO", "PQ"] as const;
export const KB_LANGS = ["en", "zh"] as const;
export const KB_STATUSES = ["draft", "pending_review", "published", "archived"] as const;
export const KB_STAGE_OPTIONS = MAIN_STAGE_TABS.map((stage) => ({ code: stage.code, label: stage.label }));
export const KB_SELECTOR_KEYS = ["ids", "kinds", "tags", "stage_codes", "brand", "lang"] as const;

export function kindSpec(kind?: string): KnowledgeKindSpec | null {
  const code = String(kind || "").trim();
  if (!code) return null;
  return KNOWLEDGE_KIND_SPECS.find((spec) => spec.code === code) || null;
}

/** 该 kind 的专有字段；未登记的 kind 返回空表（正文即内容）。 */
export function kindFields(kind?: string): StructuredFieldSpec[] {
  return kindSpec(kind)?.fields || [];
}

/** 库类型是否与 kind 兼容（config.search base_kinds）；未登记 kind 不拦。 */
export function kindAllowedInBase(kind: string | undefined, baseKind: string | undefined): boolean {
  const spec = kindSpec(kind);
  const target = String(baseKind || "").trim();
  if (!spec || !target) return true;
  return spec.baseKinds.includes(target as "structured" | "unstructured");
}

/** 结构化字段显示行：只渲染有值的字段，标签按 kind 定义。 */
export function structuredDisplay(
  kind: string | undefined,
  value: unknown,
): Array<{ key: string; label: string; value: string }> {
  const source = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Row;
  const seen = new Set<string>();
  const rows: Array<{ key: string; label: string; value: string }> = [];
  for (const field of kindFields(kind)) {
    seen.add(field.key);
    const text = field.type === "string_list" ? asArray(source[field.key]).join("、") : textValue(source[field.key]);
    if (!text) continue;
    rows.push({ key: field.key, label: field.label, value: text });
  }
  for (const [key, raw] of Object.entries(source)) {
    if (seen.has(key)) continue;
    const text = Array.isArray(raw) ? asArray(raw).join("、") : textValue(raw);
    if (!text) continue;
    rows.push({ key, label: key, value: text });
  }
  return rows;
}

/** 表单读取 `structured:<key>`：空值不写（必填由服务端按 config 判定）。 */
export function structuredPayload(form: FormData, kind: string | undefined): Row | undefined {
  const fields = kindFields(kind);
  if (!fields.length) return undefined;
  const payload: Row = {};
  for (const field of fields) {
    const raw = String(form.get(`structured:${field.key}`) ?? "").trim();
    if (!raw) continue;
    payload[field.key] = field.type === "string_list" ? splitList(raw) : raw;
  }
  return Object.keys(payload).length ? payload : undefined;
}

/** 结构化校验错误（后端 400 knowledge_structured_invalid 的 errors[]）。 */
export function structuredErrorList(cause: unknown): string[] {
  const payload = (cause as { payload?: unknown } | null)?.payload;
  const errors = (payload as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((item) => {
      if (typeof item === "string") return item;
      const row = (item || {}) as Row;
      const field = textValue(row.field || row.key);
      const message = textValue(row.message || row.detail || row.error);
      return [field, message].filter(Boolean).join("：") || JSON.stringify(item);
    })
    .filter(Boolean);
}

/** 分类行的显示名（族/域/库）与状态文案。 */
export function taxonomyLabel(row: Pick<KnowledgeBaseRow, "family_name" | "domain_name" | "name">): string {
  return [row.family_name, row.domain_name, row.name].map((item) => String(item || "").trim()).filter(Boolean).join(" / ");
}

export { kbBaseKindLabel, kbLevelLabel };


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

/** 字节数的紧凑展示（列表元信息用；不参与业务判断）。 */
export function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
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

/** 条目详情的深链：/admin/knowledge/entries/:id。 */
export function entryPath(id: string): string {
  return `/admin/knowledge/entries/${encodeURIComponent(id)}`;
}

/** 库详情的深链：/admin/knowledge/bases/:id。 */
export function basePath(id: string): string {
  return `/admin/knowledge/bases/${encodeURIComponent(id)}`;
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
