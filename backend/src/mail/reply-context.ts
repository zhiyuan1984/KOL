import { scopedUser } from "../auth.js";
import { brandScope } from "../host/inbound-scope.js";
import { HttpFail } from "../host/errors.js";
import { postgresPool } from "../postgres/pool.js";
import { replyFingerprint } from "./reply-source.js";
import type { Json, Row } from "../types.js";

/** L1 cached context: no sync, model, draft modification or event creation. */
export async function readReplyContext(sessionId: string, after = 0): Promise<Json> {
  let actor = scopedUser();
  if (!actor?.active) throw new HttpFail(401, "authentication required");
  const db = postgresPool();
  const currentActor = (await db.query<Row>("SELECT active,roles,brands FROM users WHERE id=$1", [actor.id])).rows[0];
  if (!currentActor?.active) throw new HttpFail(403, "mailbox_access_denied");
  const list = (value: unknown): string[] => {
    try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  };
  actor = { ...actor, roles: list(currentActor.roles), brands: list(currentActor.brands) };
  const session = (await db.query<Row>(`SELECT collaboration_id FROM sessions WHERE id=$1 AND owner_user_id=$2
    AND deleted_at IS NULL AND disabled=0`, [sessionId, actor.id])).rows[0];
  if (!session) throw new HttpFail(404, "reply context not found");
  if (!session.collaboration_id) {
    const collaborations = (await db.query<Row>("SELECT DISTINCT collaboration_id FROM drafts WHERE session_id=$1 AND collaboration_id IS NOT NULL", [sessionId])).rows;
    if (collaborations.length === 1) session.collaboration_id = collaborations[0].collaboration_id;
  }
  if (!session.collaboration_id) throw new HttpFail(404, "reply context not found");
  const brands = brandScope(actor);
  const col = (await db.query<Row>(`SELECT id,brand,stage_code,stage_version FROM collaborations
    WHERE id=$1 AND ($2::text[] IS NULL OR brand=ANY($2::text[]))`, [session.collaboration_id, brands])).rows[0];
  if (!col) throw new HttpFail(404, "reply context not found");
  const bindings = (await db.query<Row>(`SELECT mailbox_email,synced_at,last_error,sync_cursor_at,sync_cursor_id FROM user_starry_bindings
    WHERE user_id=$1 AND status='connected' ORDER BY mailbox_email`, [actor.id])).rows;
  const boxes = bindings.map(row => String(row.mailbox_email).toLowerCase());
  if (!boxes.length) throw new HttpFail(403, { code: "mailbox_access_denied" });
  const rows = (await db.query<Row>(`SELECT i.id,i.provider_message_id,i.conversation_id,i.direction,i.subject,i.title,
    i.body_text,i.from_addr,i.to_addr,i.occurred_at,t.mailbox,r.sequence,r.fingerprint,r.received_at,r.snapshot,
    count(*) OVER() AS total FROM kol_mail_items i JOIN kol_mail_threads t ON t.id=i.thread_id
    LEFT JOIN LATERAL (SELECT sequence,fingerprint,received_at,snapshot FROM reply_mail_revisions
      WHERE mail_item_id=i.id ORDER BY sequence DESC LIMIT 1) r ON true
    WHERE i.collaboration_id=$1 AND t.collaboration_id=$1 AND t.match_state='matched' AND lower(t.mailbox)=ANY($2::text[])
    ORDER BY i.occurred_at DESC,i.id DESC LIMIT 200`, [col.id, boxes])).rows;
  const used = new Set(rows.map(row => String(row.mailbox).toLowerCase()));
  const sources = bindings.filter(row => used.has(String(row.mailbox_email).toLowerCase())).map(row => ({
    mailbox: row.mailbox_email, checked_at: row.synced_at || null,
    state: row.last_error ? "failed" : row.synced_at ? "verified_cache" : "unknown",
    cursor_at: row.sync_cursor_at || null, cursor_id: row.sync_cursor_id || null,
  }));
  const messages = rows.reverse().map(row => ({ id: row.id, source: "starry", provider_message_id: row.provider_message_id,
    conversation_id: row.conversation_id, mailbox: row.mailbox, direction: row.direction, subject: row.subject,
    body: row.body_text, from: row.from_addr, to: row.to_addr, occurred_at: row.occurred_at,
    version: row.fingerprint || replyFingerprint([row.id,row.subject,row.body_text,row.from_addr,row.to_addr,row.occurred_at]),
    sequence: Number(row.sequence || 0), received_at: row.received_at || null,
    attachments: (row.snapshot as Json | null)?.attachments || [],
  }));
  const version = replyFingerprint({ collaboration_id: col.id, stage_code: col.stage_code, stage_version: col.stage_version,
    messages: messages.map(row => [row.id,row.version]) });
  const cursor = Math.max(0, ...messages.map(row => row.sequence));
  const missingBodyCount = rows.filter(row => typeof row.body_text !== "string").length;
  const drafts = (await db.query<Row>(`SELECT id,subject,body_en,from_addr,to_addr,status,count(*) OVER() AS total
    FROM drafts WHERE session_id=$1 AND collaboration_id=$2 AND sent_at IS NULL
    AND status NOT IN ('sent','sending','send_unknown') ORDER BY id LIMIT 20`, [sessionId,col.id])).rows;
  const draftsVersion = replyFingerprint(drafts.map(row => [row.id,row.subject,row.body_en,row.from_addr,row.to_addr,row.status]));
  const events = (await db.query<Row>(`SELECT r.sequence,r.mail_item_id,r.fingerprint,r.received_at,r.occurred_at
    FROM reply_mail_revisions r JOIN kol_mail_items i ON i.id=r.mail_item_id JOIN kol_mail_threads t ON t.id=i.thread_id
    WHERE r.sequence>$1 AND r.collaboration_id=$2 AND i.collaboration_id=$2 AND t.collaboration_id=$2
      AND t.match_state='matched' AND lower(t.mailbox)=ANY($3::text[]) AND lower(r.mailbox)=lower(t.mailbox)
    ORDER BY r.sequence LIMIT 201`, [after,col.id,boxes])).rows;
  return { entry: "memory", risk: "L1", creates_session: false, creates_turn: false, calls_model: false,
    session_id: sessionId, collaboration_id: col.id, object: { stage_code: col.stage_code, stage_version: col.stage_version }, version, cursor, sources,
    complete: missingBodyCount === 0 && Number(rows[0]?.total || 0) <= 200 && sources.length > 0 && sources.every(row => row.state === "verified_cache"),
    missing_body_count: missingBodyCount,
    messages, drafts: drafts.map(({total, ...draft}) => draft), drafts_version: draftsVersion,
    drafts_complete: Number(drafts[0]?.total || 0) <= 20, changes: messages.filter(row => row.sequence > after),
    events: events.slice(0,200), has_more_events: events.length > 200,
    next_cursor: events.length ? Number(events[Math.min(events.length,200)-1].sequence) : after,
    note: "已授权邮箱缓存；同步状态不代表远端实时完整。刷新上下文不自动发送、改稿或推进阶段。" };
}
