/**
 * Turn session items produced by the worker (stub or Codex completion).
 * Host only maps these items to UI. Dispatch must not call Starry / SOP / stage shortcuts.
 */
import { scopedUser } from "../auth.js";
import { executeKolClawTask, isKolClawTask, kolClawResultCard, type KolClawTask } from "../kolclaw/service.js";
import { eightPhaseWalkItems, exceptionFlowItems, isExceptionStage, phaseSopSummary, profileForDomain, sopPackBySkill, sopPackByStage, stageSopView } from "../sops.js";
import { label } from "../stages.js";
import {
  composePayloadFromItem,
  emailMcpResultCard,
  executeEmailMcpTask,
  isEmailMcpTask,
  isStarryKolReadTask,
  resolveComposeSubject,
  type EmailMcpTask,
} from "../starrykol/service.js";
import { analyzeCreatorProfile } from "../starrykol/profile-briefing.js";
import { stubInternalZh } from "../starrykol/translate-zh.js";
import { extractTaskEntities } from "../tasks/resolver.js";
import type { Json } from "../types.js";
import { compileMailDraft } from "../host/knowledge.js";
import type { WorkerProgress } from "./progress.js";
import { firstEmail } from "../host/mail-to.js";
import { mailHistoryRows, mailMemoryLines } from "../host/mail-summary.js";
import { codexMode } from "../config.js";
import { CodexUnavailable } from "./errors.js";
import { extractNestedCreateDrafts } from "./parse.js";
import {
  attachComposeLoopCard,
  composeFactsFromContext,
  composePromptFromEntities,
  draftFieldsFromFacts,
  pickComposeTemplate,
  seedComposeDraft,
  stageMailAction,
  composeRouteFacts,
  type ComposeFacts,
} from "../host/compose-loop.js";
import { ensureQuoteInBody, ensureQuoteInZh } from "../host/quote-amount.js";

