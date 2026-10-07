import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { publishedSkillsDir, skillsDir } from "../config.js";

export const TASK_PROFILES = [
  "commander",
  "lead",
  "opportunity",
  "negotiation",
  "execution",
  "settlement-growth",
] as const;

export type TaskProfileId = (typeof TASK_PROFILES)[number];
export const TASK_OUTPUTS = ["crawl_plan", "task_result", "propose_stage", "kol_analyze_brief", "today_brief"] as const;
export const TASK_SIDE_EFFECTS = ["none", "write"] as const;
export type TaskSideEffects = (typeof TASK_SIDE_EFFECTS)[number];
export type TaskOutput = (typeof TASK_OUTPUTS)[number];
export const TASK_FUNNELS = ["reach", "intent", "biz", "sample", "content", "settle", "exception"] as const;
export type TaskFunnel = (typeof TASK_FUNNELS)[number];
export type TaskSource = "bundled" | "published";

export const TASK_INPUT_KINDS = ["single", "multiple", "text", "number", "date", "object"] as const;
const REGISTERED_INPUT_OPTION_SOURCES = new Set([
  "api:/home/discovery/template#platforms",
  "api:/home/discovery/template#regions",
  "api:/home/discovery/template#directions",
]);
/**
 * 上下文键目录（docs/superpowers/specs/2026-10-06-context-resolution-design.md §已登记上下文键）。
 * 技能声明「需要哪几片当前世界」，Host 用统一来源链解析；键不得自创，未登记即拒绝加载
 * —— 与 input_schema.options_source 同一处置。
 */
export const TASK_CONTEXT_KEYS = [
  "collaboration",
  "stage",
  "stage_tracks",
  "mailbox",
  "mail_thread",
  "mail_template",
  "message",
  "conversation",
  "creator",
  "creator_filter",
  "risk_scope",
  "recipient",
] as const;
export type TaskContextKey = (typeof TASK_CONTEXT_KEYS)[number];
/** Only result types with a Host-owned validator may opt into automatic memory writes. */
const REGISTERED_SKILL_RESULT_MEMORY_WRITERS = new Set([
  "creator_discovery|discovery_candidates|skill_result|owner|on_complete",
]);
export type TaskInputKind = (typeof TASK_INPUT_KINDS)[number];
export type TaskInputField = {
  key: string;
  label: string;
  kind: TaskInputKind;
  required: boolean;
  options_source?: string;
  options?: Array<string | { code: string; label: string }>;
  reason?: string;
  prefill?: string;
  default?: unknown;
  min?: number;
  max?: number;
  integer?: boolean;
};
export type TaskResultSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, TaskResultSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: TaskResultSchema;
  enum?: Array<string | number | boolean | null>;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};
/**
 * 结果卡片的下一步动作。action_id 是本技能 actions 里登记的动作，或 `skill:<技能 id>`（引导到另一个技能）；
 * note 是员工看到的动作文案。when：always / has_results / no_results / has_selection。
 */
export type TaskNextAction = { action_id: string; when: "has_results" | "no_results" | "has_selection" | "always"; note?: string };
export type TaskMemoryPolicy = {
  kind: string;
  scope: "owner" | "company" | "object";
  auto_persist: "on_complete" | "on_adopt" | "never";
  stale_refs?: string[];
};
export type TaskSupports = { cancel: boolean; retry: boolean; resume: boolean };
export type TaskRuntimeAccess = "granted" | "authenticated";

/**
 * 技能的上下文需求声明。`requires` 解析失败即 needs_context（不建箱、不启动 turn）；
 * `prefers` 失败不阻塞，但要如实标注未取到。空 `requires` 是「本技能不依赖当前世界」
 * 的显式声明，不是缺省值 —— 未声明整个 context 的技能保持现状并记为待补。
 */
export type TaskContext = {
  requires: TaskContextKey[];
  prefers: TaskContextKey[];
};

/** Human-facing half of the same published Skill; never executable instructions. */
export type TaskInteraction = {
  purpose: string;
  steps: string[];
  output_title: string;
  constraints: string[];
  evidence?: string[];
  decisions?: string[];
  recovery?: string[];
};

