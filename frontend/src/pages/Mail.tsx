import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Markdown from "../components/Markdown";
import { api } from "../api";
import { decorateWorkspace, hydratePollDelayMs, loadMailThread, loadMailWorkspaceFast, normalizeBox, syncMailboxMail } from "../mail/client";
import { ConversationItem } from "../mail/components/ConversationItem";
import { MailboxSwitcher } from "../mail/components/MailboxSwitcher";
import { ConversationSummary } from "../mail/components/ConversationSummary";
import { TranslationPanel } from "../mail/components/TranslationPanel";
import { MailContent } from "../mail/components/MailContent";
import { MailTimelineItem } from "../mail/components/MailTimelineItem";
import { avatarTone, formatMailTime, initialsOf } from "../mail/format";
import { selectedMessageOf, timelineOf } from "../mail/selection";
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
  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({});
  const [mobilePanel, setMobilePanel] = useState<"original" | "summary" | "translation">("original");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [expandedId, setExpandedId] = useState("");
  const syncPollRef = useRef<number | null>(null);
  const baseSyncedAtRef = useRef<string>("");

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

  const load = (opts?: { keepNotice?: boolean; skipAutoSync?: boolean }) => {
    setLoadState("loading");
    setError("");
    if (!opts?.keepNotice) setNotice("");
    void loadMailWorkspaceFast(boxParam || undefined)
      .then((next) => {
        setWorkspace(next);
        setLoadState("ok");
        return next;
      })
      .then((next) => {
        // Optional labels (owner name, kol handle) land behind the first paint,
        // so a slow /me/starry-binding or board can never hold the list.
        void decorateWorkspace(next)
          .then((decorated) => setWorkspace((prev) => (prev === next ? decorated : prev)))
          .catch(() => undefined);
        return next;
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
    return stopSyncPoll;
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
    // Only the conversation changes here: writing ?box= would re-trigger the
    // mailbox-level reload (and flash the list) on every row click.
    const next = new URLSearchParams(params);
    next.set("c", row.conversation_id);
    setParams(next, { replace: true });
    markRead(row);
  };

  /** Selecting a mail inside the open conversation: only ?m= changes. */
  const selectMessage = (message: MailMessage) => {
    const next = new URLSearchParams(params);
    next.set("c", message.conversation_id);
    next.set("m", message.id);
    setParams(next, { replace: true });
  };

  const openBox = (binding: MailBoxBinding) => {
    const next = new URLSearchParams();
    if (binding.mailbox) next.set("box", binding.mailbox);
    setParams(next, { replace: true });
  };

  const stopSyncPoll = () => {
    if (syncPollRef.current != null) {
      window.clearInterval(syncPollRef.current);
      syncPollRef.current = null;
    }
  };

  // The sync endpoint returns immediately; the mailbox is filled in behind.
  // Watch box.synced_at and refresh the list once the background run lands.
  const pollForSync = () => {
    stopSyncPoll();
    let ticks = 0;
    syncPollRef.current = window.setInterval(() => {
      ticks += 1;
      if (ticks > 60) {
        stopSyncPoll();
        setSyncing(false);
        return;
      }
      void api.mailBox(boxParam || undefined)
        .then((raw) => {
          const next = normalizeBox(raw as Record<string, unknown>);
          const syncedAt = next?.synced_at || "";
          if (syncedAt && syncedAt !== baseSyncedAtRef.current) {
            baseSyncedAtRef.current = syncedAt;
            stopSyncPoll();
            setSyncing(false);
            load({ keepNotice: true, skipAutoSync: true });
          }
        })
        .catch(() => undefined);
    }, 2_000);
  };

  const startSilentSync = () => {
    void syncMailboxMail(boxParam || undefined).then(() => pollForSync()).catch(() => undefined);
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    setNotice("已在后台开始收取，完成后自动刷新。");
    try {
      await syncMailboxMail(boxParam || undefined);
      baseSyncedAtRef.current = workspace?.box?.synced_at || "";
      pollForSync();
    } catch (e) {
      setError(httpCopy(e, MAIL_SYNC_MISSING_COPY));
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
  const currentMessage = useMemo(() => selectedMessageOf(thread?.messages || [], params.get("m") || ""), [thread, params]);

  const starred = starredOf(thread?.thread || selected);

  return (
    <div className="list-page mail-page" data-mail-page data-mail-source={workspace?.source || undefined}>
      <header className="mail-hero">
        <div className="mail-hero-copy">
          <div className="mail-title-row">
            <h1>邮箱通讯</h1>
            <span className="muted mail-hero-sub">管理多邮箱的邮件沟通，推动合作进展</span>
          </div>
          {loadState === "ok" && !bound ? (
            <p className="muted" data-mail-unbound-guide>
              {MAIL_UNBOUND_COPY}
            </p>
          ) : bound ? (
            <p className="muted" data-mail-box>
              {box?.mailbox || "已绑定邮箱"}
              {box?.owner_name ? ` · ${box.owner_name}` : ""}
              {box?.synced_at ? ` · 同步 ${formatMailTime(box.synced_at)}` : " · 尚未收取"}
              {` · 未读 ${Number(box?.total_unread ?? box?.unread ?? 0)}`}
            </p>
          ) : (
            <p className="muted" data-mail-box-loading>正在读取本地邮件记忆…</p>
          )}
        </div>
        {loadState === "ok" && !bound ? (
          <Link className="btn work" to="/settings?tab=starry" data-mail-bind>
            去绑定邮箱
          </Link>
        ) : null}
      </header>

      {loadState === "ok" && bound ? (
        <MailboxSwitcher
          current={activeBox}
          bindings={bindings}
          syncing={syncing}
          onSelect={openBox}
          onSync={() => void sync()}
        />
      ) : null}
      {error ? <p className="error" role="alert" data-mail-error>{error}</p> : null}
      {notice ? <p className="muted" role="status" data-mail-notice>{notice}</p> : null}
      {workspace?.source === "fallback" && bound ? (
        <p className="muted" data-mail-fallback>
          通讯接口尚未开通，正在用已缓存的跟进往来只读展示。打开会话不会创建 Agent 会话。
        </p>
      ) : null}

      {loadState === "loading" ? (
        <div className="mail-split mail-pane-skeleton" data-mail-state="loading" aria-busy="true">
          <div className="mail-list">
            <div className="mps-search" />
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="mps-row" />
            ))}
          </div>
          <div className="mail-content">
            <div className="mps-line is-meta" />
            <div className="mps-line is-subject" />
            <div className="mps-line" style={{ width: "92%" }} />
            <div className="mps-line" style={{ width: "86%" }} />
            <div className="mps-line" style={{ width: "64%" }} />
          </div>
          <div className="mail-side">
            <div className="mps-line is-block" />
            <div className="mps-line" style={{ width: "78%" }} />
            <div className="mps-line" style={{ width: "88%" }} />
          </div>
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
              const expanded = expandedId === row.conversation_id;
              return (
                <div key={row.id + row.conversation_id} className="mail-thread-block">
                  <ConversationItem
                    row={row}
                    expanded={expanded}
                    selected={active}
                    onToggle={() => {
                      if (expanded) setExpandedId("");
                      else {
                        setExpandedId(row.conversation_id);
                        openRow(row);
                      }
                    }}
                  />
                  {expanded ? (
                    <div className="mail-timeline" data-mail-timeline>
                      {timelineOf(thread?.messages || []).map((message) => (
                        <MailTimelineItem
                          key={message.id}
                          message={message}
                          selected={currentMessage?.id === message.id}
                          onSelect={() => selectMessage(message)}
                        />
                      ))}
                    </div>
                  ) : null}                </div>
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
                    <p className="muted" data-mail-thread-sub>
                      {peerOf(thread.thread)}
                      {thread.thread.peer_email && thread.thread.peer_email !== peerOf(thread.thread)
                        ? ` · ${thread.thread.peer_email}`
                        : ""}
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
                  {currentMessage ? (
                    <MailContent
                      message={currentMessage}
                      peerName={peerOf(thread.thread)}
                      peerEmail={thread.thread.peer_email}
                      ownerName={workspace?.box.owner_name || ""}
                      mailbox={thread.thread.mailbox || workspace?.box.mailbox || ""}
                    />
                  ) : (
                    <p className="muted">还没有缓存的往来正文。</p>
                  )}                  <div className="mail-thread-actions" data-mail-thread-actions>
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
                  <div className="mail-mobile-panel"><ConversationSummary thread={thread} /></div>
                ) : null}
                {mobilePanel === "translation" ? (
                  <div className="mail-mobile-panel"><TranslationPanel message={currentMessage} /></div>
                ) : null}
              </>
            ) : (
              <p className="muted" data-mail-thread-empty>{threadError || "选择左侧会话查看时间线。打开不会创建会话。"}</p>
            )}
          </section>

          <aside className="mail-side" data-mail-side>
            <ConversationSummary thread={thread} />
            <TranslationPanel message={currentMessage} />
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