export async function collectStarryKolItems(input: {
  task: EmailMcpTask;
  raw: string;
  entities?: Json;
  handle?: string;
  creator_id?: unknown;
  prior?: Json;
  actor?: string;
  onOperation?: (operation: { name: string; label: string; status: string }) => void;
}): Promise<{ items: Json[]; operations: Json[] }> {
  const extracted = extractTaskEntities(input.raw || "");
  const prior = input.prior && typeof input.prior === "object" ? { ...input.prior } : {};
  const entities = input.entities && typeof input.entities === "object" ? { ...input.entities } : {};
  const subject = resolveComposeSubject({
    raw: input.raw || "",
    prior,
    extracted,
    entities,
  });
  if (subject) {
    prior.subject = subject;
    extracted.subject = subject;
    entities.subject = subject;
  } else {
    delete prior.subject;
    delete extracted.subject;
    delete entities.subject;
  }
  const facts = factsFromEntities(input.raw || "", {
    ...entities,
    mail_digest: entities.mail_digest || input.prior?.mail_digest || "",
    rate_unit: entities.rate_unit,
  });
  const previewPrompt = composePromptFromEntities({
    ...entities,
    prompt: extracted.another_letter
      ? (input.raw || "写一封简短的跟进邮件，先不要发送。")
      : (entities.prompt || input.raw),
    mail_digest: facts.digest || entities.mail_digest,
    amount_usd: facts.amount_usd,
    rate_unit: facts.rate_unit,
    stage_code: facts.quote ? (entities.stage_code || entities.stage) : entities.stage_code,
  }, "写一封简短的合作沟通邮件，先不要发送。");
  let { data: rawData, operations } = await executeEmailMcpTask(
    input.task,
    {
      ...prior,
      ...extracted,
      ...(input.handle ? { handle: input.handle } : {}),
      ...(input.creator_id ? { creator_id: input.creator_id } : {}),
      ...entities,
      prompt: previewPrompt,
      mail_digest: facts.digest || entities.mail_digest,
      amount_usd: facts.amount_usd,
      rate_unit: facts.rate_unit,
      ...(subject ? { subject } : {}),
    },
    input.actor || scopedUser()?.id || "demo",
    input.onOperation,
  );
  if (input.task === "creator_profile" && !rawData.needs_input) {
    const analyzed = await analyzeCreatorProfile(rawData);
    rawData = {
      ...rawData,
      briefing: analyzed.briefing,
      highlights: analyzed.highlights,
      briefing_summary: analyzed.summary,
      briefing_source: analyzed.briefing_source,
      recommended_actions: analyzed.recommended_actions,
    };
  }
  const mailbox = firstEmail(rawData.mailboxEmail || rawData.from || prior.mailboxEmail || entities.mailboxEmail || entities.from);
  const recipient = firstEmail(rawData.to || rawData.recipient || prior.to || entities.to || entities.email || entities.recipient);
  const knowledgeDraft = draftFromMailTemplate(entities, facts, {
    mailbox,
    recipient,
    handle: String(rawData.handle || input.handle || ""),
    stage: String(entities.stage_code || entities.stage || ""),
  });
  let data: Json = {
    ...rawData,
    ...(mailbox ? { mailboxEmail: mailbox, from: mailbox } : {}),
    ...(recipient ? { to: Array.isArray(rawData.to) && rawData.to.length ? rawData.to : [recipient], recipient } : {}),
    ...(knowledgeDraft ? { subject: knowledgeDraft.subject, body: knowledgeDraft.body, bodyText: knowledgeDraft.body } : {}),
  };
  if (input.task === "email_compose" && (facts.quote || facts.amount_usd != null)) {
    const rawBody = String(data.body || data.bodyText || data.preview || "");
    const body = ensureQuoteInBody(rawBody, {
      amount_usd: facts.amount_usd ?? null,
      currency: facts.currency || "USD",
      deliverables: facts.deliverables || (facts.rate_unit === "hour" ? "1 hour" : null),
    });
    if (body) {
      data = { ...data, body, bodyText: body, preview: data.preview ? body : data.preview };
    }
  }
  const card = input.task === "email_compose"
    ? attachComposeLoopCard(emailMcpResultCard(input.task, data), facts, {
      ...data,
      handle: String(data.handle || input.handle || ""),
    })
    : emailMcpResultCard(input.task, data);
  const items: Json[] = [{
    ...card,
    type: "task_result",
    operations,
  }];
  const fromAddr = firstEmail(data.mailboxEmail || data.from || input.entities?.mailboxEmail);
  const toAddr = firstEmail(data.to || data.recipient || input.entities?.to || input.entities?.email);
  const draftSubject = String(data.subject || subject || input.entities?.subject || "");
  if (input.task === "email_compose" && !data.sent && fromAddr && toAddr && draftSubject) {
    const tpl = knowledgeDraft
      ? { id: String(knowledgeDraft.template_id) }
      : pickComposeTemplate("email_compose", String(entities.stage_code || entities.stage || ""), input.raw || "", facts.amount_usd);
    const body = String(knowledgeDraft?.body || data.body || data.bodyText || data.preview || "");
    items.unshift({
      type: "create_draft",
      skill: "email_compose",
      template_id: tpl.id,
      from: fromAddr,
      to: toAddr,
      subject: String(knowledgeDraft?.subject || draftSubject),
      body,
      body_zh_internal: body
        ? ensureQuoteInZh(stubInternalZh(body), {
          amount_usd: facts.amount_usd ?? null,
          currency: facts.currency || "USD",
          deliverables: facts.deliverables || (facts.rate_unit === "hour" ? "1 hour" : null),
        })
        : "",
      keep_stage: true,
      official_stage: data.current_stage || entities.stage_code || null,
      ...(knowledgeDraft ? { knowledge_id: knowledgeDraft.knowledge_id, knowledge_version: knowledgeDraft.knowledge_version } : {}),
      ...draftFieldsFromFacts(facts, data),
    });
  }
  if (input.task === "reply_analysis" && data.pointer && !data.exception) {
    items.push({
      type: "propose_stage",
      proposed_stage: data.pointer,
      reason: String(data.summary_zh || card.summary || "来信事实支持推进指针"),
      evidence: { source: "reply_analysis", completed: data.completed, pointer: data.pointer },
    });
  }
  return { items, operations };
}

