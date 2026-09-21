import Markdown from "../../components/Markdown";
import { mailDigestView } from "../digestView";
import type { MailThread } from "../types";

/** Conversation-level digest. It follows the conversation id and never
 *  changes when the operator selects another mail inside the thread. */
function DigestStrip({ thread }: { thread: MailThread }) {
  const view = mailDigestView(thread.digest);
  if (view.kind === "empty") return null;
  return (
    <article
      className={`mail-digest is-${view.kind}`}
      data-mail-digest
      data-digest-kind={view.kind}
      data-summary-source={thread.digest.source || undefined}
    >
      <strong data-digest-label>{view.label}</strong>
      {thread.digest.mail_count ? <small data-digest-count>{thread.digest.mail_count} 封往来</small> : null}
      {view.disclaimer ? <p className="muted" data-digest-disclaimer>{view.disclaimer}</p> : null}
      {view.lede ? <p className="muted" data-digest-lede>{view.lede}</p> : null}
      {view.kind === "model" && view.text ? (
        <div className="mail-digest-body" data-digest-body>
          <Markdown>{view.text}</Markdown>
        </div>
      ) : null}
      {view.kind === "rule" && view.text ? (
        <details className="mail-digest-excerpt" data-digest-excerpt>
          <summary>查看摘录</summary>
          <div className="mail-digest-body" data-digest-body>
            <Markdown>{view.text}</Markdown>
          </div>
        </details>
      ) : null}
    </article>
  );
}

export function ConversationSummary({ thread }: { thread: MailThread | null }) {
  const text = String(thread?.digest?.text || "").trim();
  return (
    <section className="mail-side-card" data-mail-summary-card>
      <header className="mail-side-card-head">
        <strong>✦ 会话摘要</strong>
        <span className="mail-side-tag">AI 生成</span>
      </header>
      {text ? (
        <div className="mail-side-body" data-mail-summary-body>
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <p className="muted" data-mail-summary-pending>摘要生成中…点「收取」后可再试。</p>
      )}
      {thread ? <DigestStrip thread={thread} /> : null}
    </section>
  );
}
