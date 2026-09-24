/**
 * Task intent via a bounded Jev Choice on OpenRouter, then GPT-5.6 Luna
 * (Responses API) or Codex app-server when Jev is unavailable or uncertain.
 * Host still validates catalog ids and emails.
 * Stub is tests only. gpt-4o Chat Completions is not required.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { codexMode, taskRecognizeTimeout } from "../config.js";
import { envApiKey, inspectLocalCodexAuth } from "../worker/auth.js";
import { CodexAppServer } from "../worker/codex.js";
import { CodexUnavailable } from "../worker/errors.js";
import { taskDefinitions } from "./registry.js";
import { stubResolveTaskIntent } from "./resolver.js";

export const INTENT_CLARIFICATION_KINDS = ["none", "missing_fields", "direction"] as const;
export type ClarificationKind = (typeof INTENT_CLARIFICATION_KINDS)[number];

export type IntentAlternative = { task_type: string; title: string; confidence: number };

export type IntentVerdict = {
  task_type: string | null;
  confidence: number;
  entities: Record<string, unknown>;
  missing_fields: string[];
  clarification_kind: ClarificationKind;
  alternatives: IntentAlternative[];
  reason_zh?: string;
};

export class IntentLlmUnavailable extends Error {
  next_action: string;
  constructor(message: string, next_action = "检查 OPENAI_API_KEY 后重试。") {
    super(message);
    this.name = "IntentLlmUnavailable";
    this.next_action = next_action;
  }
}

type FetchLike = typeof fetch;
let fetchOverride: FetchLike | null = null;
let jevFetchOverride: FetchLike | null = null;

const JEV_OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const JEV_CLARIFICATION_CHOICE = "clarification";
const DEFAULT_JEV_INTENT_MIN_CONFIDENCE = 0.8;
const DEFAULT_JEV_INTENT_LOW_CONFIDENCE = 0.6;

export function setIntentLlmFetch(factory?: FetchLike): void {
  fetchOverride = factory || null;
}

/** Test-only transport override for the OpenRouter System One request. */
export function setJevIntentFetch(factory?: FetchLike): void {
  jevFetchOverride = factory || null;
}

export function intentLlmFetch(): FetchLike {
  return fetchOverride || fetch;
}

export function intentLlmFetchOverridden(): boolean {
  return Boolean(fetchOverride);
}

export function jevIntentApiKey(): string {
  return String(process.env.OPENROUTER_API_KEY || "").trim();
}

/** Enabled whenever a key exists outside tests; test transports must opt in explicitly. */
export function jevIntentEnabled(): boolean {
  const setting = String(process.env.JEV_INTENT_ENABLED || "").trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(setting)) return false;
  if (!jevIntentApiKey()) return false;
  return process.env.NODE_ENV !== "test"
    || Boolean(jevFetchOverride)
    || String(process.env.JEV_INTENT_TEST_LIVE || "").trim() === "1";
}

export function jevIntentModel(): string {
  return String(process.env.JEV_MODEL || "jev-1.13").trim() || "jev-1.13";
}

