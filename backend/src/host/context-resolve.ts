/**
 * 技能上下文解析层：来源优先级链 + 统一信封
 * （docs/superpowers/specs/2026-10-06-context-resolution-design.md）。
 *
 * 固定链：1 显式载荷 → 2 UI 选中态(object_refs) → 3 会话绑定 → 4 文本抽取(@handle/handle)
 * → 5 账号绑定 → 6 对象事实 → 7 记忆。逐级回退；多候选只出候选、不取第一只；
 * 第 1 级与第 3 级给出不同合作对象时不静默，返回冲突。
 *
 * 按需解析：访问器被读到才取数，顺序即调用方顺序；取数前先过范围核对，第 6 级不做推断。
 * 只读：不建箱、不启动 Codex turn、不写业务状态。
 */
import { createHash } from "node:crypto";
import { sopExceptionByStage } from "../sops.js";
import { BY_CODE, groupedStageTracks, label, normalizeStage } from "../stages.js";
import { taskDefinition, type TaskContextKey } from "../tasks/registry.js";
import { extractTaskEntities } from "../tasks/resolver.js";
import type { Json, Row } from "../types.js";
import { composeContextForCollaboration } from "./compose-loop.js";
import { composeSenderFor, type ComposeSender, type ComposeSenderSource } from "./compose-sender.js";
import { collabById } from "./intent.js";
import { assertCollaborationInScope, brandScope, scopedCollaborationSearch } from "./inbound-scope.js";
import { preparedTemplateChoice, resolveApplicableMailTemplates, type UsableTemplate } from "./knowledge.js";
import { conversationRowOf, currentMailbox, findMailThread } from "./mail-memory.js";
import type { ThreadDigest } from "./mail-summary.js";

export type ContextSource = "explicit" | "object_refs" | "session" | "text" | "account_binding" | "object_fact" | "memory";

/** 来源档编号即固定链顺序；逐键写进 `sources`，让「凭什么说这是当前世界」可追溯。 */
export const CONTEXT_SOURCE_TIER: Record<ContextSource, number> = {
  explicit: 1,
  object_refs: 2,
  session: 3,
  text: 4,
  account_binding: 5,
  object_fact: 6,
  memory: 7,
};

export type ContextStatus = "ready" | "needs_context" | "needs_input" | "blocked";
export type ContextMissing = { key: string; tier: "requires" | "prefers"; reason: string };
export type ContextCandidate = { key: string; id: string; label: string };

/** 缺口卡上逐键的人话名称；键目录的单一事实源仍是 tasks/registry.ts 的 TASK_CONTEXT_KEYS。 */
export const CONTEXT_KEY_LABEL: Record<TaskContextKey, string> = {
  collaboration: "合作对象",
  stage: "正式阶段",
  stage_tracks: "阶段轨道",
  mailbox: "授权发件箱",
  mail_thread: "往来邮件",
  mail_template: "邮件模板",
  message: "当前邮件",
  conversation: "邮件会话",
  creator: "达人",
  creator_filter: "达人库筛选",
  risk_scope: "风险范围",
};

export function contextKeyLabel(key: string): string {
  return CONTEXT_KEY_LABEL[key as TaskContextKey] || key;
}

/** 统一信封。`needs_context` 只对应 `requires` 未满足；`prefers` 未满足只记 `missing`。 */
export type ContextResolution = {
  status: ContextStatus;
  skill_id: string;
  resolved: Record<string, unknown>;
  sources: Record<string, string>;
  missing: ContextMissing[];
  candidates: ContextCandidate[];
  context_version: string;
};

export type StageFact = {
  stage_code: string;
  stage_label: string;
  stage_version: number;
  advancement_mode: string | null;
  exception: boolean;
  exception_kind: string | null;
};

export type StageTracksFact = ReturnType<typeof groupedStageTracks>;
export type MailThreadFact = { digest: ThreadDigest | null; memory: string[]; text: string; mail_count: number };
export type MailTemplateFact = { templates: UsableTemplate[]; choices: UsableTemplate[]; template: UsableTemplate | null };
export type CreatorFact = { handle: string; display_name: string; kol_uid: string; brand: string; collaboration_id: string };

