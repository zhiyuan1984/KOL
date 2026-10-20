import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EmailCard, Message, Task, TaskResultCard } from "../api";
import { KolMailWorkbench, taskResultCardsFrom, employeeTraceLabel } from "./ChatBlocks";
import PanelToggleIcon from "./PanelToggleIcon";
import { api } from "../api";
import { stripEngineCopy } from "../employeeCopy";
import type { SessionMailRow } from "./AgentTaskList";
import { taskStatusView, type TaskStatusShape } from "../runViewState";
import { useViewMode } from "../viewMode";
import { stageLabel } from "../labels";
import { isComposeResultCard, ResultActions } from "./ResultArtifact";
import { revealWorkspace } from "../home/WorkspaceShell";
import { resultCardOf } from "./StreamArtifact";
import { streamTime } from "../streamOrder";
import AgentAvatar from "./AgentAvatar";
import type { TaskRunView } from "../runViewState";
import ExecutionTimeline from "./ExecutionTimeline";
import ResultRailTabs, { type ResultRailTab } from "./ResultRailTabs";

/** 形状通道的字形：⚠ 只给需要人确认的 R3 等待，✓/✕ 只在真的完成或失败时出现。 */
const STATUS_SHAPE_GLYPH: Record<TaskStatusShape, string> = {
  dot: "•",
  pulse: "•",
  alert: "⚠",
  hollow: "○",
  check: "✓",
  cross: "✕",
  square: "■",
};

/** 只有这些运行态需要占用右栏状态区；结果已生成/已完成退场，避免压过成果。 */
const ATTENTION_RUN_KEYS = new Set(["running", "awaiting_confirm", "stopped", "failed", "uncertain"]);

function readSavedRailTab(sessionId: string, debug: boolean): ResultRailTab | null {
  try {
    const saved = sessionStorage.getItem(`ui:rail-tab:${sessionId}`);
    if (saved === "result" || saved === "status") return saved;
    if (saved === "debug" && debug) return saved;
  } catch { /* Storage is optional. */ }
  return null;
}

/** 结果目录的一行：指向中栏时间流里的那张卡（`data-stream-entry`）。 */
export type ResultEntry = { id: string; kind: string; title: string; detail?: string; time: number };