export type TaskDefinition = {
  id: string;
  content_version?: string;
  interaction?: TaskInteraction;
  /** Stable Runtime identity. Bundled business Skills retain agent:kol unless declared otherwise. */
  runtime_agent_id: string;
  /** Platform-only read Skills may be available to every active authenticated employee. */
  runtime_access: TaskRuntimeAccess;
  title: string;
  description: string;
  /** 面向员工的说明（可选）：员工面文案不得出现引擎词（specs/UX-EMPLOYEE.md §员工禁词）。
      缺省时员工面沿用 description —— 那也是 id 外泄的来源，见 CONST-10 的实施诚实。 */
  employee_summary?: string;
  /** 员工面「可以直接查到」（可选）：逐字取自 docs/BUSINESS.md 的「快捷查询与思考覆盖表」。
      没登记入口口径的技能不带这两个字段 —— 员工面照实说明待专家补齐，不给推测口径（CONST-10）。 */
  employee_quick?: string;
  /** 员工面「需要走确认或 AI 助理」（可选）：同表右列，与 employee_quick 成对登记。 */
  employee_agent?: string;
  /** 员工面示例（可选）：逐条成行。缺省时员工面不渲染示例小节。 */
  employee_example?: string[];
  /** 是否在员工面（提问框「技能」组、技能目录选用入口）列出。
      内部技能——只有 pipeline / 定时任务 / 旅程会调用的那些——标 false：
      能力与条款不动，只是不在员工可选清单里冒充一个动作。见 docs/BUSINESS.md 覆盖表。 */
  employee_visible: boolean;
  category: string;
  profile: TaskProfileId;
  output: TaskOutput;
  mcp: string[];
  required_inputs: string[];
  input_schema?: TaskInputField[];
  result_type?: string;
  /** Strict schema for the persisted result envelope: { items: WorkerResult.items }. */
  result_schema?: TaskResultSchema;
  next_actions?: TaskNextAction[];
  memory_policy?: TaskMemoryPolicy;
  supports?: TaskSupports;
  /** 这一步的当前世界需求（合作/阶段/发件箱/会话…）。见并发规格 2026-10-06。 */
  context?: TaskContext;
  permissions: string[];
  actions: string[];
  aliases: string[];
  in_market: boolean;
  funnel?: TaskFunnel;
  /** 展示元数据（作者声明）：图标库编号、来源徽章、填空模板。缺省时前端用通用图标/「平台内置」/标题。 */
  icon?: string;
  badge?: string;
  starter?: string;
  /** 结果卡片标题（作者声明）；缺省时用「技能名称」。 */
  result_title?: string;
  side_effects: TaskSideEffects;
  creates_session: boolean;
  auto_ok: boolean;
  source: TaskSource;
  path: string;
};

/**
 * 本地 stub / Codex 箱内置 MCP 服务器实现的工具（只用于 stub 箱配置）。
 * 这不是技能可声明工具的白名单：生产中技能声明对照已登记工具目录（runtime_tool_policies）。
 */
export const LOCAL_STUB_MCP_TOOLS = new Set([
  "knowledge.ask_documents",
  "claw.start_crawl",
  "claw.get_crawl_status",
  "claw.get_crawl_logs",
  "claw.get_creators",
  "claw.stop_crawl",
  "starry.get_collaboration",
  "starry.list_collaborations",
  "starry.deal_memory",
  "starrykol.pageMailboxes",
  "starrykol.listNylasAccounts",
  "starrykol.pageEmailConversations",
  "starrykol.getMailboxDetail",
  "starrykol.getEmailConversation",
  "starrykol.previewEmailDraft",
  "starrykol.pageKolProfiles",
  "starrykol.listAllKolProfiles",
  "starrykol.getKolProfileDetail",
  "starrykol.updateKolProfile",
  "starrykol.addKolProfile",
  "starrykol.listKolPlatformData",
  "starrykol.getKolProfileSidebarMetrics",
  "starrykol.decryptKolContact",
  "starrykol.pageLifecycleKanban",
  "starrykol.pageRiskConversations",
  "starrykol.summarizeRiskConversations",
  "starrykol.listDictionaryOptions",
  "starrykol.listCooperationStageOptions",
  "starrykol.listRiskTagOptions",
  "starrykol.pageAppEmailConversations",
  "starrykol.translateEmailToChinese",
  "starrykol.getStageRiskMatrix",
  "starrykol.getEmailConversationSubjectGroups",
  "kolclaw.analyze_creator",
  "kolclaw.analyze_creators",
  "kolclaw.generate_outreach_script",
  "kolclaw.get_daily_tasks",
  "kolclaw.get_budget_report",
  "kolclaw.list_creators",
]);

