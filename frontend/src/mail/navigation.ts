import type { MailBox } from "./types";

export const MAIL_NAVIGATION_EVENT = "mail:navigation-mailbox";
const keyOf = (accountId?: string) => accountId ? `mail:last-mailbox:${accountId}` : "";

export function lastMailbox(accountId?: string): string {
  const key = keyOf(accountId);
  if (!key) return "";
  try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
}

/** UI preference only. Revalidate against the current Host bindings before using it. */
export function navigationMailbox(box: MailBox, previous = ""): string {
  const bindings = [...new Set((box.bindings || []).filter(row => row.bound).map(row => row.mailbox.trim()).filter(Boolean))];
  const current = box.bound ? box.mailbox.trim() : "";
  if (previous && (bindings.includes(previous) || previous === current)) return previous;
  if (current) return current;
  return bindings.length === 1 ? bindings[0] : "";
}

export const mailboxHref = (mailbox: string) => mailbox ? `/mail?${new URLSearchParams({ box: mailbox })}` : "/mail";

export function rememberMailbox(accountId: string | undefined, mailbox: string): void {
  const key = keyOf(accountId);
  if (!key || !mailbox) return;
  try { sessionStorage.setItem(key, mailbox); } catch { /* URL remains the source of this visit. */ }
  window.dispatchEvent(new CustomEvent(MAIL_NAVIGATION_EVENT, { detail: { accountId, mailbox } }));
}