function draftFromMailTemplate(
  entities: Json,
  facts: ComposeFacts,
  ctx: { mailbox: string; recipient: string; handle: string; stage: string },
): { subject: string; body: string; template_id: string; knowledge_id: string; knowledge_version: number } | null {
  const mt = entities.mail_template && typeof entities.mail_template === "object"
    ? entities.mail_template as Json
    : null;
  if (!mt?.id) return null;
  const compiled = compileMailDraft({
    id: String(mt.id),
    version: Number(mt.version || 1),
    kind: "mail_template",
    skill_id: String(mt.skill_id || "email_compose"),
    brand: "*",
    subject: String(mt.subject || ""),
    body_en: String(mt.body_en || ""),
    body: String(mt.body_en || ""),
    placeholders: Array.isArray(mt.placeholders) ? mt.placeholders.map(String) : [],
    stage_codes: Array.isArray(mt.stage_codes) ? mt.stage_codes.map(String) : [],
    title: String(mt.title || ""),
    template_id: String(mt.template_id || ""),
  }, {
    handle: ctx.handle,
    amount: facts.amount_usd != null ? String(facts.amount_usd) : "",
    tracking: String(facts.tracking || ""),
    carrier: String(facts.carrier || ""),
    eta: "",
    mailboxEmail: ctx.mailbox,
    to: ctx.recipient,
    subject: String(mt.subject || ""),
  });
  return {
    subject: compiled.subject,
    body: compiled.body,
    template_id: String(mt.template_id || ""),
    knowledge_id: String(mt.id),
    knowledge_version: Number(mt.version || 1),
  };
}

function factsFromEntities(raw: string, entities: Json): ComposeFacts {
  const stored = entities.compose_facts;
  if (stored && typeof stored === "object" && String((stored as Json).kind || "")) {
    return stored as ComposeFacts;
  }
  return composeFactsFromContext({
    stage: String(entities.stage_code || entities.stage || ""),
    raw,
    amount_usd: entities.amount_usd != null ? Number(entities.amount_usd) : null,
    currency: entities.currency ? String(entities.currency) : null,
    rate_unit: entities.rate_unit === "hour" ? "hour" : null,
    deliverables: entities.deliverables ? String(entities.deliverables) : null,
    tracking: entities.tracking ? String(entities.tracking) : null,
    carrier: entities.carrier ? String(entities.carrier) : null,
    name: String(entities.recipient_name || entities.name || ""),
    phone: String(entities.phone || ""),
    address: String(entities.address_line || entities.address || ""),
    country: String(entities.country || ""),
    postal: String(entities.postal || ""),
    sku: String(entities.sku || ""),
    qty: String(entities.qty || ""),
    digest: String(entities.mail_digest || ""),
    style_tags: Array.isArray(entities.follow_style_tags) ? entities.follow_style_tags as ComposeFacts["style_tags"] : undefined,
  });
}

function sopRecommendedActions(stageCode: string, handle = ""): string[] {
  if (isExceptionStage(stageCode)) {
    return handle
      ? [`风险扫描 @${handle}`, `记状态 @${handle}`]
      : ["风险扫描", "提出阶段变更"];
  }
  const mail = stageMailAction(handle, stageCode);
  if (handle) return [mail.prompt, `记状态 @${handle}`];
  return [mail.prompt, "提出阶段变更", "阶段SOP"];
}

function sopTrackItems(stageCode: string) {
  return stageSopView(stageCode).track.map((phase) => (
    `${phase.current ? "▶ " : ""}${phase.label}：${phase.official_labels.join(" / ")}`
  ));
}

export function collectSopItems(skill: string): Json[] {
  const pack = sopPackBySkill(skill);
  if (!pack) {
    return [{
      type: "task_result",
      skill,
      title: "SOP 缺失",
      summary: `未找到 SOP ${skill}。`,
    }];
  }
  return [{
    type: "task_result",
    skill: pack.skill_id,
    profile: profileForDomain(pack.domain),
    title: pack.stage_label,
    summary: `${pack.stage_label} · ${pack.version}`,
    sections: [
      { title: "八个阶段", items: sopTrackItems(pack.stage_code) },
      { title: "输入", items: pack.inputs },
      { title: "证据", items: pack.evidence },
      { title: "完成条件", items: pack.completion },
      {
        title: "当前步骤",
        body: pack.next_action,
        items: [
          `推进方式：${pack.advancement_mode}`,
          `下一步正式阶段：${pack.next_stage ? label(pack.next_stage) : "终态"}`,
          "本卡片只展示 SOP，不发送、不修改阶段",
        ],
      },
      { title: "异常流程", items: exceptionFlowItems() },
    ],
    recommended_actions: sopRecommendedActions(pack.stage_code),
    sop_id: pack.sop_id,
    version: pack.version,
    stage: pack.stage_code,
    domain: pack.domain,
    advancement_mode: pack.advancement_mode,
    current_step: pack.next_action,
    next_step: pack.next_stage,
    phases: stageSopView(pack.stage_code).track,
  }];
}

