import { BRAND_MAILBOXES } from "../config.js";
import { normalizeEmail } from "../host/identity.js";
import type { Json, Row } from "../types.js";

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return firstString(value[0]);
    if (value && typeof value === "object") continue;
    const text = String(value ?? "").trim();
    if (text && text !== "[object Object]") return text;
  }
  return "";
}

export function firstEmail(...values: unknown[]): string {
  const text = firstString(...values);
  const match = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text);
  return match ? match[0].toLowerCase() : "";
}

export function listOf(data: Json): Json[] {
  for (const key of ["list", "items", "records", "conversations", "messages"]) {
    if (Array.isArray(data[key])) return data[key] as Json[];
  }
  if (data.conversation && typeof data.conversation === "object") {
    const nested = listOf(data.conversation as Json);
    if (nested.length) return nested;
  }
  return Array.isArray(data) ? data as Json[] : [];
}

export function conversationIdOf(row: Json): string {
  const id = row.conversationId ?? row.conversation_id ?? row.id ?? row.threadId ?? row.thread_id;
  return id == null || id === "" ? "" : String(id);
}

export function messageSubject(row: Json): string {
  return firstString(
    row.subject,
    row.title,
    row.topic,
    row.emailSubject,
    row.mailSubject,
    row.latestSubject,
    row.lastSubject,
  );
}

export function conversationSubject(...rows: Json[]): string {
  for (const row of rows) {
    const direct = messageSubject(row);
    if (direct && direct !== "(无主题)") return direct;
    const groups = row.subjectGroups || row.subject_groups || row.groups;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        const subject = messageSubject(group as Json);
        if (subject && subject !== "(无主题)") return subject;
      }
    }
    if (Array.isArray(row.list)) {
      for (const group of row.list as Json[]) {
        const subject = messageSubject(group);
        if (subject && subject !== "(无主题)") return subject;
      }
    }
  }
  return "";
}

