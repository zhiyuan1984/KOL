import { avatarTone, formatMailTime, initialsOf } from "../format";
import { decodeHtmlEntities } from "../text";
import type { MailMessage } from "../types";

/** Third column: only the currently selected mail, inbound and outbound styled apart. */
export function MailContent({
  message,
  peerName,
  peerEmail,
  ownerName,
  mailbox,
}: {
  message: MailMessage;
  peerName: string;
  peerEmail: string;
  ownerName: string;
  mailbox: string;
}) {
  const inbound = message.direction !== "outbound";
  const body = decodeHtmlEntities(String(message.body_text || "")).trim();
  const senderEmail = message.from_addr || (inbound ? peerEmail : mailbox);
  // Sender name must agree with the sender address: the conversation-level
  // peer_name can hold an address (or our own owner name) and reads as a
  // mismatch next to message-level from_addr.
  const senderName = message.from_name
    || (senderEmail.includes("@") ? senderEmail.split("@")[0] : senderEmail)
    || (inbound ? peerName : ownerName)
    || mailbox
    || "对方";
  const toAddr = message.to_addr || (inbound ? mailbox : peerEmail);
  const showEmail = Boolean(senderEmail) && senderEmail !== senderName;
  return (
    <article
      className={"mail-content" + (inbound ? " is-in" : " is-out")}
      data-mail-content
      data-mail-content-id={message.id}
      data-mail-direction={inbound ? "inbound" : "outbound"}
    >
      <header className="mail-content-meta">
        <span className={`mail-row-avatar mail-avatar-t${avatarTone(senderName)}`} aria-hidden="true">
          {initialsOf(senderName)}
        </span>
        <div className="mail-content-who">
          <strong>{senderName}</strong>
          {showEmail ? <span className="muted">{`<${senderEmail}>`}</span> : null}
          <span className="muted">发送给: {toAddr || "—"}</span>
        </div>
        <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>
          {formatMailTime(message.occurred_at)}
        </time>
      </header>
      {body ? (
        <div className="mail-content-body" data-mail-body>
          <p>{body}</p>
        </div>
      ) : (
        <p className="muted" data-mail-empty>正文未缓存。点「收取」后可再打开，不会现场拉 Starry。</p>
      )}
    </article>
  );
}
