import { Link, useLocation, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  api,
  type CrawlJob,
  type Message,
  type PendingAsk,
  type PostMessageResult,
  type AgentRunStatus,
  type StartCrawlInput,
  type Task,
  type TaskEvent,
  type KnowledgeRow,
} from "../api";
import { ChatThread, clearComposerDraft, clearPending, employeeProcessLabel, resultCardsFromMessages, takeComposerDraft, takePending, useSessionMessages, type ComposerDraft } from "../components/ChatBlocks";
import ComposerDock, { type ComposerSubmit, type ComposerSuggestion, type SkillOption } from "../components/ComposerDock";
import ModelTierControl from "../composer/ModelTierControl";
import { peekComposerDraft, takeComposerDraftStash } from "../composer/draft";
import type { ComposerEntryIntent } from "../composer/types";
import Markdown from "../components/Markdown";
import AgentTaskList, { readTaskListWidth } from "../components/AgentTaskList";
import SideWorkbench from "../components/SideWorkbench";
import { AGENT_TASK_STATUS_LABEL, agentTaskUxStatus } from "../agentUx";
import { useAccount } from "../components/AuthGate";
import { useViewMode } from "../viewMode";
import RunHud from "../components/RunHud";
import { REMOTE_BACKEND_LABEL, remoteForSkill } from "../agentConfig";
import { useRunStatus } from "../hooks/useRunStatus";
import { rememberJourney } from "../journey";
import { FollowStyleTagBar } from "../components/FollowStyleTags";
import { friendlyError, missingFieldsMessage } from "../labels";
import { readBoundExpert } from "../experts";
import { todayTaskOriginLabel } from "../home/modes";
import type { SessionMailRow } from "../components/AgentTaskList";

type RecommendedAction = {
  label?: string;
  prompt?: string;
  intent?: string;
  collaboration_id?: string;
};

type ComposeGapView = {
  field?: string | null;
  label?: string;
  placeholder?: string;
  prompt?: string;
  result_action?: string;
};

function lastUnsentComposeGap(messages: Message[]): ComposeGapView | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (row.kind !== "task_result_card") continue;
    const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
    if (String(payload.title || "") === "邮件已发送") return null;
    const nested = payload.starrykol_data && typeof payload.starrykol_data === "object"
      ? payload.starrykol_data as Record<string, unknown>
      : {};
    if (payload.sent || nested.sent) return null;
    const loop = payload.compose_loop && typeof payload.compose_loop === "object"
      ? payload.compose_loop as { gap?: ComposeGapView }
      : null;
    return loop?.gap && typeof loop.gap === "object" ? loop.gap : null;
  }
  return null;
}

function isCannedGreetingSummary(text?: string): boolean {
  return /^(去信|来信)寒暄跟进，尚未落到报价、档期或明确兴趣。$/.test(String(text || "").trim());
}

type JourneyMailDigest = {
  text?: string;
  source?: string;
  mail_count?: number;
  error?: string;
  attempted?: string[];
  failed_at?: string;
};

function isRemoteModelDigest(source: string, text: string): boolean {
  return (source === "codex_memory" || source === "luna") && Boolean(text) && !isCannedGreetingSummary(text);
}

function isPlaceholderDigest(text: string): boolean {
  return /^(正在把本会话全部往来收成一段话。|未能读完这些正文。下拉刷新可重试。)$/.test(text);
}

function threadDigestView(digest: JourneyMailDigest | null, pending: boolean): {
  label: string;
  kind: "luna" | "codex" | "pending" | "failed" | "rule";
  text: string;
  status?: string;
  lede?: string;
  excerpt?: string;
  disclaimer?: string;
  prominent: boolean;
} {
  const source = String(digest?.source || "");
  const summary = String(digest?.text || "").trim();
  const excerpt = summary && !isPlaceholderDigest(summary) ? summary : "";
  if (isRemoteModelDigest(source, summary)) {
    return {
      label: "历史邮件往来摘要",
      kind: source === "luna" ? "luna" : "codex",
      text: summary,
      prominent: true,
    };
  }
  if (pending) {
    return {
      label: "正在读历史邮件",
      kind: "pending",
      status: "正在读历史邮件",
      text: "",
      lede: "正在读取本会话的往来邮件。",
      excerpt,
      prominent: false,
    };
  }
  if (source === "analysis_failed") {
    const error = String(digest?.error || "").trim();
    const status = error ? `分析未完成 · ${error}` : "分析未完成";
    return {
      label: status,
      kind: "failed",
      status,
      text: "",
      lede: "未能读完这些正文。下拉刷新可重试。",
      excerpt,
      prominent: false,
    };
  }
  return {
    label: "规则摘录",
    kind: "rule",
    text: excerpt,
    excerpt,
    disclaimer: "这不是模型摘要，而是按每封邮件整理的规则摘录。",
    prominent: false,
  };
}

function looksLikeEmailDraft(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^(hi|hello|dear)\b/i.test(t)) return true;
  return /\nbest[,，]/i.test(t) && t.length > 40;
}

