import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import { loadMailThread, loadMailWorkspace, syncMailboxMail } from "../mail/client";
import { mailAnalyzeDraft, mailReplyDraft, stashComposerDraft } from "../mail/composerDraft";
import { mailDigestView } from "../mail/digestView";
import { occurredAtMs } from "../mail-time";
import {
  MAIL_ANALYZE_UNBOUND_COPY,
  MAIL_SYNC_MISSING_COPY,
  MAIL_THREAD_MISSING_COPY,
  MAIL_UNBOUND_COPY,
  type MailConversation,
  type MailMessage,
  type MailThread,
  type MailWorkspace,
} from "../mail/types";
import { isMissingEndpoint } from "../home/discoveryHome";

function formatMailTime(value?: string | null): string {
  const ms = occurredAtMs(value);
  if (!ms) return "";
  const date = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 45_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))} 小时前`;
  if (diff < 2 * 86_400_000) return "昨天";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function peerOf(row: MailConversation): string {
  return row.peer_name || row.peer_email || "未知对方";
}

function analyzePeopleOf(row: MailConversation): string[] {
  return [row.kol_uid, row.handle].map((item) => String(item || "").replace(/^@/, "").trim()).filter(Boolean);
}

function httpCopy(error: unknown, fallback: string): string {
  if (isMissingEndpoint(error)) return MAIL_SYNC_MISSING_COPY;
  const status = (error as { status?: number })?.status;
  if (status === 409) return "邮箱正在收取，请稍后再试。没有创建会话。";
  if (status === 404) return MAIL_THREAD_MISSING_COPY;
  return error instanceof Error && error.message ? error.message : fallback;
}

function MailDigestStrip({ thread }: { thread: MailThread }) {
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

function MailMessageCard({ message }: { message: MailMessage }) {
  const inbound = message.direction !== "outbound";
  const body = String(message.body_text || "").trim();
  return (
    <article
      className={"mail-message" + (inbound ? " is-in" : " is-out")}
      data-mail-message
      data-mail-direction={inbound ? "inbound" : "outbound"}
    >
      <header className="mail-message-head">
        <strong>{inbound ? "对方" : "我方"}</strong>
        <span className="muted">{message.from_addr}</span>
        <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>
          {formatMailTime(message.occurred_at)}
        </time>
      </header>
      {message.letter_summary ? <p className="mail-message-summary">{message.letter_summary}</p> : null}
      {body ? (
        <details className="mail-message-body" data-mail-body>
          <summary>查看正文</summary>
          <p>{body}</p>
        </details>
      ) : (
        <p className="muted" data-mail-empty>正文未缓存。点「收取」后可再打开，不会现场拉 Starry。</p>
      )}
    </article>
  );
}

export default function Mail() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const focusId = params.get("c") || "";
  const [workspace, setWorkspace] = useState<MailWorkspace | null>(null);
  const [thread, setThread] = useState<MailThread | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [threadError, setThreadError] = useState("");

  const conversations = useMemo(() => {
    const rows = [...(workspace?.conversations || [])];
    rows.sort((a, b) => occurredAtMs(b.last_at) - occurredAtMs(a.last_at));
    return rows;
  }, [workspace]);

  const selected = useMemo(() => {
    if (!focusId) return conversations[0] || null;
    return conversations.find((row) => row.conversation_id === focusId || row.id === focusId) || conversations[0] || null;
  }, [conversations, focusId]);

  const load = (opts?: { keepNotice?: boolean }) => {
    setLoadState("loading");
    setError("");
    if (!opts?.keepNotice) setNotice("");
    void loadMailWorkspace()
      .then((next) => {
        setWorkspace(next);
        setLoadState("ok");
      })
      .catch((e) => {
        setError(httpCopy(e, "无法读取通讯"));
        setLoadState("error");
      });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setThreadError("");
    void loadMailThread(selected.id || selected.conversation_id, selected, workspace?.source || "api")
      .then((next) => {
        if (cancelled) return;
        if (!next) {
          setThread(null);
          setThreadError(MAIL_THREAD_MISSING_COPY);
          return;
        }
        setThread(next);
      })
      .catch((e) => {
        if (!cancelled) {
          setThread(null);
          setThreadError(httpCopy(e, MAIL_THREAD_MISSING_COPY));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.conversation_id, workspace?.source]);

  const openRow = (row: MailConversation) => {
    const next = new URLSearchParams();
    const box = workspace?.box.mailbox || "";
    if (box) next.set("box", box);
    next.set("c", row.conversation_id);
    setParams(next, { replace: true });
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const receipt = await syncMailboxMail();
      setNotice(receipt.ok === false && receipt.error
        ? String(receipt.error)
        : `已收取${receipt.listed != null ? ` ${receipt.listed} 封会话` : ""}。`);
      load({ keepNotice: true });
    } catch (e) {
      setError(httpCopy(e, MAIL_SYNC_MISSING_COPY));
    } finally {
      setSyncing(false);
    }
  };

  const reply = () => {
    if (!selected || !workspace) return;
    stashComposerDraft(mailReplyDraft({
      mailbox: selected.mailbox || workspace.box.mailbox,
      conversation_id: selected.conversation_id,
      peer: peerOf(selected),
      subject: selected.subject,
    }));
    nav("/");
  };

  const analyze = () => {
    if (!selected) return;
    const people = analyzePeopleOf(selected);
    if (selected.match_state === "unbound" || !people.length) {
      setNotice(MAIL_ANALYZE_UNBOUND_COPY);
      return;
    }
    stashComposerDraft(mailAnalyzeDraft({ people, peer: peerOf(selected) }));
    nav("/");
  };

  const box = workspace?.box;
  const bound = Boolean(box?.bound && box.mailbox);

  return (
    <div className="list-page mail-page" data-mail-page data-mail-source={workspace?.source || undefined}>
      <header className="mail-hero">
        <div>
          <div className="page-kicker">通讯</div>
          <h1>通讯</h1>
          {bound ? (
            <p className="muted" data-mail-box>
              {box?.mailbox || "已绑定邮箱"}
              {box?.owner_name ? ` · ${box.owner_name}` : ""}
              {box?.synced_at ? ` · 同步 ${formatMailTime(box.synced_at)}` : " · 尚未收取"}
              {` · 未读 ${Number(box?.unread || 0)}`}
            </p>
          ) : (
            <p className="muted" data-mail-unbound-guide>
              {MAIL_UNBOUND_COPY}
            </p>
          )}
        </div>
        {loadState === "ok" && bound ? (
          <button
            type="button"
            className="btn work"
            data-mail-sync
            data-mail-entry="sync-mailbox-mail"
            disabled={syncing}
            onClick={() => void sync()}
          >
            {syncing ? "正在收取…" : "收取"}
          </button>
        ) : null}
        {loadState === "ok" && !bound ? (
          <Link className="btn work" to="/settings?tab=starry" data-mail-bind>
            去绑定邮箱
          </Link>
        ) : null}
      </header>

      {error ? <p className="error" role="alert" data-mail-error>{error}</p> : null}
      {notice ? <p className="muted" role="status" data-mail-notice>{notice}</p> : null}
      {workspace?.source === "fallback" && bound ? (
        <p className="muted" data-mail-fallback>
          通讯接口尚未开通，正在用已缓存的跟进往来只读展示。打开会话不会创建 Agent 会话。
        </p>
      ) : null}

      {loadState === "loading" ? (
        <div className="mail-split" data-mail-state="loading" aria-busy="true">
          <div className="mail-skeleton" />
          <div className="mail-skeleton" />
        </div>
      ) : null}

      {loadState === "ok" && bound ? (
        <div className="mail-split" data-mail-state="ok">
          <aside className="mail-list" data-mail-list data-mail-entry="list-mailbox-mail">
            {conversations.length === 0 ? (
              <p className="muted" data-mail-empty-list>这只邮箱还没有缓存的往来。点「收取」同步。</p>
            ) : conversations.map((row) => {
              const active = selected?.conversation_id === row.conversation_id;
              return (
                <button
                  key={row.id + row.conversation_id}
                  type="button"
                  className={"mail-row" + (active ? " is-selected" : "") + (row.unread_count > 0 ? " is-unread" : "")}
                  data-mail-thread-row={row.conversation_id}
                  data-mail-match-state={row.match_state}
                  data-mail-unread={row.unread_count}
                  aria-current={active ? "true" : undefined}
                  onClick={() => openRow(row)}
                >
                  <div className="mail-row-head">
                    <strong>{peerOf(row)}</strong>
                    <time className="muted">{formatMailTime(row.last_at)}</time>
                  </div>
                  <p className="mail-row-subject">{row.subject}</p>
                  <p className="mail-row-preview">{row.last_preview || "暂无预览"}</p>
                  <div className="mail-row-meta">
                    {row.match_state === "unbound" ? <span className="mail-chip" data-mail-unbound-chip>未建档</span> : null}
                    {row.unread_count > 0 ? <span className="mail-chip is-unread">未读 {row.unread_count}</span> : null}
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="mail-thread" data-mail-thread data-mail-entry="open-mail-thread">
            {selected && thread ? (
              <>
                <div className="mail-thread-head">
                  <div>
                    <h2>{thread.thread.subject}</h2>
                    <p className="muted">
                      {peerOf(thread.thread)}
                      {thread.thread.peer_email ? ` · ${thread.thread.peer_email}` : ""}
                    </p>
                  </div>
                  <div className="mail-thread-actions">
                    <button type="button" className="btn ghost" data-mail-reply onClick={reply}>回复</button>
                    <button
                      type="button"
                      className="btn ghost"
                      data-mail-analyze
                      data-mail-entry="kol-analyze-enqueue"
                      onClick={analyze}
                    >
                      分析
                    </button>
                  </div>
                </div>
                <MailDigestStrip thread={thread} />
                <div className="mail-timeline" data-mail-timeline>
                  {thread.messages.length
                    ? thread.messages.map((message) => <MailMessageCard key={message.id} message={message} />)
                    : <p className="muted">还没有缓存的往来正文。</p>}
                </div>
              </>
            ) : (
              <p className="muted" data-mail-thread-empty>{threadError || "选择左侧会话查看时间线。打开不会创建会话。"}</p>
            )}
          </section>
        </div>
      ) : null}

      {loadState === "ok" && !bound ? (
        <section className="mail-unbound" data-mail-state="unbound">
          <p>{MAIL_UNBOUND_COPY}</p>
          <Link className="btn ghost" to="/settings?tab=starry">打开连接 Starry</Link>
        </section>
      ) : null}

    </div>
  );
}
