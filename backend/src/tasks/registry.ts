import fs from "node:fs";
import path from "node:path";
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
export type TaskNextAction = { action_id: string; when: "has_results" | "has_selection" | "always"; note?: string };
export type TaskMemoryPolicy = {
  kind: string;
  scope: "owner" | "company" | "object";
  auto_persist: "on_complete" | "on_adopt" | "never";
  stale_refs?: string[];
};
export type TaskSupports = { cancel: boolean; retry: boolean; resume: boolean };

export type TaskDefinition = {
  id: string;
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
  permissions: string[];
  actions: string[];
  aliases: string[];
  in_market: boolean;
  funnel?: TaskFunnel;
  side_effects: TaskSideEffects;
  creates_session: boolean;
  auto_ok: boolean;
  source: TaskSource;
  path: string;
};

export const ALLOWED_TASK_MCP = new Set([
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
  "input_schema" | "result_type" | "result_schema" | "next_actions" | "memory_policy" | "supports"
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
      if (registeredActions && !registeredActions.has(row.action_id)) throw new Error(`manifest next_actions[${index}].action_id is not registered in actions: ${file}`);
      if (!( ["has_results", "has_selection", "always"] as unknown[]).includes(row.when)) throw new Error(`manifest next_actions[${index}].when is invalid: ${file}`);
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

  return {
    ...(inputSchema ? { input_schema: Object.freeze(inputSchema) as unknown as TaskInputField[] } : {}),
    ...(resultType ? { result_type: resultType } : {}),
    ...(resultSchema ? { result_schema: resultSchema } : {}),
    ...(nextActions ? { next_actions: Object.freeze(nextActions) as unknown as TaskNextAction[] } : {}),
    ...(memoryPolicy ? { memory_policy: memoryPolicy } : {}),
    ...(supports ? { supports } : {}),
  };
}

export function validateDeclaredTaskContract(values: Record<string, unknown>): Pick<
  TaskDefinition,
  "input_schema" | "result_type" | "result_schema" | "next_actions" | "memory_policy" | "supports"
> {
  return parseDeclaredContract(values, "<skill contract>");
}

function parseDefinition(file: string, folder: string, source: TaskSource): TaskDefinition {
  const values = frontmatter(file);
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
  const mcp = stringArray(values.mcp, "mcp", file);
  for (const tool of mcp) {
    if (!ALLOWED_TASK_MCP.has(tool)) throw new Error(`manifest exposes unapproved MCP tool ${tool}: ${file}`);
  }
  const declaredContract = parseDeclaredContract(values, file);
  return Object.freeze({
    id,
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
  const definitions = files.map((entry) => parseDefinition(entry.file, entry.folder, entry.source));
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
