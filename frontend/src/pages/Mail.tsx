import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import { api } from "../api";
import { hydratePollDelayMs, loadMailThread, loadMailWorkspace, syncMailboxMail } from "../mail/client";
import { mailAnalyzeDraft, mailReplyDraft, stashComposerDraft } from "../mail/composerDraft";
import { mailDigestView } from "../mail/digestView";
import { occurredAtMs } from "../mail-time";
import {
  MAIL_ANALYZE_UNBOUND_COPY,
  MAIL_SYNC_MISSING_COPY,
  MAIL_THREAD_MISSING_COPY,
  MAIL_UNBOUND_COPY,
  type MailBoxBinding,
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

function initialsOf(name: string): string {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

function avatarTone(seed: string): number {
  const text = String(seed || "");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 6;
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

const MAIL_TABS = [
  { key: "inbox", label: "收件箱" },
  { key: "sent", label: "发件箱" },
  { key: "unread", label: "未读" },
  { key: "read", label: "已读" },
] as const;
type MailTab = (typeof MAIL_TABS)[number]["key"];

const ICO_SEARCH = "M11 4.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4M16.4 16.4 20 20";
const ICO_FILTER = "M4 5h16l-6.3 7.3v5.2l-3.4-2.1v-3.1Z";
const ICO_REPLY = "M9.5 14.5 4.5 9.5l5-5M4.5 9.5H13a6.5 6.5 0 0 1 6.5 6.5v3";
const ICO_SPARKLE = "M12 3.8l1.9 4.9 4.9 1.9-4.9 1.9L12 17.4l-1.9-4.9-4.9-1.9 4.9-1.9ZM18.6 16.4v4M16.6 18.4h4";
const ICO_DOC = "M7 3.5h6.5L18 8v12.5H7ZM13.5 3.5V8H18";

function MailIco({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className ? `mail-ico ${className}` : "mail-ico"} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailIcoMore() {
  return (
    <svg className="mail-ico" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.35" fill="currentColor" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.35" fill="currentColor" />
    </svg>
  );
}

function useDismissable(open: boolean, close: () => void, ref: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
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

function MailMessageCard({
  message,
  current,
  onSelect,
  peerName,
  peerEmail,
  ownerName,
  mailbox,
}: {
  message: MailMessage;
  current: boolean;
  onSelect: () => void;
  peerName: string;
  peerEmail: string;
  ownerName: string;
  mailbox: string;
}) {
  const inbound = message.direction !== "outbound";
  const body = String(message.body_text || "").trim();
  const senderName = inbound ? peerName || mailbox || "对方" : ownerName || mailbox || "我方";
  const senderEmail = message.from_addr || (inbound ? peerEmail : mailbox);
  const toAddr = message.to_addr || (inbound ? mailbox : peerEmail);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useDismissable(menuOpen, () => setMenuOpen(false), menuRef);
  const copyText = (value: string) => {
    if (value) void navigator.clipboard?.writeText(value).catch(() => undefined);
    setMenuOpen(false);
  };
  return (
    <article
      className={"mail-message" + (inbound ? " is-in" : " is-out") + (current ? " is-current" : "")}
      data-mail-message
      data-mail-direction={inbound ? "inbound" : "outbound"}
      onClick={onSelect}
    >
      <header className="mail-message-head">
        <span className={`mail-row-avatar mail-avatar-t${avatarTone(senderName)}`} aria-hidden="true">
          {initialsOf(senderName)}
        </span>
        <div className="mail-message-who">
          <strong>{senderName}</strong>
          {senderEmail ? <span className="muted">{`<${senderEmail}>`}</span> : null}
          <span className="muted mail-message-to">发送给: {toAddr || "—"}</span>
        </div>
        <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>
          {formatMailTime(message.occurred_at)}
        </time>
        {current ? (
          <div className="mail-msg-more" ref={menuRef}>
            <button
              type="button"
              className="mail-more-btn"
              aria-label="更多操作"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              <MailIcoMore />
            </button>
            {menuOpen ? (
              <div className="mail-popover" onClick={(e) => e.stopPropagation()}>
                <button type="button" disabled={!senderEmail} onClick={() => copyText(senderEmail)}>
                  复制发件人地址
                </button>
                <button type="button" disabled={!body} onClick={() => copyText(body)}>复制正文</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      {message.letter_summary ? <p className="mail-message-summary">{message.letter_summary}</p> : null}
      {body ? (
        <div className="mail-message-body" data-mail-body>
          <p>{body}</p>
        </div>
      ) : (
        <p className="muted" data-mail-empty>正文未缓存。点「收取」后可再打开，不会现场拉 Starry。</p>
      )}
    </article>
  );
}

function MailSummaryCard({ thread }: { thread: MailThread | null }) {
  const text = String(thread?.digest?.text || "").trim();
  return (
    <section className="mail-side-card" data-mail-summary-card>
      <header className="mail-side-card-head">
        <strong>✦ 中文摘要</strong>
        <span className="mail-side-tag">AI 生成</span>
      </header>
      {text ? (
        <div className="mail-side-body" data-mail-summary-body>
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <p className="muted" data-mail-summary-pending>摘要生成中…点「收取」后可再试。</p>
      )}
    </section>
  );
}

function MailTranslationCard({ message }: { message: MailMessage | null }) {
  const [copied, setCopied] = useState(false);
  const translation = String(message?.translation_zh || "").trim();
  const paragraphs = useMemo(
    () => translation.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [translation],
  );
  const copy = () => {
    if (!translation) return;
    void navigator.clipboard?.writeText(translation).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };
  return (
    <section className="mail-side-card mail-translation" data-mail-translation>
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

export default function Mail() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const focusId = params.get("c") || "";
  const boxParam = params.get("box") || "";
  const [workspace, setWorkspace] = useState<MailWorkspace | null>(null);
  const [thread, setThread] = useState<MailThread | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<MailTab>("inbox");
  const [unboundOnly, setUnboundOnly] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState("");
  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({});
  const [mobilePanel, setMobilePanel] = useState<"original" | "summary" | "translation">("original");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const conversations = useMemo(() => {
    const rows = [...(workspace?.conversations || [])];
    rows.sort((a, b) => occurredAtMs(b.last_at) - occurredAtMs(a.last_at));
    return rows;
  }, [workspace]);

  const visibleConversations = useMemo(() => {
    let rows = conversations;
    if (tab === "sent") rows = rows.filter((row) => row.last_direction === "outbound");
    else if (tab === "unread") rows = rows.filter((row) => row.unread_count > 0);
    else if (tab === "read") rows = rows.filter((row) => row.unread_count <= 0);
    if (unboundOnly) rows = rows.filter((row) => row.match_state === "unbound");
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        [row.peer_name, row.peer_email, row.subject, row.last_preview]
          .some((field) => String(field || "").toLowerCase().includes(q)));
    }
    return rows;
  }, [conversations, tab, unboundOnly, query]);

  const selected = useMemo(() => {
    if (!focusId) return conversations[0] || null;
    return conversations.find((row) => row.conversation_id === focusId || row.id === focusId) || conversations[0] || null;
  }, [conversations, focusId]);

  const load = (opts?: { keepNotice?: boolean }) => {
    setLoadState("loading");
    setError("");
    if (!opts?.keepNotice) setNotice("");
    void loadMailWorkspace(boxParam || undefined)
      .then((next) => {
        setWorkspace(next);
        setLoadState("ok");
      })
      .catch((e) => {
        const status = (e as { status?: number }).status;
        if (status === 401) setError("请先登录后再查看通讯。");
        else setError(httpCopy(e, "无法读取通讯"));
        setLoadState("error");
      });
  };

  useEffect(() => {
    load();
    // Reload list + thread for the mailbox selected via ?box= (card click).
  }, [boxParam]);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const key = selected.id || selected.conversation_id;
    const source = workspace?.source || "api";
    setThreadError("");
    setCurrentMessageId("");
    const fetchThread = (attempt: number) => {
      void loadMailThread(key, selected, source)
        .then((next) => {
          if (cancelled) return;
          if (!next) {
            setThread(null);
            setThreadError(MAIL_THREAD_MISSING_COPY);
            return;
          }
          setThread(next);
          // Bodies/translations are filled in behind the first paint; re-read on a
          // bounded cadence instead of blocking on the remote mailbox.
          const delay = next.hydrating ? hydratePollDelayMs(attempt + 1) : null;
          if (delay != null) timer = window.setTimeout(() => fetchThread(attempt + 1), delay);
        })
        .catch((e) => {
          if (!cancelled) {
            setThread(null);
            setThreadError(httpCopy(e, MAIL_THREAD_MISSING_COPY));
          }
        });
    };
    fetchThread(0);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [selected?.id, selected?.conversation_id, workspace?.source]);

  useDismissable(moreOpen, () => setMoreOpen(false), moreRef);

  const markRead = (row: MailConversation) => {
    if (row.unread_count <= 0) return;
    // Optional endpoint: ignore 404/other failures silently.
    void api.markMailConversationRead(row.id || row.conversation_id);
    setWorkspace((prev) => prev
      ? {
          ...prev,
          conversations: prev.conversations.map((item) =>
            item.conversation_id === row.conversation_id ? { ...item, unread_count: 0 } : item),
        }
      : prev);
  };

  const openRow = (row: MailConversation) => {
    const next = new URLSearchParams();
    const box = row.mailbox || workspace?.box.mailbox || "";
    if (box) next.set("box", box);
    next.set("c", row.conversation_id);
    setParams(next, { replace: true });
    markRead(row);
  };

  const openBox = (binding: MailBoxBinding) => {
    const next = new URLSearchParams();
    if (binding.mailbox) next.set("box", binding.mailbox);
    setParams(next, { replace: true });
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const receipt = await syncMailboxMail(boxParam || undefined);
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

  const generateReply = () => {
    if (!selected || !workspace) return;
    const draft = mailReplyDraft({
      mailbox: selected.mailbox || workspace.box.mailbox,
      conversation_id: selected.conversation_id,
      peer: peerOf(selected),
      subject: selected.subject,
    });
    stashComposerDraft({
      ...draft,
      text: `请根据与 ${peerOf(selected)} 的往来，为「${selected.subject || "(无主题)"}」生成一封回复草稿。`,
    });
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

  const starredOf = (row: MailConversation | null | undefined): boolean => {
    if (!row) return false;
    const key = row.id || row.conversation_id;
    return starOverrides[key] ?? Boolean(row.starred);
  };

  const toggleStar = () => {
    if (!selected) return;
    const key = selected.id || selected.conversation_id;
    const next = !starredOf(selected);
    // Optional endpoint: local state wins when PATCH is unavailable.
    void api.updateMailConversation(key, { starred: next });
    setStarOverrides((prev) => ({ ...prev, [key]: next }));
  };

  const box = workspace?.box;
  const bound = Boolean(box?.bound && box.mailbox);
  const bindings = box?.bindings || [];
  const activeBox = boxParam || box?.mailbox || "";

  const currentMessage = useMemo(() => {
    if (!thread || !thread.messages.length) return null;
    return thread.messages.find((m) => m.id === currentMessageId) || thread.messages[thread.messages.length - 1];
  }, [thread, currentMessageId]);

  const starred = starredOf(thread?.thread || selected);

  return (
    <div className="list-page mail-page" data-mail-page data-mail-source={workspace?.source || undefined}>
      <header className="mail-hero">
        <div className="mail-hero-copy">
          <div className="mail-title-row">
            <h1>邮箱通讯</h1>
            <span className="muted mail-hero-sub">管理多邮箱的邮件沟通，推动合作进展</span>
          </div>
          {bound ? (
            <p className="muted" data-mail-box>
              {box?.mailbox || "已绑定邮箱"}
              {box?.owner_name ? ` · ${box.owner_name}` : ""}
              {box?.synced_at ? ` · 同步 ${formatMailTime(box.synced_at)}` : " · 尚未收取"}
              {` · 未读 ${Number(box?.total_unread ?? box?.unread ?? 0)}`}
            </p>
          ) : (
            <p className="muted" data-mail-unbound-guide>
              {MAIL_UNBOUND_COPY}
            </p>
          )}
        </div>
        {loadState === "ok" && !bound ? (
          <Link className="btn work" to="/settings?tab=starry" data-mail-bind>
            去绑定邮箱
          </Link>
        ) : null}
      </header>

      {loadState === "ok" && bound ? (
        <div className="mail-boxbar" data-mail-boxbar>
          <div className="mail-box-cards">
            {bindings.map((binding) => {
              const active = binding.mailbox === activeBox;
              const failed = Boolean(binding.error);
              return (
                <button
                  key={binding.mailbox}
                  type="button"
                  className={"mail-box-card" + (active ? " is-active" : "") + (failed ? " is-error" : "")}
                  data-mail-boxchip={binding.mailbox}
                  aria-pressed={active}
                  title={failed ? String(binding.error) : binding.mailbox}
                  onClick={() => openBox(binding)}
                >
                  <span className={"mail-box-dot" + (failed ? " is-error" : " is-ok")} aria-hidden="true" />
                  <span className="mail-box-label">{binding.mailbox}</span>
                  {binding.unread > 0 ? <span className="mail-count-pill">{binding.unread}</span> : null}
                  {binding.owner_name ? <span className="mail-box-addr muted">{binding.owner_name}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="mail-boxbar-actions">
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
            <Link className="btn ghost" to="/settings?tab=starry" data-mail-addbox>+ 添加邮箱</Link>
            <Link className="btn ghost" to="/settings?tab=starry" data-mail-boxsettings>邮箱设置</Link>
          </div>
        </div>
      ) : null}

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
            <div className="mail-list-tools">
              <div className="mail-search-row">
                <label className="mail-search-wrap">
                  <MailIco d={ICO_SEARCH} />
                  <input
                    className="mail-search"
                    data-mail-search
                    type="search"
                    placeholder="搜索联系人 / 主题 / 预览"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={"mail-filter-btn" + (unboundOnly ? " is-on" : "")}
                  data-mail-filter-unbound
                  aria-pressed={unboundOnly}
                  title="只看未建档"
                  onClick={() => setUnboundOnly((v) => !v)}
                >
                  <MailIco d={ICO_FILTER} />
                </button>
              </div>
              <div className="mail-list-tabs" role="tablist" data-mail-list-tabs>
                {MAIL_TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.key}
                    onClick={() => setTab(item.key)}
                  >
                    {item.label}
                    {item.key === "inbox" && conversations.length > 0 ? (
                      <span className="mail-count-pill">{conversations.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            {visibleConversations.length === 0 ? (
              <p className="muted" data-mail-empty-list>
                {conversations.length === 0 && tab === "inbox" && !query
                  ? "这只邮箱还没有缓存的往来。点「收取」同步。"
                  : "没有匹配的会话。"}
              </p>
            ) : visibleConversations.map((row) => {
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
                  <span className={`mail-row-avatar mail-avatar-t${avatarTone(peerOf(row))}`} aria-hidden="true">
                    {initialsOf(peerOf(row))}
                  </span>
                  <span className="mail-row-main">
                    <span className="mail-row-head">
                      <strong>{peerOf(row)}</strong>
                      <time className="muted">{formatMailTime(row.last_at)}</time>
                    </span>
                    <span className="mail-row-subject">{row.subject}</span>
                    <span className="mail-row-preview">{row.last_preview || "暂无预览"}</span>
                    {row.match_state === "unbound" ? (
                      <span className="mail-row-meta">
                        <span className="mail-chip" data-mail-unbound-chip>未建档</span>
                      </span>
                    ) : null}
                  </span>
                  {row.unread_count > 0 ? (
                    <span className="mail-count-pill is-solid" aria-label={`未读 ${row.unread_count}`}>
                      {row.unread_count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </aside>

          <section className="mail-thread" data-mail-thread data-mail-entry="open-mail-thread">
            {selected && thread ? (
              <>
                <div className="mail-thread-head">
                  <div>
                    <h2>
                      {thread.thread.subject}
                      <button
                        type="button"
                        className={"mail-star" + (starred ? " is-starred" : "")}
                        data-mail-star
                        aria-pressed={starred}
                        title={starred ? "取消星标" : "加星标"}
                        onClick={toggleStar}
                      >
                        {starred ? "★" : "☆"}
                      </button>
                    </h2>
                    <p className="muted">
                      {peerOf(thread.thread)}
                      {thread.thread.peer_email ? ` · ${thread.thread.peer_email}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mail-mobiletabs" role="tablist" data-mail-mobiletabs>
                  {([["original", "原文"], ["summary", "摘要"], ["translation", "翻译"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={mobilePanel === key}
                      onClick={() => setMobilePanel(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={mobilePanel === "original" ? "" : "mail-hide-narrow"}>
                  <MailDigestStrip thread={thread} />
                  <div className="mail-timeline" data-mail-timeline>
                    {thread.messages.length
                      ? thread.messages.map((message) => (
                          <MailMessageCard
                            key={message.id}
                            message={message}
                            current={currentMessage?.id === message.id}
                            onSelect={() => setCurrentMessageId(message.id)}
                            peerName={peerOf(thread.thread)}
                            peerEmail={thread.thread.peer_email}
                            ownerName={workspace?.box.owner_name || ""}
                            mailbox={thread.thread.mailbox || workspace?.box.mailbox || ""}
                          />
                        ))
                      : <p className="muted">还没有缓存的往来正文。</p>}
                  </div>
                  <div className="mail-thread-actions" data-mail-thread-actions>
                    <button type="button" className="btn work" data-mail-reply onClick={reply}>
                      <MailIco d={ICO_REPLY} />
                      回复
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      data-mail-analyze
                      data-mail-entry="kol-analyze-enqueue"
                      onClick={analyze}
                    >
                      <MailIco d={ICO_SPARKLE} />
                      快速分析
                    </button>
                    <button type="button" className="btn ghost" data-mail-draft-reply onClick={generateReply}>
                      <MailIco d={ICO_DOC} />
                      生成回复
                    </button>
                    <div className="mail-thread-more" ref={moreRef}>
                      <button
                        type="button"
                        className="mail-more-btn"
                        aria-label="更多会话操作"
                        aria-expanded={moreOpen}
                        onClick={() => setMoreOpen((v) => !v)}
                      >
                        <MailIcoMore />
                      </button>
                      {moreOpen ? (
                        <div className="mail-popover">
                          <button
                            type="button"
                            onClick={() => {
                              if (selected) markRead(selected);
                              setMoreOpen(false);
                            }}
                          >
                            标记已读
                          </button>
                          <button
                            type="button"
                            disabled={!selected?.peer_email}
                            onClick={() => {
                              if (selected?.peer_email) {
                                void navigator.clipboard?.writeText(selected.peer_email).catch(() => undefined);
                              }
                              setMoreOpen(false);
                            }}
                          >
                            复制对方邮箱
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {mobilePanel === "summary" ? (
                  <div className="mail-mobile-panel"><MailSummaryCard thread={thread} /></div>
                ) : null}
                {mobilePanel === "translation" ? (
                  <div className="mail-mobile-panel"><MailTranslationCard message={currentMessage} /></div>
                ) : null}
              </>
            ) : (
              <p className="muted" data-mail-thread-empty>{threadError || "选择左侧会话查看时间线。打开不会创建会话。"}</p>
            )}
          </section>

          <aside className="mail-side" data-mail-side>
            <MailSummaryCard thread={thread} />
            <MailTranslationCard message={currentMessage} />
          </aside>
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