function clock(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 从时间流的消息里列出智能体的成果；状态与过程不进目录。 */
export function resultEntries(messages: Message[], extra: ResultEntry[] = []): ResultEntry[] {
  const rows: ResultEntry[] = [];
  for (const message of messages) {
    const payload = message.payload as Record<string, unknown>;
    const time = streamTime(message);
    const push = (kind: string, title: string, detail?: string) => rows.push({ id: message.id, kind, title, detail, time });
    if (message.kind === "task_result_card") {
      const card = resultCardOf(message);
      push("result", stripEngineCopy(String(card.title || (isComposeResultCard(card) ? "写合作邮件" : "任务结果"))), stripEngineCopy(String(card.summary || "")).slice(0, 60) || undefined);
    } else if (message.kind === "email_card") {
      const card = payload as unknown as EmailCard;
      push("draft", String(card.status || "") === "sent" ? "已发送的邮件" : "邮件草稿", card.subject || "无主题");
    } else if (message.kind === "confirm_stage_card") {
      const proposed = String(payload.proposed_stage || "");
      const written = String(payload.current_stage || "") === proposed;
      push("stage", "阶段建议", `${stageLabel(proposed) || proposed || "具体阶段"}${payload.rejected ? " · 已驳回" : written ? " · 已写入" : payload.resolved ? " · 已关闭" : " · 待确认"}`);
    } else if (message.kind === "inbound_card") {
      push("inbound", "未绑定来信", String(payload.subject || "无主题"));
    } else if (message.kind === "kol_mail_card") {
      const judgment = payload.judgment && typeof payload.judgment === "object" ? payload.judgment as { suggested_stage?: string; auto_propose?: boolean } : {};
      if (judgment.suggested_stage || judgment.auto_propose) push("inbound", "来信 · 建议改阶段", String(payload.subject || "无主题"));
    } else if (message.kind === "supplement_card" && Array.isArray(payload.fields) && payload.fields.length) {
      push("ship", "待补全", String(payload.title || "补全信息"));
    } else if (message.kind === "steps" && String(payload.title || "").includes("失联")) {
      push("overdue", String(payload.title || "失联与延期清单"));
    } else if (typeof payload.approval_id === "string" && payload.approval_id) {
      push("approval", "费用审批");
    } else if (message.kind === "assistant" && !payload.streaming) {
      for (const card of taskResultCardsFrom(String(payload.text || ""))) {
        push("result", stripEngineCopy(String(card.title || "任务结果")));
      }
    }
  }
  return [...rows, ...extra].sort((a, b) => b.time - a.time);
}

/** 点目录：把中栏滚到那张卡，并短暂标出它（不靠颜色单通道，另有轮廓）。 */
export function locateStreamEntry(id: string): void {
  const target = document.querySelector<HTMLElement>(`[data-stream-entry="${CSS.escape(id)}"]`);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  target.classList.add("is-located");
  window.setTimeout(() => target.classList.remove("is-located"), 1600);
}

function MailBodyArtifact({ mail }: { mail: SessionMailRow }) {
  const body = String(mail.body || mail.snippet || "").trim();
  return (
    <article className="artifact mail-body" data-kind="mail-body" data-mail-body>
      <h2>{mail.subject || "无主题"}</h2>
      {body
        ? <pre className="mail-body-text">{body}</pre>
        : <p className="muted" data-mail-empty>正文未拉取到，请回到首页点「刷新收取」后再打开。</p>}
    </article>
  );
}

/**
 * A new mail draft is rendered in the result rail, not in the time stream.
 * Its review form can be taller than that rail, so merely putting the card at
 * the rail's top makes the R3 send affordance unreachable. Reveal the genuine
 * control once after the card has committed; never focus it or keep following
 * after the employee has started reading the rail themselves.
 */
function useRevealNewDraftSendAction({
  embedded,
  sessionId,
  messageId,
  draftId,
  active,
}: {
  embedded: boolean;
  sessionId: string;
  messageId?: string;
  draftId?: string;
  active: boolean;
}) {
  const revealed = useRef("");

  useLayoutEffect(() => {
    if (!embedded || !active || !messageId || !draftId) return;
    const key = `${sessionId}:${messageId}:${draftId}`;
    if (revealed.current === key) return;

    let frame = 0;
    let stopped = false;
    let observer: ResizeObserver | undefined;
    let rail: HTMLElement | null = null;
    const cancel = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      rail?.removeEventListener("wheel", cancel);
      rail?.removeEventListener("touchstart", cancel);
      rail?.removeEventListener("pointerdown", cancel);
      rail?.removeEventListener("keydown", cancel);
    };
    const findAction = () => Array.from(document.querySelectorAll<HTMLElement>("[data-result-message]"))
      .find((element) => element.dataset.resultMessage === messageId && element.closest(".scope-task-rail-scroll"))
      ?.querySelector<HTMLElement>('[data-email-action="send"]');
    const reveal = (first = false) => {
      if (stopped) return;
      const action = findAction();
      if (!action) return;
      rail ||= action.closest<HTMLElement>(".scope-task-rail-scroll");
      const actionRect = action.getBoundingClientRect();
      const railRect = rail?.getBoundingClientRect();
      const outsideRail = Boolean(railRect && (actionRect.top < railRect.top || actionRect.bottom > railRect.bottom));
      if (first || outsideRail) {
        action.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
        revealed.current = key;
      }
    };
    const schedule = (first = false) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => reveal(first));
    };

    schedule(true);
    const action = findAction();
    const card = action?.closest<HTMLElement>('[data-kind="email-card"]');
    rail = action?.closest<HTMLElement>(".scope-task-rail-scroll") || null;
    if (rail) {
      rail.addEventListener("wheel", cancel, { passive: true });
      rail.addEventListener("touchstart", cancel, { passive: true });
      rail.addEventListener("pointerdown", cancel);
      rail.addEventListener("keydown", cancel);
    }
    if (card && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => schedule());
      observer.observe(card);
    }
    return cancel;
  }, [active, draftId, embedded, messageId, sessionId]);
}