function confidenceSetting(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export function jevIntentMinConfidence(): number {
  return confidenceSetting("JEV_INTENT_MIN_CONFIDENCE", DEFAULT_JEV_INTENT_MIN_CONFIDENCE);
}

export function jevIntentLowConfidence(): number {
  return Math.min(
    confidenceSetting("JEV_INTENT_LOW_CONFIDENCE", DEFAULT_JEV_INTENT_LOW_CONFIDENCE),
    jevIntentMinConfidence(),
  );
}

export function intentLlmMode(): "stub" | "real" {
  const raw = String(process.env.INTENT_LLM_MODE || "").toLowerCase();
  if (raw === "stub" || raw === "real") return raw;
  if (codexMode() === "stub") return "stub";
  if (process.env.NODE_ENV === "test" && !intentLlmApiKey()) return "stub";
  return "real";
}

export function intentLlmModel(): string {
  return process.env.INTENT_LLM_MODEL || "gpt-5.6-luna";
}

export function intentLlmApiKey(): string {
  return envApiKey() || inspectLocalCodexAuth().apiKey;
}

function catalogLines(): string {
  return taskDefinitions()
    .map((definition) => {
      const aliases = definition.aliases.length ? ` aliases=${definition.aliases.join("/")}` : "";
      const inputs = definition.input_schema?.length
        ? ` inputs=${definition.input_schema.map((field) => `${field.key}:${field.kind}${field.required ? "!" : ""}`).join(",")}`
        : "";
      return `- ${definition.id}: ${definition.title} — ${definition.description}${aliases}${inputs}`;
    })
    .join("\n");
}

export function intentSystemPrompt(): string {
  return [
    "You route LiTime KOL workbench tasks. Return JSON only.",
    "Pick at most one catalog task_type. Never invent ids. Never call tools.",
    "If unsure, task_type empty and clarification_kind=direction.",
    "八个阶段 / 阶段SOP / 本阶段SOP / 阶段资料 / 异常SOP / 异常流程 / 八阶段异常 → stage_sop. Host display only; no send, no stage write.",
    "首封建联 / 写邮件 / 加一封 / 再写一封 / 发件 / 收件 / 主题 → email_compose, not mailbox list or conversation list.",
    "确认发送 is a Host send-confirm for the last preview draft → email_compose. Never treat it as direction clarification.",
    "加一封 / 再写一封 / 再发一封 reuse the last draft's From/To/thread and preview a new letter. Do not invent a new recipient.",
    "发件: / 发件箱 / From map to mailboxEmail. 收件: / 发给 / To map to to[].",
    "Emails must appear in the user text. Never invent addresses.",
    "Never ask for conversationId or 是否合作邮箱.",
    "One utterance with from+to+subject is one email_compose task. Do not split.",
    "JSON keys: task_type, confidence, entities, missing_fields, clarification_kind, alternatives, reason_zh.",
    "Catalog:",
    catalogLines(),
  ].join("\n");
}

function jevIntentCriteria(): Record<string, string> {
  const criteria = Object.fromEntries(taskDefinitions().map((definition) => {
    const aliases = definition.aliases.length ? `；常见说法：${definition.aliases.join("、")}` : "";
    const inputs = definition.input_schema?.length
      ? `；可能需要的输入：${definition.input_schema.map((field) => field.label).join("、")}`
      : "";
    return [definition.id, `${definition.title}：${definition.description}${aliases}${inputs}`];
  }));
  criteria[JEV_CLARIFICATION_CHOICE] = "用户请求与任何现有任务目录都不能可靠匹配，或提供的信息不足以判断其方向。";
  return criteria;
}

function jevIntentTimeoutMs(timeoutSec: number): number {
  const configured = Number(process.env.JEV_INTENT_TIMEOUT_MS || "8000");
  const requested = Number.isFinite(configured) && configured > 0 ? configured : 8000;
  return Math.max(1, Math.min(10000, Math.floor(timeoutSec * 1000), Math.floor(requested)));
}

/**
 * Runs one bounded task-type Choice through OpenRouter's TypeSafe-compatible
 * System One endpoint. It deliberately does not extract entities: deterministic
 * host code continues to own slot extraction and all safety validation.
 */
export async function classifyIntentWithJev(text: string, timeoutSec = taskRecognizeTimeout()): Promise<IntentVerdict> {
  const apiKey = jevIntentApiKey();
  if (!apiKey) {
    throw new IntentLlmUnavailable("Jev 分类服务未配置 OpenRouter 密钥。", "设置 OPENROUTER_API_KEY 后重试。");
  }
  const client = new TypeSafeClient({
    apiKey,
    baseURL: JEV_OPENROUTER_BASE_URL,
    defaultModel: jevIntentModel(),
    timeout: jevIntentTimeoutMs(timeoutSec),
    retry: { maxRetries: 0 },
    logLevel: "off",
    ...(jevFetchOverride ? { fetch: jevFetchOverride } : {}),
  });
  try {
    const response = await client.systemOne({
      model: jevIntentModel(),
      state: { user_text: text },
      questions: {
        task_type: {
          type: "choice",
          instructions: "根据 `user_text`，选择唯一最匹配的现有 KOL 工作台任务。只根据用户明确表达的目标判断；若没有可靠匹配，选择 clarification。",
          criteria: jevIntentCriteria(),
        },
      },
    });
    const answer = response.answers.task_type;
    const taskType = answer.choice === JEV_CLARIFICATION_CHOICE || !taskDefinitions().some((definition) => definition.id === answer.choice)
      ? null
      : answer.choice;
    return {
      task_type: taskType,
      confidence: Number.isFinite(answer.confidence) ? answer.confidence : 0,
      entities: {},
      missing_fields: [],
      clarification_kind: taskType ? "none" : "direction",
      alternatives: [],
      reason_zh: taskType ? "Jev 分类" : "Jev 建议澄清",
    };
  } catch (error) {
    throw new IntentLlmUnavailable(
      "Jev 分类服务未就绪。",
      error instanceof Error && /401|403/i.test(error.message)
        ? "检查 OPENROUTER_API_KEY 后重试。"
        : "稍后重试；系统会自动回退到现有识别服务。",
    );
  }
}

function clarificationFromJev(verdict: IntentVerdict): IntentVerdict {
  return {
    ...verdict,
    task_type: null,
    entities: {},
    missing_fields: [],
    clarification_kind: "direction",
    alternatives: [],
    reason_zh: "Jev 置信度不足，请澄清方向",
  };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function asClarificationKind(value: unknown, fallback: ClarificationKind): ClarificationKind {
  return INTENT_CLARIFICATION_KINDS.includes(value as ClarificationKind)
    ? value as ClarificationKind
    : fallback;
}

export function parseIntentVerdict(raw: string, catalogIds = taskDefinitions().map((row) => row.id)): IntentVerdict {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const blob = fence?.[1] || raw;
  const start = blob.indexOf("{");
  const end = blob.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      task_type: null,
      confidence: 0,
      entities: {},
      missing_fields: [],
      clarification_kind: "direction",
      alternatives: [],
    };
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(blob.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {
      task_type: null,
      confidence: 0,
      entities: {},
      missing_fields: [],
      clarification_kind: "direction",
      alternatives: [],
    };
  }
  const rawType = parsed.task_type == null || parsed.task_type === "" ? null : String(parsed.task_type);
  const taskType = rawType && catalogIds.includes(rawType) ? rawType : null;
  const confidence = Number(parsed.confidence);
  const entities = parsed.entities && typeof parsed.entities === "object" && !Array.isArray(parsed.entities)
    ? { ...(parsed.entities as Record<string, unknown>) }
    : {};
  const missing = asStringArray(parsed.missing_fields);
  const alternatives = (Array.isArray(parsed.alternatives) ? parsed.alternatives : [])
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const id = String(item.task_type || item.id || "");
      if (!catalogIds.includes(id)) return [];
      return [{
        task_type: id,
        title: String(item.title || taskDefinitions().find((definition) => definition.id === id)?.title || id),
        confidence: Number(item.confidence) || 0.4,
      }];
    });
  const kind = !taskType
    ? "direction"
    : asClarificationKind(parsed.clarification_kind, missing.length ? "missing_fields" : "none");
  return {
    task_type: taskType,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    entities,
    missing_fields: missing,
    clarification_kind: kind,
    alternatives,
    reason_zh: parsed.reason_zh ? String(parsed.reason_zh) : undefined,
  };
}

