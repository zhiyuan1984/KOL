/**
 * KOL mail communication: one thread, the letter of the current official stage.
 * Digest as context → this-stage facts + preview + draft → human confirm send →
 * ingest outbound and refresh the thread digest. Quote is the 报价待确认 letter,
 * not a special loop that other stages copy.
 */
import { nowIso } from "../db.js";
import { pickTemplateForSkill, templateById, EMAIL_TEMPLATES, type EmailTemplate } from "../email-templates.js";
import { firstEmail } from "./mail-to.js";
import {
  mailHistoryRows,
  mailMemoryLines,
  readThreadDigest,
  threadDigestOf,
  type ThreadDigest,
} from "./mail-summary.js";
import { followStylePromptLine, readFollowStyleTags, type FollowStyleTag } from "../follow-style-tags.js";
import { normalizeStage } from "../stages.js";
import type { Json, Row } from "../types.js";
import { extractTaskEntities } from "../tasks/resolver.js";
import { formatQuoteRate } from "./quote-amount.js";
import {
  composeGapHint,
  requestedMailKind,
  stageMailSpec,
  stageMailSpecByKind,
  type StageMailKind,
} from "../skills/email-compose-contract.js";

export {
  composeGapHint,
  isNamedMailCommand,
  isQuoteCompose,
  requestedMailKind,
  stageMailAction,
  stageMailSpec,
} from "../skills/email-compose-contract.js";
export type { ComposeGap, StageMailKind, StageMailSpec } from "../skills/email-compose-contract.js";

export type ComposeFacts = {
  kind: StageMailKind;
  title: string;
  items: string[];
  quote: boolean;
  amount_usd?: number | null;
  currency?: string | null;
  rate_unit?: "hour" | null;
  deliverables?: string | null;
  tracking?: string | null;
  carrier?: string | null;
  digest?: string;
  style_tags?: FollowStyleTag[];
};

export function composeFactsFromContext(input: {
  stage?: string;
  raw?: string;
  amount_usd?: number | null;
  currency?: string | null;
  rate_unit?: "hour" | null;
  deliverables?: string | null;
  tracking?: string | null;
  carrier?: string | null;
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  postal?: string | null;
  sku?: string | null;
  qty?: string | null;
  digest?: string;
  style_tags?: FollowStyleTag[] | null;
}): ComposeFacts {
  const stage = normalizeStage(String(input.stage || ""));
  const amount = input.amount_usd != null && Number.isFinite(Number(input.amount_usd))
    ? Number(input.amount_usd)
    : null;
  const requested = requestedMailKind(input.raw || "");
  const spec = requested ? stageMailSpecByKind(requested, stage) : stageMailSpec(stage);
  const currency = String(input.currency || (amount != null ? "USD" : "") || "").trim()
    || (amount != null ? "USD" : null);
  const rateUnit = input.rate_unit || null;
  const deliverables = String(input.deliverables || "").trim() || null;
  const tracking = String(input.tracking || "").trim() || null;
  const carrier = String(input.carrier || "").trim() || null;
  const digest = String(input.digest || "").trim();
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  const address = String(input.address || "").trim();
  const country = String(input.country || "").trim();
  const postal = String(input.postal || "").trim();
  const sku = String(input.sku || "").trim();
  const qty = String(input.qty || "").trim();
  const items: string[] = [];
  if (amount != null) items.push(`金额：${formatQuoteRate(amount, currency || "USD", rateUnit)}`);
  else if (spec.kind === "quote") items.push("金额未写明，请在草稿里补上价格后再确认发送。");
  if (deliverables) items.push(`交付：${deliverables}`);
  if (spec.kind === "address") {
    if (name) items.push(`收件人：${name}`);
    if (phone) items.push(`电话：${phone}`);
    if (address) items.push(`地址：${address}`);
    if (country) items.push(`国家：${country}`);
    if (postal) items.push(`邮编：${postal}`);
    if (sku) items.push(`SKU：${sku}`);
    if (qty) items.push(`数量：${qty}`);
    if (!name || !phone || !address || !country || !postal || !sku || !qty) {
      items.push("寄样资料未齐，请在草稿里补全后再确认发送。");
    }
  }
  if (tracking) items.push(`运单号：${tracking}`);
  else if (spec.kind === "ship") items.push("运单号未写明，请补上后再确认发送。");
  if (carrier) items.push(`承运商：${carrier}`);
  const styleTags = Array.isArray(input.style_tags) ? input.style_tags : [];
  const styleLine = followStylePromptLine(styleTags);
  if (styleLine) items.push(styleLine);
  if (!items.length) items.push(spec.instruction);
  return {
    kind: spec.kind,
    title: spec.factTitle,
    items,
    quote: spec.kind === "quote",
    amount_usd: amount,
    currency,
    rate_unit: rateUnit,
    deliverables,
    tracking,
    carrier,
    digest: digest || undefined,
    style_tags: styleTags,
  };
}

