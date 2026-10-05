import { createHash } from "node:crypto";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

export const replyFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type ReplyMailObservation = {
  thread_id: string; collaboration_id: string | null; conversation_id: string; mailbox: string;
  provider_message_id: string; direction: string; subject: string; title: string; body: string;
  from: string; from_name: string; to: string; occurred_at: string; unread: boolean;
  summary: string; summary_zh: string; summary_source: string;
  source_updated_at?: string; attachments?: Json[];
};

/** Internal ingestion only: caller has already authenticated the mailbox sync.
 * Stable provider identity is scoped by mailbox, never by contact-name similarity.
 * Cache and immutable revision event commit together, including body-only edits.
 */
export async function observeReplyMail(input: ReplyMailObservation): Promise<{ changed: boolean; quarantined: boolean; item_id?: string }> {
  const mailbox = input.mailbox.trim().toLowerCase();
  const identity = replyFingerprint([mailbox, input.provider_message_id]);
  return postgresTransaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [identity]);
    const quarantine = async (reason: string) => {
      await db.query("INSERT INTO reply_mail_quarantine(identity_hash,reason) VALUES ($1,$2) ON CONFLICT(identity_hash) DO UPDATE SET reason=EXCLUDED.reason,observed_at=now()", [identity, reason]);
      return { changed: false, quarantined: true };
    };
    if (!mailbox || !input.provider_message_id) return quarantine("stable_source_identity_missing");
    const thread = (await db.query<Row>("SELECT id,mailbox,conversation_id,collaboration_id FROM kol_mail_threads WHERE id=$1 FOR UPDATE", [input.thread_id])).rows[0];
    if (!thread || String(thread.mailbox).toLowerCase() !== mailbox || thread.conversation_id !== input.conversation_id || (thread.collaboration_id || null) !== input.collaboration_id) return quarantine("source_association_mismatch");
    const existing = (await db.query<Row>(`SELECT i.* FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
      WHERE lower(t.mailbox)=$1 AND i.provider_message_id=$2 FOR UPDATE OF i`, [mailbox, input.provider_message_id])).rows;
    if (existing.length > 1) return quarantine("ambiguous_source_identity");
    const prior = existing[0];
    if (prior && (prior.conversation_id !== input.conversation_id || (prior.collaboration_id || null) !== input.collaboration_id)) return quarantine("source_association_changed");
    const itemId = String(prior?.id || nid("kmi"));
    const occurredAt = input.occurred_at || String(prior?.occurred_at || "");
    if (!occurredAt) return quarantine("source_occurrence_time_missing");
    input = { ...input, occurred_at: occurredAt };
    const previous = (await db.query<Row>("SELECT fingerprint,source_updated_at FROM reply_mail_revisions WHERE mail_item_id=$1 ORDER BY sequence DESC LIMIT 1", [itemId])).rows[0];
    const updatedAt = input.source_updated_at && Number.isFinite(Date.parse(input.source_updated_at)) ? new Date(input.source_updated_at).toISOString() : null;
    if (previous?.source_updated_at && updatedAt && Date.parse(updatedAt) < new Date(String(previous.source_updated_at)).getTime()) return { changed: false, quarantined: false, item_id: itemId };
    const snapshot = { provider_message_id: input.provider_message_id, conversation_id: input.conversation_id,
      direction: input.direction, subject: input.subject, title: input.title, body: input.body,
      from: input.from, to: input.to, occurred_at: input.occurred_at,
      // Stable metadata references only; expiring signed URLs and provider
      // credentials are not mail facts and must not enter the model snapshot.
      attachments: (Array.isArray(input.attachments) ? input.attachments : []).filter(file => file && typeof file === "object" && !Array.isArray(file)).map(file => ({
        id: String(file.id || file.fileId || file.attachmentId || ""),
        name: String(file.name || file.filename || ""),
        content_type: String(file.contentType || file.mimeType || ""),
        size: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
        version: String(file.version || file.checksum || file.updatedAt || ""),
        contents_verified: false,
      })) };
    const fingerprint = replyFingerprint(snapshot);
    if (previous?.fingerprint === fingerprint) return { changed: false, quarantined: false, item_id: itemId };
    if (prior) {
      await db.query(`UPDATE kol_mail_items SET subject=$2,title=$3,body_text=$4,snippet=$5,from_addr=$6,to_addr=$7,
        occurred_at=$8,direction=$9,summary=$10,summary_zh=$11,summary_source=$12,
        translation_zh=NULL,translation_source='',memory_fingerprint=NULL,memory_generated_at=NULL WHERE id=$1`,
      [itemId,input.subject,input.title,input.body,input.body.slice(0,280),input.from,input.to,input.occurred_at,input.direction,input.summary,input.summary_zh,input.summary_source]);
    } else {
      await db.query(`INSERT INTO kol_mail_items(id,thread_id,collaboration_id,conversation_id,provider_message_id,direction,subject,title,
        snippet,unread,occurred_at,created_at,from_addr,from_name,to_addr,body_text,summary,summary_zh,summary_source,receipt_status,effective)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'',0)`,
      [itemId,input.thread_id,input.collaboration_id,input.conversation_id,input.provider_message_id,input.direction,input.subject,input.title,
        input.body.slice(0,280),input.unread?1:0,input.occurred_at,new Date().toISOString(),input.from,input.from_name,input.to,input.body,input.summary,input.summary_zh,input.summary_source]);
    }
    await db.query(`INSERT INTO reply_mail_revisions(mail_item_id,mailbox,collaboration_id,provider_message_id,fingerprint,source_updated_at,occurred_at,snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [itemId,mailbox,input.collaboration_id,input.provider_message_id,fingerprint,updatedAt,input.occurred_at,snapshot]);
    if (input.direction === "inbound") await db.query(`INSERT INTO business_events
      (id,event_type,object_type,object_id,occurred_at,received_at,source,source_version,actor_type,payload,evidence,idempotency_key,correlation_id,created_at)
      VALUES ($1,'email.received','email',$2,$3,$4,'starry',$5,'external',$6,$7,$8,$9,$4)
      ON CONFLICT DO NOTHING`, [nid("evt"),itemId,input.occurred_at,new Date().toISOString(),fingerprint,
      JSON.stringify({ thread_id: input.thread_id, conversation_id: input.conversation_id, from: input.from, revision: Boolean(prior) }),
      JSON.stringify({ mail_item_id: itemId, fingerprint }),`email.received:${identity}:${fingerprint}`,input.collaboration_id || input.thread_id]);
    return { changed: true, quarantined: false, item_id: itemId };
  });
}