/** Host 侧原始对象：只给消费者读，`resolution()` 才按信封投影成响应体。 */
export type ContextFacts = {
  collaboration: Row | null;
  stage: StageFact | null;
  stage_tracks: StageTracksFact | null;
  mailbox: ComposeSender | null;
  mail_thread: MailThreadFact | null;
  mail_template: MailTemplateFact | null;
  creator: CreatorFact | null;
  conversation: Json | null;
  message: Json | null;
  creator_filter: Json | null;
  risk_scope: Json | null;
};

/** 合作对象的选定结果：`conflict`（第 1/3 级打架）与 `ambiguous`（多候选）都不是「解析成功」。 */
export type CollaborationPick = {
  row: Row | null;
  source: ContextSource | null;
  conflict: boolean;
  ambiguous: boolean;
  candidates: ContextCandidate[];
  reason: string;
};

export type ContextResolveInput = {
  skillId: string;
  /** 原始请求体；显式载荷（第 1 级）与 object_refs（第 2 级）都从这里读。 */
  body?: Json;
  /** 已鉴权的会话行；会话绑定（第 3 级）读它的 collaboration_id。 */
  session?: Row | null;
  /** 员工文本；只用于第 4 级文本抽取。 */
  text?: string;
  /** 覆盖技能 frontmatter 的 `context` 声明；缺省取 registry。 */
  requires?: readonly TaskContextKey[];
  prefers?: readonly TaskContextKey[];
};

export type ContextSession = {
  skillId: string;
  collaboration(): CollaborationPick;
  stage(): StageFact | null;
  stageTracks(): StageTracksFact | null;
  mailbox(): ComposeSender | null;
  mailThread(): MailThreadFact | null;
  mailTemplate(): MailTemplateFact | null;
  creator(): CreatorFact | null;
  resolution(requires?: readonly TaskContextKey[], prefers?: readonly TaskContextKey[]): ContextResolution;
};

/** 版本哈希：内容变化即版本变化，旧确认快照随之失效。 */
export function contextVersion(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
}

type KeyFailure = {
  ok: false;
  gap: "context" | "input" | "blocked";
  reason: string;
  candidates?: ContextCandidate[];
};
type KeyResult = { ok: true; source: ContextSource } | KeyFailure;

const failed = (gap: KeyFailure["gap"], reason: string, candidates?: ContextCandidate[]): KeyFailure => ({
  ok: false,
  gap,
  reason,
  ...(candidates?.length ? { candidates } : {}),
});

/** 依赖键没解析出来时，把它的缺口与候选一起传给声明方键，避免缺口卡只剩一句「缺少合作对象」。 */
const dependencyFailed = (result: KeyResult, reason: string): KeyFailure => result.ok
  ? failed("context", reason)
  : failed(result.gap, reason, result.candidates);

const KEY_ORDER: readonly TaskContextKey[] = [
  "collaboration",
  "creator",
  "stage",
  "stage_tracks",
  "mailbox",
  "mail_thread",
  "mail_template",
  "conversation",
  "message",
  "creator_filter",
  "risk_scope",
];

/** 解析一片上下文要先拿到哪几片：只为「被声明的键」补依赖，不多取数。 */
const KEY_DEPENDS: Partial<Record<TaskContextKey, readonly TaskContextKey[]>> = {
  stage: ["collaboration"],
  stage_tracks: ["stage"],
  mailbox: ["collaboration"],
  mail_thread: ["collaboration"],
  mail_template: ["collaboration", "stage"],
};

const MAILBOX_SOURCE: Record<ComposeSenderSource, ContextSource> = {
  explicit: "explicit",
  user_binding: "account_binding",
  collaboration: "object_fact",
  brand_unique: "object_fact",
  none: "object_fact",
};

function objectRefIds(raw: unknown, kinds: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const ref = value as Json;
    const kind = String(ref.kind || ref.type || "").toLowerCase();
    if (!kinds.includes(kind)) return [];
    const id = String(ref.id || ref.collaboration_id || "").trim();
    return id ? [id] : [];
  });
}

