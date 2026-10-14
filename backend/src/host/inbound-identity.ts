import { createHash } from "node:crypto";
import { postgresDb } from "../postgres/access.js";
import type { Row } from "../types.js";
/** Same letter identity for webhook Message ID and kol_mail_seen fingerprint. */
export function mailFingerprint(collaborationId: string, subject: string, body: string, extra = ""): string {
  return `${collaborationId}:${subject}:${body.slice(0, 80)}:${extra}`;
}
export function inboundIdentity(input: {
  provider_message_id?: string | null;
  collaboration_id?: string | null;
  subject?: string | null;
  body?: string | null;
  conversation_id?: string | null;
}): {
  provider_message_id: string;
  fingerprint: string;
  identity_hash: string;
  seen_keys: string[];
} {
  const provider_message_id = String(input.provider_message_id || "").trim();
  const fingerprint = mailFingerprint(String(input.collaboration_id || ""), String(input.subject || ""), String(input.body || ""), String(input.conversation_id || ""));
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
}): Promise<Row | undefined> {
  const db = postgresDb();
  if (keys.provider_message_id) {
    const byMid = (await db.one("SELECT * FROM inbound WHERE provider_message_id = $1", keys.provider_message_id)) as Row | undefined;
    if (byMid)
      return byMid;
  }
  if (keys.identity_hash) {
    const byHash = (await db.one("SELECT * FROM inbound WHERE identity_hash = $1", keys.identity_hash)) as Row | undefined;
    if (byHash)
      return byHash;
  }
  return undefined;
}
export async function mailAlreadySeen(keys: {
  seen_keys: string[];
}): Promise<boolean> {
  const db = postgresDb();
  for (const key of keys.seen_keys) {
    if ((await db.one("SELECT 1 FROM kol_mail_seen WHERE fingerprint = $1", key)))
      return true;
  }
  return Boolean((await inboundByIdentity({
    provider_message_id: keys.seen_keys.find((key) => key.startsWith("mid:"))?.slice(4),
  })));
}
export async function markMailSeen(keys: {
  seen_keys: string[];
}, sessionId: string, collaborationId: string, createdAt: string): Promise<void> {
  const db = postgresDb();
  for (const key of keys.seen_keys)
    await db.execute(`INSERT INTO kol_mail_seen (fingerprint, session_id, collaboration_id, created_at)
          VALUES ($1,$2,$3,$4) ON CONFLICT (fingerprint) DO NOTHING`, key, sessionId, collaborationId, createdAt);
}
