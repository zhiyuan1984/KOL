/**
 * 写邮件的收件人默认规则（BIZ-04、backend/skills/email_compose/SKILL.md）。
 *
 * 取值顺序（只在一处定，前端不拼 To —— CONST-04）：
 * 1. 口令里写明的地址（explicit）
 * 2. 通讯页选中的会话的对方（conversation）
 * 3. 已选合作或会话绑定：该红人地址里最近有往来的那个（kol_recent），
 *    没有往来记录时用合作记录里的邮箱（kol_record）
 * 4. 当前发件箱下 last_at 最新的真实往来对方（memory）
 * 5. 都没有就留空，让人补
 *
 * 约束：
 * - 排除本人挂载的邮箱，以及 noreply / mailer-daemon 一类系统地址；
 * - 只读本人有权限的邮箱（会话按所选/默认发件箱查，跨箱不串）；
 * - 最多返回 5 个最近往来作为候选；
 * - 每一档都写明来源；多候选只出候选、不取第一只（BIZ-04）。
 */
import type { Persona } from "../config.js";
import { getConn } from "../db.js";
import type { Row } from "../types.js";
import { normalizeEmail } from "./identity.js";
import { findMailThread, mailboxBindings } from "./mail-memory.js";
import { boundMailboxEmail } from "./starry-bind.js";
import { currentUser } from "./persona.js";
import { firstEmail } from "./mail-to.js";

export type ComposeRecipientSource =
  | "explicit"
  | "conversation"
  | "kol_recent"
  | "kol_record"
  | "memory"
  | "none";

export type RecipientCandidate = {
  email: string;
  source: ComposeRecipientSource;
  label: string;
  last_at: string | null;
};

export type ComposeRecipient = {
  /** 选中的收件人；没有时为空字符串，让人补 */
  to: string;
  source: ComposeRecipientSource;
  /** 人话来源标签，前端直接展示 */
  label: string;
  candidates: RecipientCandidate[];
  /** 命中会话时带回：给「往来匹配采用合作」用 */
  thread_id: string | null;
  collaboration_id: string | null;
  /** 选中会话不在本人邮箱下等拒绝情况 */
  error?: { code: string; message: string };
};

/** 系统/通知类地址：永远不作为收件人，也不出候选。 */
const SYSTEM_ADDRESS_RE = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|undeliverable|delivery)/i;

const SOURCE_LABEL: Record<ComposeRecipientSource, string> = {
  explicit: "口令里写明的",
  conversation: "通讯页选中的会话",
  kol_recent: "该红人最近往来的地址",
  kol_record: "合作记录里的邮箱",
  memory: "最近往来",
  none: "暂无收件人",
};

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function ownMailboxSet(user: Persona | null | undefined): Set<string> {
  const set = new Set<string>();
  try {
    for (const binding of mailboxBindings()) {
      const email = normalizeEmail(String(binding.mailbox || ""));
      if (email) set.add(email);
    }
    const bound = normalizeEmail(boundMailboxEmail() || "");
    if (bound) set.add(bound);
  } catch {
    // 读绑定失败时不扩大范围：只按空集合处理，候选照常过滤系统地址。
  }
  void user;
  return set;
}

function usablePeer(raw: unknown, owned: Set<string>): string {
  const email = normalizeEmail(String(raw || ""));
  if (!email || !email.includes("@")) return "";
  if (owned.has(email)) return "";
  if (SYSTEM_ADDRESS_RE.test(email)) return "";
  return email;
}

type ThreadPeer = { id: string; peer: string; collaboration_id: string | null; last_at: string | null };

function recentThreads(mailbox: string, limit: number): ThreadPeer[] {
  const rows = getConn().prepare(
    `SELECT id, peer_email, last_from, collaboration_id, last_at
       FROM kol_mail_threads
      WHERE mailbox=?
      ORDER BY last_at DESC NULLS LAST, updated_at DESC
      LIMIT ?`,
  ).all(mailbox, limit) as Row[];
  return rows.map((row) => ({
    id: String(row.id || ""),
    peer: String(row.peer_email || row.last_from || ""),
    collaboration_id: row.collaboration_id ? String(row.collaboration_id) : null,
    last_at: row.last_at ? String(row.last_at) : null,
  }));
}

function collaborationThreads(collaborationId: string, limit: number): ThreadPeer[] {
  const rows = getConn().prepare(
    `SELECT id, peer_email, last_from, collaboration_id, last_at
       FROM kol_mail_threads
      WHERE collaboration_id=?
      ORDER BY last_at DESC NULLS LAST, updated_at DESC
      LIMIT ?`,
  ).all(collaborationId, limit) as Row[];
  return rows.map((row) => ({
    id: String(row.id || ""),
    peer: String(row.peer_email || row.last_from || ""),
    collaboration_id: row.collaboration_id ? String(row.collaboration_id) : null,
    last_at: row.last_at ? String(row.last_at) : null,
  }));
}

