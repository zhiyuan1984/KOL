import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type KnowledgeFieldType = "text" | "longtext" | "string_list";

export type KnowledgeFieldSpec = {
  key: string;
  label: string;
  type: KnowledgeFieldType;
  required: boolean;
};

export type KnowledgeKindSpec = {
  code: string;
  name: string;
  /** true = 有专有结构化字段；false = 正文即内容（仍可按 key 被绑定精确取用）。 */
  structured: boolean;
  baseKind: string[];
  summary: string;
  fields: KnowledgeFieldSpec[];
  clauses: string[];
};

export type KnowledgeKindsConfig = {
  version: number;
  kinds: Map<string, KnowledgeKindSpec>;
};

let cached: { file: string; mtime: number; config: KnowledgeKindsConfig } | null = null;

export function knowledgeKindsPath(): string {
  return process.env.KNOWLEDGE_KINDS_PATH || path.join(repoRoot, "config", "knowledge-kinds.yaml");
}

export function resetKnowledgeKindsCache(): void {
  cached = null;
}

export function loadKnowledgeKinds(options: { refresh?: boolean } = {}): KnowledgeKindsConfig | null {
  const file = knowledgeKindsPath();
  if (!fs.existsSync(file)) {
    console.warn(`[knowledge] 知识类型目录不存在：${file}（使用内置兜底类型）`);
    return null;
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (!options.refresh && cached && cached.file === file && cached.mtime === mtime) return cached.config;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as {
      version?: number;
      kinds?: Array<{
        code?: string;
        name?: string;
        structured?: boolean;
        base_kind?: string[];
        summary?: string;
        fields?: Array<{ key?: string; label?: string; type?: string; required?: boolean }>;
        clauses?: string[];
      }>;
    };
    const kinds = new Map<string, KnowledgeKindSpec>();
    for (const kind of raw.kinds || []) {
      const code = String(kind?.code || "");
      if (!code) continue;
      kinds.set(code, {
        code,
        name: String(kind?.name || code),
        structured: kind?.structured === true,
        baseKind: (kind?.base_kind || []).map(String),
        summary: String(kind?.summary || ""),
        fields: (kind?.fields || []).map((field) => ({
          key: String(field?.key || ""),
          label: String(field?.label || field?.key || ""),
          type: (["text", "longtext", "string_list"].includes(String(field?.type)) ? String(field?.type) : "text") as KnowledgeFieldType,
          required: field?.required === true,
        })),
        clauses: (kind?.clauses || []).map(String),
      });
    }
    const config: KnowledgeKindsConfig = { version: Number(raw.version || 1), kinds };
    cached = { file, mtime, config };
    return config;
  } catch (error) {
    console.warn(`[knowledge] 知识类型目录解析失败：${file}：${(error as Error).message}（使用内置兜底类型）`);
    return null;
  }
}

export function knowledgeKindSpec(code: string): KnowledgeKindSpec | null {
  return loadKnowledgeKinds()?.kinds.get(String(code)) || null;
}

export function knowledgeKindCodes(): string[] {
  return [...(loadKnowledgeKinds()?.kinds.keys() || [])];
}

/**
 * 校验结构化字段：只允许目录声明的键；required 字段非空；string_list 必须为字符串数组。
 * 返回错误清单（空数组 = 通过）。`structured=false` 的 kind 只允许空对象。
 */
export function validateStructuredFields(kindCode: string, value: unknown): string[] {
  const spec = knowledgeKindSpec(kindCode);
  if (!spec) return [`未知的知识类型：${kindCode}`];
  const errors: string[] = [];
  const input = value === null || value === undefined ? {} : value;
  if (typeof input !== "object" || Array.isArray(input)) return [`${kindCode} 的结构化字段必须是对象`];
  const record = input as Record<string, unknown>;
  const allowed = new Set(spec.fields.map((field) => field.key));
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`${kindCode} 不支持字段：${key}`);
  }
  for (const field of spec.fields) {
    const cell = record[field.key];
    const empty = cell === undefined || cell === null || cell === "";
    if (field.required && empty) {
      errors.push(`${spec.name} 缺少必填字段：${field.label}（${field.key}）`);
      continue;
    }
    if (empty) continue;
    if (field.type === "string_list") {
      if (!Array.isArray(cell) || cell.some((item) => typeof item !== "string")) {
        errors.push(`${spec.name} 的「${field.label}」必须是字符串数组`);
      }
    } else if (typeof cell !== "string") {
      errors.push(`${spec.name} 的「${field.label}」必须是文本`);
    }
  }
  return errors;
}
