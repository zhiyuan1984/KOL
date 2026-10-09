import { normalizeEmail } from './identity.js';
import { isPlaceholderMailbox } from '../starrykol/mail-fields.js';

/** Names and mailbox local parts are display hints, never authorization evidence. */
export function matchesVerifiedMailbox(
  kol: { owner_mailbox?: unknown; mailbox_from?: unknown; mailboxEmail?: unknown; mailbox?: unknown; owner_name?: unknown },
  scope: { mailbox_email: string; owner_name?: string },
): boolean {
  const mailbox=normalizeEmail(scope.mailbox_email);
  if (!mailbox || isPlaceholderMailbox(mailbox)) return false;
  return [kol.owner_mailbox,kol.mailbox_from,kol.mailboxEmail,kol.mailbox]
    .map(x=>normalizeEmail(String(x||'')))
    .some(x=>Boolean(x)&&!isPlaceholderMailbox(x)&&x===mailbox);
}
