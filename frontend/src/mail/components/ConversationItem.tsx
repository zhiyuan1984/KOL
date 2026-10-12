import type { MailConversation } from "../types";
import { formatMailTime } from "../format";
import { MailIcon } from "./MailIcon";

export function ConversationItem({ row, expanded, current, mailCount, onToggle, starred = false, onStar }: {
  row: MailConversation; expanded: boolean; current: boolean; mailCount: number; onToggle: () => void;
  starred?: boolean; onStar?: () => void;
}) {
  return <div className={"mail-subject-row" + (row.unread_count > 0 ? " is-unread" : "") + (current ? " is-current" : "")}>
    {onStar ? <button type="button" className={"mail-list-star" + (starred ? " is-starred" : "")}
      aria-label={starred ? "取消收藏" : "收藏此会话"} aria-pressed={starred} data-mail-list-star={row.conversation_id} onClick={onStar}>
      <MailIcon name="star" filled={starred} />
    </button> : null}
    <button type="button" className={"mail-row mail-conversation" + (current ? " is-current" : "")}
      data-mail-thread-row={row.conversation_id} data-mail-match-state={row.match_state}
      data-mail-expanded={expanded ? "true" : "false"} data-mail-mail-count={mailCount || undefined}
      aria-expanded={expanded} aria-current={current ? "true" : undefined} onClick={onToggle}>
      <span className="mail-row-caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      <span className="mail-row-subject" title={row.subject || "(无主题)"}>{row.subject || "(无主题)"}</span>
      {row.match_state === "unbound" ? <span className="mail-chip" data-mail-unbound-chip>未建档</span> : null}
      <time className="mail-row-time" dateTime={row.last_at || undefined}>{formatMailTime(row.last_at)}</time>
    </button>
  </div>;
}