export function stubClassifyIntent(text: string): IntentVerdict {
  const rules = stubResolveTaskIntent({ text });
  if (rules.task_type && rules.confidence >= 0.75) {
    return {
      task_type: rules.task_type,
      confidence: rules.confidence,
      entities: rules.entities,
      missing_fields: rules.missing_fields,
      clarification_kind: rules.missing_fields.length ? "missing_fields" : "none",
      alternatives: [],
      reason_zh: "stub",
    };
  }
  return {
    task_type: null,
    confidence: rules.confidence || 0,
    entities: rules.entities,
    missing_fields: [],
    clarification_kind: "direction",
    alternatives: rules.alternatives,
    reason_zh: "stub",
  };
}

export function normalizeIntentVerdict(value: Partial<IntentVerdict> & { task_type?: string | null; confidence?: number }): IntentVerdict {
  const catalogIds = taskDefinitions().map((row) => row.id);
  const rawType = value.task_type == null || value.task_type === "" ? null : String(value.task_type);
  const taskType = rawType && catalogIds.includes(rawType) ? rawType : null;
  const missing = asStringArray(value.missing_fields);
  return {
    task_type: taskType,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0,
    entities: value.entities && typeof value.entities === "object" ? { ...value.entities } : {},
    missing_fields: missing,
    clarification_kind: !taskType
      ? "direction"
      : asClarificationKind(value.clarification_kind, missing.length ? "missing_fields" : "none"),
    alternatives: Array.isArray(value.alternatives) ? value.alternatives : [],
    reason_zh: value.reason_zh,
  };
}

