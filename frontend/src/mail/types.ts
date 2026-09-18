/** Formal FE contract for kol PR #177 `/api/mail`. Do not send legacy mailbox filter strings. */

export type MailMatchState = "matched" | "unbound" | "deferred" | "ignored";
export type MailDigestSource = "codex_memory" | "luna" | "body_analysis" | "analysis_failed";
export type MailDirection = "inbound" | "outbound";
export type MailDataSource = "api" | "fallback";

/** GET /api/mail/box — MailBoxStatus + memory envelope. owner_name is display-only decorate. */
export type MailBox = {
  mailbox: string;
  bound: boolean;
  unread: number;
  synced_at: string | null;
  error: string | null;
  last_tool?: string | null;
  cursor_at?: string | null;
  cursor_id?: string | null;
  owner_name?: string;
};

/** GET /api/mail/conversations[] — ConversationRow */
export type MailConversation = {
  id: string;
  mailbox: string;
  conversation_id: string;
  collaboration_id?: string | null;
  match_state: MailMatchState;
  subject: string;
  peer_email: string;
  peer_name: string;
  last_at: string | null;
  last_direction: MailDirection | "";
  last_preview: string;
  unread_count: number;
  last_receipt?: string;
  digest_source: MailDigestSource | "";
  digest_text?: string;
  kol_uid?: string;
  handle?: string;
};

/** GET /api/mail/conversations/:id messages[] — MessageRow */
export type MailMessage = {
  id: string;
  conversation_id: string;
  provider_message_id?: string;
  direction: MailDirection;
  occurred_at: string | null;
  from_addr: string;
  subject: string;
  snippet: string;
  body_text?: string;
  letter_summary: string;
  summary_source: MailDigestSource | "body_digest" | "";
  receipt_status?: string;
  effective?: boolean;
};

export type MailDigest = {
  text: string;
  source: MailDigestSource | "";
  mail_count?: number;
  error?: string;
  failed_at?: string;
};

export type MailThread = {
  thread: MailConversation;
  messages: MailMessage[];
  digest: MailDigest;
};

/** POST /api/mail/sync — SyncReceipt + command envelope */
export type MailSyncReceipt = {
  ok: boolean;
  mailbox?: string;
  listed?: number;
  inserted?: number;
  updated?: number;
  unread?: number;
  synced_at?: string;
  cursor_at?: string;
  error?: string;
};

export type MailWorkspace = {
  source: MailDataSource;
  box: MailBox;
  conversations: MailConversation[];
};

export const MAIL_SYNC_MISSING_COPY = "暂时无法收取。邮箱同步接口尚未开通，没有创建会话。";
export const MAIL_THREAD_MISSING_COPY = "未找到该邮件会话。";
export const MAIL_UNBOUND_COPY = "尚未绑定 Starry 邮箱。绑定后只显示该邮箱的往来，打开会话不会创建 Agent 会话。";
export const MAIL_ANALYZE_UNBOUND_COPY = "未建档，无法入队分析。";
export const MAIL_ANALYZE_PREFILL_PREFIX = "分析已选";
