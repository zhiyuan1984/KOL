/**
 * Result-page follow-up: unsent 本轮结果 + composer text is a revision of that
 * artifact (field merge via Codex app-server), not a new Skill run.
 * First compose still goes Starry; chips / 再写一封 / leading skill aliases
 * are new tasks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexMode, mailAnalysisTimeout } from "../config.js";
import { extractTaskEntities } from "../tasks/resolver.js";
import { ensureQuoteInBody, ensureQuoteInZh, parseQuoteOffer } from "./quote-amount.js";
import { taskDefinitions } from "../tasks/registry.js";
import { intentLlmModel } from "../tasks/openai-intent.js";
import { CodexAppServer } from "../worker/codex.js";
import { CodexUnavailable } from "../worker/errors.js";
import type { Json } from "../types.js";

export type ResultSnapshot = {
  skill: string;
  thread_id?: string | null;
  handle?: string;
  collaboration_id?: string;
  draft_id?: string | null;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  body_zh_internal?: string;
  amount_usd?: number | null;
  currency?: string | null;
  tracking?: string | null;
  carrier?: string | null;
  title?: string;
  summary?: string;
  sections?: Json[];
  compose_loop?: Json | null;
  digest?: string;
  stage?: string;
};

export type LastUnsentResult = {
  skill: string;
  snapshot: ResultSnapshot;
  card: Json;
  thread_id?: string | null;
  handle?: string;
  collaboration_id?: string;
  draft_id?: string | null;
  sent: boolean;
};

const RESTART_RE = /重新写|重写一封|重写这封|不要上一封|从头来/;
const ANOTHER_LETTER_RE = /加一封|再发一封|再写一封|再来一封/;
const CONFIRM_SEND_RE = /确认发送|confirm[_ ]?send/i;
const REVISE_KEYS = [
  "subject",
  "body",
  "body_zh_internal",
  "from",
  "to",
  "amount_usd",
  "currency",
  "tracking",
  "carrier",
  "title",
  "summary",
] as const;

export const REVISE_OUTPUT_SCHEMA: Json = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["revise_result"] },
    fields: {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
        body_zh_internal: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        amount_usd: { type: "number" },
        currency: { type: "string" },
        tracking: { type: "string" },
        carrier: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
      },
    },
    changed: { type: "array", items: { type: "string" } },
  },
  required: ["type", "fields"],
  additionalProperties: false,
};

function payloadOf(row: Json): Json {
  const raw = row.payload;
  if (raw && typeof raw === "object") return raw as Json;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Json;
    } catch {
      return {};
    }
  }
  return {};
}

function isSentCard(payload: Json): boolean {
  if (String(payload.title || "") === "邮件已发送") return true;
  const nested = payload.starrykol_data && typeof payload.starrykol_data === "object"
    ? payload.starrykol_data as Json
    : (payload.emailmcp_data && typeof payload.emailmcp_data === "object" ? payload.emailmcp_data as Json : {});
  return Boolean(payload.sent || nested.sent);
}

function lastEmailCard(rows: Json[]): Json | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].kind) === "email_card") return payloadOf(rows[i]);
  }
  return null;
}

export function snapshotFromCards(card: Json, draft?: Json | null): ResultSnapshot {
  const nested = card.starrykol_data && typeof card.starrykol_data === "object"
    ? card.starrykol_data as Json
    : (card.emailmcp_data && typeof card.emailmcp_data === "object" ? card.emailmcp_data as Json : {});
  const loop = card.compose_loop && typeof card.compose_loop === "object" ? card.compose_loop as Json : null;
  const stored = card.result_revise && typeof card.result_revise === "object" ? card.result_revise as Json : {};
  const prior = stored.snapshot && typeof stored.snapshot === "object" ? stored.snapshot as Json : {};
  const skill = String(stored.skill || card.skill || draft?.skill || "email_compose");
  return {
    skill,
    thread_id: stored.thread_id ? String(stored.thread_id) : null,
    handle: String(stored.handle || card.handle || prior.handle || ""),
    collaboration_id: String(stored.collaboration_id || card.collaboration_id || draft?.collaboration_id || prior.collaboration_id || ""),
    draft_id: String(stored.draft_id || draft?.draft_id || draft?.id || prior.draft_id || "") || null,
    from: String(draft?.from || nested.from || nested.mailboxEmail || prior.from || ""),
    to: String(draft?.to || nested.to || nested.recipient || prior.to || ""),
    subject: String(draft?.subject || nested.subject || prior.subject || ""),
    body: String(draft?.body || nested.body || nested.bodyText || prior.body || ""),
    body_zh_internal: String(draft?.body_zh_internal || prior.body_zh_internal || ""),
    amount_usd: draft?.amount_usd != null
      ? Number(draft.amount_usd)
      : (loop?.amount_usd != null ? Number(loop.amount_usd) : (prior.amount_usd != null ? Number(prior.amount_usd) : null)),
    currency: String(draft?.currency || loop?.currency || prior.currency || "") || null,
    tracking: String(nested.tracking || prior.tracking || "") || null,
    carrier: String(nested.carrier || prior.carrier || "") || null,
    title: String(card.title || prior.title || ""),
    summary: String(card.summary || prior.summary || ""),
    sections: Array.isArray(card.sections) ? card.sections as Json[] : (Array.isArray(prior.sections) ? prior.sections as Json[] : []),
    compose_loop: loop,
    digest: String(loop?.digest || nested.mail_digest || prior.digest || ""),
    stage: String(nested.current_stage || prior.stage || ""),
  };
}

export function lastUnsentResult(rows: Json[]): LastUnsentResult | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].kind) !== "task_result_card") continue;
    const card = payloadOf(rows[i]);
    if (isSentCard(card)) return null;
    const draft = lastEmailCard(rows.slice(0, i + 1));
    const snapshot = snapshotFromCards(card, draft);
    const skill = snapshot.skill || String(card.skill || "");
    if (!skill && !card.compose_loop && !draft) continue;
    return {
      skill: skill || "task_result",
      snapshot,
      card,
      thread_id: snapshot.thread_id,
      handle: snapshot.handle,
      collaboration_id: snapshot.collaboration_id,
      draft_id: snapshot.draft_id,
      sent: false,
    };
  }
  return null;
}

function leadingSkillId(text: string): string | null {
  const trimmed = text.trim().replace(/^(请|帮我)/, "");
  let best: { id: string; len: number } | null = null;
  for (const definition of taskDefinitions()) {
    for (const name of [definition.title, definition.id, ...definition.aliases]) {
      const token = String(name || "").trim();
      if (token.length < 2) continue;
      if (trimmed.startsWith(token) && (!best || token.length > best.len)) {
        best = { id: definition.id, len: token.length };
      }
    }
  }
  return best?.id || null;
}

export function isResultRevision(
  text: string,
  last: LastUnsentResult | null,
  opts?: { lockedIntent?: string | null; boundTask?: boolean },
): boolean {
  const raw = String(text || "").trim();
  if (!raw || !last || last.sent) return false;
  if (opts?.boundTask) return false;
  if (opts?.lockedIntent && taskDefinitions().some((row) => row.id === opts.lockedIntent)) return false;
  if (CONFIRM_SEND_RE.test(raw) || ANOTHER_LETTER_RE.test(raw) || RESTART_RE.test(raw)) return false;
  const handle = String(extractTaskEntities(raw).handle || "");
  if (handle && last.handle && handle !== last.handle) return false;
  if (leadingSkillId(raw)) return false;
  return true;
}

export function mergeReviseFields(snapshot: ResultSnapshot, fields: Json): { next: ResultSnapshot; changed: string[] } {
  const next: ResultSnapshot = { ...snapshot };
  const changed: string[] = [];
  for (const key of REVISE_KEYS) {
    if (fields[key] == null || fields[key] === "") continue;
    const value = key === "amount_usd" ? Number(fields[key]) : fields[key];
    if (String(next[key] ?? "") === String(value)) continue;
    (next as Record<string, unknown>)[key] = value;
    changed.push(key);
  }
  return { next, changed };
}

function replaceToken(body: string, from: string, to: string): string {
  if (!from || from === to) return body;
  return body.split(from).join(to);
}

export function stubReviseFields(text: string, snapshot: ResultSnapshot): Json {
  const fields: Json = {};
  const extracted = extractTaskEntities(text);
  const offer = parseQuoteOffer(text);
  const amountMatch = extracted.amount_usd != null && Number.isFinite(Number(extracted.amount_usd))
    ? Number(extracted.amount_usd)
    : (offer.amount_usd != null
      ? offer.amount_usd
      : Number(/(?:改成|换成)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/.exec(text)?.[1] || ""));
  if (Number.isFinite(amountMatch) && amountMatch > 0) {
    fields.amount_usd = amountMatch;
    const nextOffer = {
      amount_usd: amountMatch,
      currency: String(extracted.currency || offer.currency || snapshot.currency || "USD"),
      deliverables: String(extracted.deliverables || offer.deliverables || "") || null,
    };
    fields.currency = nextOffer.currency;
    let body = String(snapshot.body || "");
    if (snapshot.amount_usd != null && body) {
      body = replaceToken(body, String(snapshot.amount_usd), String(fields.amount_usd));
    }
    body = ensureQuoteInBody(body, nextOffer);
    if (body && body !== String(snapshot.body || "")) fields.body = body;
    const zh = ensureQuoteInZh(String(snapshot.body_zh_internal || ""), nextOffer);
    if (zh && zh !== String(snapshot.body_zh_internal || "")) fields.body_zh_internal = zh;
  }
  if (extracted.tracking) {
    fields.tracking = String(extracted.tracking);
    if (snapshot.tracking && snapshot.body) {
      fields.body = replaceToken(String(fields.body || snapshot.body), String(snapshot.tracking), String(fields.tracking));
    }
  }
  if (extracted.carrier) fields.carrier = String(extracted.carrier);
  if (extracted.subject) fields.subject = String(extracted.subject);
  const swap = /把\s*[「"']?(.+?)[」"']?\s*(?:改成|换成)\s*[「"']?(.+?)[」"']?\s*$/.exec(text.trim());
  if (swap && snapshot.body && String(snapshot.body).includes(swap[1])) {
    fields.body = replaceToken(String(fields.body || snapshot.body), swap[1], swap[2]);
  }
  const add = /(?:加上|补充|加一句)\s*[:：]?\s*(.+)$/.exec(text.trim());
  if (add && snapshot.body) {
    fields.body = `${String(fields.body || snapshot.body).trim()}\n\n${add[1].trim()}`.trim();
  }
  return fields;
}

function parseReviseFields(raw: string): Json {
  const text = String(raw || "").trim();
  const tryParse = (value: string): Json | null => {
    try {
      const parsed = JSON.parse(value) as Json;
      const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields as Json : parsed;
      if (parsed.type === "revise_result" && parsed.fields) return parsed.fields as Json;
      if (fields && typeof fields === "object") return fields;
    } catch {
      return null;
    }
    return null;
  };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed) return parsed;
  }
  const direct = tryParse(text);
  if (direct) return direct;
  const start = text.indexOf("{");
  if (start >= 0) {
    const parsed = tryParse(text.slice(start));
    if (parsed) return parsed;
  }
  return {};
}

function revisePrompt(snapshot: ResultSnapshot, text: string): string {
  return [
    "你在修订上一份已生成的结果，不是新任务，也不要发信或改阶段。",
    "只输出 JSON：{ type: \"revise_result\", fields: { ... } }。",
    "fields 里只放用户明确要求改的字段；没提到的字段不要出现。",
    "若用户要求补上或修改价格，必须同时改 amount_usd、body 和 body_zh_internal。",
    "英文 body 必须出现该金额和计费单位（例如 USD 5000 for 1 hour），不能只改元数据，也不能改写成没有报价的建联信。",
    "body_zh_internal 必须是该英文正文的对应中文译稿，且同样写明金额和计费单位。",
    "上一份结果：",
    JSON.stringify(snapshot),
    "用户补充：",
    text,
  ].join("\n");
}

export async function reviseWithCodex(
  snapshot: ResultSnapshot,
  text: string,
): Promise<{ fields: Json; thread_id: string | null }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-result-revise-"));
  const rpc = new CodexAppServer(mailAnalysisTimeout());
  try {
    await rpc.handshake();
    await rpc.requireAuth();
    const threadParams = {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { mcp_servers: {}, model: intentLlmModel() },
    };
    let started: Json;
    if (snapshot.thread_id) {
      try {
        started = await rpc.request("thread/resume", { threadId: snapshot.thread_id });
      } catch (error) {
        if (!(error instanceof CodexUnavailable)) throw error;
        started = await rpc.request("thread/start", threadParams);
      }
    } else {
      started = await rpc.request("thread/start", threadParams);
    }
    const thread = (started.thread as Json) || started;
    const threadId = String(thread.id || "");
    if (!threadId) throw new CodexUnavailable("thread/start 未返回 thread.id。", "升级 Codex CLI 后重试。");
    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: revisePrompt(snapshot, text) }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: REVISE_OUTPUT_SCHEMA,
    });
    const completed = await rpc.waitTurn(mailAnalysisTimeout());
    const extras = completed.turn && typeof completed.turn === "object"
      ? JSON.stringify((completed.turn as { output?: unknown }).output || {})
      : "";
    const fields = parseReviseFields([...rpc.agentTexts, extras].join("\n"));
    return { fields, thread_id: threadId };
  } finally {
    rpc.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

export async function collectReviseFields(
  snapshot: ResultSnapshot,
  text: string,
): Promise<{ fields: Json; thread_id: string | null }> {
  if (codexMode() === "stub") {
    return { fields: stubReviseFields(text, snapshot), thread_id: snapshot.thread_id || null };
  }
  return reviseWithCodex(snapshot, text);
}

export function stampResultRevise(
  card: Json,
  meta: {
    skill: string;
    snapshot: ResultSnapshot;
    thread_id?: string | null;
    changed?: string[];
  },
): Json {
  return {
    ...card,
    result_revise: {
      skill: meta.skill,
      thread_id: meta.thread_id || null,
      handle: meta.snapshot.handle || "",
      collaboration_id: meta.snapshot.collaboration_id || "",
      draft_id: meta.snapshot.draft_id || null,
      snapshot: meta.snapshot,
      changed: meta.changed || [],
    },
  };
}

export function changedLabel(changed: string[]): string {
  const labels: Record<string, string> = {
    amount_usd: "金额",
    subject: "主题",
    body: "正文",
    tracking: "运单号",
    carrier: "承运商",
    title: "标题",
    summary: "摘要",
    from: "发件",
    to: "收件",
  };
  const named = changed.map((key) => labels[key] || key);
  return named.length ? `已按你的说明改了：${named.join("、")}。` : "已按你的说明修订了这一份结果。";
}
