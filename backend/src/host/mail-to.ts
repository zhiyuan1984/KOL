import { getConn } from "../db.js";
import type { Intent, Json, Row } from "../types.js";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function firstEmail(value: unknown): string {
  const match = EMAIL_RE.exec(String(value ?? ""));
  return match ? match[0] : "";
}

export function isPlaceholderMail(addr: string): boolean {
  return /@example\.com$/i.test(String(addr || "").trim());
}

export function resolveMailTo(
  col: Row | null | undefined,
  intent: Intent | null | undefined,
  item?: Json,
  text?: string,
): string {
  const entities = intent?.extras?.entities && typeof intent.extras.entities === "object"
    ? intent.extras.entities as Json
    : {};
  return firstEmail(item?.to)
    || firstEmail(col?.email)
    || firstEmail(intent?.extras?.email)
    || firstEmail(entities.email)
    || firstEmail(entities.to)
    || firstEmail(text)
    || firstEmail(intent?.raw);
}

export async function bindCollaborationEmail(collaborationId: string | null | undefined, email: string): Promise<Awaited<boolean>> {
  const id = String(collaborationId || "").trim();
  const to = firstEmail(email);
  if (!id || !to) return false;
  const row = (await getConn().query("SELECT email FROM collaborations WHERE id=$1",[id])).rows[0] as
    | { email?: string }
    | undefined;
  if (!row) return false;
  if (String(row.email || "").trim()) return false;
  (await getConn().query("UPDATE collaborations SET email=$1 WHERE id=$2",[to,id]));
  return true;
}
