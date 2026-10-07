/**
 * 实时上下文层 P1：知识问答改写器（线①）。
 *
 * 设计稿：docs/superpowers/specs/2026-10-06-realtime-context-layer-design.md（§4）。
 * 决策摘要（2026-10-06 qiyou）：
 * - D1：改写后干净单问喂给 PageIndex，历史摘要只进改写器输入、不进 PageIndex 的问题；
 * - D2（修订）：改写器直调 Luna，不用规则层，也不用 Codex；
 * - D3：改写后必须过 Host 校验（实体须有出处，不许编造），失败回退原 query + audit；
 * - D4：P1 会话状态放前端 state（试算面板内），后端只接收、不落库。
 *
 * 职责边界：本模块只做「提议」（改写 + 校验），不做裁决之外的事。
 * 任何环节失败 → 调用方回退原问题直查，这是统一的降级路径。
 */

import {
  extractRemoteIntentText,
  intentLlmApiKey,
  intentLlmFetch,
  intentLlmModel,
} from "../tasks/openai-intent.js";

/** 上一轮问答明细（前端 state 传来，后端只读）。 */
export type RewriteLastTurn = {
  query: string;
  answer: string;
  entities: string[];
  citations: Array<{ document?: string; title?: string }>;
};

export type RewriteInput = {
  query: string;
  last_turn: RewriteLastTurn | null;
  history_summary: string;
  scope?: { base_id?: string; doc_ids?: string[] };
};

export type RewriteOutput = {
  rewritten: string;
  resolved_entities: string[];
  rewrote: boolean;
  reason: string;
};

/** Luna 不可用/超时/返回异常 → 调用方回退原问题直查。 */
export class RewriteUnavailable extends Error {}

export const REWRITE_TIMEOUT_MS = 30_000;
export const MAX_LAST_ANSWER_CHARS = 2_000;
export const MAX_HISTORY_SUMMARY_CHARS = 1_500;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).map((s) => s.trim()).filter(Boolean);
}

/**
 * 清洗前端传来的会话上下文：截断、去空，防止超长输入拖慢改写。
 * 返回 null 表示没有可用上文（调用方跳过改写）。
 */
export function sanitizeSessionContext(input: {
  last_turn?: unknown;
  history_summary?: unknown;
}): { last_turn: RewriteLastTurn | null; history_summary: string } {
  const history_summary = asString(input.history_summary).slice(0, MAX_HISTORY_SUMMARY_CHARS);
  const raw = input.last_turn;
  if (!raw || typeof raw !== "object") return { last_turn: null, history_summary };
  const obj = raw as Record<string, unknown>;
  const query = asString(obj.query).trim();
  if (!query) return { last_turn: null, history_summary };
  const citationsRaw = Array.isArray(obj.citations) ? obj.citations : [];
  const citations = citationsRaw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({ document: asString(c.document), title: asString(c.title) }))
    .filter((c) => c.document || c.title)
    .slice(0, 20);
  return {
    last_turn: {
      query: query.slice(0, 500),
      answer: asString(obj.answer).slice(0, MAX_LAST_ANSWER_CHARS),
      entities: asStringList(obj.entities).slice(0, 20),
      citations,
    },
    history_summary,
  };
}

export function rewriteSystemPrompt(): string {
  return [
    "你是知识库问答的改写器。输入是一轮用户问题 + 会话上下文（上一轮问答明细、更早轮次摘要）。",
    "只做一件事：判断本轮问题是否含指代（它/这个/该产品…）或省略（主语缺失），有则改写成无指代、无省略的干净单问；无则原样返回。",
    "规则：",
    "1. resolved_entities 只能是上轮 entities、引用文档名、上轮问答原文、历史摘要里出现过的词，不许编造新实体；",
    "2. 找不到可消解的实体时，rewrote=false，rewritten 原样等于 query；",
    "3. 只输出 JSON，不输出解释文字。",
    "示例 1：上轮问「有哪些产品型号」，答「LiTime 12V 100Ah / 200Ah…」，本轮问「介绍下它的规格参数」→ rewritten=「介绍下 LiTime 12V 100Ah 的规格参数」，resolved_entities=[\"LiTime 12V 100Ah\"]，rewrote=true。",
    "示例 2：上轮问「保修政策是什么」，本轮问「规格参数呢？」→ rewritten=「保修政策的规格参数是什么」（按上轮主语补全），rewrote=true。",
    "示例 3：本轮问「退货政策是什么」，无指代无省略 → rewrote=false，rewritten 原样等于 query，resolved_entities=[]。",
  ].join("\n");
}

