import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import ComposerDock, { type ComposerSubmit } from "../components/ComposerDock";
import { storePending } from "../components/ChatBlocks";
import { applyComposerDraft } from "../composer/draft";
import type { ComposerEntryIntent } from "../composer/types";
import { isMissingEndpoint } from "../home/discoveryHome";
import { decorateWorkspace, hydratePollDelayMs, loadMailPersonDigest, loadMailThread, loadMailWorkspaceFast, normalizeBox, syncMailboxMail } from "../mail/client";
import { CorrespondentRow } from "../mail/components/CorrespondentRow";
import { ConversationItem } from "../mail/components/ConversationItem";
import { MailContent } from "../mail/components/MailContent";
import { MailDigestCard } from "../mail/components/MailDigestCard";
import { MailFold, MAIL_FOLD_KEYS, readMailFolds, writeMailFold, type MailFoldKey } from "../mail/components/MailFold";
import { MailboxSwitcher } from "../mail/components/MailboxSwitcher";
import { MailTimelineItem, type MailReadState } from "../mail/components/MailTimelineItem";
import { PlainText } from "../mail/components/PlainText";
import { isAnalyzeEnqueuePrefill, mailAnalyzeDraft, mailReplyDraft } from "../mail/composerDraft";
import { formatMailTime } from "../mail/format";
import { firstConversationOf, groupByPeer } from "../mail/groups";
import { selectedMessageOf, timelineOf } from "../mail/selection";
import { occurredAtMs } from "../mail-time";
import {
  MAIL_ANALYZE_PREFILL_PREFIX,
  MAIL_ANALYZE_UNBOUND_COPY,
  MAIL_SYNC_MISSING_COPY,
  MAIL_THREAD_MISSING_COPY,
  MAIL_UNBOUND_COPY,
  type MailBoxBinding,
  type MailComposeLetter,
  type MailConversation,
  type MailMessage,
  type MailPersonDigest,
  type MailThread,
  type MailWorkspace,
} from "../mail/types";

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

/**
 * Only the newest inbound mail of a conversation with unread_count > 0 can be
 * unread: legacy rows (and the board fallback) carry no message-level flag.
 */
function readStateOf(message: MailMessage, newestId: string, unreadCount: number): MailReadState {
  if (message.unread === true) return "unread";
  if (message.unread === false) return "read";
  return message.id === newestId && message.direction !== "outbound" && Number(unreadCount || 0) > 0
    ? "unread"
    : "read";
}

const MAIL_TABS = [
  { key: "inbox", label: "收件箱" },
  { key: "sent", label: "发件箱" },
  { key: "unread", label: "未读" },
  { key: "read", label: "已读" },
] as const;
type MailTab = (typeof MAIL_TABS)[number]["key"];

const FOLD_TABS: { key: MailFoldKey; label: string }[] = [
  { key: "original", label: "原文" },
  { key: "summary", label: "摘要" },
  { key: "translation", label: "翻译" },
];

const TASK_CHIP_LIMIT = 6;

/** Composer entry intents stop at mail_analyze; the analyze lock is this page's own name. */
const ANALYZE_INTENT = "kol-analyze-enqueue" as ComposerEntryIntent;
const COMPOSE_STASH_INTENT = "email_compose" as ComposerEntryIntent;
const ANALYZE_QUEUED_COPY = "已入队，等待分析。没有走 from-text，也没有创建会话。";
const MAIL_COMPOSE_ACTION_COPY = "通讯邮件任务目录";

const ICO_SEARCH = "M11 4.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4M16.4 16.4 20 20";
const ICO_FILTER = "M4 5h16l-6.3 7.3v5.2l-3.4-2.1v-3.1Z";
const ICO_REPLY = "M9.5 14.5 4.5 9.5l5-5M4.5 9.5H13a6.5 6.5 0 0 1 6.5 6.5v3";
const ICO_SPARKLE = "M12 3.8l1.9 4.9 4.9 1.9-4.9 1.9L12 17.4l-1.9-4.9-4.9-1.9 4.9-1.9ZM18.6 16.4v4M16.6 18.4h4";
const ICO_DOC = "M7 3.5h6.5L18 8v12.5H7ZM13.5 3.5V8H18";

