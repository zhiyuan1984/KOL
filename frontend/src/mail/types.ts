/** FE contract for kol `/api/mail` P0. Do not send legacy follow-mail mailbox filters. */

export type MailMatchState = "matched" | "unbound" | "deferred" | "ignored";
export type MailDigestSource = "codex_memory" | "luna" | "body_analysis" | "analysis_failed";
export type MailDirection = "inbound" | "outbound";
export type MailDataSource = "api" | "fallback";

export type MailBox = {
  bound: boolean;
  mailbox: string;
  owner_name: string;
  status: "connected" | "expired" | "unbound" | string;
  unread: number;
  synced_at: string | null;
  last_error?: string | null;
  error?: string;
};

export type MailConversation = {
  id: string;
  mailbox: string;
  conversation_id: string;
  collaboration_id?: string;
  match_state: MailMatchState;
  subject: string;
  peer_email: string;
  peer_name: string;
  last_at: string | null;
  last_direction: MailDirection | "";
  last_preview: string;
  unread_count: number;
  digest_source: MailDigestSource | "";
  digest_text?: string;
  kol_uid?: string;
  handle?: string;
};

export type MailMessage = {
  id: string;
  conversation_id: string;
  provider_message_id?: string;
  direction: MailDirection;
  occurred_at: string;
  from_addr: string;
  subject: string;
  snippet: string;
  body_text?: string;
  letter_summary: string;
  summary_source: MailDigestSource | "body_digest" | "";
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

export type MailSyncReceipt = {
  ok: boolean;
  mailbox?: string;
  listed?: number;
  inserted?: number;
  updated?: number;
  unread?: number;
  synced_at?: string;
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
