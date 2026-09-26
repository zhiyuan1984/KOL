import type { CorrespondentGroup } from "../groups";

/**
 * L1 of the mailbox tree: the peer address and how many subjects (conversations)
 * hang under it. Clicking only expands or collapses — it never moves the reader.
 */
export function CorrespondentRow({
  group,
  expanded,
  onToggle,
}: {
  group: CorrespondentGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const subjects = group.conversations.length;
  return (
    <button
      type="button"
      className={"mail-row mail-correspondent" + (expanded ? " is-open" : "")}
      data-mail-correspondent={group.peer_email}
      data-mail-expanded={expanded ? "true" : "false"}
      data-mail-thread-count={subjects}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="mail-row-caret" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
      <span className="mail-row-addr">{group.peer_email}</span>
      <span className="mail-row-count-tag" data-mail-thread-count-tag>
        {subjects} 个主题
      </span>
    </button>
  );
}