function MailIco({ d }: { d: string }) {
  return (
    <svg className="mail-ico" viewBox="0 0 24 24" aria-hidden="true">
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
  const messageId = params.get("m") || "";
  const peerParam = params.get("p") || "";
  const boxParam = params.get("box") || "";
  const [workspace, setWorkspace] = useState<MailWorkspace | null>(null);
  const [threads, setThreads] = useState<Record<string, MailThread | null>>({});
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  const [personDigest, setPersonDigest] = useState<MailPersonDigest | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<MailTab>("inbox");
  const [unboundOnly, setUnboundOnly] = useState(false);
  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [expandedPeer, setExpandedPeer] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [letters, setLetters] = useState<MailComposeLetter[]>([]);
  const [lettersMore, setLettersMore] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [analyzeLocked, setAnalyzeLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folds, setFolds] = useState<Record<MailFoldKey, boolean>>(readMailFolds);
  const syncPollRef = useRef<number | null>(null);
  const baseSyncedAtRef = useRef<string>("");
  const startedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Record<string, number>>({});
  const appliedFocusRef = useRef("");
  const appliedPeerRef = useRef("");
  const intakeCancelled = useRef(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);

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

  const groups = useMemo(() => groupByPeer(visibleConversations), [visibleConversations]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  /** The conversation the detail column reads: ?c=, else the newest of ?p=, else the newest. */
  const selectedConversation = useMemo(() => {
    if (!conversations.length) return null;
    if (focusId) {
      const row = conversations.find((item) => item.conversation_id === focusId || item.id === focusId);
      if (row) return row;
    }
    if (peerParam) {
      const group = groups.find((item) => item.peer_email === peerParam.toLowerCase());
      const first = firstConversationOf(group || null);
      if (first) return first;
    }
    return conversations[0] || null;
  }, [conversations, groups, focusId, peerParam]);

  const detailThread = selectedConversation ? threads[selectedConversation.conversation_id] ?? null : null;
  const currentMessage = useMemo(
    () => selectedMessageOf(detailThread?.messages || [], messageId),
    [detailThread, messageId],
  );
  const detailError = selectedConversation ? threadErrors[selectedConversation.conversation_id] || "" : "";

  const load = (opts?: { keepNotice?: boolean }) => {
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
        // Optional owner label only: /me/starry-binding is re-read behind the first
        // paint (bounded to 2s) and can never hold the list.
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

  const dropThreadCache = useCallback(() => {
    startedRef.current = new Set();
    for (const timer of Object.values(timersRef.current)) window.clearTimeout(timer);
    timersRef.current = {};
    setThreads({});
    setCacheEpoch((value) => value + 1);
  }, []);

  useEffect(() => {
    load();
    return stopSyncPoll;
    // Reload list + thread for the mailbox selected via ?box= (card click).
  }, [boxParam]);

  const timerAt = (key: string, timer: number) => {
    if (timersRef.current[key]) window.clearTimeout(timersRef.current[key]);
    timersRef.current[key] = timer;
  };

  /**
   * Conversation detail is read on demand: the expanded L2 renders its mail list
   * and the detail column renders the focused mail, both from this cache.
   */
  const ensureThread = useCallback((
    conversationId: string,
    row: MailConversation | null | undefined,
    source: MailWorkspace["source"],
  ) => {
    if (!conversationId || startedRef.current.has(conversationId)) return;
    startedRef.current.add(conversationId);
    const fetchThread = (attempt: number) => {
      void loadMailThread(conversationId, row || undefined, source)
        .then((next) => {
          if (!next) {
            startedRef.current.delete(conversationId);
            setThreads((prev) => ({ ...prev, [conversationId]: null }));
            setThreadErrors((prev) => ({ ...prev, [conversationId]: MAIL_THREAD_MISSING_COPY }));
            return;
          }
          setThreads((prev) => ({ ...prev, [conversationId]: next }));
          setThreadErrors((prev) => (prev[conversationId] ? { ...prev, [conversationId]: "" } : prev));
          // Bodies/translations are filled in behind the first paint; re-read on a
          // bounded cadence instead of blocking on the remote mailbox.
          const delay = next.hydrating ? hydratePollDelayMs(attempt + 1) : null;
          if (delay != null) timerAt(conversationId, window.setTimeout(() => fetchThread(attempt + 1), delay));
        })
        .catch((e) => {
          startedRef.current.delete(conversationId);
          setThreads((prev) => ({ ...prev, [conversationId]: null }));
          setThreadErrors((prev) => ({ ...prev, [conversationId]: httpCopy(e, MAIL_THREAD_MISSING_COPY) }));
        });
    };
    fetchThread(0);
  }, []);

  const neededIds = useMemo(() => {
    const ids: string[] = [];
    if (expandedId) ids.push(expandedId);
    const focused = selectedConversation?.conversation_id || "";
    if (focused && focused !== expandedId) ids.push(focused);
    return ids;
  }, [expandedId, selectedConversation]);

  useEffect(() => {
    if (!workspace) return;
    for (const id of neededIds) {
      ensureThread(id, conversations.find((row) => row.conversation_id === id), workspace.source);
    }
  }, [neededIds, workspace, conversations, ensureThread, cacheEpoch]);

  useEffect(() => () => {
    for (const timer of Object.values(timersRef.current)) window.clearTimeout(timer);
  }, []);

  // A /mail?c= deep link (board 「查看互动 / 原邮件」) opens its parents once and
  // leaves the newest mail focused; a later manual collapse is never undone.
  useEffect(() => {
    if (!focusId || !conversations.length || appliedFocusRef.current === focusId) return;
    const row = conversations.find((item) => item.conversation_id === focusId || item.id === focusId);
    if (!row) return;
    appliedFocusRef.current = focusId;
    setExpandedPeer(row.peer_email.toLowerCase());
    setExpandedId(row.conversation_id);
  }, [focusId, conversations]);

  useEffect(() => {
    if (!peerParam || focusId || !conversations.length || appliedPeerRef.current === peerParam) return;
    appliedPeerRef.current = peerParam;
    setExpandedPeer(peerParam.toLowerCase());
  }, [peerParam, focusId, conversations]);

  useEffect(() => {
    const mailbox = workspace?.box.mailbox || boxParam;
    const peer = selectedConversation?.peer_email;
    if (!mailbox || !peer) {
      setPersonDigest(null);
      return;
    }
    let cancelled = false;
    void loadMailPersonDigest(mailbox, peer)
      .then((digest) => {
        if (!cancelled) setPersonDigest(digest);
      })
      .catch(() => {
        if (!cancelled) setPersonDigest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedConversation?.peer_email, workspace?.box.mailbox, boxParam]);

  // 邮件任务技能 chips come from the email_compose contract; a dead catalog
  // renders nothing instead of crashing the pane.
  useEffect(() => {
    let cancelled = false;
    void api.mailComposeCatalog()
      .then((res) => {
        if (!cancelled) setLetters(Array.isArray(res?.letters) ? res.letters : []);
      })
      .catch(() => {
        if (!cancelled) setLetters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const openBox = (binding: MailBoxBinding) => {
    const next = new URLSearchParams();
    if (binding.mailbox) next.set("box", binding.mailbox);
    setParams(next, { replace: true });
    appliedFocusRef.current = "";
    appliedPeerRef.current = "";
    setExpandedPeer("");
    setExpandedId("");
    setFolds(readMailFolds());
    dropThreadCache();
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
            setPersonDigest(null);
            dropThreadCache();
            load({ keepNotice: true });
          }
        })
        .catch(() => undefined);
    }, 2_000);
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

  const setFold = (key: MailFoldKey, open: boolean) => {
    writeMailFold(key, open);
    setFolds((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
  };

  const toggleFold = (key: MailFoldKey) => setFold(key, !folds[key]);

  const openSingleFold = (key: MailFoldKey) => {
    for (const other of MAIL_FOLD_KEYS) setFold(other, other === key);
  };

  /** L2 click: expand or collapse only — the detail column does not move. */
  const toggleConversation = (row: MailConversation) => {
    setExpandedId((prev) => (prev === row.conversation_id ? "" : row.conversation_id));
  };

  /** L3 click: focus that mail, and open 原文 so the body is readable at once. */
  const selectMessage = (row: MailConversation, message: MailMessage) => {
    const next = new URLSearchParams(params);
    next.set("c", row.conversation_id);
    next.set("m", message.id);
    setParams(next, { replace: true });
    setFold("original", true);
    markRead(row);
  };

  const composerMailbox = () => selectedConversation?.mailbox || workspace?.box.mailbox || "";

  const replyDraftOf = (row: MailConversation) => mailReplyDraft({
    mailbox: row.mailbox || workspace?.box.mailbox || "",
    conversation_id: row.conversation_id,
    peer: peerOf(row),
    subject: row.subject,
  });

  const draftChips = (row: MailConversation) =>
    replyDraftOf(row).chips.map((chip) => ({ kind: "object" as const, id: chip.id, label: chip.label }));

  /** 回复 / 生成回复 prefill the on-page composer; they never navigate away. */
  const reply = () => {
    if (!selectedConversation) return;
    const draft = replyDraftOf(selectedConversation);
    applyComposerDraft({ text: draft.text, intent: "mail_reply", chips: draftChips(selectedConversation) });
    setAnalyzeLocked(false);
    setNotice("");
  };

  const generateReply = () => {
    if (!selectedConversation) return;
    const subject = selectedConversation.subject || "(无主题)";
    applyComposerDraft({
      text: `请根据与 ${peerOf(selectedConversation)} 的往来，为「${subject}」生成一封回复草稿。`,
      intent: "mail_reply",
      chips: draftChips(selectedConversation),
    });
    setAnalyzeLocked(false);
    setNotice("");
  };

  /** 快速分析 locks the composer to the analyze entry; the send is the real action. */
  const analyze = () => {
    if (!selectedConversation) return;
    const people = analyzePeopleOf(selectedConversation);
    if (selectedConversation.match_state === "unbound" || !people.length) {
      setNotice(MAIL_ANALYZE_UNBOUND_COPY);
      return;
    }
    const draft = mailAnalyzeDraft({ people, peer: peerOf(selectedConversation) });
    applyComposerDraft({
      text: draft.text,
      intent: ANALYZE_INTENT,
      chips: draft.chips.map((chip) => ({ kind: "object" as const, id: chip.id, label: chip.label })),
    });
    setAnalyzeLocked(true);
    setNotice("");
  };

  const stopIntake = () => {
    intakeCancelled.current = true;
    setBusy(false);
  };

  const submitComposer = async (payload: ComposerSubmit) => {
    const text = String(payload.text || "").trim();
    if (!text || busy) return;
    intakeCancelled.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (analyzeLocked || isAnalyzeEnqueuePrefill(text, payload.intent)) {
        const conversation = selectedConversation;
        const people = conversation ? analyzePeopleOf(conversation) : [];
        if (!conversation || !people.length) {
          setNotice(MAIL_ANALYZE_UNBOUND_COPY);
          return;
        }
        // The prefilled text is the prompt; an emptied box falls back to the
        // analyze brief rather than enqueueing a bare label.
        const prompt = composerText.trim() || mailAnalyzeDraft({ people, peer: peerOf(conversation) }).text;
        const queued = await api.enqueueKolAnalyze({
          kol_uids: people,
          title: MAIL_ANALYZE_PREFILL_PREFIX,
          prompt,
        });
        if (intakeCancelled.current) return;
        if (queued.creates_session) throw new Error("分析入队不应创建会话");
        setNotice(ANALYZE_QUEUED_COPY);
        setComposerText("");
        setAnalyzeLocked(false);
        return;
      }
      const recognized = await api.createTaskFromText({
        text,
        intent: payload.intent || undefined,
        source: "text",
        attachments: payload.attachments,
        model_tier: payload.model_tier,
        knowledge_id: payload.knowledge_id,
        collaboration_id: payload.collaboration_id,
        entities: payload.entities,
        scope: payload.scope,
        object_refs: payload.object_refs,
        client_entry: payload.client_entry,
      });
      if (intakeCancelled.current) return;
      const created = recognized.task;
      if (!created?.id) {
        setError(String(recognized.clarification || recognized.message || "无法识别这个任务，请补充后重试。"));
        return;
      }
      const run = await api.runTask(created.id);
      if (intakeCancelled.current) return;
      storePending(run.session_id, {
        text,
        intent: String(payload.intent || created.task_type || ""),
        model_tier: payload.model_tier,
      });
      nav(`/s/${run.session_id}`);
    } catch (e) {
      if (!intakeCancelled.current) setError(e instanceof Error && e.message ? e.message : "无法执行这个任务。");
    } finally {
      setBusy(false);
    }
  };

  const pickLetter = (letter: MailComposeLetter) => {
    applyComposerDraft({
      text: letter.prompt,
      intent: COMPOSE_STASH_INTENT,
      chips: [{ kind: "skill", id: "email_compose", label: letter.chip }],
    });
    setAnalyzeLocked(false);
    setNotice("");
  };

  const starredOf = (row: MailConversation | null | undefined): boolean => {
    if (!row) return false;
    const key = row.id || row.conversation_id;
    return starOverrides[key] ?? Boolean(row.starred);
  };

  const toggleStar = () => {
    if (!selectedConversation) return;
    const key = selectedConversation.id || selectedConversation.conversation_id;
    const next = !starredOf(selectedConversation);
    // Optional endpoint: local state wins when PATCH is unavailable.
    void api.updateMailConversation(key, { starred: next });
    setStarOverrides((prev) => ({ ...prev, [key]: next }));
  };

  const countOf = (row: MailConversation): number =>
    Number(row.message_count || 0) || (threads[row.conversation_id]?.messages.length ?? 0);

  const composerChips = useMemo(
    () => (selectedConversation ? replyDraftOf(selectedConversation).chips.map((chip) => ({ id: chip.id, label: chip.label })) : []),
    [selectedConversation, workspace?.box.mailbox],
  );

  const box = workspace?.box;
  const bound = Boolean(box?.bound && box.mailbox);
  const bindings = box?.bindings || [];
  const activeBox = boxParam || box?.mailbox || "";
  const starred = starredOf(detailThread?.thread || selectedConversation);
  const detailPeer = selectedConversation ? peerOf(selectedConversation) : "";
  const detailPeerEmail = selectedConversation?.peer_email || "";
  const translation = String(currentMessage?.translation_zh || "").trim();
  const digestTag = personDigest?.digest_source === "codex_memory" ? "AI 生成 · codex" : "AI 生成";
  const visibleLetters = lettersMore ? letters : letters.slice(0, TASK_CHIP_LIMIT);

  return (
    <div className="list-page mail-page" data-mail-page data-mail-source={workspace?.source || undefined}>
      <header className="mail-hero">
        <h1 className="mail-hero-title">邮箱通讯</h1>
        {loadState === "ok" && bound ? (
          <MailboxSwitcher
            current={activeBox}
            bindings={bindings}
            syncing={syncing}
            onSelect={openBox}
            onSync={() => void sync()}
          />
        ) : null}
        {loadState === "ok" && bound ? (
          <p className="muted mail-hero-meta" data-mail-box>
            {box?.synced_at ? `同步 ${formatMailTime(box.synced_at)}` : "尚未收取"}
            {` · 未读 ${Number(box?.total_unread ?? box?.unread ?? 0)}`}
          </p>
        ) : null}
        {loadState === "ok" && !bound ? (
          <Link className="btn ghost" to="/settings?tab=starry" data-mail-bind>
            去绑定邮箱
          </Link>
        ) : null}
        {loadState === "loading" ? (
          <p className="muted mail-hero-meta" data-mail-box-loading>正在读取本地邮件记忆…</p>
        ) : null}
      </header>

      {loadState === "ok" && !bound ? (
        <p className="muted mail-unbound-line" data-mail-unbound-guide>
          {MAIL_UNBOUND_COPY}
        </p>
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
          <div className="mail-interact">
            <div className="mps-chip-row">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="mps-chip" />
              ))}
            </div>
            <div className="mps-line is-block" />
          </div>
          <div className="mail-detail">
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

            {groups.length === 0 ? (
              <p className="muted mail-empty-list" data-mail-empty-list>
                {conversations.length === 0 && tab === "inbox" && !query
                  ? "这只邮箱还没有缓存的往来。点「收取」同步。"
                  : "没有匹配的会话。"}
              </p>
            ) : groups.map((group) => {
              const peerExpanded = expandedPeer === group.peer_email;
              return (
                <div key={group.peer_email} className="mail-tree-peer">
                  <CorrespondentRow
                    group={group}
                    expanded={peerExpanded}
                    onToggle={() => setExpandedPeer(peerExpanded ? "" : group.peer_email)}
                  />
                  {peerExpanded ? (
                    <div className="mail-conversation-list">
                      {group.conversations.map((row) => {
                        const expanded = expandedId === row.conversation_id;
                        const current = selectedConversation?.conversation_id === row.conversation_id;
                        const mailCount = countOf(row);
                        const rows = expanded ? timelineOf(threads[row.conversation_id]?.messages || []) : [];
                        const newestId = rows[0]?.id || "";
                        return (
                          <div key={row.id + row.conversation_id} className="mail-tree-conversation">
                            <ConversationItem
                              row={row}
                              expanded={expanded}
                              current={current}
                              mailCount={mailCount}
                              onToggle={() => toggleConversation(row)}
                            />
                            {expanded ? (
                              <div className="mail-timeline" data-mail-timeline>
                                {rows.length === 0 ? (
                                  <p className="muted mail-timeline-empty">
                                    {threadErrors[row.conversation_id] || "正在读取这只会话的邮件…"}
                                  </p>
                                ) : rows.map((message) => (
                                  <MailTimelineItem
                                    key={message.id}
                                    message={message}
                                    selected={Boolean(messageId) && messageId === message.id}
                                    readState={readStateOf(message, newestId, row.unread_count)}
                                    onSelect={() => selectMessage(row, message)}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </aside>

          <section className="mail-interact" data-mail-interact>
            {letters.length ? (
              <div className="mail-interact-tasks">
                <p className="mail-pane-label">{MAIL_COMPOSE_ACTION_COPY}</p>
                <div className="mail-task-chips" data-mail-task-chips>
                  {visibleLetters.map((letter) => (
                    <button
                      key={letter.stage}
                      type="button"
                      className="mail-task-chip"
                      data-mail-task-chip={letter.stage}
                      title={letter.prompt}
                      onClick={() => pickLetter(letter)}
                    >
                      {letter.chip}
                    </button>
                  ))}
                  {letters.length > TASK_CHIP_LIMIT ? (
                    <button
                      type="button"
                      className="mail-task-more"
                      data-mail-task-more
                      aria-expanded={lettersMore}
                      onClick={() => setLettersMore((v) => !v)}
                    >
                      {lettersMore ? "收起" : "更多"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="mail-interact-dock" data-mail-composer-entry={analyzeLocked ? ANALYZE_INTENT : undefined}>
              <ComposerDock
                variant="workspace"
                placement="dock"
                value={composerText}
                onChange={setComposerText}
                onSubmit={(payload) => void submitComposer(payload)}
                disabled={busy}
                running={busy}
                onStop={stopIntake}
                lockedIntent={analyzeLocked ? ANALYZE_INTENT : null}
                lockedLabel={analyzeLocked ? "快速分析" : null}
                contextChips={composerChips}
                entryIntent={analyzeLocked ? "mail_analyze" : "free"}
              />
            </div>
          </section>

          <aside className="mail-detail" data-mail-side data-mail-thread data-mail-entry="open-mail-thread">
            <div className="mail-detail-head">
              <div className="mail-thread-head">
                <h2>
                  {detailThread?.thread.subject || selectedConversation?.subject || "邮件详情"}
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
                {detailPeer ? (
                  <p className="muted" data-mail-thread-sub>
                    {detailPeer}
                    {detailPeerEmail && detailPeerEmail !== detailPeer ? ` · ${detailPeerEmail}` : ""}
                  </p>
                ) : null}
              </div>
              <div className="mail-mobiletabs" role="tablist" data-mail-mobiletabs>
                {FOLD_TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={folds[item.key]}
                    onClick={() => openSingleFold(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <MailFold
              id="summary"
              label="往来摘要"
              open={folds.summary}
              onToggle={() => toggleFold("summary")}
              tag={<span className="mail-side-tag" data-mail-digest-tag>{digestTag}</span>}
            >
              <div
                className="mail-fold-inner"
                data-mail-summary-card
                data-mail-digest
                data-summary-source={personDigest?.digest_source || undefined}
              >
                <MailDigestCard digest={personDigest} />
              </div>
            </MailFold>

            <MailFold id="translation" label="中文翻译" open={folds.translation} onToggle={() => toggleFold("translation")}>
              <div
                className="mail-fold-inner"
                data-mail-translation
                data-mail-translation-for={currentMessage?.id || ""}
              >
                {translation ? (
                  <div className="mail-side-body" data-mail-translation-body>
                    <PlainText text={translation} />
                  </div>
                ) : (
                  <p className="muted mail-side-hint" data-mail-translation-pending>暂无中文译稿。</p>
                )}
              </div>
            </MailFold>

            <MailFold id="original" label="原文" open={folds.original} onToggle={() => toggleFold("original")}>
              {currentMessage ? (
                <MailContent
                  message={currentMessage}
                  peerName={detailPeer}
                  peerEmail={detailPeerEmail}
                  ownerName={box?.owner_name || ""}
                  mailbox={composerMailbox()}
                />
              ) : (
                <p className="muted" data-mail-thread-empty>
                  {detailError || "选择左侧会话查看邮件。打开不会创建会话。"}
                </p>
              )}
              {selectedConversation ? (
                <div className="mail-thread-actions" data-mail-thread-actions>
                  <button type="button" className="btn ghost" data-mail-reply onClick={reply}>
                    <MailIco d={ICO_REPLY} />
                    回复
                  </button>
                  <button type="button" className="btn ghost" data-mail-draft-reply onClick={generateReply}>
                    <MailIco d={ICO_DOC} />
                    生成回复
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
                            if (selectedConversation) markRead(selectedConversation);
                            setMoreOpen(false);
                          }}
                        >
                          标记已读
                        </button>
                        <button
                          type="button"
                          disabled={!selectedConversation?.peer_email}
                          onClick={() => {
                            if (selectedConversation?.peer_email) {
                              void navigator.clipboard?.writeText(selectedConversation.peer_email).catch(() => undefined);
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
              ) : null}
            </MailFold>
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