/**
 * 右栏只做两件事：执行中显示当前状态；执行结束后状态文字退场，只列结果目录
 * （标题 + 时间，点击定位到中栏时间流里的卡片）。完整的成果、过程与确认都在中栏。
 */
export default function SideWorkbench({
  sessionId,
  messages,
  status,
  task,
  focusedMail = null,
  resultExtra,
  extraEntries = [],
  statusOverride,
  phase,
  remoteLabel,
  discoveryReturn,
  embedded = false, runView, renderArtifact, artifactExtra,
  officialStage, onPrefill, ready = true,
}: {
  sessionId: string;
  messages: Message[];
  status: string;
  task?: Task | null;
  focusedMail?: SessionMailRow | null;
  resultExtra?: ReactNode;
  /** 页面自己的成果条目（例如采集候选），与消息里的成果一起进目录。 */
  extraEntries?: ResultEntry[];
  /** 采集等子流程给出的更具体状态词，覆盖状态文案但沿用同一投影的语气与形状。 */
  statusOverride?: string;
  /** 运行中的当前阶段（来自 useRunStatus 的过程投影）。 */
  phase?: string;
  /** 调试视图下的远端执行面名称，只出现在调试细节里。 */
  remoteLabel?: string;
  discoveryReturn?: string;
  embedded?: boolean; runView?: TaskRunView;
  renderArtifact?: (message: Message) => ReactNode | undefined; artifactExtra?: ReactNode;
  officialStage?: string; onPrefill?: (text: string) => void; ready?: boolean;
}) {
  const { debug } = useViewMode();
  const statusView = taskStatusView(task, status);
  // 执行中、待人确认、停止、失败才占用状态区；结果已生成/已完成退场，只留成果。
  const showStatus = runView
    ? runView.live || ATTENTION_RUN_KEYS.has(runView.key)
    : statusView.live || statusView.needsConfirm || statusView.tone === "failed";
  const attention = showStatus || statusView.needsConfirm;
  const railRootRef = useRef<HTMLDivElement>(null);
  const userReading = useRef(false);
  const [hasNewResult, setHasNewResult] = useState(false);
  const railScrollPositions = useRef<Record<string, number>>({});
  const pendingRailScroll = useRef<ResultRailTab | null>(null);
  const userPickedTab = useRef(Boolean(readSavedRailTab(sessionId, debug)));
  const previousSessionId = useRef(sessionId);
  const [activeTab, setActiveTab] = useState<ResultRailTab>(() => readSavedRailTab(sessionId, debug) || (attention ? "status" : "result"));
  const chooseTab = (next: ResultRailTab) => {
    if (next === activeTab) return;
    const scroll = railRootRef.current?.closest<HTMLElement>(".scope-task-rail-scroll");
    if (scroll) railScrollPositions.current[activeTab] = scroll.scrollTop;
    userPickedTab.current = true;
    userReading.current = true;
    try { sessionStorage.setItem(`ui:rail-tab:${sessionId}`, next); } catch { /* Storage is optional. */ }
    pendingRailScroll.current = next;
    setActiveTab(next);
  };
  useLayoutEffect(() => {
    const next = pendingRailScroll.current;
    if (!next) return;
    pendingRailScroll.current = null;
    const scroll = railRootRef.current?.closest<HTMLElement>(".scope-task-rail-scroll");
    if (scroll) scroll.scrollTop = railScrollPositions.current[next] ?? 0;
  }, [activeTab]);
  useEffect(() => {
    if (!userPickedTab.current) setActiveTab(attention ? "status" : "result");
  }, [attention]);
  useEffect(() => {
    if (!debug && activeTab === "debug") setActiveTab("result");
  }, [debug, activeTab]);
  useEffect(() => {
    if (previousSessionId.current === sessionId) return;
    previousSessionId.current = sessionId;
    const saved = readSavedRailTab(sessionId, debug);
    userPickedTab.current = Boolean(saved);
    railScrollPositions.current = {};
    userReading.current = false;
    setHasNewResult(false);
    setActiveTab(saved || (attention ? "status" : "result"));
  }, [sessionId, attention, debug]);
  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; region?: string }>).detail;
      if (detail?.sessionId !== sessionId || detail.region !== "rail") return;
      if (activeTab !== "result") chooseTab("result");
    };
    window.addEventListener("workspace:reveal", reveal);
    return () => window.removeEventListener("workspace:reveal", reveal);
  }, [sessionId, activeTab]);
  const entries = resultEntries(messages, extraEntries);
  const primaryArtifactId = [...messages].reverse().find(message => ["email_card", "confirm_stage_card", "supplement_card", "task_result_card"].includes(message.kind))?.id;
  const latestDraft = [...messages].reverse().find((message) => message.kind === "email_card");
  const draft = latestDraft ? latestDraft.payload as unknown as EmailCard : null;
  useRevealNewDraftSendAction({
    embedded,
    sessionId,
    messageId: latestDraft?.id,
    draftId: draft?.draft_id,
    active: Boolean(draft && draft.status !== "sent" && !draft.send_disabled),
  });
  const latestResult = [...messages].reverse().find((message) => message.kind === "task_result_card");
  const result = latestResult ? resultCardOf(latestResult) : (task?.task_result || task?.crawl_result) as TaskResultCard | undefined;
  const mailMessages = messages.filter(message => message.kind === "kol_mail_card");
  const latestStage = [...messages].reverse().find(message => message.kind === "confirm_stage_card");
  const composing = Boolean(draft && task?.skill_id !== "reply_analysis") || Boolean(result && isComposeResultCard(result));
  const decisionActions = !composing && result ? result.recommended_actions || result.actions || [] : [];
  const stageReview = useRef<HTMLDetailsElement>(null);
  // Storage is an initial value for one R3 card, not an authority that can replay
  // over the employee's explicit open/close choice when late props arrive.
  const initializedStageReviewElement = useRef<HTMLDetailsElement | null>(null);
  const [initializedStageReviewKey, setInitializedStageReviewKey] = useState("");
  const stageReviewKey = latestStage ? `ui:stage-review:${sessionId}:${latestStage.id}` : "";
  const lastUser = [...messages].reverse().find(message => message.kind === "me");
  const lastUserIndex = messages.findIndex(message => message.id === lastUser?.id);
  const stageRequested = Boolean(latestStage && !latestStage.payload.locked && !latestStage.payload.resolved && !latestStage.payload.rejected
    && lastUserIndex > messages.findIndex(message => message.id === mailMessages.at(-1)?.id));
  const stageReviewInitialized = initializedStageReviewKey === stageReviewKey;
  useEffect(() => {
    if (stageRequested && activeTab !== "result") chooseTab("result");
  }, [stageRequested, latestStage?.id]);
  useEffect(() => {
    const element = stageReview.current;
    if (!stageReviewKey || !latestStage || !ready || !element
      || initializedStageReviewElement.current === element) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(stageReviewKey); } catch { /* Storage is optional. */ }
    const open = saved === "true" || (saved === null && ready && stageRequested);
    initializedStageReviewElement.current = element;
    // Do not control the `open` attribute after this one per-ID restoration.
    // Chromium queues a native `toggle` for summary activation after React has
    // committed click work; a controlled attribute can then invert the employee's
    // one real click. The native element remains authoritative after initialization.
    element.open = open;
    setInitializedStageReviewKey(stageReviewKey);
    if (saved === null && open) {
      try { sessionStorage.setItem(stageReviewKey, "true"); } catch { /* Storage is optional. */ }
    }
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      revealWorkspace(sessionId, "rail", latestStage.id);
      requestAnimationFrame(() => stageReview.current?.querySelector<HTMLElement>("[data-confirm-stage]")?.scrollIntoView({ block: "nearest", behavior: "auto" }));
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, stageRequested, latestStage?.id, sessionId, stageReviewKey]);

  const persistStageReviewOpen = (open: boolean) => {
    if (stageReviewKey) setInitializedStageReviewKey(stageReviewKey);
    if (!stageReviewKey) return;
    try { sessionStorage.setItem(stageReviewKey, String(open)); } catch { /* Storage is optional. */ }
  };

  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("ui:right-collapsed");
    return saved === null ? window.matchMedia("(max-width: 1199px)").matches : saved === "true";
  });
  const [share, setShare] = useState<{ url?: string; expires_at?: string } | null>(null);
  const [toolStatus, setToolStatus] = useState("");

  const toggle = () => {
    setCollapsed((value) => {
      localStorage.setItem("ui:right-collapsed", String(!value));
      void api.savePreferences({ right_workbench_collapsed: !value }).catch(() => undefined);
      return !value;
    });
  };

  const copyArtifact = async () => {
    const content = draft
      ? [draft.subject, draft.body].filter(Boolean).join("\n\n")
      : result
        ? [result.title, result.summary, result.subject, result.body].filter(Boolean).join("\n\n")
        : "";
    await navigator.clipboard.writeText(content || "暂无可复制的结果");
    setToolStatus("已复制公开内容");
  };

  const createShare = async () => {
    try {
      const created = await api.shareSession(sessionId);
      const url = created.url || (created.token ? `${location.origin}/share/${created.token}` : "");
      setShare({ url, expires_at: created.expires_at });
      let copied = false;
      if (url && navigator.share) {
        await navigator.share({ title: "共享会话", url }).then(() => { copied = true; }).catch(() => undefined);
      } else if (url) {
        await navigator.clipboard.writeText(url).then(() => { copied = true; }).catch(() => undefined);
      }
      setToolStatus(url ? (copied ? "分享链接已创建并复制" : "分享链接已创建，请手动复制") : "分享已创建");
    } catch (e) {
      setToolStatus(e instanceof Error ? e.message : "无法创建分享");
    }
  };

  const Container = embedded ? "div" : "aside";
  const mailDecision = mailMessages.length && renderArtifact ? <>
    <KolMailWorkbench messages={mailMessages} sessionId={sessionId} officialStage={officialStage}
      nextActions={decisionActions.length ? <ResultActions compact actions={decisionActions} sessionId={sessionId} onPrefill={onPrefill} /> : null}
      onReviewStage={latestStage ? () => {
        if (stageReview.current) {
          initializedStageReviewElement.current = stageReview.current;
          stageReview.current.open = true;
        }
        persistStageReviewOpen(true);
        revealWorkspace(sessionId, "rail", latestStage.id);
        stageReview.current?.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
        requestAnimationFrame(() => stageReview.current?.querySelector<HTMLElement>("[data-confirm-stage]")?.scrollIntoView({ block: "nearest", behavior: "auto" }));
      } : undefined} />
    {latestStage ? <details key={stageReviewKey} className="mail-stage-review" ref={stageReview} data-result-message={latestStage.id}
      data-stage-review-initialized={stageReviewInitialized ? "true" : "false"}
      onToggle={(event) => {
        initializedStageReviewElement.current = event.currentTarget;
        persistStageReviewOpen(event.currentTarget.open);
      }}
    >
      <summary data-stage-review-summary>正式阶段变更 · 独立确认</summary>{renderArtifact(latestStage)}
    </details> : null}
  </> : null;
  const resultExtraInStatus = Boolean(runView?.canRerun || statusView.canRerun);
  const renderedArtifacts = renderArtifact
    ? messages
      .map((message) => ({ message, artifact: renderArtifact(message) }))
      .filter((row): row is { message: Message; artifact: ReactNode } => Boolean(row.artifact))
    : [];
  const artifactRows = renderedArtifacts.filter(({ message }) => {
    if (mailDecision && message.kind === "kol_mail_card") return false;
    if (mailDecision && message.id === latestStage?.id) return false;
    if (mailDecision && composing && message.id === latestDraft?.id) return false;
    return true;
  });
  const [activeArtifactId, setActiveArtifactId] = useState<string | undefined>(primaryArtifactId);
  const previousPrimaryArtifactId = useRef(primaryArtifactId);
  useEffect(() => {
    if (primaryArtifactId === previousPrimaryArtifactId.current) return;
    previousPrimaryArtifactId.current = primaryArtifactId;
    if (userReading.current || userPickedTab.current) { setHasNewResult(true); return; }
    setActiveArtifactId(primaryArtifactId);
    if (primaryArtifactId) setActiveTab("result");
  }, [primaryArtifactId]);
  const activeArtifact = artifactRows.find((row) => row.message.id === activeArtifactId) || artifactRows.at(-1);
  const historyArtifacts = artifactRows.filter((row) => row.message.id !== activeArtifact?.message.id);
  const artifactLabel = (message: Message) => {
    if (message.kind === "email_card") return String((message.payload as unknown as EmailCard).subject || "邮件草稿");
    if (message.kind === "confirm_stage_card") return "阶段建议";
    if (message.kind === "task_result_card") return stripEngineCopy(String(resultCardOf(message).title || "任务结果"));
    return entries.find((entry) => entry.id === message.id)?.title || "成果";
  };
  const currentMessages = messages.slice(messages.map(message => message.kind).lastIndexOf("me") + 1);
  const showLatestResult = () => {
    userReading.current = false;
    userPickedTab.current = false;
    setHasNewResult(false);
    setActiveArtifactId(primaryArtifactId);
    setActiveTab("result");
  };
  const history = historyArtifacts.length ? (
    <details className="rail-result-history" data-rail-result-history>
      <summary>历史与阶段输出（{historyArtifacts.length}）</summary>
      <ol>{historyArtifacts.map(({ message }) => <li key={message.id}>
        <button type="button" className="result-index-item" onClick={() => { setActiveArtifactId(message.id); chooseTab("result"); }}>
          <span className="result-index-title">{artifactLabel(message)}</span>
          <time className="result-index-time">{clock(streamTime(message))}</time>
        </button>
      </li>)}</ol>
    </details>
  ) : null;
  const tabs: Array<{ id: ResultRailTab; label: string; badge?: number }> = [
    { id: "result", label: "结果", badge: artifactRows.length > 1 ? artifactRows.length : undefined },
    { id: "status", label: "状态过程" },
    ...(debug ? [{ id: "debug" as const, label: "调试细节" }] : []),
  ];
  return (
    <Container
      className={embedded ? "embedded-workbench" : "side-workbench scope-task-rail" + (collapsed ? " is-collapsed" : "")}
      data-workbench={embedded ? undefined : true}
    >
      {/* 收起/展开按钮＝今日任务右栏同一个控件（24px 图标 + 竖排标签 + 可见焦点环）。 */}
      {!embedded && (!discoveryReturn || collapsed) ? <button
        type="button"
        className="scope-task-rail-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开结果" : "收起结果"}
        title={collapsed ? "展开结果" : "收起结果"}
        data-workbench-toggle
        onClick={toggle}
      >
        <PanelToggleIcon className="scope-task-rail-toggle-icon" />
      </button> : null}
      {discoveryReturn && collapsed ? <Link className="discovery-return is-collapsed-return" to={discoveryReturn} data-session-back-link>返回 AI发现</Link> : null}
      {!embedded && collapsed ? null : <>
      <div className="rail-tab-root" ref={railRootRef}
        onWheel={() => { userReading.current = true; }}
        onPointerDown={event => { if (!(event.target as HTMLElement).closest('[role="tab"]')) userReading.current = true; }}
        onKeyDown={() => { userReading.current = true; }}>
      <details className="result-tools" data-rail-tools><summary>更多操作</summary>
      <div className="artifact-toolbar" aria-label="产物工具栏">
        {discoveryReturn ? <Link className="discovery-return" to={discoveryReturn} data-session-back-link>返回 AI发现</Link> : null}
        <a className="icon-btn" href={`/api/sessions/${sessionId}/export?format=md`} download aria-label="下载 Markdown">↓ MD</a>
        {debug ? <a className="icon-btn" href={`/api/sessions/${sessionId}/export?format=json`} download aria-label="下载 JSON">↓ JSON</a> : null}
        {draft?.draft_id && <a className="icon-btn" href={`/api/queries/mail.export?draft_id=${encodeURIComponent(draft.draft_id)}&format=eml`} download aria-label="下载邮件草稿">.eml</a>}
        <button className="icon-btn" onClick={() => void copyArtifact()}>复制</button>
        <button className="icon-btn" onClick={() => window.open(`/s/${sessionId}`, "_blank", "noopener")}>打开</button>
        <button className="icon-btn" onClick={() => void createShare()}>分享</button>
        {discoveryReturn && !embedded ? <button type="button" className="icon-btn discovery-inline-toggle" data-workbench-toggle
          aria-label="收起结果" aria-expanded onClick={toggle}><PanelToggleIcon className="scope-task-rail-toggle-icon" /></button> : null}
      </div>
      </details>
      <ResultRailTabs tabs={tabs} active={activeTab} onChange={chooseTab} />
      {hasNewResult ? <button type="button" className="result-pointer-button" data-new-result onClick={showLatestResult}>有新结果</button> : null}
      {(toolStatus || share) && <div className="share-status" role="status">{toolStatus}{share?.expires_at && <> · {new Date(share.expires_at).toLocaleString()} 过期</>}{share?.url && <><input className="share-url" aria-label="分享链接" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} /><button className="link-button" onClick={() => void navigator.clipboard.writeText(share.url || "").then(() => setToolStatus("分享链接已复制")).catch(() => setToolStatus("请手动复制链接"))}>复制链接</button></>}{share && <button className="link-button" onClick={() => void api.revokeShare(sessionId).then(() => { setShare(null); setToolStatus("分享已撤销"); }).catch((e) => setToolStatus(String(e)))}>撤销</button>}</div>}
      <div className="side-body" data-rail-panels>
        <section className="rail-panel" role="tabpanel" id="rail-panel-result" aria-labelledby="rail-tab-result" data-round-results hidden={activeTab !== "result"}>
          {mailDecision && composing && latestDraft ? <>
            <section data-tab="draft" data-result-message={latestDraft.id}>{renderArtifact ? renderArtifact(latestDraft) : null}</section>
            <details className="mail-decision-context"><summary>阶段建议与证据链</summary>{mailDecision}</details>
          </> : mailDecision}
          {activeArtifact ? (
            <section key={activeArtifact.message.id} aria-current="true" data-result-message={activeArtifact.message.id} data-tab={activeArtifact.message.kind === "email_card" ? "draft" : "result"}>
              {activeArtifact.artifact}
            </section>
          ) : null}
          {activeArtifact && activeArtifact.message.id !== primaryArtifactId ? <p className="muted" data-historical-result>正在查看历史版本 · <button className="result-pointer-button" onClick={showLatestResult}>回到当前成果</button></p> : null}
          {!resultExtraInStatus ? resultExtra : null}
          {focusedMail ? (
            <section data-mail-focus>
              <MailBodyArtifact mail={focusedMail} />
            </section>
          ) : null}
          {artifactExtra}
          {resultExtraInStatus ? <p className="muted">停止或失败后的恢复入口在“状态过程”页。</p> : null}
          {!mailDecision && !activeArtifact && !resultExtra && !focusedMail && !artifactExtra ? (
            entries.length ? (
              <nav className="result-index" aria-label="结果目录" data-result-index>
                <div className="page-kicker">结果目录</div>
                <ol>
                  {entries.map((entry) => (
                    <li key={`${entry.kind}:${entry.id}`}>
                      <button type="button" className="result-index-item" data-result-entry={entry.id} data-result-kind={entry.kind} onClick={() => locateStreamEntry(entry.id)}>
                        <span className="result-index-title">{entry.title}</span>
                        {entry.detail ? <span className="result-index-detail">{entry.detail}</span> : null}
                        {entry.time ? <time className="result-index-time" dateTime={new Date(entry.time).toISOString()}>{clock(entry.time)}</time> : null}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : (
              <p className="muted" data-result-index-empty>成果将在生成后自动显示；当前执行反馈见中栏。</p>
            )
          ) : null}
        </section>
        <section className="rail-panel rail-status-panel" role="tabpanel" id="rail-panel-status" aria-labelledby="rail-tab-status" data-rail-panel="status" hidden={activeTab !== "status"}>
          {showStatus ? (
            <div className="side-status" data-run-status={statusView.key} data-run-tone={statusView.tone}>
              <AgentAvatar active={runView?.live ?? statusView.live} failed={(runView?.key || statusView.key) === "failed"} />
              <i className={`status-shape is-${statusView.tone}`} aria-hidden>{STATUS_SHAPE_GLYPH[statusView.shape]}</i>
              <span className="side-status-copy" data-agent-status={status} data-workspace-status role="status" aria-live="polite">
                {statusOverride || runView?.label || statusView.copy}
              </span>
              {statusView.live && phase ? <span className="side-status-phase" data-run-phase>{phase}</span> : null}
              {statusView.live ? <span className="side-status-hint">刷新页面不会取消后台执行；过程在中栏，完整成果保存在这里</span> : null}
            </div>
          ) : (
            <div className="rail-status-quiet" data-rail-status-quiet>
              <strong data-agent-status={status} data-workspace-status role="status" aria-live="polite">{statusOverride || runView?.label || statusView.copy}</strong>
              <p>执行状态依据真实回执更新；成果保存在“结果”。</p>
            </div>
          )}
          <div className="rail-process" data-rail-process>
            <h3>本次处理记录</h3>
            <ExecutionTimeline messages={currentMessages} label={employeeTraceLabel} />
          </div>
          {history}

          {task?.last_error ? <p className="error" role="alert">失败原因：{task.last_error}</p> : null}
          {stageRequested ? <button type="button" className="result-pointer-button" onClick={() => chooseTab("result")}>查看待确认的阶段建议</button> : null}
          {resultExtraInStatus ? resultExtra : null}
        </section>
        {debug ? (
          <section className="rail-panel rail-debug-panel" role="tabpanel" id="rail-panel-debug" aria-labelledby="rail-tab-debug" data-rail-panel="debug" hidden={activeTab !== "debug"}>
            <dl className="rail-debug-list">
              <div><dt>会话</dt><dd>{sessionId}</dd></div>
              <div><dt>任务</dt><dd>{task?.id || "—"}</dd></div>
              <div><dt>执行面</dt><dd>{remoteLabel || "未提供"}</dd></div>
              <div><dt>状态</dt><dd>{statusView.key} · {status}</dd></div>
              <div><dt>阶段</dt><dd>{phase || "—"}</dd></div>
              <div><dt>运行</dt><dd>{runView?.key || "—"}</dd></div>
            </dl>
            <p className="muted">仅调试视图可见；不包含凭据或私有正文。</p>
          </section>
        ) : null}
      </div>
      </div>
      </>}
    </Container>
  );
}
