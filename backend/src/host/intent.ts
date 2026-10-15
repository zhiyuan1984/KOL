/** Host extracts handles/emails; Skill contracts and the harness own business slots. */
import { getConn } from "../db.js";
import type { Intent, Row } from "../types.js";
import { extractCreatorId } from "./creator.js";
import { isSkillHandleToken, skillCatalog, stripSkillMentions, type SkillEntry } from "./skills-catalog.js";
const HANDLE_RE = /(?:^|[^A-Za-z0-9._%+-])@([^\s「」]+)/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SEND_TO_RE = /发送给\s*[：:]?\s*@?([^\s,，]+)/;
function knownIntents(catalog: readonly SkillEntry[]): Set<string> {
  return new Set([...catalog.map((skill) => skill.id), "inbound"]);
}
function makeIntent(type: string, skill: string | null, handle: string | null, needs: boolean, raw: string): Intent {
  return { type, skill, handle, amount_usd: null, tracking: null, carrier: null, eta: null, needs_worker: needs, raw, collaboration_id: null, extras: {} };
}
export function extractEmail(text: string): string | null {
  return EMAIL_RE.exec(text || "")?.[0] || null;
}
async function leftoverCollabHandle(stripped: string, catalog: readonly SkillEntry[]): Promise<string | null> {
  const leftover = String(stripped || "").trim();
  if (!leftover) return null;
  const candidates = [leftover, ...leftover.split(/\s+/).filter((part) => part.length >= 2)];
  for (const candidate of candidates) {
    if (candidate.includes("@") || isSkillHandleToken(candidate, catalog)) continue;
    const row = (await getConn().query<{ handle?: string }>("SELECT handle FROM collaborations WHERE handle=$1 OR display_name=$2", [candidate, candidate])).rows[0];
    if (row?.handle) return String(row.handle);
  }
  return null;
}
export async function extractHandle(text: string, snapshot?: readonly SkillEntry[]): Promise<string | null> {
  const catalog = snapshot || await skillCatalog();
  const stripped = stripSkillMentions(text, catalog);
  const from = (chunk: string): string | null => {
    const match = HANDLE_RE.exec(chunk || "");
    if (match) {
      const token = match[1].replace(/^@+/, "");
      if (token && !token.includes("@") && !isSkillHandleToken(token, catalog) && !EMAIL_RE.test(token)) return token;
    }
    const paren = /[（(]([^）)]{1,32})[）)]/.exec(chunk || "");
    if (paren) {
      const token = paren[1].replace(/^@+/, "").trim();
      if (token && !isSkillHandleToken(token, catalog)) return token;
    }
    const sendTo = SEND_TO_RE.exec(chunk || "");
    if (sendTo) {
      const token = sendTo[1].replace(/^@+/, "").trim();
      if (token && !token.includes("@") && !isSkillHandleToken(token, catalog)) return token;
    }
    return null;
  };
  return from(stripped) || from(text || "") || await leftoverCollabHandle(stripped, catalog);
}
export async function classify(text: string, frontendIntent?: string | null, collaborationId?: string | null): Promise<Intent> {
  const catalog = await skillCatalog();
  let derived = makeIntent("chat", null, await extractHandle(text || "", catalog), false, text || "");
  if (frontendIntent && knownIntents(catalog).has(frontendIntent)) derived = makeIntent(frontendIntent, frontendIntent, derived.handle, true, text);
  derived.collaboration_id = collaborationId ?? null;
  const creatorId = extractCreatorId(text);
  if (creatorId) derived.extras = { ...derived.extras, creator_id: creatorId };
  const email = extractEmail(text);
  if (email) derived.extras = { ...derived.extras, email };
  return derived;
}
export async function collabByHandle(handle: string | null): Promise<Row | null> {
  if (!handle) return null;
  const row = (await getConn().query<Row>("SELECT * FROM collaborations WHERE handle=$1 OR display_name=$2", [handle, handle])).rows[0];
  return row ? { ...row } : null;
}
export async function collabById(cid: string | null): Promise<Row | null> {
  if (!cid) return null;
  const row = (await getConn().query<Row>("SELECT * FROM collaborations WHERE id=$1", [cid])).rows[0];
  return row ? { ...row } : null;
}
export async function resolveCollab(intent: Intent): Promise<Row | null> {
  // A Promise itself is always truthy: resolve the first lookup before falling back.
  return await collabById(intent.collaboration_id) || await collabByHandle(intent.handle);
}
