export type ReplyContext = {
  version: string; cursor: number; complete: boolean; missing_body_count?: number;
  sources: Array<{ mailbox: string; checked_at: string | null; state: string }>;
  messages: Array<{ id: string; source: string; mailbox: string; direction: string; subject: string; body: string | null;
    occurred_at: string; version: string; sequence: number; received_at: string | null }>;
};