export function composePreviewPrompt(raw: string, digest: string, facts: ComposeFacts, stage = ""): string {
  const instruction = stageMailSpecByKind(facts.kind, stage).instruction;
  const bits = [
    digest
      ? `历史往来摘要（必须当作上下文，不要编造与摘要冲突的事实）：\n${digest}`
      : "当前没有往来摘要，只根据运营口令和当前阶段写。",
    instruction,
    facts.amount_usd != null
      ? (facts.rate_unit === "hour"
        ? `金额 ${formatQuoteRate(facts.amount_usd, facts.currency || "USD", "hour")}。英文正文必须出现 “${formatQuoteRate(facts.amount_usd, facts.currency || "USD", "hour")}”。不要写成套餐总价，禁止改写成没有价格的建联信。`
        : `金额 ${formatQuoteRate(facts.amount_usd, facts.currency || "USD")}。英文正文必须写出该数字，禁止改写成没有价格的建联信。`)
      : (facts.quote ? "金额未写明。若运营口令里已有价格数字，必须写进英文正文，不要改写成建联信。" : ""),
    facts.deliverables ? `交付 ${facts.deliverables}。` : "",
    facts.tracking ? `运单号 ${facts.tracking}${facts.carrier ? ` · ${facts.carrier}` : ""}。` : "",
    followStylePromptLine(facts.style_tags || []),
    raw ? `运营口令：${raw}` : "",
    "生成预览草稿，先不要发送。发送不等于改阶段。",
  ].filter(Boolean);
  return bits.join("\n");
}

export function composePromptFromEntities(entities: Json, fallback: string): string {
  const raw = String(entities.prompt || entities.text || entities.raw || "").trim();
  const digest = String(entities.mail_digest || "").trim();
  const facts = composeFactsFromContext({
    stage: String(entities.stage_code || entities.stage || entities.official_stage || ""),
    raw,
    amount_usd: entities.amount_usd != null ? Number(entities.amount_usd) : null,
    currency: entities.currency ? String(entities.currency) : null,
    rate_unit: entities.rate_unit === "hour" ? "hour" : null,
    deliverables: entities.deliverables ? String(entities.deliverables) : null,
    tracking: entities.tracking ? String(entities.tracking) : null,
    carrier: entities.carrier ? String(entities.carrier) : null,
    digest,
    style_tags: Array.isArray(entities.follow_style_tags) ? entities.follow_style_tags as FollowStyleTag[] : undefined,
  });
  return composePreviewPrompt(raw || fallback, digest, facts, String(entities.stage_code || entities.stage || entities.official_stage || ""));
}

export function composeRouteFacts(input: {
  col?: { email?: unknown; mailbox_from?: unknown; stage_code?: unknown } | null;
  extra?: Json;
  boundMailbox?: string | null;
}): { mailboxEmail: string; from: string; to: string } {
  const extra = input.extra && typeof input.extra === "object" ? input.extra as Json : {};
  const entities = extra.entities && typeof extra.entities === "object" ? extra.entities as Json : {};
  const stage = String(entities.stage_code || extra.stage_code || extra.stage || input.col?.stage_code || "");
  const collabFrom = stage && stage !== "INITIAL_CONTACT" ? firstEmail(input.col?.mailbox_from) : "";
  const from = firstEmail(entities.mailboxEmail)
    || firstEmail(entities.from)
    || firstEmail(extra.mailboxEmail)
    || firstEmail(extra.from)
    || firstEmail(input.boundMailbox)
    || collabFrom;
  const to = firstEmail(entities.to)
    || firstEmail(entities.email)
    || firstEmail(entities.recipient)
    || firstEmail(extra.to)
    || firstEmail(input.col?.email);
  return { mailboxEmail: from, from, to };
}

export function pickComposeTemplate(skill: string, stageCode?: string | null, raw = "", _amount?: number | null): EmailTemplate {
  const requested = requestedMailKind(raw);
  const spec = requested ? stageMailSpecByKind(requested, stageCode || "") : stageMailSpec(stageCode || "");
  const named = templateById(spec.templateId);
  if (named) return named;
  const stage = stageCode ? normalizeStage(stageCode) : "";
  const byStage = EMAIL_TEMPLATES.filter((row) => stage && row.stages.includes(stage) && row.kind === "main");
  const hit = [...byStage].sort((a, b) => a.stages.length - b.stages.length)[0];
  return hit || pickTemplateForSkill(skill, stage);
}