function rowLabel(row: Row): string {
  const handle = String(row.handle || "").trim();
  if (handle) return `@${handle}`;
  return String(row.display_name || row.id || "").trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function publicCollaboration(row: Row): Json {
  return {
    id: String(row.id || ""),
    handle: String(row.handle || ""),
    display_name: String(row.display_name || ""),
    brand: String(row.brand || ""),
    email: String(row.email || ""),
    mailbox_from: String(row.mailbox_from || ""),
    stage_code: String(row.stage_code || ""),
    stage_version: Number(row.stage_version || 0),
  };
}

const PUBLIC_VALUE: Record<TaskContextKey, (facts: ContextFacts) => unknown> = {
  collaboration: (facts) => (facts.collaboration ? publicCollaboration(facts.collaboration) : null),
  stage: (facts) => facts.stage,
  stage_tracks: (facts) => facts.stage_tracks,
  mailbox: (facts) => facts.mailbox,
  mail_thread: (facts) => (facts.mail_thread
    ? { text: facts.mail_thread.text, mail_count: facts.mail_thread.mail_count, source: facts.mail_thread.digest?.source || "" }
    : null),
  mail_template: (facts) => (facts.mail_template?.template
    ? {
      knowledge_id: facts.mail_template.template.id,
      published_version: facts.mail_template.template.version,
      template_id: facts.mail_template.template.template_id,
      title: facts.mail_template.template.title,
      source: "knowledge",
    }
    : null),
  creator: (facts) => facts.creator,
  conversation: (facts) => facts.conversation,
  message: (facts) => facts.message,
  creator_filter: (facts) => facts.creator_filter,
  risk_scope: (facts) => facts.risk_scope,
};

export function openContext(input: ContextResolveInput): ContextSession {
  const body = (input.body && typeof input.body === "object" ? input.body : {}) as Json;
  const skillId = String(input.skillId || "").trim();
  const text = String(input.text ?? "").trim();
  let extracted: Record<string, unknown> | null = null;
  const facts: ContextFacts = {
    collaboration: null,
    stage: null,
    stage_tracks: null,
    mailbox: null,
    mail_thread: null,
    mail_template: null,
    creator: null,
    conversation: null,
    message: null,
    creator_filter: null,
    risk_scope: null,
  };
  let pick: CollaborationPick | null = null;
  const memo = new Map<TaskContextKey, KeyResult>();
  const resolving = new Set<TaskContextKey>();

  const entities = (): Record<string, unknown> => {
    if (!extracted) extracted = text ? extractTaskEntities(text) : {};
    return extracted;
  };

  function pickCollaboration(): CollaborationPick {
    const explicit = String(body.collaboration_id || "").trim();
    const sessionId = String(input.session?.collaboration_id || "").trim();
    if (sessionId && explicit && sessionId !== explicit) {
      return { row: null, source: null, conflict: true, ambiguous: false, candidates: [], reason: "会话已绑定其他合作对象，不能由请求覆盖" };
    }
    const named = new Map<string, { row: Row; source: ContextSource }>();
    const remember = (id: string, source: ContextSource): void => {
      if (!id) return;
      const direct = collabById(id);
      if (direct) {
        if (!named.has(String(direct.id))) named.set(String(direct.id), { row: direct, source });
        return;
      }
      for (const candidate of scopedCollaborationSearch(id)) {
        if (String(candidate.handle || "") !== id && String(candidate.id || "") !== id) continue;
        const full = collabById(String(candidate.id));
        if (full && !named.has(String(full.id))) named.set(String(full.id), { row: full, source });
      }
    };
    // 第 1/2/3 级合并成候选集合，来源档记最高优先的那一档。
    remember(explicit, "explicit");
    for (const id of objectRefIds(body.object_refs, ["collaboration", "collab", "kol", "creator", "object"])) remember(id, "object_refs");
    remember(sessionId, "session");
    if (!named.size) {
      // 第 4 级：请求体 handle 与文本 @handle 走同一条检索径；id 命中时永不回退到这里。
      const handle = firstString(body.handle, entities().handle);
      if (handle) {
        for (const candidate of scopedCollaborationSearch(handle)) {
          if (String(candidate.handle || "") !== handle && String(candidate.id || "") !== handle) continue;
          const full = collabById(String(candidate.id));
          if (full && !named.has(String(full.id))) named.set(String(full.id), { row: full, source: "text" });
        }
      }
    }
    if (!named.size) return { row: null, source: null, conflict: false, ambiguous: false, candidates: [], reason: "没有可识别的合作对象" };
    if (named.size > 1) {
      return {
        row: null,
        source: null,
        conflict: false,
        ambiguous: true,
        candidates: [...named.values()].map(({ row }) => ({ key: "collaboration", id: String(row.id), label: rowLabel(row) })),
        reason: "匹配到多个合作对象，需要先选定其中一个",
      };
    }
    const only = [...named.values()][0];
    assertCollaborationInScope(String(only.row.id));
    return { row: only.row, source: only.source, conflict: false, ambiguous: false, candidates: [], reason: "" };
  }

  const resolvers: Record<TaskContextKey, () => KeyResult> = {
    collaboration() {
      pick = pickCollaboration();
      facts.collaboration = pick.row;
      if (pick.conflict) return failed("blocked", pick.reason);
      if (pick.row) return { ok: true, source: pick.source || "explicit" };
      return failed("context", pick.reason, pick.candidates);
    },
    creator() {
      const asked = new Map<string, ContextSource>();
      const ask = (value: unknown, source: ContextSource): void => {
        const id = String(value ?? "").trim();
        if (id && !asked.has(id)) asked.set(id, source);
      };
      for (const key of ["creator_uid", "kol_uid", "creator_id", "kol_id", "creator_handle", "handle"]) ask(body[key], "explicit");
      for (const id of objectRefIds(body.object_refs, ["kol", "creator", "creator_profile", "kol_profile", "object"])) ask(id, "object_refs");
      const found = entities();
      for (const key of ["kolUid", "creator_id", "handle", "name"]) ask(found[key], "text");
      if (!asked.size) return failed("input", "没有给定达人，请先从红人库或会话里选一个");
      const named = new Map<string, { row: Row; source: ContextSource }>();
      for (const [query, source] of asked) {
        const direct = collabById(query);
        const rows: Row[] = direct ? [direct] : [];
        for (const candidate of scopedCollaborationSearch(query)) {
          const full = collabById(String(candidate.id));
          if (full) rows.push(full);
        }
        for (const row of rows) {
          const matches = [row.id, row.handle, row.display_name, row.kol_uid, row.kol_id]
            .some((value) => String(value || "").trim() === query);
          if (matches && !named.has(String(row.id))) named.set(String(row.id), { row, source });
        }
      }
      if (!named.size) return failed("input", "当前范围里没有匹配的达人");
      if (named.size > 1) {
        return failed("input", "匹配到多个达人，需要先选定其中一个",
          [...named.values()].map(({ row }) => ({ key: "creator", id: String(row.id), label: rowLabel(row) })));
      }
      const only = [...named.values()][0];
      facts.creator = {
        handle: String(only.row.handle || ""),
        display_name: String(only.row.display_name || ""),
        kol_uid: String(only.row.kol_uid || only.row.kol_id || ""),
        brand: String(only.row.brand || ""),
        collaboration_id: String(only.row.id || ""),
      };
      return { ok: true, source: only.source };
    },
    stage() {
      const collaboration = read("collaboration");
      const row = facts.collaboration;
      if (!collaboration.ok || !row) return dependencyFailed(collaboration, "缺少合作对象，无法确定正式阶段");
      const code = normalizeStage(String(row.stage_code || "").trim());
      if (!code || !BY_CODE[code]) return failed("context", code ? `未知的正式阶段 ${code}` : "当前合作没有正式阶段");
      const exception = sopExceptionByStage(code);
      facts.stage = {
        stage_code: code,
        stage_label: label(code),
        stage_version: Number(row.stage_version || 0),
        advancement_mode: BY_CODE[code]?.advancementMode || null,
        exception: Boolean(exception),
        exception_kind: exception?.kind || null,
      };
      return { ok: true, source: "object_fact" };
    },
    stage_tracks() {
      const stage = read("stage");
      if (!stage.ok || !facts.stage) return dependencyFailed(stage, "缺少正式阶段，无法列出阶段轨道");
      facts.stage_tracks = groupedStageTracks(facts.stage.stage_code);
      return { ok: true, source: "object_fact" };
    },
    mailbox() {
      read("collaboration");
      const requested = firstString(body.mailbox, body.mailbox_from, body.from);
      const sender = composeSenderFor({ collaboration: facts.collaboration, requested });
      if (!sender.send_from) {
        facts.mailbox = null;
        return requested
          ? failed("input", "指定的发件箱未通过品牌与范围核对，需要重新选择")
          : failed("context", "没有可用的授权发件箱");
      }
      facts.mailbox = sender;
      return { ok: true, source: MAILBOX_SOURCE[sender.source] };
    },
    mail_thread() {
      const collaboration = read("collaboration");
      if (!collaboration.ok || !facts.collaboration) return dependencyFailed(collaboration, "缺少合作对象，无法读取往来摘要");
      const thread = composeContextForCollaboration(String(facts.collaboration.id));
      facts.mail_thread = thread;
      if (!thread.text && !thread.mail_count) return failed("context", "该合作暂无往来邮件");
      return { ok: true, source: "memory" };
    },
    mail_template() {
      const stage = read("stage");
      if (skillId !== "email_compose") return failed("context", "邮件模板解析目前只登记了 email_compose（P2 按技能补齐）");
      if (!stage.ok || !facts.stage) return dependencyFailed(stage, "缺少正式阶段，无法匹配适用模板");
      const brand = String(facts.collaboration?.brand || "").trim();
      const knowledgeId = String(body.knowledge_id || "").trim() || null;
      const templates = resolveApplicableMailTemplates({ knowledgeId, skillId, stageCode: facts.stage.stage_code, brand });
      const choices = preparedTemplateChoice(templates, facts.stage.stage_code, brand);
      facts.mail_template = { templates, choices, template: choices.length === 1 ? choices[0] : null };
      if (!templates.length) return failed("context", "暂无已启用的适用模板");
      if (choices.length !== 1) {
        return failed("context", "有多个同等适用的模板，需要先选定其中一个", choices.map((template) => ({
          key: "mail_template",
          id: template.id,
          label: template.title,
        })));
      }
      return { ok: true, source: knowledgeId ? "explicit" : "object_fact" };
    },
    conversation() {
      const mailbox = currentMailbox();
      if (!mailbox) return failed("context", "当前账号没有已挂载的邮箱，无法解析邮件会话");
      const asked: Array<[string, ContextSource]> = [];
      const explicit = firstString(body.conversation_id, body.thread_id);
      if (explicit) asked.push([explicit, "explicit"]);
      for (const id of objectRefIds(body.object_refs, ["conversation", "thread", "mail_thread"])) asked.push([id, "object_refs"]);
      const fromText = firstString(entities().conversationId);
      if (fromText) asked.push([fromText, "text"]);
      if (!asked.length) return failed("input", "没有给定邮件会话，请从收件箱或会话卡片里选一个");
      const found = new Map<string, ContextSource>();
      for (const [id, source] of asked) {
        const thread = findMailThread(id, mailbox);
        if (thread && !found.has(String(thread.id))) found.set(String(thread.id), source);
      }
      if (!found.size) return failed("context", "当前邮箱下没有这条会话");
      if (found.size > 1) {
        return failed("context", "匹配到多条邮件会话，需要先选定其中一个",
          [...found.keys()].map((id) => ({ key: "conversation", id, label: id })));
      }
      const [id, source] = [...found.entries()][0];
      const thread = findMailThread(id, mailbox);
      facts.conversation = thread ? conversationRowOf(thread) as unknown as Json : null;
      return { ok: true, source };
    },
    message() {
      // TODO(P2.3)：当前邮件（kol_mail_items）的来源链还没登记，先如实报未解析，不猜。
      return failed("context", "当前邮件的解析器尚未登记（P2.3 接通当前会话/当前邮件）");
    },
    creator_filter() {
      // TODO(P2.4)：达人库筛选态与字典来源还没登记，先如实报未解析，不猜。
      return failed("context", "达人库筛选口径的解析器尚未登记（P2.4 接通字典与当前筛选）");
    },
    risk_scope() {
      read("collaboration");
      const scope = brandScope();
      const requested = Array.isArray(body.brands) ? body.brands.map((value) => String(value || "").trim()).filter(Boolean) : [];
      if (scope && requested.some((brand) => !scope.includes(brand))) return failed("blocked", "所选品牌超出当前账号范围");
      facts.risk_scope = {
        brand_scope: scope === null ? "all" : "scoped",
        brands: requested.length ? requested : scope,
        collaboration_id: facts.collaboration ? String(facts.collaboration.id) : null,
      };
      return { ok: true, source: requested.length ? "explicit" : "account_binding" };
    },
  };

  function read(key: TaskContextKey): KeyResult {
    const hit = memo.get(key);
    if (hit) return hit;
    if (resolving.has(key)) return failed("context", `上下文键 ${key} 互相依赖，无法解析`);
    resolving.add(key);
    let result: KeyResult;
    try {
      result = resolvers[key]();
    } finally {
      resolving.delete(key);
    }
    memo.set(key, result);
    return result;
  }

  function resolution(
    requires = input.requires ?? taskDefinition(skillId)?.context?.requires ?? [],
    prefers = input.prefers ?? taskDefinition(skillId)?.context?.prefers ?? [],
  ): ContextResolution {
    const declared = [...new Set([...requires, ...prefers])];
    const wanted = new Set<TaskContextKey>(declared);
    for (const key of declared) for (const dependency of KEY_DEPENDS[key] || []) wanted.add(dependency);
    for (const key of KEY_ORDER) if (wanted.has(key)) read(key);

    const resolved: Record<string, unknown> = {};
    const sources: Record<string, string> = {};
    const missing: ContextMissing[] = [];
    const candidates: ContextCandidate[] = [];
    const seen = new Set<string>();
    let blocked = false;
    let needsContext = false;
    let needsInput = false;
    for (const key of declared) {
      const tier = requires.includes(key) ? "requires" : "prefers";
      const result = read(key);
      if (result.ok) {
        const value = PUBLIC_VALUE[key](facts);
        if (value === null || value === undefined) {
          missing.push({ key, tier, reason: "解析结果为空" });
          if (tier === "requires") needsContext = true;
          continue;
        }
        resolved[key] = value;
        sources[key] = result.source;
        continue;
      }
      missing.push({ key, tier, reason: result.reason });
      for (const candidate of result.candidates || []) {
        const id = `${candidate.key}\u0000${candidate.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push(candidate);
      }
      if (tier !== "requires") continue;
      if (result.gap === "blocked") blocked = true;
      else if (result.gap === "input") needsInput = true;
      else needsContext = true;
    }
    const status: ContextStatus = blocked ? "blocked" : needsContext ? "needs_context" : needsInput ? "needs_input" : "ready";
    // 版本只认内容：声明顺序变化不算上下文变化，否则旧确认会无谓失效。
    const versioned = Object.fromEntries(Object.entries(resolved).sort(([left], [right]) => left.localeCompare(right)));
    return {
      status,
      skill_id: skillId,
      resolved,
      sources,
      missing,
      candidates,
      context_version: contextVersion({ skill_id: skillId, resolved: versioned, candidates }),
    };
  }

  return {
    skillId,
    collaboration: () => {
      read("collaboration");
      return pick || { row: null, source: null, conflict: false, ambiguous: false, candidates: [], reason: "" };
    },
    stage: () => {
      read("stage");
      return facts.stage;
    },
    stageTracks: () => {
      read("stage_tracks");
      return facts.stage_tracks;
    },
    mailbox: () => {
      read("mailbox");
      return facts.mailbox;
    },
    mailThread: () => {
      read("mail_thread");
      return facts.mail_thread;
    },
    mailTemplate: () => {
      read("mail_template");
      return facts.mail_template;
    },
    creator: () => {
      read("creator");
      return facts.creator;
    },
    resolution,
  };
}

/** 统一入口：按声明解析并返回信封（`context.resolve` 的回答体）。 */
export function resolveContext(input: ContextResolveInput): ContextResolution {
  return openContext(input).resolution(input.requires, input.prefers);
}