/** `<连接器>.<工具>`：只校验引用格式；是否已登记、已挂载在编写/测试/发布时对照工具目录判定。 */
export const MCP_TOOL_REFERENCE = /^[a-z][a-z0-9_-]{0,39}\.[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

export const SKILL_ICON_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_BADGE = 12;
const MAX_STARTER = 300;

export function validatePresentationValue(key: "icon" | "badge" | "starter" | "result_title", value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string: ${where}`);
  const text = value.trim();
  if (key === "icon" && !SKILL_ICON_KEY.test(text)) throw new Error(`icon must be an icon library key: ${where}`);
  if (key === "badge" && text.length > MAX_BADGE) throw new Error(`badge is too long: ${where}`);
  if (key === "starter" && text.length > MAX_STARTER) throw new Error(`starter is too long: ${where}`);
  if (key === "result_title" && text.length > 40) throw new Error(`result_title is too long: ${where}`);
  return text;
}

function parsePresentation(values: Record<string, unknown>, file: string): Pick<TaskDefinition, "icon" | "badge" | "starter" | "result_title"> {
  const out: Pick<TaskDefinition, "icon" | "badge" | "starter" | "result_title"> = {};
  for (const key of ["icon", "badge", "starter", "result_title"] as const) {
    if (values[key] !== undefined) out[key] = validatePresentationValue(key, values[key], file);
  }
  return out;
}

/**
 * 内置技能的展示字段可在管理端经「草稿 → 发布」覆盖；运行契约（工具、必填、权限）仍随代码发布。
 * 覆盖来源由 Host 注册（读库），注册前或读取失败时不覆盖——注册表本身不触碰数据库。
 */
export const PRESENTATION_OVERLAY_FIELDS = ["icon", "badge", "starter", "result_title", "category", "funnel", "aliases", "next_actions"] as const;
export type PresentationOverlay = Partial<Pick<TaskDefinition, (typeof PRESENTATION_OVERLAY_FIELDS)[number]>>;
let presentationOverlaySource: (() => ReadonlyMap<string, PresentationOverlay>) | null = null;

export function setPresentationOverlaySource(source: (() => ReadonlyMap<string, PresentationOverlay>) | null): void {
  presentationOverlaySource = source;
  cached = null;
}

function withPresentationOverlay(definition: TaskDefinition, overlays: ReadonlyMap<string, PresentationOverlay>): TaskDefinition {
  const overlay = definition.source === "bundled" ? overlays.get(definition.id) : undefined;
  if (!overlay) return definition;
  const picked = Object.fromEntries(PRESENTATION_OVERLAY_FIELDS.filter((key) => overlay[key] !== undefined).map((key) => [key, overlay[key]]));
  return Object.freeze({ ...definition, ...picked }) as TaskDefinition;
}

const REQUIRED = [
  "id",
  "title",
  "description",
  "category",
  "profile",
  "output",
  "mcp",
  "required_inputs",
  "permissions",
  "actions",
] as const;

let cached: { signature: string; definitions: readonly TaskDefinition[] } | null = null;

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch (error) {
      throw new Error(`invalid manifest array ${value}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed;
    } catch (error) {
      throw new Error(`invalid manifest object ${value}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

function frontmatter(file: string): Record<string, unknown> {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`skill manifest missing frontmatter: ${file}`);
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) throw new Error(`skill manifest frontmatter is not closed: ${file}`);
  const values: Record<string, unknown> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`invalid manifest line in ${file}: ${line}`);
    const key = line.slice(0, separator).trim();
    if (key in values) throw new Error(`duplicate manifest field ${key}: ${file}`);
    values[key] = parseValue(line.slice(separator + 1));
  }
  return values;
}

function stringArray(value: unknown, field: string, file: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`manifest ${field} must be a string array: ${file}`);
  }
  return value.map(String);
}

const RESULT_SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

function parseResultSchema(raw: unknown, file: string, path = "result_schema", depth = 0): TaskResultSchema {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || depth > 12) {
    throw new Error(`manifest ${path} must be a bounded schema object: ${file}`);
  }
  const row = raw as Record<string, unknown>;
  const type = String(row.type || "");
  if (!RESULT_SCHEMA_TYPES.has(type)) throw new Error(`manifest ${path}.type is invalid: ${file}`);
  const permitted = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"]);
  if (Object.keys(row).some((key) => !permitted.has(key))) throw new Error(`manifest ${path} contains an unsupported keyword: ${file}`);
  const parsed: TaskResultSchema = { type: type as TaskResultSchema["type"] };
  if (row.enum !== undefined) {
    if (!Array.isArray(row.enum) || !row.enum.length || row.enum.length > 100
      || row.enum.some((value) => value !== null && !["string", "number", "boolean"].includes(typeof value))) {
      throw new Error(`manifest ${path}.enum is invalid: ${file}`);
    }
    parsed.enum = row.enum as TaskResultSchema["enum"];
  }
  if (type === "object") {
    if (!row.properties || typeof row.properties !== "object" || Array.isArray(row.properties)) {
      throw new Error(`manifest ${path}.properties is required: ${file}`);
    }
    const properties = row.properties as Record<string, unknown>;
    if (Object.keys(properties).length > 64 || row.additionalProperties !== false) {
      throw new Error(`manifest ${path} requires at most 64 properties and additionalProperties=false: ${file}`);
    }
    const required = row.required === undefined ? [] : stringArray(row.required, `${path}.required`, file);
    if (required.some((key) => !(key in properties)) || new Set(required).size !== required.length) {
      throw new Error(`manifest ${path}.required must reference unique declared properties: ${file}`);
    }
    parsed.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [
      key, parseResultSchema(value, file, `${path}.properties.${key}`, depth + 1),
    ]));
    parsed.required = required;
    parsed.additionalProperties = false;
  } else if (type === "array") {
    if (row.items === undefined) throw new Error(`manifest ${path}.items is required: ${file}`);
    parsed.items = parseResultSchema(row.items, file, `${path}.items`, depth + 1);
    if (row.maxItems === undefined || typeof row.maxItems !== "number" || row.maxItems > 200) {
      throw new Error(`manifest ${path}.maxItems must be declared and no greater than 200: ${file}`);
    }
  } else if (type === "string" && (row.maxLength === undefined || typeof row.maxLength !== "number" || row.maxLength > 8000)) {
    throw new Error(`manifest ${path}.maxLength must be declared and no greater than 8000: ${file}`);
  }
  for (const key of ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"] as const) {
    if (row[key] === undefined) continue;
    if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0) {
      throw new Error(`manifest ${path}.${key} must be a non-negative finite number: ${file}`);
    }
    (parsed as Record<string, unknown>)[key] = row[key];
  }
  if (parsed.minItems !== undefined && parsed.maxItems !== undefined && parsed.minItems > parsed.maxItems) throw new Error(`manifest ${path} minItems exceeds maxItems: ${file}`);
  if (parsed.minLength !== undefined && parsed.maxLength !== undefined && parsed.minLength > parsed.maxLength) throw new Error(`manifest ${path} minLength exceeds maxLength: ${file}`);
  if (parsed.minimum !== undefined && parsed.maximum !== undefined && parsed.minimum > parsed.maximum) throw new Error(`manifest ${path} minimum exceeds maximum: ${file}`);
  return Object.freeze(parsed);
}

/** Validates a worker result against the strict published skill schema. */
export function validateTaskResultSchema(schema: TaskResultSchema, value: unknown): string[] {
  const issues: string[] = [];
  const visit = (rule: TaskResultSchema, candidate: unknown, path: string): void => {
    if (issues.length >= 32) return;
    const validType = rule.type === "null" ? candidate === null
      : rule.type === "array" ? Array.isArray(candidate)
        : rule.type === "object" ? Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate))
          : rule.type === "integer" ? typeof candidate === "number" && Number.isInteger(candidate)
          : rule.type === "number" ? typeof candidate === "number" && Number.isFinite(candidate)
            : typeof candidate === rule.type;
    if (!validType) { issues.push(`${path} must be ${rule.type}`); return; }
    if (rule.enum && !rule.enum.some((allowed) => Object.is(allowed, candidate))) issues.push(`${path} is not an allowed value`);
    if (rule.type === "object") {
      const object = candidate as Record<string, unknown>;
      for (const key of rule.required || []) if (!(key in object)) issues.push(`${path}.${key} is required`);
      for (const key of Object.keys(object)) {
        const child = rule.properties?.[key];
        if (!child) issues.push(`${path}.${key} is not declared`);
        else visit(child, object[key], `${path}.${key}`);
      }
    } else if (rule.type === "array") {
      const array = candidate as unknown[];
      if (rule.minItems !== undefined && array.length < rule.minItems) issues.push(`${path} has too few items`);
      if (rule.maxItems !== undefined && array.length > rule.maxItems) issues.push(`${path} has too many items`);
      if (rule.items) array.slice(0, rule.maxItems ?? 500).forEach((item, index) => visit(rule.items!, item, `${path}[${index}]`));
    } else if (rule.type === "string") {
      const string = candidate as string;
      if (rule.minLength !== undefined && string.length < rule.minLength) issues.push(`${path} is too short`);
      if (rule.maxLength !== undefined && string.length > rule.maxLength) issues.push(`${path} is too long`);
    } else if (rule.type === "number" || rule.type === "integer") {
      const number = candidate as number;
      if (rule.minimum !== undefined && number < rule.minimum) issues.push(`${path} is below minimum`);
      if (rule.maximum !== undefined && number > rule.maximum) issues.push(`${path} is above maximum`);
    }
  };
  visit(schema, value, "$result");
  return issues;
}

function parseDeclaredContract(values: Record<string, unknown>, file: string): Pick<
  TaskDefinition,
  "input_schema" | "result_type" | "result_schema" | "next_actions" | "memory_policy" | "supports" | "context"
> {
  let inputSchema: TaskInputField[] | undefined;
  if (values.input_schema !== undefined) {
    if (!Array.isArray(values.input_schema)) throw new Error(`manifest input_schema must be an array: ${file}`);
    const seen = new Set<string>();
    inputSchema = values.input_schema.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`manifest input_schema[${index}] must be an object: ${file}`);
      }
      const row = raw as Record<string, unknown>;
      const key = String(row.key || "").trim();
      const label = String(row.label || "").trim();
      if (!/^[a-z][a-z0-9_]*$/.test(key) || !label) {
        throw new Error(`manifest input_schema[${index}] requires a valid key and label: ${file}`);
      }
      if (seen.has(key)) throw new Error(`manifest input_schema has duplicate key ${key}: ${file}`);
      seen.add(key);
      if (!TASK_INPUT_KINDS.includes(row.kind as TaskInputKind)) {
        throw new Error(`manifest input_schema.${key}.kind is invalid: ${file}`);
      }
      if (typeof row.required !== "boolean") throw new Error(`manifest input_schema.${key}.required must be boolean: ${file}`);
      if (row.options_source !== undefined && (typeof row.options_source !== "string" || !row.options_source.trim())) {
        throw new Error(`manifest input_schema.${key}.options_source must be a non-empty string: ${file}`);
      }
      if (typeof row.options_source === "string" && !REGISTERED_INPUT_OPTION_SOURCES.has(row.options_source)) {
        throw new Error(`manifest input_schema.${key}.options_source is not a registered dictionary: ${file}`);
      }
      if (row.options !== undefined && (!Array.isArray(row.options) || row.options.some((option) => {
        if (typeof option === "string") return !option.trim();
        if (!option || typeof option !== "object" || Array.isArray(option)) return true;
        const item = option as Record<string, unknown>;
        return typeof item.code !== "string" || !item.code.trim() || typeof item.label !== "string" || !item.label.trim();
      }))) throw new Error(`manifest input_schema.${key}.options must contain codes and labels: ${file}`);
      if ((row.kind === "single" || row.kind === "multiple") && row.options === undefined && row.options_source === undefined) {
        throw new Error(`manifest input_schema.${key} requires options or a registered options_source: ${file}`);
      }
      for (const field of ["min", "max"] as const) {
        if (row[field] !== undefined && (typeof row[field] !== "number" || !Number.isFinite(row[field]))) {
          throw new Error(`manifest input_schema.${key}.${field} must be a finite number: ${file}`);
        }
      }
      if (row.integer !== undefined && (typeof row.integer !== "boolean" || row.kind !== "number")) {
        throw new Error(`manifest input_schema.${key}.integer requires a number field and boolean: ${file}`);
      }
      return Object.freeze({
        key,
        label,
        kind: row.kind as TaskInputKind,
        required: row.required as boolean,
        ...(row.options_source ? { options_source: String(row.options_source) } : {}),
        ...(row.options ? { options: row.options as TaskInputField["options"] } : {}),
        ...(row.reason ? { reason: String(row.reason) } : {}),
        ...(row.prefill ? { prefill: String(row.prefill) } : {}),
        ...(row.default !== undefined ? { default: row.default } : {}),
        ...(row.min !== undefined ? { min: Number(row.min) } : {}),
        ...(row.max !== undefined ? { max: Number(row.max) } : {}),
        ...(row.integer !== undefined ? { integer: row.integer as boolean } : {}),
      });
    });
    const declaredRequired = [...seen].filter((key) => inputSchema!.find((field) => field.key === key)?.required).sort();
    const requiredInputs = stringArray(values.required_inputs, "required_inputs", file).sort();
    if (declaredRequired.join("\0") !== requiredInputs.join("\0")) {
      throw new Error(`manifest required_inputs must match input_schema required keys: ${file}`);
    }
  }

  let resultType: string | undefined;
  if (values.result_type !== undefined) {
    resultType = String(values.result_type).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(resultType)) throw new Error(`manifest result_type is invalid: ${file}`);
  }
  const resultSchema = values.result_schema === undefined ? undefined : parseResultSchema(values.result_schema, file);

  let nextActions: TaskNextAction[] | undefined;
  if (values.next_actions !== undefined) {
    if (!Array.isArray(values.next_actions)) throw new Error(`manifest next_actions must be an array: ${file}`);
    const registeredActions = Array.isArray(values.actions) ? new Set(values.actions.map(String)) : null;
    nextActions = values.next_actions.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`manifest next_actions[${index}] must be an object: ${file}`);
      const row = raw as Record<string, unknown>;
      if (typeof row.action_id !== "string" || !row.action_id.trim()) throw new Error(`manifest next_actions[${index}].action_id is required: ${file}`);
      const skillRef = /^skill:[a-z][a-z0-9_]{1,39}$/.test(row.action_id);
      if (!skillRef && registeredActions && !registeredActions.has(row.action_id)) throw new Error(`manifest next_actions[${index}].action_id is not registered in actions: ${file}`);
      if (!( ["has_results", "no_results", "has_selection", "always"] as unknown[]).includes(row.when)) throw new Error(`manifest next_actions[${index}].when is invalid: ${file}`);
      return Object.freeze({ action_id: row.action_id, when: row.when as TaskNextAction["when"], ...(row.note ? { note: String(row.note) } : {}) });
    });
  }

  let memoryPolicy: TaskMemoryPolicy | undefined;
  if (values.memory_policy !== undefined) {
    if (!values.memory_policy || typeof values.memory_policy !== "object" || Array.isArray(values.memory_policy)) {
      throw new Error(`manifest memory_policy must be an object: ${file}`);
    }
    const row = values.memory_policy as Record<string, unknown>;
    if (typeof row.kind !== "string" || !row.kind.trim()) throw new Error(`manifest memory_policy.kind is required: ${file}`);
    if (!( ["owner", "company", "object"] as unknown[]).includes(row.scope)) throw new Error(`manifest memory_policy.scope is invalid: ${file}`);
    if (!( ["on_complete", "on_adopt", "never"] as unknown[]).includes(row.auto_persist)) throw new Error(`manifest memory_policy.auto_persist is invalid: ${file}`);
    memoryPolicy = Object.freeze({
      kind: row.kind,
      scope: row.scope as TaskMemoryPolicy["scope"],
      auto_persist: row.auto_persist as TaskMemoryPolicy["auto_persist"],
      ...(row.stale_refs === undefined ? {} : { stale_refs: stringArray(row.stale_refs, "memory_policy.stale_refs", file) }),
    });
    if (memoryPolicy.auto_persist !== "never") {
      const writerKey = [values.id, resultType, memoryPolicy.kind, memoryPolicy.scope, memoryPolicy.auto_persist].join("|");
      const genericWriterReady = values.id !== "creator_discovery"
        && resultType && resultSchema
        && memoryPolicy.kind === "skill_result"
        && memoryPolicy.scope === "owner"
        && memoryPolicy.auto_persist === "on_complete";
      if (!REGISTERED_SKILL_RESULT_MEMORY_WRITERS.has(writerKey) && !genericWriterReady) {
        throw new Error(`manifest memory_policy has no Host-validated result writer for this skill/result/scope/policy: ${file}`);
      }
      if (genericWriterReady && (resultSchema?.type !== "object"
        || !resultSchema.required?.includes("items")
        || resultSchema.properties?.items?.type !== "array")) {
        throw new Error(`manifest result_schema must strictly validate the required {items: []} result envelope: ${file}`);
      }
    }
  }

  let supports: TaskSupports | undefined;
  if (values.supports !== undefined) {
    if (!values.supports || typeof values.supports !== "object" || Array.isArray(values.supports)) throw new Error(`manifest supports must be an object: ${file}`);
    const row = values.supports as Record<string, unknown>;
    for (const field of ["cancel", "retry", "resume"] as const) {
      if (typeof row[field] !== "boolean") throw new Error(`manifest supports.${field} must be boolean: ${file}`);
    }
    supports = Object.freeze({ cancel: row.cancel as boolean, retry: row.retry as boolean, resume: row.resume as boolean });
  }

  let context: TaskContext | undefined;
  if (values.context !== undefined) {
    if (!values.context || typeof values.context !== "object" || Array.isArray(values.context)) {
      throw new Error(`manifest context must be an object: ${file}`);
    }
    const row = values.context as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["requires", "prefers"].includes(key))) {
      throw new Error(`manifest context contains an unsupported field: ${file}`);
    }
    const readKeys = (field: "requires" | "prefers"): TaskContextKey[] => {
      const raw = row[field];
      if (raw === undefined) return [];
      if (!Array.isArray(raw)) throw new Error(`manifest context.${field} must be an array: ${file}`);
      const keys = raw.map((item) => String(item || "").trim());
      for (const key of keys) {
        if (!TASK_CONTEXT_KEYS.includes(key as TaskContextKey)) {
          throw new Error(`manifest context.${field} has an unregistered key ${key}: ${file}`);
        }
      }
      if (new Set(keys).size !== keys.length) throw new Error(`manifest context.${field} has duplicate keys: ${file}`);
      return keys as TaskContextKey[];
    };
    const requires = readKeys("requires");
    const prefers = readKeys("prefers");
    const both = requires.filter((key) => prefers.includes(key));
    if (both.length) {
      // requires 已经管住解析失败即拦截；同时列进 prefers 会让缺口呈现自相矛盾。
      throw new Error(`manifest context key listed in both requires and prefers (${both.join(", ")}): ${file}`);
    }
    context = Object.freeze({ requires, prefers });
  }

  return {
    ...(inputSchema ? { input_schema: Object.freeze(inputSchema) as unknown as TaskInputField[] } : {}),
    ...(resultType ? { result_type: resultType } : {}),
    ...(resultSchema ? { result_schema: resultSchema } : {}),
    ...(nextActions ? { next_actions: Object.freeze(nextActions) as unknown as TaskNextAction[] } : {}),
    ...(memoryPolicy ? { memory_policy: memoryPolicy } : {}),
    ...(supports ? { supports } : {}),
    ...(context ? { context } : {}),
  };
}

export function validateDeclaredTaskContract(values: Record<string, unknown>): Pick<
  TaskDefinition,
  "input_schema" | "result_type" | "result_schema" | "next_actions" | "memory_policy" | "supports" | "context"
> {
  return parseDeclaredContract(values, "<skill contract>");
}

function parseDefinition(file: string, folder: string, source: TaskSource): TaskDefinition {
  const values = frontmatter(file);
  let interaction: TaskInteraction | undefined;
  if (values.interaction !== undefined) {
    if (!values.interaction || typeof values.interaction !== "object" || Array.isArray(values.interaction)) {
      throw new Error(`manifest interaction must be an object: ${file}`);
    }
    const raw = values.interaction as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["purpose", "steps", "output_title", "constraints", "evidence", "decisions", "recovery"].includes(key))) {
      throw new Error(`manifest interaction contains an unsupported field: ${file}`);
    }
    for (const key of ["purpose", "output_title"] as const) {
      if (typeof raw[key] !== "string" || !raw[key].trim() || raw[key].length > 1000) {
        throw new Error(`manifest interaction.${key} must be bounded non-empty text: ${file}`);
      }
    }
    const steps = stringArray(raw.steps, "interaction.steps", file);
    const constraints = stringArray(raw.constraints, "interaction.constraints", file);
    const evidence = raw.evidence === undefined ? [] : stringArray(raw.evidence, "interaction.evidence", file);
    const decisions = raw.decisions === undefined ? [] : stringArray(raw.decisions, "interaction.decisions", file);
    const recovery = raw.recovery === undefined ? [] : stringArray(raw.recovery, "interaction.recovery", file);
    if (!steps.length || steps.length > 12 || constraints.length > 12
      || [...steps, ...constraints].some((text) => text.length > 1000)) {
      throw new Error(`manifest interaction steps/constraints exceed bounds or steps are missing: ${file}`);
    }
    // No second list of inputs in the template: it must reuse the execution schema.
    if (!Array.isArray(values.input_schema)) throw new Error(`manifest interaction requires input_schema: ${file}`);
    if ([...evidence, ...decisions, ...recovery].length > 18
      || [...evidence, ...decisions, ...recovery].some((text) => text.length > 1000)) {
      throw new Error(`manifest interaction evidence/decisions/recovery exceed bounds: ${file}`);
    }
    interaction = Object.freeze({ purpose: String(raw.purpose), steps, output_title: String(raw.output_title), constraints, evidence, decisions, recovery });
  }
  for (const field of REQUIRED) {
    if (!(field in values)) throw new Error(`manifest missing ${field}: ${file}`);
  }
  for (const field of ["id", "title", "description", "category", "profile", "output"] as const) {
    if (typeof values[field] !== "string" || !String(values[field]).trim()) {
      throw new Error(`manifest ${field} must be a non-empty string: ${file}`);
    }
  }
  const id = String(values.id);
  if (!/^[a-z][a-z0-9_]*$/.test(id) || id !== folder) {
    throw new Error(`manifest id must match its skill directory: ${file}`);
  }
  const runtimeAgentId = values.runtime_agent_id === undefined ? "agent:kol" : String(values.runtime_agent_id).trim();
  if (!/^agent:[a-z][a-z0-9-]*$/.test(runtimeAgentId)) {
    throw new Error(`manifest runtime_agent_id is invalid: ${file}`);
  }
  const runtimeAccess = values.runtime_access === undefined ? "granted" : values.runtime_access;
  if (runtimeAccess !== "granted" && runtimeAccess !== "authenticated") {
    throw new Error(`manifest runtime_access is invalid: ${file}`);
  }
  if (!TASK_PROFILES.includes(values.profile as TaskProfileId)) {
    throw new Error(`manifest has unknown profile ${String(values.profile)}: ${file}`);
  }
  if (!TASK_OUTPUTS.includes(values.output as TaskOutput)) {
    throw new Error(`manifest has unknown output ${String(values.output)}: ${file}`);
  }
  let employeeSummary: string | undefined;
  if (values.employee_summary !== undefined) {
    if (typeof values.employee_summary !== "string" || !values.employee_summary.trim()) {
      throw new Error(`manifest employee_summary must be a non-empty string: ${file}`);
    }
    employeeSummary = values.employee_summary.trim();
  }
  let employeeQuick: string | undefined;
  if (values.employee_quick !== undefined) {
    if (typeof values.employee_quick !== "string" || !values.employee_quick.trim()) {
      throw new Error(`manifest employee_quick must be a non-empty string: ${file}`);
    }
    employeeQuick = values.employee_quick.trim();
  }
  let employeeAgent: string | undefined;
  if (values.employee_agent !== undefined) {
    if (typeof values.employee_agent !== "string" || !values.employee_agent.trim()) {
      throw new Error(`manifest employee_agent must be a non-empty string: ${file}`);
    }
    employeeAgent = values.employee_agent.trim();
  }
  let employeeExample: string[] | undefined;
  if (values.employee_example !== undefined) {
    employeeExample = stringArray(values.employee_example, "employee_example", file);
    if (employeeExample.length === 0) {
      throw new Error(`manifest employee_example must be a non-empty array: ${file}`);
    }
  }
  if (values.employee_visible !== undefined && typeof values.employee_visible !== "boolean") {
    throw new Error(`manifest employee_visible must be a boolean: ${file}`);
  }
  let sideEffects: TaskSideEffects = "none";
  if (values.side_effects !== undefined) {
    if (!TASK_SIDE_EFFECTS.includes(values.side_effects as TaskSideEffects)) {
      throw new Error(`manifest has unknown side_effects ${String(values.side_effects)}: ${file}`);
    }
    sideEffects = values.side_effects as TaskSideEffects;
  }
  if (values.creates_session !== undefined && typeof values.creates_session !== "boolean") {
    throw new Error(`manifest creates_session must be a boolean: ${file}`);
  }
  if (values.auto_ok !== undefined && typeof values.auto_ok !== "boolean") {
    throw new Error(`manifest auto_ok must be a boolean: ${file}`);
  }
  let funnel: TaskFunnel | undefined;
  if (values.funnel !== undefined) {
    if (!TASK_FUNNELS.includes(values.funnel as TaskFunnel)) {
      throw new Error(`manifest has unknown funnel ${String(values.funnel)}: ${file}`);
    }
    funnel = values.funnel as TaskFunnel;
  }
  const presentation = parsePresentation(values, file);
  const mcp = stringArray(values.mcp, "mcp", file);
  for (const tool of mcp) {
    if (!MCP_TOOL_REFERENCE.test(tool)) throw new Error(`manifest has invalid MCP tool reference ${tool}: ${file}`);
  }
  const declaredContract = parseDeclaredContract(values, file);
  if (runtimeAccess === "authenticated" && (sideEffects !== "none" || mcp.length > 0 || stringArray(values.permissions, "permissions", file).length > 0)) {
    throw new Error(`authenticated runtime access is reserved for read-only Skills without external permissions: ${file}`);
  }
  return Object.freeze({
    id,
    content_version: createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex"),
    ...(interaction ? { interaction } : {}),
    runtime_agent_id: runtimeAgentId,
    runtime_access: runtimeAccess as TaskRuntimeAccess,
    title: String(values.title),
    description: String(values.description),
    ...(employeeSummary ? { employee_summary: employeeSummary } : {}),
    ...(employeeQuick ? { employee_quick: employeeQuick } : {}),
    ...(employeeAgent ? { employee_agent: employeeAgent } : {}),
    ...(employeeExample
      ? { employee_example: Object.freeze([...employeeExample]) as unknown as string[] }
      : {}),
    employee_visible: values.employee_visible === undefined ? true : values.employee_visible === true,
    category: String(values.category),
    profile: values.profile as TaskProfileId,
    output: values.output as TaskOutput,
    mcp: Object.freeze([...new Set(mcp)]) as unknown as string[],
    required_inputs: Object.freeze(stringArray(values.required_inputs, "required_inputs", file)) as unknown as string[],
    ...declaredContract,
    permissions: Object.freeze(stringArray(values.permissions, "permissions", file)) as unknown as string[],
    actions: Object.freeze(stringArray(values.actions, "actions", file)) as unknown as string[],
    aliases: Object.freeze(
      values.aliases === undefined ? [] : stringArray(values.aliases, "aliases", file),
    ) as unknown as string[],
    in_market: values.in_market === undefined ? true : values.in_market === true,
    funnel,
    ...presentation,
    side_effects: sideEffects,
    creates_session: values.creates_session === true,
    auto_ok: values.auto_ok === true,
    source,
    path: path.resolve(file),
  });
}

function skillFiles(root: string): { folder: string; file: string; stamp: string }[] {
  if (!fs.existsSync(root)) return [];
  const resolvedRoot = path.resolve(root);
  const realRoot = fs.realpathSync(resolvedRoot);
  return fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const file = path.resolve(resolvedRoot, entry.name, "SKILL.md");
      if (!file.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(file)) {
        throw new Error(`skill directory must contain SKILL.md: ${entry.name}`);
      }
      const realFile = fs.realpathSync(file);
      if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error(`skill manifest escapes the skills root: ${file}`);
      }
      const stat = fs.statSync(file);
      return {
        folder: entry.name,
        file,
        stamp: `${realFile}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`,
      };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

function combinedSkillFiles(): { folder: string; file: string; stamp: string; source: TaskSource }[] {
  const bundled = skillFiles(skillsDir()).map((entry) => ({ ...entry, source: "bundled" as const }));
  const bundledIds = new Set(bundled.map((entry) => entry.folder));
  const published = skillFiles(publishedSkillsDir())
    .filter((entry) => !bundledIds.has(entry.folder))
    .map((entry) => ({ ...entry, source: "published" as const }));
  return [...bundled, ...published].sort((a, b) => a.folder.localeCompare(b.folder));
}

export function taskDefinitions(root?: string): readonly TaskDefinition[] {
  const usingDefault = root === undefined || root === skillsDir();
  const files = usingDefault
    ? combinedSkillFiles()
    : skillFiles(root).map((entry) => ({ ...entry, source: "bundled" as const }));
  const signature = files.map((entry) => `${entry.source}:${entry.stamp}`).join("|");
  if (usingDefault && cached?.signature === signature) return cached.definitions;
  const parsed = files.map((entry) => parseDefinition(entry.file, entry.folder, entry.source));
  let overlays: ReadonlyMap<string, PresentationOverlay> = new Map();
  if (usingDefault && presentationOverlaySource) {
    try { overlays = presentationOverlaySource(); } catch { overlays = new Map(); }
  }
  const definitions = parsed.map((definition) => withPresentationOverlay(definition, overlays));
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`duplicate task definition id: ${definition.id}`);
    ids.add(definition.id);
  }
  const frozen = Object.freeze(definitions);
  if (usingDefault) cached = { signature, definitions: frozen };
  return frozen;
}

export function taskDefinition(id: string): TaskDefinition | undefined {
  return taskDefinitions().find((definition) => definition.id === id);
}

export function requireTaskDefinition(id: string): TaskDefinition {
  const definition = taskDefinition(id);
  if (!definition) throw new Error(`unknown task type: ${id}`);
  return definition;
}

export function clearTaskRegistryCache(): void {
  cached = null;
}