export function composeContextForCollaboration(collaborationId: string | null | undefined): {
  digest: ThreadDigest | null;
  memory: string[];
  text: string;
} {
  if (!collaborationId) return { digest: null, memory: [], text: "" };
  const rows = mailHistoryRows(collaborationId);
  const digest = threadDigestOf(rows, readThreadDigest(collaborationId));
  return {
    digest,
    memory: mailMemoryLines(rows),
    text: digest.text || "",
  };
}

export function composeLoopSections(facts: ComposeFacts): Json[] {
  return [{ title: facts.title, items: facts.items.filter((item) => !item.startsWith("往来依据：")) }];
}

export function seedComposeDraft(facts: ComposeFacts, _raw = "", stage = ""): { subject: string; body: string } {
  const amount = facts.amount_usd ?? null;
  const currency = facts.currency || "USD";
  const rateUnit = facts.rate_unit;
  if (facts.quote || amount != null) {
    const rate = amount != null ? formatQuoteRate(amount, currency, rateUnit) : `${currency} ___ per hour`;
    const subject = amount != null ? `LiTime collaboration quote — ${rate}` : "LiTime collaboration quote";
    const rateLine = amount != null
      ? `Please find the LiTime collaboration quote at ${rate}. This is a quote, not a confirmed deal.`
      : "Please find the LiTime collaboration quote. Fill in the rate as USD ___ per hour. This is a quote, not a confirmed deal.";
    return {
      subject,
      body: `Hi,\n\n${rateLine}\n\nReply on this thread if this rate works.\n\nBest,\nLiTime Creator Desk\n`,
    };
  }
  const tpl = pickComposeTemplate("email_compose", stage, _raw);
  return { subject: tpl.subject, body: tpl.body_en };
}

export function previewComposeForCollaboration(col: Row | null, text: string, extra: Json = {}): {
  subject: string;
  body: string;
  amount_usd: number | null;
  currency: string | null;
  rate_unit: "hour" | null;
  prompt: string;
} {
  const digest = composeContextForCollaboration(col?.id ? String(col.id) : null).text;
  const extracted = extractTaskEntities(text);
  const facts = composeFactsFromRow(col, {
    ...extra,
    raw: text,
    text,
    amount_usd: extra.amount_usd ?? extracted.amount_usd,
    currency: extra.currency || extracted.currency,
    rate_unit: extra.rate_unit || extracted.rate_unit,
    tracking: extra.tracking || extracted.tracking,
    carrier: extra.carrier || extracted.carrier,
  }, digest);
  const seeded = seedComposeDraft(facts, text, String(col?.stage_code || extra.stage_code || ""));
  return {
    subject: seeded.subject,
    body: seeded.body,
    amount_usd: facts.amount_usd ?? null,
    currency: facts.currency || null,
    rate_unit: facts.rate_unit || null,
    prompt: composePreviewPrompt(text, digest, facts, String(col?.stage_code || extra.stage_code || "")),
  };
}

export async function rememberOutboundAndRefreshDigest(input: {
  collaborationId: string;
  sessionId: string;
  subject?: string;
  body?: string;
  from?: string;
  to?: string;
  conversationId?: string;
  providerMessageId?: string;
}): Promise<void> {
  const { ingestKolMail, refreshMailDigestAfterChange } = await import("./kol-journey.js");
  ingestKolMail(input.collaborationId, {
    subject: String(input.subject || ""),
    body: String(input.body || ""),
    from: firstEmail(input.from),
    to: firstEmail(input.to),
    mailbox: firstEmail(input.from),
    occurred_at: nowIso(),
    direction: "outbound",
    conversation_id: String(input.conversationId || ""),
    session_id: input.sessionId,
    provider_message_id: String(input.providerMessageId || ""),
  });
  await refreshMailDigestAfterChange(input.collaborationId, input.sessionId, { retryFailed: true });
}