function splitPortraitNotes(notes: unknown): string[] {
  return String(notes || "")
    .split(/[·/;、，,|/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ThreadMailDigest({
  digest,
  pending,
  mailCount,
  onRefresh,
}: {
  digest: JourneyMailDigest | null;
  pending: boolean;
  mailCount?: number;
  onRefresh?: () => void;
}) {
  const analysis = threadDigestView(digest, pending);
  const count = Number(digest?.mail_count || mailCount || 0);
  const source = digest?.source || (pending ? "pending" : "body_analysis");
  return (
    <article
      className={`thread-mail-digest sop-mail-analysis is-${analysis.kind}`}
      data-mail-digest
      data-mail-summaries
      data-mail-summary
      data-digest-kind={analysis.kind}
      data-summary-source={source}
      data-digest-error={digest?.error || undefined}
      data-digest-failed-at={digest?.failed_at || undefined}
    >
      <span className="sop-mail-icon" aria-hidden>✉️</span>
      <strong className="sop-mail-analysis-label" data-digest-status={analysis.status || undefined}>{analysis.label}</strong>
      {count ? <small data-digest-count>{count} 封往来</small> : null}
      {analysis.disclaimer ? (
        <p className="digest-disclaimer" data-digest-disclaimer>{analysis.disclaimer}</p>
      ) : null}
      {analysis.lede ? (
        <p className="digest-lede" data-digest-lede>{analysis.lede}</p>
      ) : null}
      {analysis.prominent && analysis.text ? (
        <div className="sop-mail-md-body" data-digest-body>
          <Markdown>{analysis.text}</Markdown>
        </div>
      ) : null}
      {!analysis.prominent && analysis.excerpt ? (
        <details className="digest-excerpt" data-digest-excerpt>
          <summary>查看摘录</summary>
          <div className="sop-mail-md-body" data-digest-body>
            <Markdown>{analysis.excerpt}</Markdown>
          </div>
        </details>
      ) : null}
      {analysis.kind === "failed" && onRefresh ? (
        <button type="button" className="digest-retry" onClick={onRefresh}>重试读取</button>
      ) : null}
    </article>
  );
}

function KolPortraitFields({ portrait }: { portrait: Record<string, unknown> }) {
  const platform = String(portrait.platform || "").trim();
  const brand = String(portrait.brand || "").trim();
  const email = String(portrait.email || "").trim();
  const followers = String(portrait.followers || "").trim();
  const notes = splitPortraitNotes(portrait.notes);
  const days = Number(portrait.days_in_stage || 0);
  const hasIdentity = Boolean(platform || brand);
  const hasMeta = Boolean(followers || days > 0);
  if (!hasIdentity && !email && !hasMeta && !notes.length) {
    return <span className="muted">画像待补</span>;
  }
  return (
    <div className="kol-portrait" data-kol-portrait>
      {hasIdentity ? (
        <div className="portrait-row is-identity" data-portrait-field="identity">
          <span className="portrait-chips">
            {platform ? <span className="chip" data-portrait-field="platform">{platform}</span> : null}
            {brand ? <span className="chip" data-portrait-field="brand">{brand}</span> : null}
          </span>
        </div>
      ) : null}
      {email ? (
        <div className="portrait-row is-email" data-portrait-field="email">
          <span className="portrait-value mono">{email}</span>
        </div>
      ) : null}
      {hasMeta ? (
        <div className="portrait-row is-meta" data-portrait-field="meta">
          {followers ? <span data-portrait-field="followers">{followers}</span> : null}
          {followers && days > 0 ? <span className="portrait-sep" aria-hidden>·</span> : null}
          {days > 0 ? <span data-portrait-field="stay">{days} 天</span> : null}
        </div>
      ) : null}
      {notes.length ? (
        <div className="portrait-row is-tags" data-portrait-field="tags">
          <span className="portrait-chips">
            {notes.map((value) => (
              <span key={value} className="chip">{value}</span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Share one POST across React StrictMode remount so 记状态 / 催大纲 不会卡在空会话。 */
const inflight = new Map<string, Promise<PostMessageResult>>();

function postOnce(sessionId: string, payload: PendingAsk): Promise<PostMessageResult> {
  const key = `${sessionId}:${payload.text || ""}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const req = api.postMessage(sessionId, payload).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, req);
  return req;
}

function unwrapTask(value: Task | { task: Task }): Task {
  return (value as { task?: Task }).task || (value as Task);
}

function unwrapEvents(value: TaskEvent[] | { events: TaskEvent[] }): TaskEvent[] {
  return Array.isArray(value) ? value : value.events || [];
}

function unwrapCrawlJob(value: CrawlJob | { crawl_job: CrawlJob; job?: CrawlJob }): CrawlJob {
  return (value as { crawl_job?: CrawlJob; job?: CrawlJob }).crawl_job
    || (value as { job?: CrawlJob }).job
    || value as CrawlJob;
}

const CRAWL_PROGRESS: Record<string, string> = {
  starting: "正在启动远程采集",
  running: "正在采集公开创作者数据",
  stopping: "正在停止远程采集",
  queued: "远程采集已排队",
  crawling: "正在安全采集公开创作者数据",
  uploading: "正在接收采集结果",
  analyzing: "正在分析候选创作者",
  result_ready: "候选创作者结果已就绪",
  error: "远程采集遇到异常",
  stopped: "远程采集已停止",
};
const ACTIVE_CRAWL = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);

function safeCrawlEventMessages(taskId: string, events: TaskEvent[], job: CrawlJob | null): Message[] {
  const rows = (events.length ? events : job ? [{ id: "job", status: job.status, created_at: job.updated_at }] : [])
    .filter((event) => String(event.event_type || event.type || "") !== "operation");
  const seenStatuses = new Set<string>();
  const phases = rows.flatMap((event) => {
    const status = String(event.status || event.type || job?.status || "");
    if (seenStatuses.has(status)) return [];
    seenStatuses.add(status);
    return [{
      label: employeeProcessLabel(CRAWL_PROGRESS[status] || "远程采集状态已更新"),
      status: status === "error" ? "failed" : status === "result_ready" || status === "stopped" ? "done" : "running",
    }];
  });
  if (!phases.length) return [];
  return [{
    id: `crawl-progress:${taskId}`,
    session_id: taskId,
    role: "assistant",
    kind: "process_trace",
    payload: { title: "创作者采集进度", phases },
    created_at: rows[rows.length - 1].created_at || new Date().toISOString(),
  }];
}

function safeCrawlOperationMessages(taskId: string, events: TaskEvent[]): Message[] {
  const operations = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (String(event.event_type || event.type || "") !== "operation") continue;
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload as Record<string, unknown>
      : {};
    const name = String(payload.operation || "");
    if (!name) continue;
    operations.set(name, {
      id: name,
      name,
      label: employeeProcessLabel(String(payload.label || event.summary || name)),
      status: String(payload.operation_status || event.status || "running"),
      summary: event.summary,
    });
  }
  if (!operations.size) return [];
  return [{
    id: `crawl-operations:${taskId}`,
    session_id: taskId,
    role: "assistant",
    kind: "operation_trace",
    payload: { title: "正在调用系统能力", items: [...operations.values()] },
    created_at: new Date().toISOString(),
  }];
}

function taskAnalysisSummary(task: Task): string {
  const entities = task.entities && typeof task.entities === "object"
    ? task.entities as Record<string, unknown>
    : {};
  const platformLabels: Record<string, string> = {
    youtube: "YouTube", instagram: "Instagram", facebook: "Facebook",
    xhs: "小红书", dy: "抖音", ks: "快手", bili: "哔哩哔哩", wb: "微博", tieba: "贴吧", zhihu: "知乎",
  };
  if (String(task.task_type || task.skill) === "creator_discovery") {
    const platform = platformLabels[String(entities.platform || "")] || String(entities.platform || "待选择平台");
    const keywords = Array.isArray(entities.keywords) ? entities.keywords.map(String).join("、") : "待补充关键词";
    return `已识别为达人发现任务；目标平台：${platform}；搜索主题：${keywords}。参数生成后将自动启动远程采集。`;
  }
  return `正在处理“${task.title}”。完整结果会放在结果工作台。`;
}

function humanError(message: string) {
  if (
    /请求失败\s*\((502|503|500)\)/.test(message) ||
    /502|503/.test(message) ||
    /is not valid JSON|Unexpected token|SyntaxError/i.test(message)
  ) {
    return "连接暂时异常，已保留你的任务。";
  }
  return friendlyError(message, message);
}

function safeEventMessages(taskId: string, events: TaskEvent[]): Message[] {
  return events
    .filter((event) => !/(reasoning|thought|tool|internal)/i.test(String(event.type || "")))
    .map((event, index) => {
      const label = employeeProcessLabel(String(event.title || event.label || event.message || "任务进度已更新")
        .replace(/`[^`]+`/g, "任务步骤")
        .slice(0, 120));
      const summary = event.summary
        ? employeeProcessLabel(String(event.summary).replace(/`[^`]+`/g, "内部步骤").slice(0, 180))
        : undefined;
      return {
        id: `task-event:${event.id || index}`,
        session_id: taskId,
        role: "assistant",
        kind: "process_trace",
        payload: {
          title: "任务进度",
          phases: [{ label, status: event.status || "running", summary }],
        },
        created_at: event.created_at || new Date().toISOString(),
      };
    });
}

const DRAFT_SUBMIT_GUARD_MS = 500;

async function bindSessionTask(
  sessionId: string,
  input: { intent: string; title?: string | null; text: string; composer: ComposerSubmit },
): Promise<{ pending: PendingAsk; task: Task } | { clarification: string } | null> {
  try {
    const created = unwrapTask(await api.createTask({
      task_type: input.intent,
      title: input.title || input.text.slice(0, 80),
      prompt: input.text,
      session_id: sessionId,
      source: "manual",
      intent: input.intent,
      attachments: input.composer.attachments,
      model_tier: input.composer.model_tier,
      collaboration_id: input.composer.collaboration_id,
      knowledge_id: input.composer.knowledge_id,
    }));
    if (created.status === "needs_clarification") {
      const missing = (created.resolution as { missing_fields?: string[] } | undefined)?.missing_fields || [];
      return {
        clarification: missing.length ? missingFieldsMessage(missing) : "请补充任务所需信息后再执行。",
      };
    }
    const run = await api.runTask(created.id, { text: input.text });
    const pending = (run.pending_message || run.pending || {}) as Record<string, unknown>;
    sessionStorage.setItem(`task:${sessionId}`, created.id);
    return {
      task: unwrapTask(run.task || created),
      pending: {
        text: input.text,
        intent: input.intent,
        collaboration_id: input.composer.collaboration_id,
        knowledge_id: input.composer.knowledge_id,
        attachments: input.composer.attachments,
        model_tier: input.composer.model_tier,
        work_item_id: String(pending.work_item_id || run.work_item_id || created.id),
        task_type: String(pending.task_type || created.task_type || created.skill || input.intent),
        run_id: pending.run_id ? String(pending.run_id) : (run.run_id ? String(run.run_id) : undefined),
        entities: pending.entities && typeof pending.entities === "object"
          ? pending.entities as Record<string, unknown>
          : undefined,
      },
    };
  } catch {
    return null;
  }
}

export default function Chat() {
  const { id } = useParams();
  const location = useLocation();
  const { account } = useAccount();
  const { debug } = useViewMode();
  const { messages, err, reload, setMessages, agentStatus, setAgentStatus, journey, collaborationId, sessionLoaded, runQueue, setRunQueue } = useSessionMessages(id);
  const [text, setText] = useState("");
  const [entryIntent, setEntryIntent] = useState<ComposerEntryIntent>("free");
  const [lockedIntent, setLockedIntent] = useState<string | null>(null);
  const [lockedLabel, setLockedLabel] = useState<string | null>(null);
  const [lockedKnowledgeId, setLockedKnowledgeId] = useState<string | null>(null);
  const [focusDraft, setFocusDraft] = useState(false);
  const [blockSubmit, setBlockSubmit] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [pending, setPending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [completion, setCompletion] = useState("");
  const [completing, setCompleting] = useState(false);
  const [crawlJob, setCrawlJob] = useState<CrawlJob | null>(null);
  const [crawlEvents, setCrawlEvents] = useState<TaskEvent[]>([]);
  const [taskListWidth, setTaskListWidth] = useState(() => readTaskListWidth());
  const [crawlBusy, setCrawlBusy] = useState(false);
  const [crawlError, setCrawlError] = useState("");
  const [crawlGeneration, setCrawlGeneration] = useState(0);
  const [focusedMail, setFocusedMail] = useState<SessionMailRow | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const stopRequestedRef = useRef(false);
  const focusThread = String((location.state as { focusThread?: string } | null)?.focusThread || "");
  const confirmStageNotice = String(
    (location.state as { confirmStageNotice?: string } | null)?.confirmStageNotice || "",
  );

  useEffect(() => {
    if (!id) return;
    const taskId = sessionStorage.getItem(`task:${id}`) || id;
    let cancelled = false;
    const loadTask = async () => {
      try {
        const nextTask = unwrapTask(
          sessionStorage.getItem(`task:${id}`)
            ? await api.task(taskId)
            : await api.taskBySession(id),
        );
        if (cancelled) return;
        setTask(nextTask);
        sessionStorage.setItem(`task:${id}`, nextTask.id);
        const events = unwrapEvents(await api.taskEvents(nextTask.id).catch(() => []));
        if (!cancelled) setTaskEvents(events);
      } catch {
        // Legacy sessions have no task resource and continue using session messages.
      }
    };
    void loadTask();
    const timer = window.setInterval(() => {
      if (task?.status === "pending" || task?.status === "running" || task?.status === "waiting" || task?.status === "queued") {
        void loadTask();
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, task?.status]);

  useEffect(() => {
    if (!task) return;
    const taskType = String(task.task_type || task.skill || task.skill_id || "");
    const crawlAware = taskType === "creator_discovery" || Boolean(task.crawl_plan || task.crawl_result);
    if (!crawlAware) return;
    let cancelled = false;
    let timer: number | undefined;
    let missingRetries = 0;
    const load = async () => {
      try {
        const [jobValue, eventValue] = await Promise.all([
          api.crawlJob(task.id),
          api.crawlEvents(task.id).catch(() => []),
        ]);
        if (cancelled) return;
        const nextJob = unwrapCrawlJob(jobValue);
        setCrawlJob(nextJob);
        setCrawlEvents(unwrapEvents(eventValue));
        setCrawlError("");
        if (["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"].includes(nextJob.status)) {
          timer = window.setTimeout(load, 1000);
        }
      } catch (error) {
        if (!cancelled && (error as Error & { status?: number }).status === 404 && missingRetries < 10) {
          missingRetries += 1;
          timer = window.setTimeout(load, 1000);
        } else if (!cancelled && (error as Error & { status?: number }).status !== 404) {
          setCrawlError(error instanceof Error ? error.message : "无法读取远程任务状态");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [task?.id, task?.task_type, task?.skill, task?.skill_id, task?.crawl_plan, task?.crawl_result, task?.task_result, crawlGeneration]);

  useEffect(() => {
    if (!id) return;
    const fromNav = (location.state as { composerDraft?: ComposerDraft } | null)?.composerDraft;
    const draft = takeComposerDraft(id) || (fromNav?.text ? fromNav : null);
    const stashed = peekComposerDraft();
    if (!draft && !stashed) {
      setText("");
      setLockedIntent(null);
      setLockedLabel(null);
      setEntryIntent("free");
      setFocusDraft(false);
      setBlockSubmit(false);
      return;
    }
    if (stashed) {
      takeComposerDraftStash();
      setText(stashed.text || draft?.text || "");
      setEntryIntent(stashed.intent || "free");
      setLockedIntent(draft?.intent || null);
      setLockedLabel(draft?.title || null);
      setFocusDraft(true);
      return;
    }
    setText(draft!.text);
    setLockedIntent(draft!.intent || null);
    setLockedLabel(draft!.title || null);
    setFocusDraft(true);
    setBlockSubmit(true);
    const timer = window.setTimeout(() => setBlockSubmit(false), DRAFT_SUBMIT_GUARD_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    stopRequestedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const payload = takePending(id);
    if (!payload) return;
    stopRequestedRef.current = false;
    setPending(true);
    setAgentStatus("running");
    const req = postOnce(id, payload);
    let cancelled = false;
    req
      .then((r) => {
        clearPending(id);
        if (cancelled || stopRequestedRef.current) return;
        setMessages(r.messages);
        setAgentStatus(String(r.agent_status || (r.accepted ? "running" : "listening")));
      })
      .catch(() => {
        clearPending(id);
        if (!cancelled) reload();
      })
      .finally(() => {
        if (!cancelled) {
          setPending(false);
          reload();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload, setMessages, setAgentStatus]);

  useEffect(() => {
    if (!id || !journey?.mail_analysis_pending) return;
    const timer = window.setInterval(() => reload(false), 2000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 45000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [id, journey?.mail_analysis_pending, reload]);

  const send = async (p: ComposerSubmit) => {
    if (!id) return;
    const t = p.text.trim();
    if (!t && !p.attachments?.length) return;
    const title = lockedLabel;
    const existingTask = task;
    const savedIntent = p.intent || lockedIntent;
    const savedLabel = lockedLabel;
    setText("");
    setLockedIntent(null);
    setLockedLabel(null);
    setLockedKnowledgeId(null);
    setFocusDraft(false);
    setSubmitErr("");
    clearComposerDraft(id);
    stopRequestedRef.current = false;
    setPending(true);
    setAgentStatus("running");
    setFocusedMail(null);
    rememberJourney({ kind: "send", skillId: String(existingTask?.skill_id || existingTask?.skill || ""), skillLabel: title || existingTask?.title });
    try {
      const pendingAsk: PendingAsk = {
        text: t,
        intent: p.intent || lockedIntent || undefined,
        collaboration_id: p.collaboration_id || (journey?.collaboration_id ? String(journey.collaboration_id) : undefined),
        knowledge_id: p.knowledge_id,
        attachments: p.attachments,
        model_tier: p.model_tier,
        scope: p.scope,
        object_refs: p.object_refs,
        client_entry: p.client_entry,
        entities: {
          ...(p.entities || {}),
          ...((p.intent || lockedIntent) === "email_compose" && looksLikeEmailDraft(t) ? { body: t } : {}),
        },
      };
      const r = await postOnce(id, pendingAsk);
      if (stopRequestedRef.current) return;
      setMessages(r.messages || []);
      setAgentStatus(String(r.agent_status || (r.accepted ? "running" : "listening")));
    } catch (error) {
      setText(t);
      setLockedIntent(savedIntent);
      setLockedLabel(savedLabel);
      setSubmitErr(error instanceof Error ? error.message : "还不能开始这项工作");
    } finally {
      setPending(false);
      reload();
    }
  };

  const stopRun = async () => {
    if (!id) return;
    stopRequestedRef.current = true;
    setPending(false);
    setAgentStatus("listening");
    try {
      const r = await api.stopSession(id);
      if (Array.isArray(r.run_queue)) setRunQueue(r.run_queue);
      setAgentStatus(String(r.agent_status || "listening"));
    } catch (error) {
      setSubmitErr(error instanceof Error ? error.message : "未能停止生成");
    } finally {
      reload();
    }
  };

  const removeQueued = async (qid: string) => {
    if (!id) return;
    try {
      await api.removeQueued(id, qid);
    } catch (error) {
      setSubmitErr(error instanceof Error ? error.message : "未能移出队列");
    } finally {
      reload();
    }
  };

  const status: AgentRunStatus = agentStatus === "running" || pending ? "running" : (agentStatus as AgentRunStatus) || "listening";
  const { phase, task: runTask } = useRunStatus(id, messages, status);
  const skillId = String(task?.skill_id || task?.skill || task?.task_type || runTask?.skill_id || runTask?.skill || "");
  const remoteLabel = debug && skillId ? REMOTE_BACKEND_LABEL[remoteForSkill(skillId)] : undefined;
  const hasVisibleTrace = messages.some((message) => message.kind === "process_trace" || message.kind === "operation_trace");
  const timeline = task && taskEvents.length && !hasVisibleTrace
    ? [...messages, ...safeEventMessages(task.id, taskEvents)]
    : messages;
  const timelineWithCrawl = task && (crawlEvents.length || crawlJob)
    ? [
        ...timeline,
        ...safeCrawlOperationMessages(task.id, crawlEvents),
        ...safeCrawlEventMessages(task.id, crawlEvents, crawlJob),
      ]
    : timeline;
  useEffect(() => {
    const pane = streamRef.current;
    if (!pane) return;
    pane.scrollTop = pane.scrollHeight;
  }, [timelineWithCrawl, crawlJob, err, submitErr]);
  const lastComposeGap = lastUnsentComposeGap(messages);
  const composerHint = String(lastComposeGap?.placeholder || journey?.composer_placeholder || "");
  const boundExpert = id ? readBoundExpert(id) : null;
  const recommendedActions = (() => {
    const expertTasks = (boundExpert?.recommended_tasks || []).map((task) => ({
      label: task.title,
      prompt: task.prompt,
    }));
    const base = (Array.isArray(journey?.recommended_actions)
      ? journey?.recommended_actions as RecommendedAction[]
      : []);
    if (expertTasks.length) {
      return [...expertTasks, ...base.filter((row) => !expertTasks.some((task) => task.prompt === row.prompt))].slice(0, 3);
    }
    if (!lastComposeGap?.field) return base.slice(0, 3);
    const gapAction: RecommendedAction = {
      label: lastComposeGap.label || lastComposeGap.result_action,
      prompt: lastComposeGap.prompt,
    };
    return [gapAction, ...base.filter((row) => String(row.prompt || "") !== String(gapAction.prompt || ""))].slice(0, 3);
  })();
  const openedAsKol = Boolean((location.state as { kolSession?: boolean } | null)?.kolSession);
  const rememberedKol = Boolean(id && sessionStorage.getItem(`kol-session:${id}`));
  const kolSession = Boolean(collaborationId || journey?.collaboration_id || openedAsKol || rememberedKol);
  const showLeftRail = Boolean(id && (kolSession || sessionLoaded));
  const sessionMails = (Array.isArray(journey?.mail_history)
    ? journey?.mail_history as SessionMailRow[]
    : undefined);
  const portrait = journey?.portrait && typeof journey.portrait === "object"
    ? journey.portrait as Record<string, unknown>
    : null;
  const mailDigest = journey?.mail_digest && typeof journey.mail_digest === "object"
    ? journey.mail_digest as JourneyMailDigest
    : (Array.isArray(journey?.mail_summaries) && journey.mail_summaries[0]
      ? {
        text: String((journey.mail_summaries[0] as SessionMailRow).summary || ""),
        source: String((journey.mail_summaries[0] as SessionMailRow).summary_source || ""),
        mail_count: Number((journey.mail_summaries[0] as { mail_count?: number }).mail_count || 0),
      }
      : null);
  const mailAnalysisPending = Boolean(journey?.mail_analysis_pending);
  const pickSuggestion = (action: ComposerSuggestion | RecommendedAction) => {
    const prompt = String(action.prompt || action.label || "").trim();
    if (!prompt || pending) return;
    setText(prompt);
    setLockedIntent(action.intent || null);
    setLockedLabel(action.intent ? (action.label || null) : null);
    setFocusDraft(true);
  };
  const pickSkill = (skill: SkillOption, ctx: { mention: string; rest: string }) => {
    setLockedIntent(skill.id);
    setLockedLabel(skill.title || skill.label || skill.id);
    if (skill.id !== "email_compose" || !id || !kolSession) return;
    const leftover = [ctx.mention, ctx.rest].filter(Boolean).join(" ").trim();
    setPreviewing(true);
    setText("正在生成邮件草稿…");
    void api.composePreview(id, {
      text: leftover,
      collaboration_id: collaborationId || (journey?.collaboration_id ? String(journey.collaboration_id) : undefined),
      handle: journey?.handle ? String(journey.handle) : undefined,
    }).then((preview) => {
      if (preview.body) setText(preview.body);
      else setText(leftover);
    }).catch(() => setText(leftover)).finally(() => setPreviewing(false));
  };
  const selectMail = (mail: SessionMailRow) => {
    const full = (sessionMails || []).find((row) => (
      (mail.id && row.id === mail.id)
      || (mail.occurred_at && row.occurred_at === mail.occurred_at && row.subject === mail.subject)
    ));
    setFocusedMail(full || mail);
  };

  useEffect(() => {
    if (id && kolSession) sessionStorage.setItem(`kol-session:${id}`, "1");
  }, [id, kolSession]);
  useEffect(() => {
    if (!focusThread) return;
    const mails = Array.isArray(journey?.mail_history) ? journey.mail_history as SessionMailRow[] : [];
    if (!mails.length) return;
    const match = mails.find((row) => String(row.conversation_id || "") === focusThread)
      || mails.find((row) => String(row.id || "") === focusThread);
    if (match) setFocusedMail(match);
  }, [focusThread, journey?.mail_history]);
  const hasRightArtifact = messages.some((message) =>
    ["task_result_card", "email_card", "confirm_stage_card", "inbound_card", "supplement_card", "kol_mail_card"].includes(message.kind) ||
    (message.kind === "steps" && String(message.payload.title || "").includes("失联")),
  ) || resultCardsFromMessages(messages).length > 0
    || Boolean(task?.task_result || task?.crawl_result) || crawlJob?.status === "result_ready" || Boolean(focusedMail)
    || Boolean(kolSession && sessionMails && sessionMails.length);
  const showRightWorkbench = Boolean(id && (hasRightArtifact || kolSession));

  const complete = async () => {
    if (!task || completing) return;
    setCompleting(true);
    setCompletion("");
    try {
      const result = await api.completeTask(task.id);
      setTask(unwrapTask(result));
      setCompletion("任务已标记完成");
      rememberJourney({ kind: "complete", skillId: String(task.skill_id || task.skill || ""), skillLabel: task.title });
    } catch (error) {
      setCompletion(error instanceof Error ? error.message : String(error));
    } finally {
      setCompleting(false);
    }
  };

  const startCrawl = async (input: StartCrawlInput) => {
    if (!task || crawlBusy) return;
    setCrawlBusy(true);
    setCrawlError("");
    try {
      setCrawlJob(unwrapCrawlJob(await api.startCrawl(task.id, input)));
      setCrawlEvents(unwrapEvents(await api.crawlEvents(task.id).catch(() => [])));
      setCrawlGeneration((value) => value + 1);
    } catch (error) {
      setCrawlError(error instanceof Error ? error.message : "启动远程采集失败");
    } finally {
      setCrawlBusy(false);
    }
  };

  const stopCrawl = async () => {
    if (!task || crawlBusy) return;
    setCrawlBusy(true);
    setCrawlError("");
    try {
      setCrawlJob(unwrapCrawlJob(await api.stopCrawl(task.id)));
      setCrawlEvents(unwrapEvents(await api.crawlEvents(task.id).catch(() => [])));
      setCrawlGeneration((value) => value + 1);
    } catch (error) {
      setCrawlError(error instanceof Error ? error.message : "停止远程采集失败");
    } finally {
      setCrawlBusy(false);
    }
  };

  const retryCrawlUpload = async () => {
    if (!crawlJob?.id || crawlBusy) return;
    setCrawlBusy(true);
    setCrawlError("");
    try {
      setCrawlJob(unwrapCrawlJob(await api.retryCrawlUpload(crawlJob.id)));
      setCrawlGeneration((value) => value + 1);
    } catch (error) {
      setCrawlError(error instanceof Error ? error.message : "重试上传失败");
    } finally {
      setCrawlBusy(false);
    }
  };

  const clearCrawlHistory = async () => {
    if (crawlBusy) return;
    setCrawlBusy(true);
    setCrawlError("");
    try {
      await api.clearCrawlHistory();
      setCrawlJob(null);
      setCrawlEvents([]);
      setCrawlGeneration((value) => value + 1);
    } catch (error) {
      setCrawlError(error instanceof Error ? error.message : "清除采集历史失败");
    } finally {
      setCrawlBusy(false);
    }
  };

  const contextKicker = String(task?.project || "").trim();

  return (
    <div
      className={`session-shell conversation-workspace${showLeftRail ? " has-tasklist" : ""}${showRightWorkbench ? "" : " no-workbench"}`}
      style={{ ["--tasklist-width" as string]: `${taskListWidth}px` }}
    >
      {showLeftRail ? (
        <AgentTaskList
          sessionId={id}
          currentTask={task}
          running={status === "running"}
          width={taskListWidth}
          onWidthChange={setTaskListWidth}
          mails={kolSession ? (sessionMails || []) : undefined}
          selectedMailId={focusedMail?.id}
          onSelectMail={selectMail}
          onRefreshMails={() => reload(true, true)}
          mailSyncing={Boolean(journey?.mail_sync_pending)}
          mailSyncFailed={Boolean(journey?.mail_sync_failed)}
        />
      ) : null}
      <section className="session-center">
        <header className="task-detail-header conversation-context" {...(task ? { "data-task-detail": true } : { "data-session-back": true })}>
          <div className="session-head-row">
            <Link to="/" className="task-back">← 返回任务列表</Link>
            <ModelTierControl className="session-tier" compact />
            <RunHud status={status} phase={phase} taskTitle={task?.title || runTask?.title} remoteLabel={remoteLabel} />
          </div>
          {boundExpert ? (
            <div className="expert-session-bar" data-expert-identity={boundExpert.expert_id}>
              <div>
                <strong data-expert-name>{boundExpert.name}</strong>
                <p className="muted">{boundExpert.mission}</p>
              </div>
              <div className="expert-session-tasks" data-expert-tasks>
                {boundExpert.recommended_tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="chip"
                    data-expert-task={task.id}
                    onClick={() => pickSuggestion({ label: task.title, prompt: task.prompt })}
                  >
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {confirmStageNotice ? (
            <p className="muted" data-confirm-stage-feedback data-tone="info" role="status">
              {confirmStageNotice}
            </p>
          ) : null}
          {journey?.handle ? (
            <div className={"kol-journey" + (journey.exception ? " is-exception" : "")} data-kol-journey data-exception={journey.exception ? "true" : undefined}>
              <div className="kol-journey-title">
                <h1>@{String(journey.handle)}</h1>
                <span className="session-stage-chip" data-session-stage>
                  {String(journey.stage_label || "")}
                  {journey.sop && typeof journey.sop === "object" && (journey.sop as { phase_label?: string }).phase_label
                    ? <small>{String((journey.sop as { phase_label?: string }).phase_label)}</small>
                    : null}
                </span>
                {journey.exception ? <span className="exception-mark" data-exception-kind={String(journey.exception_kind || "")}>异常旁路</span> : null}
              </div>
              <FollowStyleTagBar
                collaborationId={String(collaborationId || journey.collaboration_id || "")}
                sessionId={id}
                tags={Array.isArray(journey.follow_style_tags) ? journey.follow_style_tags as { id: string; label: string }[] : []}
                presets={Array.isArray(journey.follow_style_presets) ? journey.follow_style_presets as { id: string; label: string }[] : undefined}
                onSaved={() => void reload()}
              />
              {journey.sop && typeof journey.sop === "object" ? (
                <details className="kol-stage-sop" data-stage-sop key={String(journey.stage_code || "")}>
                  <summary>
                    <span className="sop-summary-title">
                      本阶段 SOP
                      {(journey.sop as { phase_label?: string }).phase_label
                        ? ` · ${String((journey.sop as { phase_label?: string }).phase_label)}`
                        : ""}
                    </span>
                    {portrait ? <span className="sop-summary-sub">红人画像</span> : null}
                  </summary>
                  {portrait ? <KolPortraitFields portrait={portrait} /> : null}
                </details>
              ) : null}
            </div>
          ) : null}
          {task && (
            <>
            <div className="task-detail-title">
              <div>
                <span className={`detail-source source-${task.source || "manual"}`} data-task-source={task.source || "manual"}>
                  {task.source === "ai" ? todayTaskOriginLabel(task.source) : "今天的工作"}
                </span>
                {contextKicker && <span className="conversation-kicker">{contextKicker}</span>}
                <h1>{task.title}</h1>
              </div>
              <button className="btn work" type="button" onClick={complete} disabled={completing || task.status === "completed"} data-complete-task>
                {task.status === "completed" ? "已完成" : "标记完成"}
              </button>
            </div>
            <div className="task-detail-meta">
              <span className={`task-ux-badge is-${agentTaskUxStatus(task, status === "running").toLowerCase()}`} data-task-ux-status={agentTaskUxStatus(task, status === "running")}>
                {AGENT_TASK_STATUS_LABEL[agentTaskUxStatus(task, status === "running")]}
              </span>
              {task.priority === "high" && <span>高优先级</span>}
            </div>
            {(task.context || task.description) && <p className="task-context">{task.context || task.description}</p>}
            {completion && <p className={task.status === "completed" ? "completion-feedback" : "error"} role="status">{completion}</p>}
            </>
          )}
        </header>
        <div className="session-stream conversation" ref={streamRef} data-session-stream-pane data-ai-conversation role="log">
        {boundExpert?.intro ? (
          <article className="expert-intro message is-assistant" data-expert-intro data-kind="expert-intro">
            <p>{boundExpert.intro}</p>
          </article>
        ) : null}
        {kolSession && !sessionLoaded ? (
          <section className="session-loading-status" data-session-loading role="status" aria-live="polite" aria-busy="true">
            <span className="session-loading-dot" aria-hidden="true" />
            <div>
              <strong>正在打开红人合作会话</strong>
              <p>正在读取最近往来邮件，结果会持续更新。等待期间不会发送邮件，也不会修改合作阶段。</p>
            </div>
          </section>
        ) : kolSession && (mailDigest || mailAnalysisPending || (sessionMails && sessionMails.length)) ? (
          <ThreadMailDigest digest={mailDigest} pending={mailAnalysisPending} mailCount={sessionMails?.length} onRefresh={() => reload(true, true)} />
        ) : kolSession ? (
          <section className="thread-mail-digest is-empty muted" data-mail-digest data-mail-summaries role="status">
            <strong>暂未读到往来邮件</strong>
            <p>正在等待同步结果；你可以继续在输入框描述下一步工作。</p>
            <button type="button" className="digest-retry" onClick={() => reload(true, true)}>刷新收取</button>
          </section>
        ) : null}
        {task && (
          <section className="task-analysis-summary" data-task-analysis-summary>
            <strong>分析摘要</strong>
            <p>{taskAnalysisSummary(task)}</p>
          </section>
        )}
        {crawlJob && (
          <section className="crawl-middle-status" data-crawl-middle-status={crawlJob.status}>
            <div>
              <strong>{CRAWL_PROGRESS[crawlJob.status] || "正在处理这项工作"}</strong>
              <p>
                正在同步公开创作者数据，完成后会给出建议。
                {crawlJob.remote_task_id ? ` 采集编号 ${crawlJob.remote_task_id}` : ""}
              </p>
              {(crawlJob.upload_error || crawlJob.error || crawlError) && (
                <div className="workspace-error" role="alert">
                  <strong>当前无法读取达人数据</strong>
                  <p>{humanError(String(crawlJob.upload_error || crawlJob.error || crawlError))}</p>
                </div>
              )}
              {debug && (
                <details className="execution-details">
                  <summary>查看执行详情</summary>
                  <p>
                    采集任务编号：{crawlJob.remote_task_id || "正在分配"}
                    {crawlJob.last_checked_at && ` · 最近检查：${new Date(crawlJob.last_checked_at).toLocaleTimeString("zh-CN")}`}
                  </p>
                </details>
              )}
            </div>
            {ACTIVE_CRAWL.has(crawlJob.status) && (
              <button type="button" className="btn ghost" onClick={() => void stopCrawl()} disabled={crawlBusy}>
                停止采集
              </button>
            )}
          </section>
        )}
        {!crawlJob && crawlError && (
          <div className="workspace-error composer-err" role="alert">
            <strong>当前无法读取达人数据</strong>
            <p>{humanError(crawlError)}</p>
            <button type="button" className="btn ghost" onClick={() => setCrawlGeneration((value) => value + 1)}>重试</button>
          </div>
        )}
        {submitErr && (
          <div className="workspace-error" role="alert">
            <strong>还不能开始这项工作</strong>
            <p>{submitErr}</p>
          </div>
        )}
        {err && (
          <div className="workspace-error" role="alert">
            <strong>当前无法继续这次工作</strong>
            <p>{humanError(err)}</p>
            <button type="button" className="btn ghost" onClick={() => reload()}>重试</button>
            {debug && (
              <details className="execution-details">
                <summary>查看详情</summary>
                <p>{/is not valid JSON|Unexpected token|SyntaxError/i.test(err) ? humanError(err) : err}</p>
              </details>
            )}
          </div>
        )}
        {id && (
          <ChatThread
            messages={timelineWithCrawl}
            officialStage={String(journey?.stage_code || "")}
            onRefresh={reload}
          />
        )}
        </div>
        <footer className="session-composer prompt-input" data-sop-ask={journey?.sop ? true : undefined} data-ai-prompt-input>
          {kolSession || messages.some((message) => message.kind === "email_card") ? (
            <p className="session-send-hint" data-session-send-hint>
              发送不等于改阶段
            </p>
          ) : null}
          <ComposerDock
            variant="workspace"
            value={text}
            onChange={setText}
            onSubmit={send}
            disabled={blockSubmit || previewing}
            running={status === "running"}
            queue={runQueue}
            onStop={() => void stopRun()}
            onRemoveQueued={(qid) => void removeQueued(qid)}
            lockedIntent={lockedIntent}
            lockedLabel={lockedLabel}
            lockedKnowledgeId={lockedKnowledgeId}
            onKnowledgeChange={(row: KnowledgeRow | null) => {
              setLockedKnowledgeId(row?.id || null);
              if (row) {
                setLockedIntent(row.skill_id || row.intent || null);
                setLockedLabel(row.title);
              }
            }}
            autoFocus={focusDraft}
            selectFirstPlaceholder={focusDraft}
            suggestions={recommendedActions}
            onPickSuggestion={pickSuggestion}
            onPickSkill={pickSkill}
            hint={composerHint || undefined}
            entryIntent={entryIntent}
          />
        </footer>
      </section>
      {id && showRightWorkbench && (
        <SideWorkbench
          sessionId={id}
          messages={messages}
          status={status}
          onRefresh={reload}
          onPosted={(msgs) => setMessages(msgs)}
          task={task}
          crawlJob={crawlJob}
          crawlEvents={crawlEvents}
          crawlBusy={crawlBusy}
          crawlError={crawlError}
          onStartCrawl={startCrawl}
          onStopCrawl={stopCrawl}
          onPrefill={setText}
          crawlAdmin={account?.available_modes?.includes("admin") === true}
          onRetryCrawlUpload={crawlJob?.id ? retryCrawlUpload : undefined}
          onClearCrawlHistory={crawlJob ? clearCrawlHistory : undefined}
          focusedMail={focusedMail}
          officialStage={String(journey?.stage_code || "")}
          collaborationId={String(collaborationId || journey?.collaboration_id || "")}
          handle={String(journey?.handle || "")}
        />
      )}
    </div>
  );
}
