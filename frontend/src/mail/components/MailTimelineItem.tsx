import { formatMailTime } from "../format";
import type { MailMessage } from "../types";

export function MailTimelineItem({
  message,
  selected,
  onSelect,
}: {
  message: MailMessage;
  selected: boolean;
  onSelect: () => void;
}) {
  const outbound = message.direction === "outbound";
  return (
    <button
      type="button"
      className={"mail-timeline-item" + (selected ? " is-selected" : "")}
      data-mail-timeline-item={message.id}
      data-mail-selected={selected ? "true" : "false"}
      data-mail-direction={outbound ? "outbound" : "inbound"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>
        {formatMailTime(message.occurred_at)}
      </time>
      <span className="mail-timeline-subject" data-mail-timeline-subject>
        {message.subject || "(无主题)"}
      </span>
    </button>
  );
}
