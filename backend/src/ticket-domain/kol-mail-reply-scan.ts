import { postgresPool } from "../postgres/pool.js";
import { recordLeadEvent } from "./kol-event-bridge.js";
import type { Row } from "../types.js";

/**
 * 邮件回复自动检测（P3，2026-10-08）。
 * cron handler `kol-mail-reply-scan` 调用；PG-only。
 *
 * 链路：kol_mail_items(direction='inbound') → thread → collaborations(legacy 镜像)
 *   → (platform, handle) → kol_leads → lead.followup_task_id 上写 lead.reply_received
 *   （verified-event → Jev → 执行队列，触发"商务跟进"工单）。
 *
 * 匹配不到 collaboration 时回退：发件人邮箱 → kol_leads.contact_json->>'email'。
 * 已转化 / 已归档的线索跳过（合作侧邮件归属是二期）。
 * 幂等：idempotency_key = kol:mail:reply:{item_id}，查 work_order_verified_events 去重。
 * 归因：verified_by = 线索 owner（负责人对系统检测的事实负责），与 deadline sweep 一致。
 */

export type MailReplyScanItem = {
  item_id: string;
  lead_id: string;
  event_type: string;
  idempotency_key: string;
  skipped_reason?: string;
};

const SCAN_LOOKBACK_DAYS = 7;
const SCAN_LIMIT = 200;

async function alreadyEmitted(idempotencyKey: string): Promise<boolean> {
  const r = await postgresPool().query(
    `SELECT 1 FROM work_order_verified_events WHERE idempotency_key=$1`, [idempotencyKey]);
  return Boolean(r.rows[0]);
}

type InboundItem = {
  id: string;
  thread_id: string;
  conversation_id: string;
  from_addr: string;
  from_name: string;
  subject: string;
  snippet: string;
  occurred_at: string;
  collaboration_id: string | null;
};

async function unprocessedInboundItems(): Promise<InboundItem[]> {
  const r = await postgresPool().query<InboundItem>(
    `SELECT i.id, i.thread_id, i.conversation_id,
            COALESCE(i.from_addr,'') AS from_addr, COALESCE(i.from_name,'') AS from_name,
            COALESCE(i.subject,'') AS subject, COALESCE(i.snippet,'') AS snippet,
            i.occurred_at::text AS occurred_at, t.collaboration_id
       FROM kol_mail_items i
       JOIN kol_mail_threads t ON t.id = i.thread_id
      WHERE i.direction = 'inbound'
        AND i.created_at > now() - ($1 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM work_order_verified_events v
          WHERE v.idempotency_key = 'kol:mail:reply:' || i.id)
      ORDER BY i.occurred_at ASC NULLS LAST, i.id ASC
      LIMIT $2`,
    [String(SCAN_LOOKBACK_DAYS), SCAN_LIMIT],
  );
  return r.rows;
}

async function findLeadForItem(item: InboundItem): Promise<Row | null> {
  const db = postgresPool();
  if (item.collaboration_id) {
    const col = (await db.query<Row>(
      `SELECT platform, handle FROM collaborations WHERE id=$1`, [item.collaboration_id])).rows[0];
    if (col?.platform && col?.handle) {
      const lead = (await db.query<Row>(
        `SELECT id, lead_stage, is_archived, followup_task_id, owner_principal_id, display_name
           FROM kol_leads
          WHERE lower(platform) = lower($1) AND lower(account_handle) = lower($2)
          LIMIT 1`,
        [String(col.platform), String(col.handle)])).rows[0];
      if (lead) return lead;
    }
  }
  const email = String(item.from_addr || "").trim().toLowerCase();
  if (email) {
    const lead = (await db.query<Row>(
      `SELECT id, lead_stage, is_archived, followup_task_id, owner_principal_id, display_name
         FROM kol_leads
        WHERE lower(contact_json->>'email') = $1 AND is_archived = FALSE
        ORDER BY updated_at DESC LIMIT 1`,
      [email])).rows[0];
    if (lead) return lead;
  }
  return null;
}

/** 纯函数：判定一条 inbound 邮件是否可转为 lead.reply_received（无 PG，可单测）。 */
export function classifyReplyItem(lead: {
  id: string;
  lead_stage?: string;
  is_archived?: boolean;
  followup_task_id?: string | null;
  owner_principal_id?: string | null;
} | null): { action: "emit" } | { action: "skip"; reason: string } {
  if (!lead) return { action: "skip", reason: "lead_not_matched" };
  if (lead.is_archived) return { action: "skip", reason: "lead_archived" };
  if (String(lead.lead_stage) === "converted") return { action: "skip", reason: "lead_converted" };
  if (!lead.followup_task_id) return { action: "skip", reason: "lead_no_task" };
  if (!lead.owner_principal_id) return { action: "skip", reason: "lead_no_owner" };
  return { action: "emit" };
}

export async function scanMailReplies(): Promise<{ scanned: number; emitted: MailReplyScanItem[]; skipped: MailReplyScanItem[] }> {
  const items = await unprocessedInboundItems();
  const emitted: MailReplyScanItem[] = [];
  const skipped: MailReplyScanItem[] = [];
  for (const item of items) {
    const idem = `kol:mail:reply:${item.id}`;
    if (await alreadyEmitted(idem)) continue;
    const lead = await findLeadForItem(item);
    const decision = classifyReplyItem(lead ? {
      id: String(lead.id),
      lead_stage: String(lead.lead_stage || ""),
      is_archived: Boolean(lead.is_archived),
      followup_task_id: lead.followup_task_id ? String(lead.followup_task_id) : null,
      owner_principal_id: lead.owner_principal_id ? String(lead.owner_principal_id) : null,
    } : null);
    if (decision.action === "skip" || !lead) {
      skipped.push({
        item_id: item.id, lead_id: lead ? String(lead.id) : "", event_type: "lead.reply_received",
        idempotency_key: idem, skipped_reason: decision.action === "skip" ? decision.reason : "lead_not_matched",
      });
      continue;
    }
    const leadId = String(lead.id);
    const actorId = String(lead.owner_principal_id || "");
    const fromLabel = item.from_name || item.from_addr || "达人";
    const summary = `系统检测：${fromLabel} 回复了邮件「${item.subject || "(无主题)"}」`;
    try {
      await recordLeadEvent(actorId, false, leadId, {
        event_type: "lead.reply_received",
        summary,
        evidence: {
          mail_item_id: item.id,
          thread_id: item.thread_id,
          conversation_id: item.conversation_id,
          from: item.from_addr,
          from_name: item.from_name,
          subject: item.subject,
          snippet: item.snippet,
          occurred_at: item.occurred_at,
          detected_by: "kol-mail-reply-scan",
        },
        idempotency_key: idem,
      });
      emitted.push({ item_id: item.id, lead_id: leadId, event_type: "lead.reply_received", idempotency_key: idem });
    } catch {
      // recordLeadEvent 的 409/422（归档、无 Task 等）记为跳过，不中断整批扫描。
      skipped.push({ item_id: item.id, lead_id: leadId, event_type: "lead.reply_received", idempotency_key: idem, skipped_reason: "record_rejected" });
    }
  }
  return { scanned: items.length, emitted, skipped };
}