export function occurredAtMs(...values: unknown[]): number {
  for (const value of values) {
    const raw = firstString(value);
    if (!raw) continue;
    if (/^\d{10,13}$/.test(raw)) {
      const n = Number(raw);
      const ms = raw.length <= 10 ? n * 1000 : n;
      if (Number.isFinite(ms) && ms > 0) return ms;
      continue;
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function asIsoTime(value: unknown): string {
  const ms = occurredAtMs(value);
  return ms ? new Date(ms).toISOString() : "";
}

export function compareMailTime(left: Json, right: Json): number {
  const delta = occurredAtMs(
    left.occurred_at,
    left.sentAt,
    left.sendTime,
    left.receivedAt,
    left.created_at,
    left.createdAt,
  ) - occurredAtMs(
    right.occurred_at,
    right.sentAt,
    right.sendTime,
    right.receivedAt,
    right.created_at,
    right.createdAt,
  );
  if (delta) return delta;
  return String(left.id || left.provider_message_id || "").localeCompare(
    String(right.id || right.provider_message_id || ""),
  );
}

export function sortByMailTime<T extends Json>(rows: T[]): T[] {
  return [...rows].sort(compareMailTime);
}

export function messageOccurredAt(row: Json): string {
  return asIsoTime(firstString(
    row.sentAt,
    row.receivedAt,
    row.sendTime,
    row.receiveTime,
    row.sentTime,
    row.send_time,
    row.receive_time,
    row.sent_at,
    row.received_at,
    row.gmtCreate,
    row.createTime,
    row.createdAt,
    row.created_at,
    row.lastMessageAt,
    row.last_message_at,
    row.occurred_at,
    row.time,
    row.ts,
    row.updatedAt,
    row.updated_at,
  ));
}

export function replySubjectOf(subject: string): string {
  const clean = String(subject || "").replace(/^(Re:\s*)+/i, "").replace(/^\(\s*无主题\s*\)$/, "").trim();
  return clean ? `Re: ${clean}` : "";
}

export function messageBody(row: Json): string {
  const raw = firstString(
    row.bodyText,
    row.body_text,
    row.text,
    row.body,
    row.content,
    row.html,
    row.bodyHtml,
    row.snippet,
    row.preview,
    row.lastMessage,
    row.summary,
  );
  if (!raw) return "";
  if (/<[a-z][\s\S]*>/i.test(raw) && raw.includes("<")) {
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return raw;
}

function addressFromUnknown(value: unknown): { email: string; name: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Json;
    return {
      email: firstEmail(obj.email, obj.address, obj.value),
      name: firstString(obj.name, obj.displayName, obj.display_name),
    };
  }
  const raw = firstString(value);
  const email = firstEmail(raw);
  const stripped = raw.replace(/<[^>]+>/g, "").replace(/"/g, "").trim();
  return {
    email,
    name: stripped && normalizeEmail(stripped) !== email ? stripped : "",
  };
}

export function isPlaceholderMailbox(email: string): boolean {
  const normalized = normalizeEmail(email) || String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  return /@(?:[\w-]+\.)*example\.com$/i.test(normalized) || /@[\w.-]*\bexample$/i.test(normalized);
}

function emailFromUnknown(value: unknown): string {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return emailFromUnknown(value[0]);
  const parsed = addressFromUnknown(value);
  return parsed.email || firstEmail(value);
}

export function realMailboxEmail(...values: unknown[]): string {
  for (const value of values) {
    const email = emailFromUnknown(value);
    if (email && !isPlaceholderMailbox(email)) return email;
  }
  return "";
}

export function messageTo(row: Json): { email: string; name: string } {
  const parsed = [row.to, row.recipient, row.toAddr, row.toAddress]
    .map(addressFromUnknown)
    .find((item) => item.email || item.name) || { email: "", name: "" };
  const email = firstEmail(
    parsed.email,
    row.toEmail,
    row.recipientEmail,
    row.to,
    row.recipient,
  );
  return { email, name: parsed.name };
}

export function messageFrom(row: Json): { email: string; name: string } {
  const parsed = [row.from, row.sender, row.fromAddr, row.fromAddress]
    .map(addressFromUnknown)
    .find((item) => item.email || item.name) || { email: "", name: "" };
  const email = firstEmail(
    parsed.email,
    row.fromEmail,
    row.senderEmail,
    row.from_addr,
    row.from,
    row.sender,
  );
  const name = firstString(
    parsed.name,
    row.fromName,
    row.senderName,
    row.from_name,
    row.sender_name,
  );
  return { email, name };
}

export function handleContactHint(handle: string): string {
  const raw = String(handle || "").replace(/^@/, "").trim();
  if (!raw) return "";
  const parts = raw.split(/[-_/\s]+/).filter(Boolean);
  const hint = [...parts].reverse().find((part) => /^[A-Za-z0-9._%+]{3,}$/.test(part));
  return hint ? hint.toLowerCase() : "";
}

export function contactSearchKeyword(col: { email?: unknown; handle?: unknown }): string {
  const email = normalizeEmail(String(col.email || ""));
  if (email) return email;
  return handleContactHint(String(col.handle || "")) || String(col.handle || "").replace(/^@/, "");
}

export function brandMailboxSet(extra: Array<string | undefined | null> = []): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(BRAND_MAILBOXES)) {
    const email = normalizeEmail(value);
    if (email) out.add(email);
  }
  for (const value of extra) {
    const email = normalizeEmail(String(value || ""));
    if (email) out.add(email);
  }
  return out;
}

export function isBrandSideEmail(email: string, boxes: Set<string>): boolean {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && boxes.has(normalized));
}

export function conversationEmails(row: Json): string[] {
  const found = [
    firstEmail(row.kolEmail, row.contactEmail),
    firstEmail(row.from, row.fromEmail, row.senderEmail, row.sender),
    firstEmail(row.recipientEmail, row.to, row.toEmail),
  ].filter(Boolean);
  return [...new Set(found)];
}

export function matchesHandleHint(email: string, handle: string): boolean {
  const hint = handleContactHint(handle);
  if (!hint) return false;
  const local = (firstEmail(email) || normalizeEmail(email)).split("@")[0] || "";
  return Boolean(local && local === hint);
}

export function inferInbound(
  row: Json,
  ctx: { kolEmail?: string; mailboxEmail?: string; handle?: string } = {},
): boolean {
  const direction = firstString(row.direction, row.mailDirection, row.type, row.kind).toLowerCase();
  if (["in", "inbound", "received", "receive", "kol", "from_kol"].includes(direction)) return true;
  if (["out", "outbound", "sent", "send"].includes(direction)) return false;
  if (row.inbound === true || row.isInbound === true) return true;
  if (row.inbound === false || row.isInbound === false) return false;

  const from = messageFrom(row).email;
  const to = firstEmail(row.to, row.recipientEmail, row.toEmail, row.mailboxEmail);
  const kol = normalizeEmail(ctx.kolEmail || "");
  const box = normalizeEmail(ctx.mailboxEmail || "");
  if (from && kol && from === kol) return true;
  if (from && ctx.handle && matchesHandleHint(from, ctx.handle)) return true;
  if (from && box && from === box) return false;
  if (to && kol && to === kol && from !== kol) return false;
  return false;
}

export function conversationMailboxOf(row: Json): string {
  return firstEmail(row.mailboxEmail, row.mailbox_email, row.mailbox, row.mailboxFrom);
}

/** Brand-side mailboxes used when matching a conversation to a Collaboration. */
export function collaborationMatchMailboxes(
  col: Row,
  extras: Array<string | undefined | null> = [],
): string[] {
  return [
    String(col.mailbox_from || ""),
    String(col.owner_mailbox || ""),
    String(col.mailboxEmail || ""),
    String(col.mailbox || ""),
    ...extras,
  ].filter(Boolean);
}

export function matchCollaboration(
  conv: Json,
  collabs: Row[],
  boundMailbox = "",
): Row | undefined {
  const uid = firstString(conv.kolUid, conv.kol_uid, conv.uid);
  if (uid) {
    const hit = collabs.find((row) => String(row.kol_uid || "") === uid);
    if (hit) return hit;
  }
  const conversationMailbox = conversationMailboxOf(conv);
  const boxes = brandMailboxSet(collabs.flatMap((row) => collaborationMatchMailboxes(row, [
    boundMailbox,
    conversationMailbox,
  ])));
  for (const email of conversationEmails(conv)) {
    if (isBrandSideEmail(email, boxes)) continue;
    const byEmail = collabs.filter((row) => normalizeEmail(String(row.email || "")) === email);
    if (byEmail.length === 1) return byEmail[0];
    const byHandle = collabs.filter((row) => matchesHandleHint(email, String(row.handle || "")));
    if (byHandle.length === 1) return byHandle[0];
  }
  const conversationId = conversationIdOf(conv);
  if (conversationId) {
    const hit = collabs.find((row) => {
      const stored = String(row.conversation_id || "");
      return stored === conversationId || stored === `conv_${conversationId}` || stored.endsWith(`_${conversationId}`);
    });
    if (hit) return hit;
  }
  const name = firstString(conv.kolName, conv.recipientName, conv.name, conv.fromName);
  if (name) {
    const hits = collabs.filter((row) => String(row.handle || "") === name || String(row.display_name || "") === name);
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}
