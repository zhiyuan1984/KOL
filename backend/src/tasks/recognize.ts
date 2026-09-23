/**
 * Task recognition always goes through a remote judge (GPT-5.6 Luna when a key
 * is set, otherwise Codex app-server) or a same-shape stub in tests.
 * Host validates catalog ids, required inputs, and that emails came from the user
 * (or the operator's bound Starry mailbox). Regex does not pick the skill.
 */
import { audit } from "../db.js";
import { scopedUser } from "../auth.js";
import { starryBindingRow } from "../host/starry-bind.js";
import { normalizeEmail } from "../host/identity.js";
import { taskDefinition } from "./registry.js";
import {
  classifyTaskIntent,
  IntentLlmUnavailable,
  normalizeIntentVerdict,
  type IntentVerdict,
} from "./openai-intent.js";
import { extractTaskEntities, resolveTaskIntent, type ClarificationKind, type TaskResolution } from "./resolver.js";

export type TaskRecognition = TaskResolution & {
  source: "llm" | "locked" | "none";
  error?: string;
  next_action?: string;
};

type ClassifyFn = (text: string) => Promise<Partial<IntentVerdict> & { task_type: string | null; confidence: number }>;
let classifyOverride: ClassifyFn | null = null;

export function setTaskClassifier(factory?: ClassifyFn): void {
  classifyOverride = factory || null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;

function firstEmail(value: unknown): string {
  if (Array.isArray(value)) return firstEmail(value[0]);
  const match = String(value || "").match(EMAIL_RE);
  return match?.[0] || "";
}

function emailsInText(text: string): Set<string> {
  return new Set([...text.matchAll(EMAIL_RE)].map((match) => normalizeEmail(match[0])));
}

function boundMailboxEmail(): string {
  try {
    const user = scopedUser();
    if (!user) return "";
    return normalizeEmail(String(starryBindingRow(user.id)?.mailbox_email || ""));
  } catch {
    return "";
  }
}

export function sanitizeIntentEntities(
  entities: Record<string, unknown>,
  text: string,
  boundMailbox = "",
): Record<string, unknown> {
  const allowed = emailsInText(text);
  if (boundMailbox) allowed.add(normalizeEmail(boundMailbox));
  const out = { ...entities };
  const from = firstEmail(out.mailboxEmail || out.from);
  if (from && allowed.has(normalizeEmail(from))) out.mailboxEmail = from;
  else {
    delete out.mailboxEmail;
    delete out.from;
  }
  const rawTo = Array.isArray(out.to) ? out.to : (out.to || out.email ? [out.to || out.email] : []);
  const to = rawTo
    .map((item) => firstEmail(item))
    .filter((email) => email && allowed.has(normalizeEmail(email)));
  if (to.length) {
    out.to = to;
    out.email = to[0];
  } else {
    delete out.to;
    delete out.email;
  }
  return out;
}

function mergeEntities(
  extracted: Record<string, unknown>,
  llm: Record<string, unknown>,
  supplied: Record<string, unknown>,
  boundMailbox: string,
  taskType: string | null,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...extracted };
  for (const [key, value] of Object.entries(llm)) {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const current = merged[key];
    if (current == null || current === "" || (Array.isArray(current) && current.length === 0)) {
      merged[key] = value;
    }
  }
  Object.assign(merged, supplied);
  // Keep prompt placeholders in the clarification path. A value such as
  // “[主题]” is a label from a task template, not user-provided data.
  if (typeof merged.subject === "string" && /^\[(?:主题|subject)\]$/i.test(merged.subject.trim())) {
    delete merged.subject;
  }
  if (taskType === "email_compose" && !firstEmail(merged.mailboxEmail) && boundMailbox) {
    merged.mailboxEmail = boundMailbox;
  }
  return merged;
}

function kindOf(resolution: TaskResolution, fallback: ClarificationKind): ClarificationKind {
  if (!resolution.task_type) return "direction";
  if (resolution.missing_fields.length || Object.keys(resolution.invalid_fields || {}).length) return "missing_fields";
  return fallback === "direction" ? "none" : fallback;
}

async function judgeIntent(text: string): Promise<IntentVerdict> {
  if (classifyOverride) return normalizeIntentVerdict(await classifyOverride(text));
  return classifyTaskIntent(text);
}

export async function recognizeTaskIntent(input: {
  text?: string;
  task_type?: string | null;
  entities?: Record<string, unknown>;
  input?: Record<string, unknown>;
}): Promise<TaskRecognition> {
  const text = String(input.text || "").trim();
  let lockedType = input.task_type && taskDefinition(String(input.task_type))
    ? String(input.task_type)
    : "";
  if (!text && !lockedType) {
    return {
      task_type: null,
      confidence: 0,
      entities: {},
      missing_fields: [],
      alternatives: [],
      needs_clarification: true,
      clarification_kind: "direction",
      source: "none",
    };
  }

  const extractedEarly = extractTaskEntities(text);
  if (!lockedType && extractedEarly.confirm_send) {
    lockedType = "email_compose";
  }

  let verdict: IntentVerdict | null = null;
  let llmError = "";
  let llmNext = "";
  if (text && !lockedType) {
    try {
      verdict = await judgeIntent(text);
    } catch (error) {
      if (error instanceof IntentLlmUnavailable) {
        llmError = error.message;
        llmNext = error.next_action;
      } else {
        llmError = "识别服务未就绪，请再试一次。";
        llmNext = "检查 OPENAI_API_KEY 是否已被 Host 加载后，在箱内重试。";
      }
    }
  }

  if (!verdict && !lockedType) {
    return {
      task_type: null,
      confidence: 0,
      entities: extractTaskEntities(text),
      missing_fields: [],
      alternatives: resolveTaskIntent({ text }).alternatives,
      needs_clarification: true,
      clarification_kind: "direction",
      source: "none",
      error: llmError || "识别服务未就绪，请再试一次。",
      next_action: llmNext || "设置 OPENAI_API_KEY 后重启 Host，再在箱内重试。",
    };
  }

  const taskType = lockedType || (verdict?.task_type && taskDefinition(verdict.task_type) ? verdict.task_type : null);
  const bound = boundMailboxEmail();
  const extracted = extractTaskEntities(text);
  const llmEntities = sanitizeIntentEntities(verdict?.entities || {}, text, bound);
  const merged = mergeEntities(extracted, llmEntities, input.entities || {}, bound, taskType);

  if (!taskType) {
    const fallback = resolveTaskIntent({ text, entities: merged, input: input.input });
    audit("host", "task.recognize", { text: text.slice(0, 200), task_type: null, source: "llm" });
    return {
      ...fallback,
      task_type: null,
      confidence: verdict?.confidence || 0,
      alternatives: (verdict?.alternatives?.length ? verdict.alternatives : fallback.alternatives),
      needs_clarification: true,
      clarification_kind: "direction",
      source: "llm",
    };
  }

  const locked = resolveTaskIntent({
    text,
    task_type: taskType,
    entities: merged,
    input: input.input,
  });
  const clarificationKind = kindOf(locked, verdict?.clarification_kind || "none");
  if (verdict && !lockedType) {
    audit("host", "task.recognize", {
      text: text.slice(0, 200),
      task_type: taskType,
      confidence: verdict.confidence,
      source: "llm",
    });
  }
  return {
    ...locked,
    confidence: lockedType ? 1 : Math.max(locked.confidence, verdict?.confidence || 0),
    needs_clarification: clarificationKind !== "none",
    clarification_kind: clarificationKind,
    source: lockedType ? "locked" : "llm",
    ...(llmError ? { error: llmError, next_action: llmNext } : {}),
  };
}
