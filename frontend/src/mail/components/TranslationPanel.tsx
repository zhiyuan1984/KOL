import { useMemo, useState } from "react";
import type { MailMessage } from "../types";

/** Message-level translation: it follows the selected mail id. */
export function TranslationPanel({ message }: { message: MailMessage | null }) {
  const [copied, setCopied] = useState(false);
  const translation = String(message?.translation_zh || "").trim();
  const paragraphs = useMemo(
    () => translation.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [translation],
  );
  const copy = () => {
    if (!translation) return;
    void navigator.clipboard?.writeText(translation)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };
  return (
    <section
      className="mail-side-card mail-translation"
      data-mail-translation
      data-mail-translation-for={message?.id || ""}
    >
      <header className="mail-side-card-head">
        <strong>译 中文翻译</strong>
        <button
          type="button"
          className="mail-copy-btn"
          data-mail-copy-translation
          disabled={!translation}
          onClick={copy}
        >
          {copied ? "已复制" : "复制翻译"}
        </button>
      </header>
      {paragraphs.length ? (
        <div className="mail-side-body" data-mail-translation-body>
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ) : (
        <p className="muted" data-mail-translation-pending>翻译生成中…</p>
      )}
    </section>
  );
}
