import { useState } from "react";
import { PlainText } from "./PlainText";
import { mailDigestView } from "../digestView";
import type { MailPersonDigest } from "../types";

/**
 * 往来摘要 body: the person digest from codex memory. The label comes from
 * `mailDigestView` so a rule extract is never dressed up as a model summary,
 * and a long digest stays clamped to six lines until asked for it.
 */
export function MailDigestCard({ digest }: { digest: MailPersonDigest | null }) {
  const [expanded, setExpanded] = useState(false);
  const view = mailDigestView(digest
    ? { text: digest.digest_text, source: digest.digest_source, generated_at: digest.digest_generated_at }
    : null);
  const text = String(digest?.digest_text || "").trim();
  const long = text.length > 200;
  const clamped = long && !expanded;
  return (
    <>
      {view.kind !== "empty" ? (
        <p className="mail-side-count" data-mail-digest-meta>
          <span data-digest-label>{view.label}</span>
          {digest?.digest_generated_at ? (
            <span data-digest-generated> · {new Date(digest.digest_generated_at).toLocaleString("zh-CN")}</span>
          ) : null}
        </p>
      ) : null}
      {view.disclaimer ? (
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
          {digest?.digest_source === "analysis_failed" ? "摘要生成失败，保留旧摘要。" : "摘要生成中…点「收取」后可再试。"}
        </p>
      )}
    </>
  );
}
