import { avatarTone, initialsOf } from "../format";
import type { CorrespondentGroup } from "../groups";

const ICO_FOLDER =
  "M3.2 6.2A1.7 1.7 0 0 1 4.9 4.5h3.1l1.5 1.9h8.6a1.7 1.7 0 0 1 1.7 1.7v8.2a1.7 1.7 0 0 1-1.7 1.7H4.9a1.7 1.7 0 0 1-1.7-1.7z";

export function CorrespondentRow({
  group,
  expanded,
  selected,
  tab,
  onToggle,
}: {
  group: CorrespondentGroup;
  expanded: boolean;
  selected: boolean;
  tab: string;
  onToggle: () => void;
}) {
  const name = group.peer_name || group.peer_email;
  const fromEmail = tab === "sent" ? group.mailbox : group.peer_email;
  const toEmail = tab === "sent" ? group.peer_email : group.mailbox;
  return (
    <button
      type="button"
      className={"mail-row mail-correspondent" + (selected ? " is-selected" : "") + (group.unread_count > 0 ? " is-unread" : "")}
      data-mail-correspondent={group.peer_email}
      data-mail-expanded={expanded ? "true" : "false"}
      aria-current={selected ? "true" : undefined}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="mail-row-caret" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
      <span className={"mail-row-folder" + (expanded ? " is-open" : "")} aria-hidden="true">
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
        </span>
        <span className="mail-row-counts">
          未读 {group.unread_count} · 已读 {group.read_count}
        </span>
        <span className="mail-row-addresses">
          <span className="mail-row-addr" title={fromEmail}>发: {fromEmail || "—"}</span>
          <span className="mail-row-addr" title={toEmail}>收: {toEmail || "—"}</span>
        </span>
      </span>
      {group.unread_count > 0 ? (
        <span className="mail-count-pill is-solid" aria-label={`未读 ${group.unread_count}`}>
          {group.unread_count}
        </span>
      ) : null}
    </button>
  );
}
