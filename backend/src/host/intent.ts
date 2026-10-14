/**
 * Host 只抽 handle / 邮箱。金额、运单等槽位由 Skill 契约 / Codex turn 认。
 * 禁止用正则/子串把口令锁成某个 skill。
 */
import { postgresDb } from "../postgres/access.js";
import type { Intent, Row } from "../types.js";
import { extractCreatorId } from "./creator.js";
import { isSkillHandleToken, SKILL_CATALOG, stripSkillMentions, } from "./skills-catalog.js";
const HANDLE_RE = /(?:^|[^A-Za-z0-9._%+-])@([^\s「」]+)/;
function knownIntents(): Set<string> {
  return new Set([...SKILL_CATALOG.map((skill) => skill.id), "inbound"]);
}
function makeIntent(type: string, skill: string | null, handle: string | null, needs: boolean, raw: string): Intent {
  return {
    type,
    skill,
    handle,
    amount_usd: null,
    tracking: null,
    carrier: null,
    eta: null,
    needs_worker: needs,
    raw,
    collaboration_id: null,
    extras: {},
  };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SEND_TO_RE = /发送给\s*[：:]?\s*@?([^\s,，]+)/;

export function extractEmail(text: string): string | null {
  const match = EMAIL_RE.exec(text || "");
  return match ? match[0] : null;
}
async function leftoverCollabHandle(stripped: string): Promise<string | null> {
  const leftover = String(stripped || "").trim();
  if (!leftover)
    return null;
  const candidates = [leftover, ...leftover.split(/\s+/).filter((part) => part.length >= 2)];
  try {
    const db = postgresDb();
    for (const candidate of candidates) {
      if (candidate.includes("@") || isSkillHandleToken(candidate))
        continue;
      const row = (await db.one("SELECT handle FROM collaborations WHERE handle = $1 OR display_name = $2", candidate, candidate)) as {
        handle?: string;
      } | undefined;
      if (row?.handle)
        return String(row.handle);
    }
    }
  catch {
    return null;
  }
  return null;
}
export async function extractHandle(text: string): Promise<string | null> {
  const stripped = stripSkillMentions(text);
  const from = (chunk: string): string | null => {
    const m = HANDLE_RE.exec(chunk || "");
    if (m) {
      const token = m[1].replace(/^@+/, "");
      if (token && !token.includes("@") && !isSkillHandleToken(token) && !EMAIL_RE.test(token))
        return token;
    }
    const paren = /[（(]([^）)]{1,32})[）)]/.exec(chunk || "");
    if (paren) {
      const token = paren[1].replace(/^@+/, "").trim();
      if (token && !isSkillHandleToken(token))
        return token;
    }
    const sendTo = SEND_TO_RE.exec(chunk || "");
    if (sendTo) {
      const token = sendTo[1].replace(/^@+/, "").trim();
      if (token && !token.includes("@") && !isSkillHandleToken(token))
        return token;
    }
    return null;
  };
  return from(stripped) || from(text || "") || (await leftoverCollabHandle(stripped));
}
async function fromText(text: string): Promise<Intent> {
  const t = text || "";
  const handle = (await extractHandle(t));
  return makeIntent("chat", null, handle, false, t);
}
export async function classify(text: string, frontendIntent?: string | null, collaborationId?: string | null): Promise<Intent> {
  let derived = (await fromText(text));
  if (frontendIntent && knownIntents().has(frontendIntent)) {
    derived = makeIntent(frontendIntent, frontendIntent, derived.handle, true, text);
  }
  derived.collaboration_id = collaborationId ?? null;
  const creatorId = extractCreatorId(text);
  if (creatorId)
    derived.extras = { ...derived.extras, creator_id: creatorId };
  const email = extractEmail(text);
  if (email)
    derived.extras = { ...derived.extras, email };
  return derived;
}
export async function collabByHandle(handle: string | null): Promise<Row | null> {
  if (!handle)
    return null;
  const row = (await postgresDb().one("SELECT * FROM collaborations WHERE handle = $1 OR display_name = $2", handle, handle));
  return row ? { ...(row as Row) } : null;
}
export async function collabById(cid: string | null): Promise<Row | null> {
  if (!cid)
    return null;
  const row = (await postgresDb().one("SELECT * FROM collaborations WHERE id = $1", cid));
  return row ? { ...(row as Row) } : null;
}
export async function resolveCollab(intent: Intent): Promise<Row | null> {
  return (await collabById(intent.collaboration_id)) || (await collabByHandle(intent.handle));
}
