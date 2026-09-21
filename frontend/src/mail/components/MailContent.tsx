import { avatarTone, formatMailTime, initialsOf } from "../format";
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
  const body = String(message.body_text || "").trim();
  const senderName = inbound ? peerName || mailbox || "对方" : ownerName || mailbox || "我方";
  const senderEmail = message.from_addr || (inbound ? peerEmail : mailbox);
  const toAddr = message.to_addr || (inbound ? mailbox : peerEmail);
  return (
    <article
      className={"mail-content" + (inbound ? " is-in" : " is-out")}
      data-mail-content
      data-mail-content-id={message.id}
      data-mail-direction={inbound ? "inbound" : "outbound"}
    >
      <h2 className="mail-content-subject" data-mail-content-subject>
        {message.subject || "(无主题)"}
      </h2>
      <header className="mail-content-meta">
        <span className={`mail-row-avatar mail-avatar-t${avatarTone(senderName)}`} aria-hidden="true">
          {initialsOf(senderName)}
        </span>
        <div className="mail-content-who">
          <strong>{senderName}</strong>
          {senderEmail ? <span className="muted">{`<${senderEmail}>`}</span> : null}
          <span className="muted">发送给: {toAddr || "—"}</span>
        </div>
        <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>
          {formatMailTime(message.occurred_at)}
        </time>
      </header>
      {message.letter_summary ? <p className="mail-content-summary">{message.letter_summary}</p> : null}
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
