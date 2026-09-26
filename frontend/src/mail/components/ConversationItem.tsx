import type { MailConversation } from "../types";

/**
 * L2 of the mailbox tree: the subject and its mail count. The count is empty
 * until the conversation detail has been read, so the row never guesses.
 */
export function ConversationItem({
  row,
  expanded,
  current,
  mailCount,
  onToggle,
}: {
  row: MailConversation;
  expanded: boolean;
  current: boolean;
  mailCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={"mail-row mail-conversation" + (current ? " is-current" : "")}
      data-mail-thread-row={row.conversation_id}
      data-mail-match-state={row.match_state}
      data-mail-expanded={expanded ? "true" : "false"}
      data-mail-mail-count={mailCount || undefined}
      aria-expanded={expanded}
      aria-current={current ? "true" : undefined}
      onClick={onToggle}
    >
      <span className="mail-row-caret" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
      <span className="mail-row-subject">{row.subject || "(无主题)"}</span>
      {mailCount > 0 ? <span className="mail-row-count-tag">{mailCount} 封</span> : null}
      {row.match_state === "unbound" ? (
        <span className="mail-chip" data-mail-unbound-chip>未建档</span>
      ) : null}
    </button>
  );
}
