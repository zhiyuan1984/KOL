import { useState } from "react";
import { PlainText } from "./PlainText";
import { mailDigestView } from "../digestView";
import type { MailThread } from "../types";

/**
 * Conversation-level digest, shaped like the existing 规则摘录 block: title row,
 * a count line, an honest source note, then the body (clamped until asked for).
 * It follows the conversation id and never changes when another mail is picked.
 */
export function ConversationSummary({ thread }: { thread: MailThread | null }) {
  const [expanded, setExpanded] = useState(false);
  const digest = thread?.digest || null;
  const view = digest ? mailDigestView(digest) : null;
  const text = String(digest?.text || "").trim();
  const long = text.length > 200;
  const clamped = long && !expanded;

  return (
    <section
      className="mail-side-card"
      data-mail-summary-card
      data-mail-digest
      data-digest-kind={view?.kind || undefined}
      data-summary-source={digest?.source || undefined}
    >
      <header className="mail-side-card-head">
        <strong className="mail-side-title">✦ 会话摘要</strong>
        <span className="mail-side-tag">AI 生成</span>
      </header>

      {view && view.kind !== "empty" ? (
        <p className="mail-side-count" data-mail-digest-meta>
          <span data-digest-label>{view.label}</span>
          {digest?.mail_count ? <span data-digest-count> · {digest.mail_count} 封往来</span> : null}
        </p>
      ) : null}
      {view?.disclaimer ? (
        <p className="muted mail-side-hint" data-digest-disclaimer>{view.disclaimer}</p>
      ) : null}

      {text ? (
        <>
          <div
            className={"mail-side-body" + (clamped ? " is-clamped" : "")}
            data-mail-summary-body
            data-digest-body
            data-mail-summary-clamped={clamped ? "true" : "false"}
          >
            <PlainText text={text} />
          </div>
          {long ? (
            <button
              type="button"
              className="mail-more-toggle"
              data-mail-summary-toggle
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : "▶ 查看摘要"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="muted mail-side-hint" data-mail-summary-pending>摘要生成中…点「收取」后可再试。</p>
      )}
    </section>
  );
}