function summaryForFacts(facts: ComposeFacts, fallback: string): string {
  if (facts.kind === "quote") {
    return facts.amount_usd != null
      ? `报价草稿已生成（${formatQuoteRate(facts.amount_usd, facts.currency || "USD", facts.rate_unit)}）。请核对价格后确认发送。`
      : "报价草稿已生成。请补上金额后再确认发送。";
  }
  if (facts.kind === "ship") {
    return facts.tracking
      ? `发货通知草稿已生成（${facts.tracking}）。请核对后确认发送。`
      : "发货通知草稿已生成。请补上运单号后再确认发送。";
  }
  if (facts.kind === "address") return "寄样核对草稿已生成。请核对地址资料后确认发送。";
  return fallback || `${facts.title.replace(/要点|资料/, "")}草稿已生成，请核对后回复「确认发送」。`.replace(/^草稿/, "邮件草稿");
}

/** Attach this-stage mail facts onto a compose result card without duplicating SOP. */
export function attachComposeLoopCard(card: Json, facts: ComposeFacts, data: Json): Json {
  const sections = Array.isArray(card.sections) ? [...(card.sections as Json[])] : [];
  const extra = composeLoopSections(facts);
  const seen = new Set(sections.map((row) => String(row.title || "")));
  const merged = [...extra.filter((row) => !seen.has(String(row.title || ""))), ...sections];
  const gap = composeGapHint(facts, String(data.handle || data.kol_name || ""));
  let actions = Array.isArray(card.recommended_actions)
    ? [...(card.recommended_actions as unknown[])]
    : [];
  if (data.sent) {
    if (!actions.length) actions.push("再写一封");
  } else if (gap.field) {
    actions = actions.filter((row) => !/核对预览后回复「确认发送」/.test(String(typeof row === "string" ? row : (row as { label?: string }).label || "")));
    if (!actions.some((row) => String(typeof row === "string" ? row : (row as { label?: string }).label || row) === gap.result_action)) {
      actions.unshift(gap.result_action);
    }
  }
  return {
    ...card,
    summary: String(card.summary || "") || summaryForFacts(facts, "邮件草稿已生成，请核对后回复「确认发送」。"),
    sections: merged,
    recommended_actions: actions,
    compose_loop: {
      kind: facts.kind,
      quote: facts.quote,
      amount_usd: facts.amount_usd ?? null,
      currency: facts.currency || null,
      rate_unit: facts.rate_unit || null,
      tracking: facts.tracking || null,
      carrier: facts.carrier || null,
      digest: facts.digest || "",
      title: facts.title,
      gap,
    },
    starrykol_data: {
      ...(data && typeof data === "object" ? data : {}),
      ...(typeof card.starrykol_data === "object" && card.starrykol_data ? card.starrykol_data as Json : {}),
      amount_usd: facts.amount_usd ?? data.amount_usd,
      currency: facts.currency || data.currency,
      mail_digest: facts.digest || data.mail_digest,
    },
  };
}

export function draftFieldsFromFacts(facts: ComposeFacts, data: Json = {}): Json {
  return {
    amount_usd: facts.amount_usd ?? data.amount_usd ?? null,
    currency: facts.currency || data.currency || (facts.amount_usd != null ? "USD" : null),
    rate_unit: facts.rate_unit || data.rate_unit || null,
    deliverables: facts.deliverables || data.deliverables || null,
    tracking: facts.tracking || data.tracking || null,
    carrier: facts.carrier || data.carrier || null,
  };
}

export function composeFactsFromRow(col: Row | null, extra: Json = {}, digest = ""): ComposeFacts {
  const fulfillment = extra.fulfillment && typeof extra.fulfillment === "object" ? extra.fulfillment as Json : {};
  return composeFactsFromContext({
    stage: String(extra.stage_code || extra.stage || col?.stage_code || ""),
    raw: String(extra.raw || extra.text || extra.prompt || extra.body || ""),
    amount_usd: extra.amount_usd != null ? Number(extra.amount_usd) : null,
    currency: extra.currency ? String(extra.currency) : null,
    rate_unit: extra.rate_unit === "hour" ? "hour" : null,
    deliverables: extra.deliverables ? String(extra.deliverables) : null,
    tracking: String(extra.tracking || fulfillment.tracking || ""),
    carrier: String(extra.carrier || fulfillment.carrier || ""),
    name: String(extra.recipient_name || extra.name || col?.recipient_name || ""),
    phone: String(extra.phone || col?.phone || ""),
    address: String(extra.address_line || extra.address || col?.address_line || ""),
    country: String(extra.country || col?.country || ""),
    postal: String(extra.postal || col?.postal || ""),
    sku: String(extra.sku || col?.sku || ""),
    qty: String(extra.qty || col?.qty || ""),
    digest,
    style_tags: Array.isArray(extra.follow_style_tags)
      ? extra.follow_style_tags as FollowStyleTag[]
      : readFollowStyleTags(col),
  });
}