export function collectStageSopItems(stageCode: string, handle = ""): Json[] {
  const view = stageSopView(stageCode || "INITIAL_CONTACT");
  const pack = sopPackByStage(view.stage_code);
  const who = handle ? `@${handle} · ` : "";
  return [{
    type: "task_result",
    skill: "stage_sop",
    profile: pack ? profileForDomain(pack.domain) : "lead",
    title: `${who}${view.exception ? "八阶段异常 SOP" : "八个阶段 SOP"}`,
    summary: `${view.phase_label || "阶段"} · ${view.stage_label} · ${view.version}`,
    sections: [
      { title: "八个阶段", items: sopTrackItems(view.stage_code) },
      {
        title: "当前正式阶段",
        items: [
          view.stage_label,
          view.exception ? "已离开主流程，按异常旁路处理" : (view.phase_label ? `展示阶段：${view.phase_label}` : "展示阶段未对齐"),
          `推进方式：${view.advancement_mode || "—"}`,
        ],
      },
      { title: "输入", items: view.inputs },
      { title: "证据", items: view.evidence },
      { title: "完成条件", items: view.completion },
      {
        title: "当前步骤",
        body: view.next_action,
        items: [
          view.exception
            ? (view.exception_kind === "bypass" ? "可回主流程，必须指定具体正式阶段" : "终态，不可回主流程")
            : `建议下一步正式阶段：${view.next_stage_label || "终态"}，由你选定后才写入`,
          "发送邮件不会修改阶段",
        ],
      },
      {
        title: "各阶段 SOP",
        items: phaseSopSummary().map((phase) => (
          `${phase.label}：${phase.official_labels.join(" / ")} → ${phase.next_action || "查看本阶段 SOP"}`
        )),
      },
      { title: "八段怎么走", items: eightPhaseWalkItems() },
      { title: "异常流程", items: view.exception_flow },
      {
        title: "边界",
        items: ["本卡片只展示 SOP，不发送、不修改阶段", "来信分析只出建议，由你选定具体正式阶段后才写入"],
      },
    ],
    recommended_actions: sopRecommendedActions(view.stage_code, handle),
    sop_id: pack?.sop_id || view.stage_code || "STAGE_SOP",
    version: view.version,
    stage: view.stage_code,
    domain: pack?.domain || null,
    advancement_mode: view.advancement_mode,
    current_step: view.next_action,
    next_step: view.next_stage,
    phases: view.track,
  }];
}

export function collectDealMemoryItems(col: Json, handle: string): Json[] {
  const notes = String(col.notes || "").trim();
  const noteItems = notes
    ? notes.split(/[；;。\n]/).map((part) => part.trim()).filter(Boolean).slice(0, 4)
    : [];
  const mailItems = mailMemoryLines(mailHistoryRows(String(col.id || "")));
  return [{
    type: "task_result",
    skill: "deal_memory",
    profile: "negotiation",
    title: "Deal Memory",
    summary: handle ? `已整理 @${handle} 的往来正文与谈判事实。` : "未指定红人，已按会话上下文整理谈判纪要。",
    sections: [
      { title: "往来摘要", body: mailItems.join("\n") || "无往来正文。", items: mailItems.length ? mailItems : ["当前没有往来正文摘要"] },
      { title: "谈判事实", body: notes || "无已落库备注。", items: noteItems.length ? noteItems : ["当前没有写入红人画像的备注"] },
      { title: "待确认", items: ["阶段变更需人确认", "发送邮件不会修改阶段"] },
    ],
    recommended_actions: sopRecommendedActions(String(col.stage_code || ""), handle),
  }];
}

export async function collectKolClawItems(input: {
  task: KolClawTask;
  raw: string;
  entities?: Json;
  actor?: string;
  onOperation?: (operation: { name: string; label: string; status: string }) => void;
}): Promise<{ items: Json[]; operations: Json[] }> {
  const { data, operations } = await executeKolClawTask(
    input.task,
    { ...extractTaskEntities(input.raw || ""), ...(input.entities || {}) },
    input.actor || scopedUser()?.id || "demo",
    input.onOperation,
  );
  return {
    items: [{ ...kolClawResultCard(input.task, data), type: "task_result", operations }],
    operations,
  };
}