export function rewriteOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      rewritten: { type: "string" },
      resolved_entities: { type: "array", items: { type: "string" } },
      rewrote: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["rewritten", "resolved_entities", "rewrote", "reason"],
    additionalProperties: false,
  };
}

/** 解析 Luna 返回的 JSON；解析失败或字段缺失 → 抛 RewriteUnavailable（调用方回退）。 */
export function parseRewriteOutput(text: string, fallbackQuery: string): RewriteOutput {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new RewriteUnavailable("改写器返回非 JSON。");
  }
  if (!parsed || typeof parsed !== "object") throw new RewriteUnavailable("改写器返回为空。");
  const rewrote = parsed.rewrote === true;
  const rewritten = asString(parsed.rewritten).trim() || fallbackQuery;
  return {
    rewritten: rewrote ? rewritten : fallbackQuery,
    resolved_entities: rewrote ? asStringList(parsed.resolved_entities) : [],
    rewrote,
    reason: asString(parsed.reason).slice(0, 300),
  };
}

function buildRewriteUserInput(input: RewriteInput): string {
  return JSON.stringify({
    query: input.query,
    last_turn: input.last_turn,
    history_summary: input.history_summary,
    scope: input.scope || {},
  });
}

/**
 * 直调 Luna 做改写（D2 修订：不用规则层，不用 Codex）。
 * 抛 RewriteUnavailable：无密钥、超时、非 200、返回不可解析。
 */
export async function rewriteQuestion(input: RewriteInput): Promise<RewriteOutput> {
  const key = intentLlmApiKey();
  if (!key) throw new RewriteUnavailable("识别服务未就绪：未配置模型密钥。");
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);
  try {
    const fetchFn = intentLlmFetch() || fetch;
    const response = await fetchFn(`${base}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: intentLlmModel(),
        instructions: rewriteSystemPrompt(),
        input: buildRewriteUserInput(input),
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "knowledge_rewrite",
            strict: false,
            schema: rewriteOutputSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new RewriteUnavailable(`改写服务未就绪（${response.status}）。`);
    return parseRewriteOutput(extractRemoteIntentText(await response.json()), input.query);
  } catch (error) {
    if (error instanceof RewriteUnavailable) throw error;
    throw new RewriteUnavailable(error instanceof Error ? error.message : "改写服务调用失败。");
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEntity(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Host 校验（设计稿 §4.4，D3）：
 * 1. resolved_entities 非空时，rewritten 必须包含其中至少一个；
 * 2. 每一项必须有出处：上轮 entities、引用文档名/标题、上轮问答原文、历史摘要
 *    （双向子串匹配；设计稿列出前三项，P1 实现把上轮问答原文也计入出处——
 *    它是最直接的实体来源，没有它会把正确改写误判为编造）。
 */
export function validateRewrite(
  rewrite: RewriteOutput,
  input: RewriteInput,
): { ok: boolean; reason?: string } {
  if (!rewrite.rewrote) return { ok: true };
  const entities = rewrite.resolved_entities.map(normalizeEntity).filter(Boolean);
  if (!entities.length) return { ok: true };
  const rewritten = normalizeEntity(rewrite.rewritten);
  if (!entities.some((entity) => rewritten.includes(entity))) {
    return { ok: false, reason: "改写后问题未包含消解出的实体词。" };
  }
  const sources: string[] = [];
  const last = input.last_turn;
  if (last) {
    sources.push(...last.entities, last.query, last.answer);
    for (const citation of last.citations) {
      if (citation.document) sources.push(citation.document);
      if (citation.title) sources.push(citation.title);
    }
  }
  if (input.history_summary) sources.push(input.history_summary);
  const normalizedSources = sources.map(normalizeEntity).filter(Boolean);
  for (const entity of entities) {
    const grounded = normalizedSources.some(
      (source) => source.includes(entity) || entity.includes(source),
    );
    if (!grounded) {
      return { ok: false, reason: `实体「${entity}」在上轮问答与历史摘要中无出处。` };
    }
  }
  return { ok: true };
}
