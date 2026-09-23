import { useState } from "react";
import { PlainText } from "./PlainText";
import { mailDigestView } from "../digestView";
import type { MailDigest, MailMessage, MailPersonDigest, MailThread } from "../types";

export type MailAssistMode = "person" | "conversation" | "message";

function SummaryCard({
  title,
  digest,
  mailCount,
}: {
  title: string;
  digest: MailDigest | null;
  mailCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
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
        <strong className="mail-side-title">✦ {title}</strong>
        <span className="mail-side-tag">AI 生成</span>
      </header>
      {view && view.kind !== "empty" ? (
        <p className="mail-side-count" data-mail-digest-meta>
          <span data-digest-label>{view.label}</span>
          {mailCount ? <span data-digest-count> · {mailCount} 封往来</span> : null}
          {digest?.generated_at ? <span data-digest-generated> · {new Date(digest.generated_at).toLocaleString("zh-CN")}</span> : null}
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
        <p className="muted mail-side-hint" data-mail-summary-pending>
          {digest?.source === "analysis_failed" ? "摘要生成失败，保留旧摘要。" : "摘要生成中…点「收取」后可再试。"}
        </p>
      )}
    </section>
  );
}

function MessageSummaryCard({ message }: { message: MailMessage | null }) {
  const text = String(message?.letter_summary || "").trim();
  return (
    <section className="mail-side-card" data-mail-summary-card data-mail-message-summary>
      <header className="mail-side-card-head">
        <strong className="mail-side-title">✦ 邮件总结</strong>
        <span className="mail-side-tag">AI 生成</span>
      </header>
      {text ? (
        <div className="mail-side-body" data-mail-summary-body>
          <PlainText text={text} />
        </div>
      ) : (
        <p className="muted mail-side-hint" data-mail-summary-pending>总结生成中…</p>
      )}
    </section>
  );
}

export function MailAssist({
  mode,
  thread,
  person,
  message,
}: {
  mode: MailAssistMode;
  thread: MailThread | null;
  person: MailPersonDigest | null;
  message: MailMessage | null;
}) {
  return (
    <aside className="mail-side" data-mail-side>
      {mode === "person" ? (
        <SummaryCard
          title="人来往总结"
          digest={person ? { text: person.digest_text, source: person.digest_source, generated_at: person.digest_generated_at } : null}
        />
      ) : mode === "conversation" ? (
        <SummaryCard
          title="会话摘要"
          digest={thread?.digest || null}
          mailCount={thread?.messages.length}
        />
      ) : (
        <MessageSummaryCard message={message} />
      )}
      <TranslationPanel message={message} />
    </aside>
  );
}

function TranslationPanel({ message }: { message: MailMessage | null }) {
  const translation = String(message?.translation_zh || "").trim();
  const paragraphs = translation.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <section className="mail-side-card" data-mail-translation data-mail-translation-for={message?.id || ""}>
      <header className="mail-side-card-head">
        <strong className="mail-side-title">✦ 中文翻译</strong>
      </header>
      {paragraphs.length ? (
        <div className="mail-side-body" data-mail-translation-body>
          <PlainText text={translation} />
        </div>
      ) : (
        <p className="muted mail-side-hint" data-mail-translation-pending>
          {message?.memory_source === "pending" ? "翻译生成中…" : "暂无中文译稿。"}
        </p>
      )}
    </section>
  );
}