function starryPayload(item: Json): Json | null {
  if (item.starrykol_data && typeof item.starrykol_data === "object") return item.starrykol_data as Json;
  if (item.emailmcp_data && typeof item.emailmcp_data === "object") return item.emailmcp_data as Json;
  return null;
}

function hasStarryResult(items: Json[]): boolean {
  return items.some((item) => starryPayload(item));
}

/** Codex `approvalPolicy: never` rejects first remote Starry KOL reads; those cards are not usable data. */
export function starryReadBlockedByApproval(data: Json | null): boolean {
  if (!data) return false;
  const blob = JSON.stringify(data);
  return /approval_policy\s*=\s*never|禁止审批|needs?[_ ]?approval|requires? approval|forbids? approval|approvalPolicy/i.test(blob);
}

export function hasUsableStarryReadResult(items: Json[]): boolean {
  return items.some((item) => {
    const data = starryPayload(item);
    if (!data || starryReadBlockedByApproval(data)) return false;
    return true;
  });
}

function existingBlockedByApproval(items: Json[]): boolean {
  return items.some((item) => starryReadBlockedByApproval(starryPayload(item)) || starryReadBlockedByApproval(item));
}

const READ_RESULT_TYPES = new Set(["task_result", "text", "note", "propose_stage", "list_overdue"]);

/** Analysis / list skills may finish without a Starry payload or sendable draft. */
function hasReadSkillOutput(items: Json[]): boolean {
  return items.some((item) => {
    if (READ_RESULT_TYPES.has(String(item.type || ""))) return true;
    return Boolean(String(item.title || "").trim() && String(item.summary || item.body || item.text || "").trim());
  });
}

function readSkillTitle(skill: string): string {
  if (skill === "reply_analysis") return "回复分析";
  if (skill === "creator_profile") return "达人画像";
  if (skill === "risk_scan") return "超时/风险扫描";
  return "任务结果";
}

function surfaceReadSkillItems(skill: string, items: Json[]): Json[] {
  if (items.some((item) => item.type === "task_result")) return items;
  const texts = items.filter((item) => item.type === "text" || item.type === "note");
  const summary = texts
    .map((item) => String(item.text || item.body || item.summary || "").trim())
    .filter(Boolean)
    .join("\n");
  const propose = items.find((item) => item.type === "propose_stage");
  const overdue = items.find((item) => item.type === "list_overdue");
  const body = summary
    || String(propose?.reason || propose?.summary || "").trim()
    || (Array.isArray(overdue?.items) ? `已列出 ${(overdue.items as Json[]).length} 条逾期。` : "");
  if (!body) return items;
  return [
    {
      type: "task_result",
      skill,
      title: readSkillTitle(skill),
      summary: body,
      sections: [{ title: "分析结果", body, items: [] }],
      metrics: [],
      recommended_actions: [],
    },
    ...items,
  ];
}

function composeDraftFromStarry(skill: EmailMcpTask, items: Json[]): Json | null {
  if (skill !== "email_compose" || items.some((item) => item.type === "create_draft")) return null;
  const data = items.map(starryPayload).find((payload) => {
    if (!payload || payload.sent) return false;
    return Boolean(
      firstEmail(payload.mailboxEmail || payload.from)
      && firstEmail(payload.to || payload.recipient)
      && String(payload.subject || "").trim(),
    );
  });
  if (!data) return null;
  const fromAddr = firstEmail(data.mailboxEmail || data.from);
  const toAddr = firstEmail(data.to || data.recipient);
  const subject = String(data.subject || "");
  const stage = data.current_stage ? String(data.current_stage) : null;
  const body = String(data.body || data.bodyText || data.preview || "");
  const brand = String(data.brandCode || data.brand || "").trim() || undefined;
  return {
    type: "create_draft",
    skill: "email_compose",
    from: fromAddr,
    to: toAddr,
    subject,
    body,
    body_zh_internal: body
      ? ensureQuoteInZh(stubInternalZh(body), {
        amount_usd: data.amount_usd != null ? Number(data.amount_usd) : null,
        currency: data.currency ? String(data.currency) : "USD",
        deliverables: data.deliverables ? String(data.deliverables) : (data.rate_unit === "hour" ? "1 hour" : null),
      })
      : "",
    keep_stage: true,
    official_stage: stage,
    amount_usd: data.amount_usd ?? null,
    currency: data.currency || null,
    ...(data.template_id ? { template_id: data.template_id } : {}),
    ...(data.body_zh_internal ? { body_zh_internal: data.body_zh_internal } : {}),
    ...(brand ? { brand } : {}),
  };
}