const INTENT_ENTITY_PROPERTIES: Record<string, Record<string, unknown>> = {
  mailboxEmail: { type: ["string", "null"] },
  from: { type: ["string", "null"] },
  to: { type: ["array", "null"], items: { type: "string" } },
  email: { type: ["string", "null"] },
  subject: { type: ["string", "null"] },
  handle: { type: ["string", "null"] },
  platform: { type: ["string", "null"] },
  keywords: { type: ["array", "null"], items: { type: "string" } },
  platforms: { type: ["array", "null"], items: { type: "string", enum: ["youtube", "instagram", "facebook"] } },
  region: { type: ["string", "null"] },
  directions: { type: ["array", "null"], items: { type: "string" } },
  min_followers: { type: ["number", "null"] },
  max_followers: { type: ["number", "null"] },
  min_avg_plays_10: { type: ["number", "null"] },
  expect_count: { type: ["number", "null"] },
  collaboration_id: { type: ["string", "null"] },
  confirm_send: { type: ["boolean", "null"] },
  keyword: { type: ["string", "null"] },
  kolUid: { type: ["string", "null"] },
};

/** Codex outputSchema requires every property key in `required` and forbids a bare object. */
export function intentOutputSchema(ids: string[]): Record<string, unknown> {
  const properties = {
    task_type: { type: "string", enum: ["", ...ids] },
    confidence: { type: "number" },
    entities: {
      type: "object",
      properties: INTENT_ENTITY_PROPERTIES,
      required: Object.keys(INTENT_ENTITY_PROPERTIES),
      additionalProperties: false,
    },
    missing_fields: { type: "array", items: { type: "string" } },
    clarification_kind: { type: "string", enum: ["none", "missing_fields", "direction"] },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task_type: { type: "string" },
          title: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["task_type", "title", "confidence"],
        additionalProperties: false,
      },
    },
    reason_zh: { type: "string" },
  };
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** Luna Responses uses gpt-5.6-luna. Codex app-server (recognize + mail digest) must use CODEX_MODEL or the CLI default — never pin gpt-5.6-luna. */
export function codexRecognizeThreadConfig(): { mcp_servers: Record<string, never>; model?: string } {
  const model = String(process.env.CODEX_MODEL || "").trim();
  return model
    ? { mcp_servers: {}, model }
    : { mcp_servers: {} };
}

export function extractRemoteIntentText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  if (typeof obj.output_text === "string" && obj.output_text.trim()) return obj.output_text;
  const choices = obj.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const choice = choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) return choice;
  const output = obj.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (typeof content === "string" && content.trim()) parts.push(content);
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) parts.push(text);
    }
  }
  return parts.join("\n");
}

function parseCodexTexts(rpc: CodexAppServer, completed: { turn?: { output?: unknown } }): string[] {
  const output = completed.turn?.output;
  const extras = output && typeof output === "object" ? [JSON.stringify(output)] : [];
  return [...rpc.agentTexts, ...extras];
}

