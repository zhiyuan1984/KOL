import { formatMailStamp } from "../format";
import type { MailMessage } from "../types";

export type MailReadState = "read" | "unread";

/**
 * L3 of the mailbox tree: one mail. Title, read state and the 收/发 stamp —
 * nothing else, so a conversation stays scannable at 280–320px.
 */
export function MailTimelineItem({
  message,
  selected,
  readState,
  onSelect,
}: {
  message: MailMessage;
  selected: boolean;
  readState: MailReadState;
  onSelect: () => void;
}) {
  const outbound = message.direction === "outbound";
  const stamp = formatMailStamp(message.occurred_at);
  return (
    <button
      type="button"
      className={"mail-timeline-item" + (selected ? " is-selected" : "")}
      data-mail-timeline-item={message.id}
      data-mail-selected={selected ? "true" : "false"}
      data-mail-read-state={readState}
      data-mail-direction={outbound ? "outbound" : "inbound"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="mail-timeline-subject" data-mail-timeline-subject>
        {message.subject || "(无主题)"}
      </span>
      <span className="mail-timeline-meta">
        <span className={"mail-read-tag is-" + readState} data-mail-read-label>
          {readState === "unread" ? "未读" : "已读"}
        </span>
        {stamp ? (
          <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>
            {`${outbound ? "发" : "收"} ${stamp}`}
          </time>
        ) : null}
      </span>
    </button>
  );
}