function isComposeResultItem(item: Json): boolean {
  if (item.type !== "task_result") return false;
  if (item.skill === "email_compose") return true;
  const title = String(item.title || "");
  if (title === "邮件草稿" || title === "邮件已发送" || title === "报价邮件草稿" || title === "报价草稿") return true;
  const sections = Array.isArray(item.sections) ? item.sections as Json[] : [];
  if (sections.some((section) => /收发说明|摘要数据|预览正文|已发正文|create_draft/.test(String(section.title || section.heading || "")))) {
    return true;
  }
  if (extractNestedCreateDrafts(item).length) return true;
  const actions = Array.isArray(item.recommended_actions) ? item.recommended_actions.map(String).join(" ") : "";
  return /确认发送|补全发件|发件邮箱/.test(actions);
}

function contextComposeDraft(extra: Json): Json | null {
  const route = composeRouteFacts({ extra });
  const entities = extra.entities && typeof extra.entities === "object" ? extra.entities as Json : {};
  const subject = String(entities.subject || extra.subject || "").trim();
  if (!route.from && !route.to && !subject) return null;
  return { type: "create_draft", from: route.from, to: route.to, subject };
}

function rebuildStarryCards(skill: EmailMcpTask, items: Json[], extra: Json = {}): Json[] {
  const fallback = contextComposeDraft(extra);
  const siblings = fallback ? [...items, fallback] : items;
  const rebuilt = items.map((item) => {
    if (item.type !== "task_result") return item;
    if (skill === "email_compose") {
      if (!isComposeResultItem(item) && !starryPayload(item)) return item;
      const data = composePayloadFromItem(item, siblings, composeRouteFacts({ extra }));
      return {
        ...emailMcpResultCard(skill, data),
        type: "task_result",
        ...(Array.isArray(item.operations) ? { operations: item.operations } : {}),
      };
    }
    const data = starryPayload(item);
    if (!data) return item;
    return {
      ...emailMcpResultCard(skill, data),
      type: "task_result",
      ...(Array.isArray(item.operations) ? { operations: item.operations } : {}),
    };
  });
  const draft = composeDraftFromStarry(skill, rebuilt);
  const withDraft = draft ? [draft, ...rebuilt] : rebuilt;
  if (skill === "email_compose" && withDraft.some((item) => item.type === "create_draft") && !withDraft.some(isComposeResultItem)) {
    const data = composePayloadFromItem({ type: "task_result", title: "邮件草稿" }, withDraft);
    return [
      ...withDraft.filter((item) => item.type === "create_draft"),
      { ...emailMcpResultCard(skill, data), type: "task_result" },
      ...withDraft.filter((item) => item.type !== "create_draft"),
    ];
  }
  return withDraft;
}