export async function classifyWithCodexAppServer(text: string, timeoutSec = taskRecognizeTimeout()): Promise<IntentVerdict> {
  const ids = taskDefinitions().map((definition) => definition.id);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-recognize-"));
  const rpc = new CodexAppServer(Math.max(1, timeoutSec));
  try {
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: codexRecognizeThreadConfig(),
    });
    const thread = (started.thread as { id?: string } | undefined) || started;
    const threadId = String((thread as { id?: string }).id || "");
    if (!threadId) throw new CodexUnavailable("thread/start 未返回 thread.id。", "升级 Codex CLI 后重试。");
    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: `${intentSystemPrompt()}\nUser: ${text}` }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: intentOutputSchema(ids),
    });
    const completed = await rpc.waitTurn();
    const verdict = parseIntentVerdict(parseCodexTexts(rpc, completed as { turn?: { output?: unknown } }).join("\n"), ids);
    if (!verdict.task_type && !verdict.clarification_kind) {
      return { ...verdict, clarification_kind: "direction" };
    }
    return verdict;
  } catch (error) {
    if (error instanceof IntentLlmUnavailable) throw error;
    const message = error instanceof CodexUnavailable ? error.message : "识别服务未就绪，请再试一次。";
    throw new IntentLlmUnavailable(
      message,
      error instanceof CodexUnavailable
        ? error.next_action
        : "设置 OPENAI_API_KEY 后重启 Host，或确认已 `codex login` 后重试。",
    );
  } finally {
    rpc.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

export async function classifyIntentWithLuna(text: string, timeoutSec = taskRecognizeTimeout()): Promise<IntentVerdict> {
  const key = intentLlmApiKey();
  if (!key) {
    throw new IntentLlmUnavailable("识别服务未就绪：未配置模型密钥。", "把 OPENAI_API_KEY 写入 .env 后重试。");
  }
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const ids = taskDefinitions().map((definition) => definition.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutSec) * 1000);
  try {
    const fetchFn = fetchOverride || fetch;
    const response = await fetchFn(`${base}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: intentLlmModel(),
        instructions: intentSystemPrompt(),
        input: text,
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "task_intent",
            strict: false,
            schema: intentOutputSchema(ids),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new IntentLlmUnavailable(`识别服务未就绪（${response.status}）。`, "稍后点「再试一次」。");
    }
    return parseIntentVerdict(extractRemoteIntentText(await response.json()), ids);
  } catch (error) {
    if (error instanceof IntentLlmUnavailable) throw error;
    throw new IntentLlmUnavailable("识别服务未就绪，请再试一次。", "检查网络或 OPENAI_API_KEY 后重试。");
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyTaskIntent(text: string): Promise<IntentVerdict> {
  if (intentLlmMode() === "stub") return stubClassifyIntent(text);
  const deadline = Date.now() + taskRecognizeTimeout() * 1000;
  const remaining = () => Math.max(0, (deadline - Date.now()) / 1000);
  let mediumConfidenceJev: IntentVerdict | null = null;
  if (jevIntentEnabled()) {
    try {
      const jev = await classifyIntentWithJev(text, remaining());
      if (jev.confidence >= jevIntentMinConfidence()) return jev;
      if (jev.confidence < jevIntentLowConfidence()) return clarificationFromJev(jev);
      mediumConfidenceJev = jev;
    } catch {
      // A bounded classifier must never block the established Luna/Codex path.
    }
  }
  if (intentLlmApiKey()) {
    try {
      return await classifyIntentWithLuna(text, remaining());
    } catch (lunaError) {
      if (remaining() < 2) {
        if (mediumConfidenceJev) return clarificationFromJev(mediumConfidenceJev);
        throw lunaError;
      }
      try {
        return await classifyWithCodexAppServer(text, remaining());
      } catch {
        if (mediumConfidenceJev) return clarificationFromJev(mediumConfidenceJev);
        throw lunaError;
      }
    }
  }
  try {
    return await classifyWithCodexAppServer(text, remaining());
  } catch (error) {
    if (mediumConfidenceJev) return clarificationFromJev(mediumConfidenceJev);
    throw error;
  }
}

export type TaskFieldUpdates = {
  title?: string;
  content?: string;
  status?: string;
  priority?: string;
  risk_level?: string;
  start_date?: string;
  due_at?: string;
};

export const TASK_FIELD_UPDATE_STATUSES = [
  "needs_clarification", "pending", "running", "in_progress", "starting",
  "waiting", "queued", "completed", "failed", "cancelled",
] as const;
export const TASK_FIELD_UPDATE_PRIORITIES = ["important_urgent", "important", "urgent", "normal", "low"] as const;
export const TASK_FIELD_UPDATE_RISKS = ["none", "low", "medium", "high"] as const;

export function taskFieldUpdateSystemPrompt(): string {
  return [
    "You extract task field edits from a Chinese instruction. Return JSON only.",
    "Only include fields the user explicitly wants to change. Never invent fields or values.",
    "priority codes: important_urgent=重要紧急, important=重要, urgent=紧急, normal=中, low=低.",
    "risk_level codes: none=无, low=低, medium=中, high=高.",
    "status codes: pending=未开始, in_progress=进行中, completed=完成, cancelled=取消, failed=失败, waiting=等待.",
    "Dates are ISO YYYY-MM-DD in local time. 今天=today, 明天=+1 day, 后天=+2 days.",
    "JSON keys: title, content, status, priority, risk_level, start_date, due_at. Unchanged fields must be null.",
  ].join("\n");
}

export function taskFieldUpdateOutputSchema(): Record<string, unknown> {
  const nullable = (extra: Record<string, unknown> = {}) => ({ type: ["string", "null"], ...extra });
  const properties = {
    title: nullable(),
    content: nullable(),
    status: nullable({ enum: [...TASK_FIELD_UPDATE_STATUSES, null] }),
    priority: nullable({ enum: [...TASK_FIELD_UPDATE_PRIORITIES, null] }),
    risk_level: nullable({ enum: [...TASK_FIELD_UPDATE_RISKS, null] }),
    start_date: nullable(),
    due_at: nullable(),
  };
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** Sanitize model JSON: unknown values are dropped, never written through. */
export function parseTaskFieldUpdates(raw: string): TaskFieldUpdates {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const blob = fence?.[1] || raw;
  const start = blob.indexOf("{");
  const end = blob.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(blob.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
  const updates: TaskFieldUpdates = {};
  if (typeof parsed.title === "string" && parsed.title.trim()) updates.title = parsed.title.trim().slice(0, 200);
  if (typeof parsed.content === "string" && parsed.content.trim()) updates.content = parsed.content.trim().slice(0, 2000);
  const status = String(parsed.status || "");
  if ((TASK_FIELD_UPDATE_STATUSES as readonly string[]).includes(status)) updates.status = status;
  const priority = String(parsed.priority || "");
  if ((TASK_FIELD_UPDATE_PRIORITIES as readonly string[]).includes(priority)) updates.priority = priority;
  const risk = String(parsed.risk_level || "");
  if ((TASK_FIELD_UPDATE_RISKS as readonly string[]).includes(risk)) updates.risk_level = risk;
  for (const field of ["start_date", "due_at"] as const) {
    const value = String(parsed[field] || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) updates[field] = value.slice(0, 10);
  }
  return updates;
}

async function extractTaskFieldUpdatesWithLuna(text: string, timeoutSec = taskRecognizeTimeout()): Promise<TaskFieldUpdates> {
  const key = intentLlmApiKey();
  if (!key) {
    throw new IntentLlmUnavailable("识别服务未就绪：未配置模型密钥。", "把 OPENAI_API_KEY 写入 .env 后重试。");
  }
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutSec) * 1000);
  try {
    const fetchFn = fetchOverride || fetch;
    const response = await fetchFn(`${base}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: intentLlmModel(),
        instructions: taskFieldUpdateSystemPrompt(),
        input: text,
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "task_field_updates",
            strict: false,
            schema: taskFieldUpdateOutputSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new IntentLlmUnavailable(`识别服务未就绪（${response.status}）。`, "稍后点「再试一次」。");
    }
    return parseTaskFieldUpdates(extractRemoteIntentText(await response.json()));
  } catch (error) {
    if (error instanceof IntentLlmUnavailable) throw error;
    throw new IntentLlmUnavailable("识别服务未就绪，请再试一次。", "检查网络或 OPENAI_API_KEY 后重试。");
  } finally {
    clearTimeout(timer);
  }
}

