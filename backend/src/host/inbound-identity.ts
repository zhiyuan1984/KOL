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

export function inboundByIdentity(keys: {
  provider_message_id?: string;
  identity_hash?: string;
  fingerprint?: string;
}): Row | undefined {
  const db = getConn();
  if (keys.provider_message_id) {
    const byMid = db.prepare("SELECT * FROM inbound WHERE provider_message_id = ?").get(keys.provider_message_id) as Row | undefined;
    if (byMid) return byMid;
  }
  if (keys.identity_hash) {
    const byHash = db.prepare("SELECT * FROM inbound WHERE identity_hash = ?").get(keys.identity_hash) as Row | undefined;
    if (byHash) return byHash;
  }
  return undefined;
}

export function mailAlreadySeen(keys: { seen_keys: string[] }): boolean {
  const db = getConn();
  for (const key of keys.seen_keys) {
    if (db.prepare("SELECT 1 FROM kol_mail_seen WHERE fingerprint = ?").get(key)) return true;
  }
  return Boolean(inboundByIdentity({
    provider_message_id: keys.seen_keys.find((key) => key.startsWith("mid:"))?.slice(4),
  }));
}

export function markMailSeen(keys: { seen_keys: string[] }, sessionId: string, collaborationId: string, createdAt: string): void {
  const db = getConn();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO kol_mail_seen (fingerprint, session_id, collaboration_id, created_at) VALUES (?,?,?,?)",
  );
  for (const key of keys.seen_keys) stmt.run(key, sessionId, collaborationId, createdAt);
}
