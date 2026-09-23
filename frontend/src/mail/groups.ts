import type { MailConversation } from "./types";

export type CorrespondentGroup = {
  peer_email: string;
  peer_name: string;
  mailbox: string;
  unread_count: number;
  message_count: number;
  read_count: number;
  conversations: MailConversation[];
};

function normalizePeer(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function groupByPeer(conversations: MailConversation[]): CorrespondentGroup[] {
  const groups = new Map<string, CorrespondentGroup>();
  for (const row of conversations) {
    const peer = normalizePeer(row.peer_email);
    if (!peer) continue;
    const existing = groups.get(peer);
    const messageCount = Number(row.message_count || 1);
    const unread = Number(row.unread_count || 0);
    if (existing) {
      existing.unread_count += unread;
      existing.message_count += messageCount;
      existing.conversations.push(row);
    } else {
      groups.set(peer, {
        peer_email: peer,
        peer_name: row.peer_name || peer,
        mailbox: row.mailbox || "",
        unread_count: unread,
        message_count: messageCount,
        read_count: 0,
        conversations: [row],
      });
    }
  }
  for (const group of groups.values()) {
    group.read_count = Math.max(0, group.message_count - group.unread_count);
    group.conversations.sort((a, b) => String(b.last_at || "").localeCompare(String(a.last_at || "")));
  }
  return Array.from(groups.values()).sort((a, b) => b.unread_count - a.unread_count || b.message_count - a.message_count);
}

export function firstConversationOf(group: CorrespondentGroup | null): MailConversation | null {
  return group?.conversations[0] || null;
}
