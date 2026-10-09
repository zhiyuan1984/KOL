import { useEffect, useRef, useState } from "react";
import { api } from "../api";

import type { ReplyContext } from "./reply-context";
import { MailEvidenceItem } from "./components/MailEvidenceItem";

/** Poll the authorized local projection, never the supplier or model. Changes
 * stay in a separate panel so they cannot replace an employee's active editor.
 */
export function ReplyContextPanel({ sessionId, onAnalyze, analyzing = false }: { sessionId: string; onAnalyze?: () => void; analyzing?: boolean }) {
  const [context, setContext] = useState<ReplyContext | null>(null);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const revision = useRef("");
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    let active = true, loading = false;
    revision.current = "";
    setContext(null); setError(""); setChanged(false);
    const read = async () => {
      if (!active || loading) return;
      loading = true; setBusy(true);
      try {
        const next = await api.replyContext(sessionId);
        if (!active) return;
        if (revision.current && revision.current !== next.version) setChanged(true);
        revision.current = next.version;
        setContext(next); setError("");
      } catch (cause) {
        if (!active) return;
        const status = (cause as { status?: number }).status;
        if ([401,403,404].includes(status || 0)) { setContext(null); revision.current = ""; }
        setError("邮件依据暂不可核验，请检查当前权限与同步状态。人工草稿仍保留。");
      } finally { loading = false; if (active) setBusy(false); }
    };
    refresh.current = () => void read();
    void read();
    const interval = setInterval(() => { if (!document.hidden) void read(); }, 15000);
    return () => { active = false; clearInterval(interval); };
  }, [sessionId]);
  return <section className="reply-context-panel" aria-label="回复任务邮件依据" data-reply-context>
    <div className="reply-context-heading"><strong>邮件依据</strong><button className="evidence-text-button" disabled={busy} onClick={() => refresh.current()}>{busy ? "正在核验" : "核验已同步邮件"}</button></div>
    {error ? <p role="status">{error}</p> : null}
    {changed ? <p role="status">相关邮件已变化，请比较新依据。人工草稿未被替换。<button className="link-button" onClick={() => setChanged(false)}>已查看变化</button></p> : null}
    {context ? <>
      {onAnalyze ? <button className="evidence-text-button" disabled={busy || analyzing} onClick={onAnalyze}>准备分析最新邮件对草稿的影响</button> : null}
      <p className="muted">{context.complete ? "读取已核验缓存" : "邮件源或上下文尚未完整核验"} · {context.messages.length} 封 · 不代表远端实时完整</p>
      {context.missing_body_count ? <p role="status">{context.missing_body_count} 封邮件缺少正文，请先完成邮箱同步核验后再确认发送。</p> : null}
      <details><summary>查看原文与来源版本</summary>
        {context.sources.map(source => <p className="muted" key={source.mailbox}>{source.mailbox} · 最后同步核验：{source.checked_at ? new Date(source.checked_at).toLocaleString() : "未核验"}{source.state === "failed" ? " · 同步失败" : ""}</p>)}
        {context.messages.map(message => <div key={message.id} data-reply-mail={message.id}>
          <MailEvidenceItem id={message.id} subject={message.subject} direction={message.direction} occurredAt={message.occurred_at}
            body={message.body} contact={message.mailbox} source={message.source} version={message.version} />
        </div>)}
      </details>
      {context.sources.some(source => source.state === "failed") ? <p role="status">邮箱同步失败，请核验已同步邮件后重试。</p> : null}
    </> : !error ? <p className="muted">正在读取当前任务的授权邮件依据</p> : null}
  </section>;
}
