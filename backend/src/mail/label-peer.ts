import type { PoolClient } from "pg";

import { HttpFail } from "../host/errors.js";

type QueryClient = Pick<PoolClient, "query">;

/**
 * 会话的对方邮箱（标签跟人走的锚点）。
 *
 * 首选 kol_mail_threads.peer_email；旧行 peer_email 可能是自己（发件会话
 * peer 曾被错写为 from 的 bug），此时按该会话最新邮件的方向推导：
 * 发件取收件人，收件取发件人。推导不出则 404，不静默落到会话本身。
 */
export async function resolveLabelPeerEmail(
  client: QueryClient,
  mailbox: string,
  conversationId: string,
): Promise<string> {
  const row = await client.query<{ peer_email: string | null }>(
    `SELECT CASE
       WHEN t.peer_email IS NOT NULL AND t.peer_email <> '' AND lower(t.peer_email) <> lower($2)
         THEN lower(t.peer_email)
       ELSE lower(COALESCE((
         SELECT CASE WHEN lower(i.direction) = 'outbound' THEN i.to_addr ELSE i.from_addr END
           FROM kol_mail_items i WHERE i.thread_id = t.id
           ORDER BY i.occurred_at DESC NULLS LAST, i.created_at DESC LIMIT 1
       ), t.peer_email))
     END AS peer_email
     FROM kol_mail_threads t
     WHERE t.conversation_id = $1 AND lower(t.mailbox) = lower($2) LIMIT 1`,
    [conversationId, mailbox],
  );
  const peer = String(row.rows[0]?.peer_email || "").trim().toLowerCase();
  if (!peer) throw new HttpFail(404, { code: "conversation_peer_not_found" });
  return peer;
}
