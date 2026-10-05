export type ReplyContext = {
  version: string; cursor: number; complete: boolean;
  sources: Array<{ mailbox: string; checked_at: string | null; state: string }>;
  messages: Array<{ id: string; source: string; mailbox: string; direction: string; subject: string; body: string;
    occurred_at: string; version: string; sequence: number; received_at: string | null }>;
};