async function extractTaskFieldUpdatesWithCodex(text: string, timeoutSec = taskRecognizeTimeout()): Promise<TaskFieldUpdates> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-task-edit-"));
  const rpc = new CodexAppServer(Math.max(1, timeoutSec));
  try {
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: codexRecognizeThreadConfig(),
    });
    const thread = (started.thread as { id?: string } | undefined) || started;
    const threadId = String((thread as { id?: string }).id || "");
    if (!threadId) throw new CodexUnavailable("thread/start 未返回 thread.id。", "升级 Codex CLI 后重试。");
    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: `${taskFieldUpdateSystemPrompt()}\nUser: ${text}` }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: taskFieldUpdateOutputSchema(),
    });
    const completed = await rpc.waitTurn();
    return parseTaskFieldUpdates(parseCodexTexts(rpc, completed as { turn?: { output?: unknown } }).join("\n"));
  } catch (error) {
    if (error instanceof IntentLlmUnavailable) throw error;
    const message = error instanceof CodexUnavailable ? error.message : "识别服务未就绪，请再试一次。";
    throw new IntentLlmUnavailable(
      message,
      error instanceof CodexUnavailable
        ? error.next_action
        : "设置 OPENAI_API_KEY 后重启 Host，或确认已 `codex login` 后重试。",
    );
  } finally {
    rpc.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Codex channel for structured task edits. Throws IntentLlmUnavailable when no
 * model is reachable; callers fall back to deterministic parsing.
 */
export async function extractTaskFieldUpdates(text: string): Promise<TaskFieldUpdates> {
  if (intentLlmMode() === "stub") {
    throw new IntentLlmUnavailable("识别服务未就绪：stub 模式。", "配置 OPENAI_API_KEY 后重试。");
  }
  const deadline = Date.now() + taskRecognizeTimeout() * 1000;
  const remaining = () => Math.max(0, (deadline - Date.now()) / 1000);
  if (intentLlmApiKey()) {
    try {
      return await extractTaskFieldUpdatesWithLuna(text, remaining());
    } catch (lunaError) {
      if (remaining() < 2) throw lunaError;
      try {
        return await extractTaskFieldUpdatesWithCodex(text, remaining());
      } catch {
        throw lunaError;
      }
    }
  }
  return extractTaskFieldUpdatesWithCodex(text, remaining());
}