export async function completeTurnItems(
  skill: string,
  extra: Json,
  existing: Json[],
  log: Json[],
  onProgress?: (progress: WorkerProgress) => void,
): Promise<Json[]> {
  const raw = String(extra.raw || extra.text || extra.prompt || "");
  const entities = extra.entities && typeof extra.entities === "object" ? extra.entities as Json : {};
  const handle = String(extra.handle || "");
  const onOperation = (operation: { name: string; label: string; status: string }) => {
    onProgress?.({
      phase: "reading_data",
      operation: {
        name: operation.name,
        label: operation.label,
        status: operation.status,
      },
    });
  };
  if (extra.compose_preview_only && skill === "email_compose") {
    const generated = existing.find((item) => item.type === "create_draft" && String(item.body || "").trim());
    if (!generated && codexMode() !== "stub") {
      throw new CodexUnavailable("本轮没有生成邮件草稿，Host 未代填。", "请使用当前授权能力重新运行。");
    }
    const facts = factsFromEntities(raw, {
      ...entities,
      mail_digest: extra.mail_digest || entities.mail_digest,
      amount_usd: extra.amount_usd ?? entities.amount_usd,
      rate_unit: extra.rate_unit || entities.rate_unit,
      stage_code: extra.stage_code || extra.stage || entities.stage_code,
    });
    const seeded = seedComposeDraft(facts, raw, String(extra.stage_code || extra.stage || entities.stage_code || ""));
    const draft = generated && String(generated.body || "").trim()
      ? generated
      : {
        type: "create_draft",
        skill: "email_compose",
        template_id: pickComposeTemplate("email_compose", String(entities.stage_code || extra.stage_code || ""), raw, facts.amount_usd).id,
        subject: seeded.subject,
        body: seeded.body,
        keep_stage: true,
        ...draftFieldsFromFacts(facts),
      };
    log.push({ method: "compose/preview", params: { source: generated ? "codex" : "seed" } });
    return [draft];
  }
  if (isEmailMcpTask(skill) && skill === "email_compose" && (
    existing.some(isComposeResultItem) || existing.some((item) => item.type === "create_draft")
  )) {
    return rebuildStarryCards(skill, existing, extra);
  }
  if (isEmailMcpTask(skill) && !hasUsableStarryReadResult(existing)) {
    const hostReadFallback = isStarryKolReadTask(skill);
    if (skill !== "email_compose" && hasReadSkillOutput(existing) && !existingBlockedByApproval(existing)) {
      return surfaceReadSkillItems(skill, existing);
    }
    if (codexMode() !== "stub") {
      throw new CodexUnavailable(
        skill === "email_compose"
          ? "生成已结束，但没有产出可映射的邮件草稿。Host 没有代填。"
          : "生成已结束，但没有产出可映射的任务结果。Host 没有代填。",
        skill === "email_compose"
          ? "请重试；若仍失败，请管理员查看该次运行记录（是否调用了预览草稿 / Starry KOL MCP）。"
          : "请重试；若仍失败，请管理员查看该次运行记录（Skill 是否产出了分析结果）。",
      );
    }
    const generated = existing.find((item) => item.type === "create_draft");
    const givenBody = String(entities.body || extra.body || generated?.body || "").trim();
    const givenSubject = String(entities.subject || extra.subject || generated?.subject || "").trim();
    const { items, operations } = await collectStarryKolItems({
      task: skill,
      raw,
      entities: {
        ...entities,
        mail_digest: extra.mail_digest || entities.mail_digest,
        amount_usd: extra.amount_usd ?? entities.amount_usd,
        rate_unit: extra.rate_unit || entities.rate_unit,
        stage_code: extra.stage_code || extra.stage || entities.stage_code,
        stage: extra.stage_code || extra.stage || entities.stage,
        tracking: extra.tracking || entities.tracking,
        carrier: extra.carrier || entities.carrier,
        deliverables: extra.deliverables || entities.deliverables,
        currency: extra.currency || entities.currency,
        text: raw,
        ...(givenBody ? { body: givenBody } : {}),
        ...(givenSubject ? { subject: givenSubject } : {}),
        ...(extra.mail_template ? { mail_template: extra.mail_template, knowledge_id: extra.knowledge_id, knowledge_version: extra.knowledge_version } : {}),
      },
      handle,
      creator_id: extra.creator_id,
      prior: {
        ...(extra.prior_compose && typeof extra.prior_compose === "object" ? extra.prior_compose as Json : {}),
        mail_digest: extra.mail_digest,
      },
      onOperation,
    });
    log.push({
      method: "mcp/starrykol",
      params: {
        task: skill,
        operations: operations.length,
        source: hostReadFallback && codexMode() !== "stub" ? "host_read" : "stub",
      },
    });
    return items;
  }
  if (isEmailMcpTask(skill) && hasStarryResult(existing)) {
    return rebuildStarryCards(skill, existing, extra);
  }
  if (isKolClawTask(skill) && !existing.some((item) => item.skill === skill && item.type === "task_result")) {
    if (codexMode() !== "stub") {
      throw new CodexUnavailable(
        "生成已结束，但没有产出本 Skill 的 Claw 结果。Host 没有代填。",
        "请重试；若仍失败，请管理员查看该次运行记录（Skill mcp 与远程 KOL Claw）。",
      );
    }
    const { items, operations } = await collectKolClawItems({ task: skill, raw, entities, onOperation });
    log.push({ method: "mcp/kolclaw", params: { task: skill, operations: operations.length } });
    return items;
  }
  return existing;
}
