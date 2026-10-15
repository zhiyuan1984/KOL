import { createHash } from "node:crypto";
import { getConn } from "../db.js";
import type { Row } from "../types.js";

/** Same letter identity for webhook Message ID and kol_mail_seen fingerprint. */
export function mailFingerprint(
  collaborationId: string,
  subject: string,
  body: string,
  extra = "",
): string {
  return `${collaborationId}:${subject}:${body.slice(0, 80)}:${extra}`;
}

export function inboundIdentity(input: {
  provider_message_id?: string | null;
  collaboration_id?: string | null;
  subject?: string | null;
  body?: string | null;
  conversation_id?: string | null;
}): { provider_message_id: string; fingerprint: string; identity_hash: string; seen_keys: string[] } {
  const provider_message_id = String(input.provider_message_id || "").trim();
  const fingerprint = mailFingerprint(
    String(input.collaboration_id || ""),
    String(input.subject || ""),
    String(input.body || ""),
    String(input.conversation_id || ""),
  );
  const seen_keys = provider_message_id
    ? [`mid:${provider_message_id}`, fingerprint]
    : [fingerprint];
  const identity_hash = createHash("sha256")
    .update(provider_message_id ? `mid:${provider_message_id}` : `fp:${fingerprint}`)
    .digest("hex");
  return { provider_message_id, fingerprint, identity_hash, seen_keys };
}

export async function inboundByIdentity(keys: {
  provider_message_id?: string;
  identity_hash?: string;
  fingerprint?: string;
}): Promise<Awaited<Row | undefined>> {
  const db = getConn();
  if (keys.provider_message_id) {
    const byMid = (await db.query("SELECT * FROM inbound WHERE provider_message_id = $1",[keys.provider_message_id])).rows[0] as Row | undefined;
    if (byMid) return byMid;
  }
  if (keys.identity_hash) {
    const byHash = (await db.query("SELECT * FROM inbound WHERE identity_hash = $1",[keys.identity_hash])).rows[0] as Row | undefined;
    if (byHash) return byHash;
  }
  return undefined;
}

export async function mailAlreadySeen(keys: { seen_keys: string[] }): Promise<Awaited<boolean>> {
  const db = getConn();
  for (const key of keys.seen_keys) {
    if ((await db.query("SELECT 1 FROM kol_mail_seen WHERE fingerprint = $1",[key])).rows[0]) return true;
  }
  return Boolean((await inboundByIdentity({
    provider_message_id: keys.seen_keys.find((key) => key.startsWith("mid:"))?.slice(4),
  })));
}

export async function markMailSeen(keys: { seen_keys: string[] }, sessionId: string, collaborationId: string, createdAt: string): Promise<Awaited<void>> {
  const db = getConn();
  const stmt = "INSERT INTO kol_mail_seen (fingerprint, session_id, collaboration_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING";
  for (const key of keys.seen_keys) (await db.query(stmt,[key,sessionId,collaborationId,createdAt]));
}
