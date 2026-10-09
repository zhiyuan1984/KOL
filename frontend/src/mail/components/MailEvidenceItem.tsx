import { useEffect, useId, useRef, useState } from "react";
import { occurredAtMs } from "../../mail-time";
import { mailExcerpt, quotePosition, splitMailBody, type MailEvidenceFocus, type MailEvidenceQuote } from "../evidence";

function Highlight({ text, quote }: { text: string; quote: string }) {
  const at = quotePosition(text, quote);
  return at < 0 ? <>{text}</> : <>{text.slice(0, at)}<mark data-evidence-highlight tabIndex={-1}>{text.slice(at, at + quote.length)}</mark>{text.slice(at + quote.length)}</>;
}

export function MailEvidenceItem({
  id, subject, direction, contact, occurredAt, body, preview = "", quotes = [], inference = "",
  source = "", version = "", translation = "", attachments = [], focus, onReturnToActions,
}: {
  id: string; subject: string; direction: string; contact?: string; occurredAt?: string;
  body: string | null; preview?: string; quotes?: MailEvidenceQuote[]; inference?: string;
  source?: string; version?: string; translation?: string; attachments?: string[]; focus?: MailEvidenceFocus;
  onReturnToActions?: () => void;
}) {
  const bodyId = useId();
  const root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; source: string; snippet: string } | null>(null);
  const active = revealed?.id === id ? revealed : null;
  const excerpt = mailExcerpt(body, preview, quotes);
  const parts = splitMailBody(body || "");
  const highlight = active?.source === "body" ? active.snippet : "";
  const acrossParts = Boolean(highlight && body && quotePosition(body, highlight) >= 0 && !Object.values(parts).some(part => quotePosition(part, highlight) >= 0));
  const matched = active && (active.source === "body" ? body !== null && quotePosition(body, active.snippet) >= 0
    : active.source === "subject" ? quotePosition(subject, active.snippet) >= 0 : false);
  const ms = occurredAtMs(occurredAt);
  useEffect(() => {
    setOpen(false); setRevealed(null);
  }, [id]);
  useEffect(() => {
    if (!focus) return;
    setOpen(true); setRevealed({ id, source: focus.source, snippet: focus.snippet });
  }, [id, focus]);
  useEffect(() => {
    if (!open || !active) return;
    // Only a deliberate citation click moves focus; polling never does.
    const target = root.current?.querySelector<HTMLElement>("[data-evidence-original] [data-evidence-highlight]")
      || root.current?.querySelector<HTMLElement>("[data-evidence-original]");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [open, active, focus?.request]);
  return <article className="mail-evidence-item" ref={root} data-mail-evidence={id}>
    <header className="mail-evidence-meta">
      <span className="mail-evidence-direction">{direction === "outbound" ? "发出 ↗" : "收到 ↙"}</span>
      {contact ? <span className="mail-evidence-contact" title={contact}>{contact}</span> : null}
      <strong className="mail-evidence-subject" title={subject}>{subject || "无主题"}</strong>
      <time data-mail-time dateTime={ms ? new Date(ms).toISOString() : undefined}>{ms ? new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "时间未同步"}</time>
      <button type="button" className="evidence-text-button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>{open ? "收起原文" : "展开原文"}</button>
    </header>
    {excerpt.text ? <p className="mail-evidence-excerpt" data-evidence-excerpt><span className="mail-evidence-label">{excerpt.label} · </span><Highlight text={excerpt.text} quote={excerpt.quote} /></p>
      : <p className="mail-evidence-missing" data-mail-empty>{body === null ? "正文尚未取得，请核验邮箱同步。" : "正文为空"}</p>}
    {inference ? <p className="mail-evidence-inference" data-mail-judgment><span className="mail-evidence-label">推断 · </span>{inference}</p> : null}
    <div id={bodyId} hidden={!open} className="mail-evidence-detail" data-evidence-original tabIndex={-1}>
      <p className="mail-evidence-source">来源：{source || "当前会话邮件"} · 邮件 {id}{version ? ` · 版本 ${version}` : " · 来源版本未提供"}</p>
      {inference ? <p>推断 · {inference}</p> : null}
      {active ? <p role="status">{matched ? "已定位引用原文" : "当前原文无法核验这条引用，请检查来源与版本。"}</p> : null}
      {active?.source === "subject" ? <p>主题原文 · <Highlight text={subject} quote={active.snippet} /></p> : null}
      {body === null ? <p className="mail-evidence-missing">正文尚未取得，当前预览不能代替完整原文。</p> : <>
        <p className="kol-mail-body reply-context-body"><Highlight text={parts.main} quote={highlight} /></p>
        {parts.signature ? <details open={Boolean(highlight && quotePosition(parts.signature, highlight) >= 0)}><summary>签名</summary><p className="kol-mail-body reply-context-body"><Highlight text={parts.signature} quote={highlight} /></p></details> : null}
        {parts.history ? <details open={Boolean(highlight && quotePosition(parts.history, highlight) >= 0)}><summary>引用与历史往来</summary><p className="kol-mail-body reply-context-body"><Highlight text={parts.history} quote={highlight} /></p></details> : null}
        <details open={acrossParts || undefined}><summary>完整原文（含签名与历史）</summary><p className="kol-mail-body reply-context-body" data-evidence-full-body><Highlight text={body} quote={acrossParts ? highlight : ""} /></p></details>
      </>}
      {attachments.length ? <details><summary>附件与链接（{attachments.length}）</summary><ul>{attachments.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
      {translation ? <details><summary>查看中文译文</summary><p className="reply-context-body">{translation}</p></details> : null}
      {onReturnToActions ? <button type="button" className="evidence-text-button" onClick={onReturnToActions}>回到下一步动作</button> : null}
    </div>
  </article>;
}