export function composeRecipientFor(input: {
  /** 已解析的发件箱；为空时 memory 档跳过（最近往来只看当前发件箱） */
  mailbox: string;
  collaboration?: Row | null;
  conversationId?: string | null;
  explicitTo?: string | null;
  user?: Persona | null;
}): ComposeRecipient {
  const user = input.user || null;
  const owned = ownMailboxSet(user || currentUserSafe());
  const mailbox = normalizeEmail(String(input.mailbox || ""));

  // 第 1 档：口令里写明的地址。写明了但属于本人/系统地址时不静默换人，
  // 留空并说明（与选中会话对方无效同一口径）。
  const explicitRaw = normalizeEmail(String(input.explicitTo || ""));
  if (explicitRaw && explicitRaw.includes("@")) {
    const explicit = usablePeer(explicitRaw, owned);
    if (explicit) {
      return {
        to: explicit,
        source: "explicit",
        label: SOURCE_LABEL.explicit,
        candidates: [],
        thread_id: null,
        collaboration_id: null,
      };
    }
    return {
      to: "",
      source: "none",
      label: SOURCE_LABEL.none,
      candidates: [],
      thread_id: null,
      collaboration_id: null,
      error: { code: "explicit_recipient_invalid", message: "口令里写明的收件地址不可用（本人邮箱或系统地址不收信），请换一个地址" },
    };
  }

  // 第 2 档：通讯页选中的会话的对方。会话必须在（所选/默认）发件箱下，否则拒绝。
  const conversationId = String(input.conversationId || "").trim();
  if (conversationId) {
    const thread = findMailThread(conversationId, mailbox || undefined);
    if (!thread) {
      return {
        to: "",
        source: "none",
        label: SOURCE_LABEL.none,
        candidates: [],
        thread_id: null,
        collaboration_id: null,
        error: { code: "conversation_not_found", message: "选中的会话不在该邮箱下或无权访问" },
      };
    }
    const peer = usablePeer((thread as Row).peer_email || (thread as Row).last_from, owned);
    if (peer) {
      return {
        to: peer,
        source: "conversation",
        label: SOURCE_LABEL.conversation,
        candidates: [],
        thread_id: String((thread as Row).id || ""),
        collaboration_id: (thread as Row).collaboration_id ? String((thread as Row).collaboration_id) : null,
      };
    }
    // 明确选中的会话对方不可用（本人/系统地址）时不静默换成另一会话的对方。
    return {
      to: "",
      source: "none",
      label: SOURCE_LABEL.none,
      candidates: [],
      thread_id: String((thread as Row).id || ""),
      collaboration_id: (thread as Row).collaboration_id ? String((thread as Row).collaboration_id) : null,
      error: { code: "conversation_peer_invalid", message: "选中会话的对方不可用（本人邮箱或系统地址不收信），请换一个会话或手动填写收件人" },
    };
  }

  // 第 3 档：已选合作——该红人地址里最近有往来的那个；没有往来用合作记录邮箱。
  const collaboration = input.collaboration || null;
  if (collaboration) {
    const cid = String(collaboration.id || "");
    if (cid) {
      for (const thread of collaborationThreads(cid, 5)) {
        const peer = usablePeer(thread.peer, owned);
        if (peer) {
          return {
            to: peer,
            source: "kol_recent",
            label: `${SOURCE_LABEL.kol_recent}${fmtDay(thread.last_at) ? ` · ${fmtDay(thread.last_at)}` : ""}`,
            candidates: [],
            thread_id: thread.id,
            collaboration_id: cid,
          };
        }
      }
    }
    const recordEmail = firstEmail(String(collaboration.email || ""));
    if (recordEmail) {
      return {
        to: normalizeEmail(recordEmail),
        source: "kol_record",
        label: SOURCE_LABEL.kol_record,
        candidates: [],
        thread_id: null,
        collaboration_id: cid || null,
      };
    }
  }

  // 第 4 档：当前发件箱下最近一条真实往来的对方；顺带收集最多 5 个候选。
  if (mailbox) {
    const candidates: RecipientCandidate[] = [];
    let picked: ThreadPeer | null = null;
    for (const thread of recentThreads(mailbox, 10)) {
      const peer = usablePeer(thread.peer, owned);
      if (!peer) continue;
      if (!picked) picked = thread;
      if (!candidates.some((c) => c.email === peer) && candidates.length < 5) {
        candidates.push({
          email: peer,
          source: "memory",
          label: `最近往来${fmtDay(thread.last_at) ? ` · ${fmtDay(thread.last_at)}` : ""}`,
          last_at: thread.last_at,
        });
      }
      if (picked && candidates.length >= 5) break;
    }
    if (picked) {
      const peer = usablePeer(picked.peer, owned);
      return {
        to: peer,
        source: "memory",
        label: `最近往来${fmtDay(picked.last_at) ? ` · ${fmtDay(picked.last_at)}` : ""}`,
        candidates,
        thread_id: picked.id,
        collaboration_id: picked.collaboration_id,
      };
    }
    if (candidates.length) {
      return {
        to: "",
        source: "none",
        label: SOURCE_LABEL.none,
        candidates,
        thread_id: null,
        collaboration_id: null,
      };
    }
  }

  // 第 5 档：留空，让人补。
  return {
    to: "",
    source: "none",
    label: SOURCE_LABEL.none,
    candidates: [],
    thread_id: null,
    collaboration_id: null,
  };
}

function currentUserSafe(): Persona | null {
  try {
    return currentUser();
  } catch {
    return null;
  }
}
