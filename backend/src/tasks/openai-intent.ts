/**
 * Task intent via a real remote judge. Prefer GPT-5.6 Luna (Responses API)
 * when OPENAI_API_KEY / CODEX_API_KEY is present; otherwise Codex app-server
 * with the same model. Host still validates catalog ids and emails.
 * Stub is tests only. gpt-4o Chat Completions is not required.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

export function setIntentLlmFetch(factory?: FetchLike): void {
  fetchOverride = factory || null;
}

export function intentLlmFetch(): FetchLike {
  return fetchOverride || fetch;
}

export function intentLlmFetchOverridden(): boolean {
  return Boolean(fetchOverride);
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
      return `- ${definition.id}: ${definition.title} — ${definition.description}${aliases}`;
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

function intentJsonSchema(ids: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      task_type: { type: "string", enum: ["", ...ids] },
      confidence: { type: "number" },
      entities: { type: "object" },
      missing_fields: { type: "array", items: { type: "string" } },
      clarification_kind: { type: "string", enum: ["none", "missing_fields", "direction"] },
      alternatives: { type: "array" },
      reason_zh: { type: "string" },
    },
    required: ["task_type", "confidence", "clarification_kind"],
    additionalProperties: false,
  };
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

export async function classifyWithCodexAppServer(text: string): Promise<IntentVerdict> {
  const ids = taskDefinitions().map((definition) => definition.id);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-recognize-"));
  const rpc = new CodexAppServer(taskRecognizeTimeout());
  try {
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { mcp_servers: {}, model: intentLlmModel() },
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
      outputSchema: intentJsonSchema(ids),
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

export async function classifyIntentWithLuna(text: string): Promise<IntentVerdict> {
  const key = intentLlmApiKey();
  if (!key) {
    throw new IntentLlmUnavailable("识别服务未就绪：未配置模型密钥。", "把 OPENAI_API_KEY 写入 .env 后重试。");
  }
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const ids = taskDefinitions().map((definition) => definition.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), taskRecognizeTimeout() * 1000);
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
            schema: intentJsonSchema(ids),
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
  if (intentLlmApiKey()) {
    try {
      return await classifyIntentWithLuna(text);
    } catch (lunaError) {
      try {
        return await classifyWithCodexAppServer(text);
      } catch {
        throw lunaError;
      }
    }
  }
  return classifyWithCodexAppServer(text);
}
