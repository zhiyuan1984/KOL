import { occurredAtMs } from "../mail-time";
import type { MailConversation, MailMessage } from "./types";

/** In-conversation timeline: newest first, rows without a timestamp last. */
export function timelineOf(messages: MailMessage[]): MailMessage[] {
  return messages
    .map((message, index) => ({ message, index, at: occurredAtMs(message.occurred_at) }))
    .sort((a, b) => {
      if (a.at === b.at) return a.index - b.index;
      if (!a.at) return 1;
      if (!b.at) return -1;
      return b.at - a.at;
    })
    .map((row) => row.message);
}

/** The focused mail, or the newest one when the focus id is missing/unknown. */
export function selectedMessageOf(messages: MailMessage[], focusId: string): MailMessage | null {
  const rows = timelineOf(messages);
  if (!rows.length) return null;
  const key = String(focusId || "").trim();
  if (!key) return rows[0];
  return rows.find((row) => row.id === key || row.provider_message_id === key) || rows[0];
}

/** The focused conversation, or the first one when the focus id is missing/unknown. */
export function selectedConversationOf(
  conversations: MailConversation[],
  focusId: string,
): MailConversation | null {
  if (!conversations.length) return null;
  const key = String(focusId || "").trim();
  if (!key) return conversations[0];
  return conversations.find((row) => row.conversation_id === key || row.id === key) || conversations[0];
}
