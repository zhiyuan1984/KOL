import { avatarTone, formatMailTime, initialsOf } from "../format";
import type { MailConversation } from "../types";

const ICO_FOLDER =
  "M3.2 6.2A1.7 1.7 0 0 1 4.9 4.5h3.1l1.5 1.9h8.6a1.7 1.7 0 0 1 1.7 1.7v8.2a1.7 1.7 0 0 1-1.7 1.7H4.9a1.7 1.7 0 0 1-1.7-1.7z";

export function ConversationItem({
  row,
  expanded,
  selected,
  onToggle,
}: {
  row: MailConversation;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = row.peer_name || row.peer_email || "未知对方";
  return (
    <button
      type="button"
      className={"mail-row" + (selected ? " is-selected" : "") + (row.unread_count > 0 ? " is-unread" : "")}
      data-mail-thread-row={row.conversation_id}
      data-mail-match-state={row.match_state}
      data-mail-unread={row.unread_count}
      data-mail-expanded={expanded ? "true" : "false"}
      aria-current={selected ? "true" : undefined}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="mail-row-caret" aria-hidden="true" data-mail-row-caret>
        {expanded ? "▾" : "▸"}
      </span>
      <span className={"mail-row-folder" + (expanded ? " is-open" : "")} aria-hidden="true" data-mail-row-folder>
        <svg viewBox="0 0 24 24" width="15" height="15">
          <path
            d={ICO_FOLDER}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={`mail-row-avatar mail-avatar-t${avatarTone(name)}`} aria-hidden="true">
        {initialsOf(name)}
      </span>
      <span className="mail-row-main">
        <span className="mail-row-head">
          <strong>{name}</strong>
          <time className="muted">{formatMailTime(row.last_at)}</time>
        </span>
        <span className="mail-row-subject">{row.subject}</span>
        <span className="mail-row-preview">{row.last_preview || "暂无预览"}</span>
        {row.match_state === "unbound" ? (
          <span className="mail-row-meta">
            <span className="mail-chip" data-mail-unbound-chip>未建档</span>
          </span>
        ) : null}
      </span>
      {row.unread_count > 0 ? (
        <span className="mail-count-pill is-solid" aria-label={`未读 ${row.unread_count}`}>
          {row.unread_count}
        </span>
      ) : null}
    </button>
  );
}
