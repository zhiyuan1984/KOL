import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTaskCollaborationWorkspace } from "../tasks/useTaskCollaborationWorkspace";
import { TaskCollaborationContext } from "../tasks/TaskCollaborationContext";
import { WorkOrderSuggestions } from "../tasks/WorkOrderSuggestions";
import {
  api,
  agentChoiceFromError,
  type AgentChoiceCandidate,
  type CrawlJob,
  type Message,
  type PendingAsk,
  type PostMessageResult,
  type AgentRunStatus,
  type StartCrawlInput,
  type Task,
  type TaskEvent,
  type KnowledgeRow,
  type SkillTemplate,
  type RuntimeActionView,
} from "../api";
import { ChatThread, clearComposerDraft, clearPending, employeeProcessLabel, takeComposerDraft, takePending, useSessionMessages, type ComposerDraft } from "../components/ChatBlocks";
import { RuntimeActions } from "../components/RuntimeActions";
import { ReplyContextPanel } from "../mail/ReplyContextPanel";
import ComposerDock, { type ComposerSubmit, type ComposerSuggestion, type SkillOption } from "../components/ComposerDock";
import { peekComposerDraft, takeComposerDraftStash } from "../composer/draft";
import { applyAddressesToText } from "../composer/addresses";
import type { ComposerEntryIntent, ComposerObjectRef } from "../composer/types";
import Markdown from "../components/Markdown";
import AgentTaskList, { readTaskListWidth } from "../components/AgentTaskList";
import SideWorkbench, { type ResultEntry } from "../components/SideWorkbench";
import { useStreamArtifacts } from "../components/StreamArtifact";
import CrawlArtifact, { crawlCandidates } from "../components/CrawlArtifact";
import WorkspaceShell, { revealWorkspace } from "../home/WorkspaceShell";
import { sessionRunView } from "../runViewState";
import { useAccount } from "../components/AuthGate";
import { useViewMode } from "../viewMode";
import { REMOTE_BACKEND_LABEL, remoteForSkill } from "../agentConfig";
import { useRunStatus } from "../hooks/useRunStatus";
import { rememberJourney } from "../journey";
import { FollowStyleTagBar } from "../components/FollowStyleTags";
import { friendlyError, missingFieldsMessage } from "../labels";
import { readBoundExpert } from "../experts";
import { todayTaskOriginLabel } from "../home/modes";
import type { SessionMailRow } from "../components/AgentTaskList";
import { useMailComposeFlow } from "../hooks/useMailComposeFlow";
import SkillParamCard from "../home/workspace/SkillParamCard";
import SkillTemplateContext from "../components/SkillTemplateContext";
import { defaultTemplateValues, nonEmptyTemplateEntities, templateInputFields } from "../skillTemplate";
import { bindTemplateSessionTask } from "../skillTemplateTask";
import { discoveryWorkspaceOf } from "../home/discoveryWorkspaceState";
import { renderDiscoveryBody } from "../home/discoveryTemplate";
import DiscoveryRuntimeResults from "../home/DiscoveryRuntimeResults";

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
      observed_at: event.created_at,
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
      observed_at: event.created_at,
    });
  }
  if (!operations.size) return [];
  return [{
    id: `crawl-operations:${taskId}`,
    session_id: taskId,
    role: "assistant",
    kind: "operation_trace",
    payload: { title: "正在调用系统能力", items: [...operations.values()] },
    created_at: [...operations.values()].map((item) => String(item.observed_at || "")).filter(Boolean).sort().pop() || "",
  }];
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

/** 任务异常收尾的里程碑：处理过程里没有对应的一步，必须单独留在时间流里。 */
const ABNORMAL_MILESTONES = new Set(["run.failed", "run.stopped", "run.cancelled", "run.template_changed"]);

/** 任务事件合成一条「任务进度」：每个里程碑一行、带各自的时间；整条按最新一步排进时间流。 */
function safeEventMessages(taskId: string, events: TaskEvent[], milestonesOnly = false): Message[] {
  const phases = events
    .filter((event) => !/(reasoning|thought|tool|internal|think|say|stream)/i.test(String(event.type || "")))
    .filter((event) => !milestonesOnly || ABNORMAL_MILESTONES.has(String(event.type || event.event_type || "")))
    .map((event) => ({
      label: employeeProcessLabel(String(event.title || event.label || event.message || "任务进度已更新")
        .replace(/`[^`]+`/g, "任务步骤")
        .slice(0, 120)),
      status: event.status || "running",
      summary: event.summary
        ? employeeProcessLabel(String(event.summary).replace(/`[^`]+`/g, "内部步骤").slice(0, 180))
        : undefined,
      observed_at: event.created_at,
    }));
  if (!phases.length) return [];
  return [{
    id: `task-events:${taskId}`,
    session_id: taskId,
    role: "assistant",
    kind: "process_trace",
    payload: { title: "任务进度", phases },
    created_at: String(phases[0].observed_at || ""),
  }];
}

const DRAFT_SUBMIT_GUARD_MS = 500;

/** 页面自己产生的条目（报错等）没有服务端时间：记下它出现的那一刻，按这个时间进时间流。 */
function useStamp(value: unknown): string {
  const ref = useRef<{ value: unknown; at: string }>({ value: undefined, at: "" });
  if (value !== ref.current.value) ref.current = { value, at: value ? new Date().toISOString() : "" };
  return ref.current.at;
}

function slotRow(slot: string, createdAt: string): Message {
  return { id: `slot:${slot}`, session_id: "", role: "assistant", kind: "ui_slot", created_at: createdAt, payload: { slot } };
}

export default function Chat() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const leaveUnavailableTask = useCallback(()=>{navigate("/tasks",{replace:true});},[navigate]);
  const taskWorkspace = useTaskCollaborationWorkspace(id,leaveUnavailableTask);
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
  /** 同一技能装在多个智能体上：由员工选择后用同一请求重新提交。 */
  const [agentChoice, setAgentChoice] = useState<{ candidates: AgentChoiceCandidate[]; pending: PendingAsk } | null>(null);
  const [pending, setPending] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [taskReadComplete, setTaskReadComplete] = useState(false);
  const [taskReadError, setTaskReadError] = useState("");
  const [taskReadGeneration, setTaskReadGeneration] = useState(0);
  const taskSessionRef = useRef(id);
  const discoveryWorkspace = discoveryWorkspaceOf(task);
  const discoveryEntry = discoveryWorkspace !== null || (location.state as { discoverySession?: string } | null)?.discoverySession === id;
  const [runtimeActions, setRuntimeActions] = useState<RuntimeActionView[]>([]);
  const discoveryProgress = runtimeActions.find(action => action.operation === "start_crawl" && action.skill_id === "crawler_collect"
    && (!task?.worker_id || action.run_id === task.worker_id))?.progress;
  const discoveryExecutionResult = discoveryProgress?.replace_result ? discoveryProgress.result : undefined;
  const pendingRuntimeActionId = runtimeActions.find((action) => action.state === "pending" && !action.execution)?.id || null;
  const [selectedSkillTemplate, setSelectedSkillTemplate] = useState<SkillTemplate | null>(null);
  const [selectedTemplateSkillId, setSelectedTemplateSkillId] = useState<string | null>(null);
  const [skillParamValues, setSkillParamValues] = useState<Record<string, unknown>>({});
  const [skillParamErrors, setSkillParamErrors] = useState<Record<string, string>>({});
  const [skillParamTouched, setSkillParamTouched] = useState<Set<string>>(() => new Set());
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
  // 中栏只有这一条时间流滚动轴，规则与首页工作台同一套：停在底部时跟随最新，上翻不抢。
  const [templatePickedAt, setTemplatePickedAt] = useState("");
  const stopRequestedRef = useRef(false);
  const paramTemplateKey = useRef<string | null>(null);
  const focusThread = String((location.state as { focusThread?: string } | null)?.focusThread || "");
  const confirmStageNotice = String(
    (location.state as { confirmStageNotice?: string } | null)?.confirmStageNotice || "",
  );
  const mailCompose = useMailComposeFlow({
    onApplyBody: setText,
    onApplyAddresses: (from, to) => {
      setText((current) => applyAddressesToText(current, from, to[0] || ""));
    },
    onPrepared: (response) => {
      if (!response.template) return;
      setLockedIntent("email_compose");
      setLockedLabel("写合作邮件");
      setLockedKnowledgeId(response.template.knowledge_id);
    },
  });

  useEffect(() => {
    if (!id) return;
    if (taskSessionRef.current !== id) { taskSessionRef.current = id; setTask(null); setTaskReadError(""); setTaskReadComplete(false); }
    const taskId = sessionStorage.getItem(`task:${id}`) || id;
    let cancelled = false;
    let loading = false;
    const loadTask = async () => {
      if (loading) return;
      loading = true;
      try {
        const nextTask = unwrapTask(
          sessionStorage.getItem(`task:${id}`)
            ? await api.task(taskId)
            : await api.taskBySession(id),
        );
        if (cancelled) return;
        setTask(nextTask);
        setTaskReadError("");
        sessionStorage.setItem(`task:${id}`, nextTask.id);
        const events = unwrapEvents(await api.taskEvents(nextTask.id).catch(() => []));
        if (!cancelled) setTaskEvents(events);
      } catch {
        // Legacy sessions have no task resource and continue using session messages.
        if (!cancelled && (sessionStorage.getItem(`task:${id}`) || (location.state as { discoverySession?: string } | null)?.discoverySession === id)) {
          setTaskReadError("暂时无法读取已保存的发现条件，请重试读取；这不会重新提交任务。");
        }
      } finally { loading = false; if (!cancelled) setTaskReadComplete(true); }
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
  }, [id, task?.status, taskReadGeneration]);

  useEffect(() => {
    // The persisted task snapshot remains the default after refresh; an
    // explicit skill switch belongs only to the currently open session.
    setRuntimeActions([]);
    setSelectedTemplateSkillId(null);
    setSelectedSkillTemplate(null);
    paramTemplateKey.current = null;
    setSkillParamValues({});
    setSkillParamErrors({});
    setSkillParamTouched(new Set());
  }, [id]);

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
      .catch((error) => {
        clearPending(id);
        const candidates = agentChoiceFromError(error);
        if (candidates && !cancelled) setAgentChoice({ candidates, pending: payload });
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
    const intent = taskWorkspace.task ? "kol_analyze" : p.intent === "email_compose" || mailCompose.active
      ? "email_compose"
      : (p.intent || lockedIntent || (discoveryWorkspace ? "crawler_collect" : undefined) || (skillParamTouched.size ? activeSkillTemplate?.skill_id : undefined));
    const submittedTemplate = activeSkillTemplate?.skill_id === intent ? activeSkillTemplate : null;
    const submittedFields = templateInputFields(submittedTemplate);
    const submittedTemplateKey = submittedTemplate ? `${submittedTemplate.id}:${submittedTemplate.version}` : "";
    const submittedValues = paramTemplateKey.current === submittedTemplateKey
      ? skillParamValues
      : defaultTemplateValues(submittedFields);
    const submittedTouched = paramTemplateKey.current === submittedTemplateKey
      ? skillParamTouched
      : new Set<string>();
    const submittedEntities = {
      ...(discoveryWorkspace ? { discovery_brief: discoveryWorkspace.brief } : {}),
      ...(p.entities || {}),
      ...nonEmptyTemplateEntities(submittedFields, submittedValues, submittedTouched),
    };
    const savedIntent = intent || null;
    const savedLabel = lockedLabel;
    const savedKnowledgeId = p.knowledge_id || lockedKnowledgeId;
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
    setAgentChoice(null);
    let submitted: PendingAsk | null = null;
    try {
      // 会话里打字点出写合作邮件时，会话本身就绑定了合作对象：与点选技能一样
      // 先向 Host 取一次上下文（正式阶段、授权发件箱、收件人、模板、最近往来），
      // 不要把这几个字段留给员工手填。已有准备结果时不重复请求。
      if (intent === "email_compose" && !mailCompose.active) {
        const boundCollabId = collaborationId || (journey?.collaboration_id ? String(journey.collaboration_id) : undefined);
        void mailCompose.prepare({
          body: t,
          session_id: id,
          collaboration_id: boundCollabId,
          handle: journey?.handle ? String(journey.handle) : undefined,
          knowledge_id: p.knowledge_id || lockedKnowledgeId || undefined,
          object_refs: mailObjectRefs,
        });
      }
      if (intent === "email_compose") mailCompose.markSubmitting();
      let pendingAsk: PendingAsk = {
        text: t,
        intent: intent || undefined,
        collaboration_id: p.collaboration_id || (journey?.collaboration_id ? String(journey.collaboration_id) : undefined),
        knowledge_id: savedKnowledgeId || undefined,
        attachments: p.attachments,
        model_tier: p.model_tier,
        scope: p.scope,
        object_refs: p.object_refs,
        client_entry: p.client_entry,
        entities: {
          ...submittedEntities,
          ...(intent === "email_compose" && looksLikeEmailDraft(t) ? { body: t } : {}),
        },
        compose_input: p.compose_input,
        skill_template_version: p.skill_template_version || submittedTemplate?.version,
      };
      submitted = pendingAsk;
      if (!taskWorkspace.task && submittedTemplate && !["email_compose", "creator_discovery"].includes(submittedTemplate.skill_id)
        && (selectedTemplateSkillId || skillParamTouched.size)) {
        const bound = await bindTemplateSessionTask(id, pendingAsk, submittedTemplate);
        sessionStorage.setItem(`task:${id}`, bound.task.id);
        setTask(bound.task);
        setSelectedTemplateSkillId(null);
        setSelectedSkillTemplate(null);
        setSkillParamTouched(new Set());
        pendingAsk = bound.pending;
      }
      submitted = pendingAsk;
      const r = await postOnce(id, pendingAsk);
      if (stopRequestedRef.current) return;
      setMessages(r.messages || []);
      setAgentStatus(String(r.agent_status || (r.accepted ? "running" : "listening")));
      if (intent === "email_compose") mailCompose.clear();
    } catch (error) {
      setText(t);
      setLockedIntent(savedIntent);
      setLockedLabel(savedLabel);
      setLockedKnowledgeId(savedKnowledgeId || null);
      if (intent === "email_compose") {
        mailCompose.markFailed(error instanceof Error ? error.message : "提交失败，已保留邮件草稿。");
      }
      const candidates = agentChoiceFromError(error);
      if (candidates && submitted) {
        setAgentChoice({ candidates, pending: submitted });
      } else {
        setSubmitErr(error instanceof Error ? error.message : "还不能开始这项工作");
      }
    } finally {
      setPending(false);
      reload();
    }
  };

  const chooseAgent = async (agentId: string) => {
    if (!id || !agentChoice) return;
    const pendingAsk = { ...agentChoice.pending, agent_id: agentId };
    setAgentChoice(null);
    setSubmitErr("");
    setText("");
    setPending(true);
    setAgentStatus("running");
    try {
      const r = await postOnce(id, pendingAsk);
      setMessages(r.messages || []);
      setAgentStatus(String(r.agent_status || (r.accepted ? "running" : "listening")));
    } catch (error) {
      setText(pendingAsk.text);
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
  // 远端执行面名称只进右栏状态的调试细节，且始终受 debug 门控（DESIGN §15）。
  const remoteLabel = debug && skillId ? REMOTE_BACKEND_LABEL[remoteForSkill(skillId)] : undefined;
  const hasVisibleTrace = messages.some((message) => message.kind === "process_trace" || message.kind === "operation_trace");
  // 处理过程已经逐步记录时，只补它表达不了的异常里程碑（失败、停止、取消、模板变化）。
  const timeline = task && taskEvents.length
    ? [...messages, ...safeEventMessages(task.id, taskEvents, hasVisibleTrace)]
    : messages;
  // 结果只写在任务上、会话里没有结果卡时（例如任务级运行），按完成时刻把它放进时间流；
  // 发现工作台的结果由专用面板呈现，采集作业的候选由采集条目呈现，都不重复。
  const taskResultRows: Message[] = task && !discoveryWorkspace && !messages.some((message) => message.kind === "task_result_card")
    && (task.task_result || (!crawlJob && task.crawl_result))
    ? [{
        id: `task-result:${task.id}`,
        session_id: id || "",
        role: "assistant",
        kind: "task_result_card",
        created_at: String(task.completed_at || task.last_acted_at || task.created_at || ""),
        payload: (task.task_result || task.crawl_result) as Record<string, unknown>,
      }]
    : [];
  const timelineWithCrawl = [
    ...timeline,
    ...taskResultRows,
    ...(task && (crawlEvents.length || crawlJob)
      ? [...safeCrawlOperationMessages(task.id, crawlEvents), ...safeCrawlEventMessages(task.id, crawlEvents, crawlJob)]
      : []),
  ];
  const lastComposeGap = lastUnsentComposeGap(messages);
  const composerHint = String(lastComposeGap?.placeholder || journey?.composer_placeholder || "");
  const boundExpert = !discoveryEntry && id ? readBoundExpert(id) : null;
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
  const terminalTaskStatuses = ["completed", "failed", "cancelled", "stopped"];
  const terminalMessageKinds = ["task_result_card", "email_card", "confirm_stage_card", "inbound_card", "supplement_card", "kol_mail_card"];
  const taskFinished = status !== "running" && (
    Boolean(task && terminalTaskStatuses.includes(String(task.status || "").toLowerCase()))
    || messages.some((message) => terminalMessageKinds.includes(message.kind))
  );
  const openedAsKol = Boolean((location.state as { kolSession?: boolean } | null)?.kolSession);
  const rememberedKol = Boolean(id && sessionStorage.getItem(`kol-session:${id}`));
  const kolSession = Boolean(collaborationId || journey?.collaboration_id || openedAsKol || rememberedKol);
  // 任务详情统一使用中栏 + 右栏两栏工作区；邮件线程仍可从红人会话的内容区查看，
  // 不再因为 kol-session 标记额外插入一列 AgentTaskList。
  const showLeftRail = false;
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
  const mailObjectRefs: ComposerObjectRef[] = [
    ...(collaborationId || journey?.collaboration_id ? [{
      kind: "collaboration",
      id: String(collaborationId || journey?.collaboration_id),
      label: String(journey?.handle || collaborationId || journey?.collaboration_id),
    }] : []),
    ...(journey?.handle ? [{ kind: "kol", id: String(journey.handle), label: `@${String(journey.handle)}` }] : []),
  ];
  const pickSuggestion = (action: ComposerSuggestion | RecommendedAction) => {
    const prompt = String(action.prompt || action.label || "").trim();
    if (!prompt || pending) return;
    setText(prompt);
    setLockedIntent(action.intent || null);
    setLockedLabel(action.intent ? (action.label || null) : null);
    setFocusDraft(true);
  };
  const pickSkill = (skill: SkillOption, ctx: { mention: string; rest: string; collaborationId?: string }) => {
    setLockedIntent(skill.id);
    setLockedLabel(skill.title || skill.label || skill.id);
    if (skill.id !== "email_compose" || !id) {
      mailCompose.clear();
      return;
    }
    void mailCompose.prepare({
      body: ctx.rest,
      session_id: id,
      collaboration_id: ctx.collaborationId || collaborationId || (journey?.collaboration_id ? String(journey.collaboration_id) : undefined),
      handle: journey?.handle ? String(journey.handle) : undefined,
      knowledge_id: lockedKnowledgeId || undefined,
      object_refs: mailObjectRefs,
    });
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
  // 任务刚启动时还没有 task_result/card，但右栏仍需立即出现并展示处理中状态。
  const showRightWorkbench = Boolean(id);

  // 验收记录由系统按已发生的事实生成，不再要员工手写「凭证」：点击本身就是
  // 一次明确的人工验收提交，这里只补充可回放的引用，不新增完成门槛。
  const acceptanceEvidence = (target: Task) => ({
    source: "employee_confirmation",
    accepted_at: new Date().toISOString(),
    task_title: target.title,
    ticket_version: Math.max(1, Number(target.data_version || 1)),
    ...(target.execution?.run_id ? { run_id: target.execution.run_id } : {}),
  });

  const complete = async () => {
    if (!task || completing) return;
    setCompleting(true);
    setCompletion("");
    try {
      const result = await api.completeTask(task, acceptanceEvidence(task));
      setTask(unwrapTask(result.ticket || await api.task(task.id)));
      setCompletion("任务已完成验收");
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

  const activeSkillTemplate = selectedTemplateSkillId
    ? selectedSkillTemplate
    : task?.skill_template || null;
  const templateParamFields = templateInputFields(activeSkillTemplate);
  // Mail and discovery already have specialized interaction paths; do not add
  // a second generic editor on top of those flows.
  const specializedTemplate = activeSkillTemplate?.skill_id === "email_compose"
    || activeSkillTemplate?.skill_id === "creator_discovery";
  const editableTemplateFields = specializedTemplate ? [] : templateParamFields;
  const templateKey = activeSkillTemplate ? `${activeSkillTemplate.id}:${activeSkillTemplate.version}` : "";

  useEffect(() => {
    if (!templateKey) {
      paramTemplateKey.current = null;
      setSkillParamValues({});
      setSkillParamErrors({});
      setSkillParamTouched(new Set());
      return;
    }
    if (paramTemplateKey.current === templateKey) return;
    paramTemplateKey.current = templateKey;
    setSkillParamValues(defaultTemplateValues(templateParamFields));
    setSkillParamErrors({});
    setSkillParamTouched(new Set());
  }, [templateKey, templateParamFields]);

  const templateRequiredFields = editableTemplateFields.filter((field) => field.required);
  const templateOptionalFields = editableTemplateFields.filter((field) => !field.required);
  const updateTemplateParam = (key: string, value: unknown) => {
    setSkillParamValues((current) => ({ ...current, [key]: value }));
    setSkillParamErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setSkillParamTouched((current) => new Set(current).add(key));
  };
  const templateParamEditor = editableTemplateFields.length ? (
    <div className="skill-template-param-editor" data-skill-template-param-editor>
      {templateRequiredFields.length ? (
        <SkillParamCard
          key={`${templateKey}:required`}
          fields={templateRequiredFields}
          values={skillParamValues}
          errors={skillParamErrors}
          title="必填参数"
          onFieldChange={updateTemplateParam}
        />
      ) : null}
      {templateOptionalFields.length ? (
        <details className="skill-template-optional skill-template-param-optional" data-skill-template-optional>
          <summary>可选条件（{templateOptionalFields.length}）</summary>
          <SkillParamCard
            key={`${templateKey}:optional`}
            fields={templateOptionalFields}
            values={skillParamValues}
            errors={skillParamErrors}
            hideTitle
            onFieldChange={updateTemplateParam}
          />
        </details>
      ) : null}
    </div>
  ) : null;

  const contextKicker = String(task?.project || "").trim();
  const submitErrAt = useStamp(submitErr);
  const loadErrAt = useStamp(err);
  const crawlErrAt = useStamp(!crawlJob && crawlError ? crawlError : "");
  const agentChoiceAt = useStamp(agentChoice);
  const renderArtifact = useStreamArtifacts({
    sessionId: id || "",
    messages: timelineWithCrawl,
    officialStage: String(journey?.stage_code || ""),
    collaborationId: String(collaborationId || journey?.collaboration_id || ""),
    handle: String(journey?.handle || ""),
    onRefresh: reload,
    onPosted: (msgs) => setMessages(msgs),
    onPrefill: setText,
  });
  const crawlCandidateRows = crawlJob ? crawlCandidates(crawlJob, task) : [];
  const crawlAt = String(crawlJob?.last_checked_at || crawlJob?.updated_at || crawlJob?.created_at || "");
  // 页面自己的条目带时间插进同一条时间流：会话开头的上下文（无时间）排最前，
  // 技能参数卡在选用时刻出现，采集状态跟随最近一次核对，报错在出现的那一刻。
  const streamSlots: Message[] = [
    ...(id && kolSession && !discoveryEntry ? [slotRow("reply-context", "")] : []),
    ...(taskWorkspace.task ? [slotRow("task-analysis", "")] : []),
    ...(boundExpert?.intro ? [slotRow("expert-intro", "")] : []),
    ...(kolSession ? [slotRow("mail-digest", "")] : []),
    ...(activeSkillTemplate && !discoveryEntry
      ? [slotRow("skill-template", selectedTemplateSkillId ? templatePickedAt : String(task?.created_at || ""))]
      : []),
    ...(crawlJob ? [slotRow("crawl", crawlAt)] : []),
    ...(!crawlJob && crawlError ? [slotRow("crawl-error", crawlErrAt)] : []),
    ...(submitErr ? [slotRow("submit-error", submitErrAt)] : []),
    ...(agentChoice ? [slotRow("agent-choice", agentChoiceAt)] : []),
    ...(err ? [slotRow("load-error", loadErrAt)] : []),
  ];
  const crawlEntries: ResultEntry[] = crawlCandidateRows.length
    ? [{ id: "slot:crawl", kind: "crawl", title: "候选创作者", detail: `${crawlCandidateRows.length} 位`, time: Date.parse(crawlAt) || 0 }]
    : [];
  const renderSlot = (slot: string) => {
    if (slot === "reply-context" && id) {
      return <ReplyContextPanel sessionId={id} analyzing={pending} onAnalyze={() => pickSuggestion({label: "分析最新邮件对草稿的影响", prompt: "分析回复：请引用当前授权邮件的 ID 和版本，解释对现有草稿的影响。延期仅作为申请，不视为已批准；保留人工稿，不发信、不改正式阶段。", intent: "reply_analysis"})} />;
    }
    if (slot === "task-analysis" && taskWorkspace.task) {
      return <section className="task-analysis-summary" aria-label="当前业务任务">
        <strong>{taskWorkspace.task.task.title}</strong><p>{taskWorkspace.task.task.goal}</p>
        <p>任务状态：{taskWorkspace.task.task.status} · 开放工单 {taskWorkspace.task.counts.open} · 阻塞 {taskWorkspace.task.counts.blocked}</p>
        <button className="btn ghost" type="button" disabled={pending || status === "running"} onClick={()=>pickSuggestion({label:"分析当前任务依赖",intent:"kol_analyze",prompt:"请基于本会话服务端绑定的正式 Task 和当前授权的审批/工单依赖快照，解释阻塞原因、变化影响及下一步。引用真实对象 ID 和版本，区分事实、建议及缺失依据；只分析，不建单、不派单、不审批、不外发、不改阶段。"})}>让 Agent 分析当前依赖</button>
        <TaskCollaborationContext taskId={taskWorkspace.task.task.task_id} titles={Object.fromEntries(taskWorkspace.task.work_orders.map(order=>[order.work_order_id,order.title]))} onUnavailable={leaveUnavailableTask} />
      </section>;
    }
    if (slot === "skill-template" && activeSkillTemplate) {
      return <div className="session-skill-template" data-session-skill-template>
        <SkillTemplateContext
          template={activeSkillTemplate}
          showOptionalInputs={!editableTemplateFields.length}
        />
        {templateParamEditor}
      </div>;
    }
    if (slot === "expert-intro" && boundExpert?.intro) {
      return <article className="expert-intro message is-assistant" data-expert-intro data-kind="expert-intro">
        <p>{boundExpert.intro}</p>
      </article>;
    }
    if (slot === "mail-digest") {
      if (!sessionLoaded) {
        return <section className="session-loading-status" data-session-loading role="status" aria-live="polite" aria-busy="true">
          <span className="session-loading-dot" aria-hidden="true" />
          <div>
            <strong>正在打开红人合作会话</strong>
            <p>正在读取最近往来邮件，结果会持续更新。等待期间不会发送邮件，也不会修改合作阶段。</p>
          </div>
        </section>;
      }
      if (mailDigest || mailAnalysisPending || (sessionMails && sessionMails.length)) {
        return <ThreadMailDigest digest={mailDigest} pending={mailAnalysisPending} mailCount={sessionMails?.length} onRefresh={() => reload(true, true)} />;
      }
      return <section className="thread-mail-digest is-empty muted" data-mail-digest data-mail-summaries role="status">
        <strong>暂未读到往来邮件</strong>
        <p>正在等待同步结果；你可以继续在输入框描述下一步工作。</p>
        <button type="button" className="digest-retry" onClick={() => reload(true, true)}>刷新收取</button>
      </section>;
    }
    if (slot === "crawl" && crawlJob) {
      return <div className="stream-artifact" data-stream-entry="slot:crawl">
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
      </div>;
    }
    if (slot === "crawl-error" && crawlError) {
      return <div className="workspace-error composer-err" role="alert">
        <strong>当前无法读取达人数据</strong>
        <p>{humanError(crawlError)}</p>
        <button type="button" className="btn ghost" onClick={() => setCrawlGeneration((value) => value + 1)}>重试</button>
      </div>;
    }
    if (slot === "submit-error" && submitErr) {
      return <div className="workspace-error" role="alert">
        <strong>还不能开始这项工作</strong>
        <p>{submitErr}</p>
      </div>;
    }
    if (slot === "agent-choice" && agentChoice) {
      return <div className="workspace-error" role="group" aria-label="选择智能体" data-agent-choice>
        <strong>请选择要使用的智能体</strong>
        <p>这个技能装配在多个智能体上，选好后按原内容提交。</p>
        {agentChoice.candidates.map((candidate) => (
          <button key={candidate.id} type="button" className="btn ghost" data-agent-choice-option={candidate.id} onClick={() => void chooseAgent(candidate.id)}>{candidate.name}</button>
        ))}
        <button type="button" className="btn ghost" onClick={() => { setText(agentChoice.pending.text); setAgentChoice(null); }}>取消</button>
      </div>;
    }
    if (slot === "load-error" && err) {
      return <div className="workspace-error" role="alert">
        <strong>当前无法继续这次工作</strong>
        <p>{humanError(err)}</p>
        <button type="button" className="btn ghost" onClick={() => reload()}>重试</button>
        {debug && (
          <details className="execution-details">
            <summary>查看详情</summary>
            <p>{/is not valid JSON|Unexpected token|SyntaxError/i.test(err) ? humanError(err) : err}</p>
          </details>
        )}
      </div>;
    }
    return null;
  };

  const taskView = sessionRunView(task, agentStatus, messages, runtimeActions, crawlJob);
  return (
    <div className="session-workspace">
      <WorkspaceShell pane="session" className={`conversation-workspace${pendingRuntimeActionId ? " is-awaiting-runtime-confirm" : ""}`}
        sessionId={id} scrollReady={sessionLoaded && taskReadComplete}
        railLabel="结果" railToggleLabel="结果" railStorageKey="ui:right-collapsed"
        streamStick={taskView.live} railScrollJump pendingTarget={pendingRuntimeActionId}
        centerHeader={<header className="session-workspace-header">
          <Link to={taskWorkspace.task ? `/tasks?businessTask=${encodeURIComponent(taskWorkspace.task.task.task_id)}` : "/"} className="task-back" data-session-back-link>← 返回任务列表</Link>
          <strong>{task?.title || String(journey?.handle ? `@${journey.handle}` : "当前会话")}</strong>
        </header>}
        centerScroll={<>
        <details className="task-context-details" data-task-context><summary>任务背景与上下文</summary>
        <div className="task-detail-header conversation-context" {...(task ? { "data-task-detail": true } : { "data-session-back": true })}>
          {!discoveryEntry ? (
            <div className="session-head-row">
              <Link
                to={taskWorkspace.task ? `/tasks?businessTask=${encodeURIComponent(taskWorkspace.task.task.task_id)}` : discoveryWorkspace && task ? `/?tab=discovery&resume=${encodeURIComponent(task.id)}` : "/"}
                reloadDocument={Boolean(taskWorkspace.task)}
                className="task-back"
                data-session-back-link
              >← 返回任务列表</Link>
            </div>
          ) : null}
          {discoveryWorkspace ? (
            <div data-discovery-workspace data-agent-identity={discoveryWorkspace.agent_id} data-agent-profile="lead">
              <strong>线索智能体</strong>
              {task?.status === "pending" && status !== "running" ? <button className="btn ghost" onClick={async () => {
                if (!id || pending) return;
                setPending(true); setSubmitErr("");
                try {
                  const restored = await api.pendingDiscoveryWorkspace(task.id);
                  if (restored.pending) {
                    const response = await postOnce(id, restored.pending);
                    setMessages(response.messages || []);
                    setAgentStatus(String(response.agent_status || (response.accepted ? "running" : "listening")));
                  }
                  reload();
                } catch { setSubmitErr("尚未恢复分析，请核对网络和当前权限后重试。原任务条件仍保留。"); }
                finally { setPending(false); }
              }}>继续分析发现需求</button> : null}
              <details data-discovery-condition-snapshot>
                <summary>本次发现条件</summary>
                <p>{renderDiscoveryBody(discoveryWorkspace.brief)}</p>
                <p className="muted">地区、粉丝和均播门槛用于结果核对；期望人数不代表远端采集数量上限。缺失数据会标注为无法核验。</p>
              </details>
            </div>
          ) : discoveryEntry ? <div data-discovery-workspace="loading" role="status">
            <p>{taskReadError || "正在读取已保存的发现条件；你可以使用左栏导航离开。"}</p>
            {taskReadError ? <button type="button" className="btn ghost" onClick={() => setTaskReadGeneration(value => value + 1)}>重新读取条件</button> : null}
          </div> : null}
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
          {task && !discoveryEntry && (
            <>
            <div className="task-detail-title">
              <div>
                <span className={`detail-source source-${task.source || "manual"}`} data-task-source={task.source || "manual"}>
                  {task.source === "ai" ? todayTaskOriginLabel(task.source) : "今天的工作"}
                </span>
                {contextKicker && <span className="conversation-kicker">{contextKicker}</span>}
                <h1>{task.title}</h1>
              </div>
              {/* 与今日任务右栏的动作同款：描边款，实底主 CTA 留给底部提问框（DESIGN 不变量 1）。 */}
              <button className="btn row-action" type="button" onClick={complete} disabled={completing || task.status === "completed"} data-complete-task>
                {task.status === "completed" ? "已完成" : "标记完成"}
              </button>
            </div>
            <div className="task-detail-meta">
              {task.priority === "high" && <span>高优先级</span>}
            </div>
            {!discoveryExecutionResult && (task.context || task.description) && <p className="task-context">{task.context || task.description}</p>}
            {completion && <p className={task.status === "completed" ? "completion-feedback" : "error"} role="status">{completion}</p>}
            </>
          )}
        </div></details>
        {id && (
          <RuntimeActions sessionId={id} onChange={setRuntimeActions}>{(actions, renderAction) => <ChatThread
            messages={timelineWithCrawl}
            discovery={discoveryEntry}
            actions={actions}
            renderAction={renderAction}
            officialStage={String(journey?.stage_code || "")}
            onRefresh={reload}
            slots={streamSlots}
            renderSlot={renderSlot}
            onViewResult={target => id && revealWorkspace(id, "rail", target)}
          />}</RuntimeActions>
        )}
        </>}
        centerFooter={<>
        {pendingRuntimeActionId && id ? <p className="workspace-confirm-hint" role="status">⚠ 请核对操作范围 <button className="btn ghost" onClick={() => revealWorkspace(id,"center",pendingRuntimeActionId)}>查看确认卡</button></p> : null}
        <footer className="session-composer prompt-input" data-sop-ask={journey?.sop ? true : undefined} data-ai-prompt-input>
          {kolSession || messages.some((message) => message.kind === "email_card") ? (
            <p className="session-send-hint" data-session-send-hint>
              发送不等于改阶段
            </p>
          ) : null}
          <ComposerDock
            variant="workspace"
            submitEmphasis={pendingRuntimeActionId ? "secondary" : "primary"}
            value={text}
            onChange={setText}
            onSubmit={send}
            disabled={blockSubmit}
            running={status === "running"}
            queue={runQueue}
            onStop={() => void stopRun()}
            onRemoveQueued={(qid) => void removeQueued(qid)}
            lockedIntent={taskWorkspace.task ? "kol_analyze" : lockedIntent || (discoveryWorkspace ? "crawler_collect" : null)}
            lockedLabel={lockedLabel || (discoveryWorkspace ? "AI发现" : null)}
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
            suggestions={taskFinished ? recommendedActions : []}
            onPickSuggestion={pickSuggestion}
            onPickSkill={pickSkill}
            onSkillTemplateChange={(template, skill) => {
              setSelectedTemplateSkillId(skill?.id || null);
              setTemplatePickedAt(new Date().toISOString());
              setSelectedSkillTemplate(template);
              if (skill) {
                setLockedIntent(skill.id);
                setLockedLabel(skill.title || skill.label || template?.title || skill.id);
              }
            }}
            hint={composerHint || undefined}
            entryIntent={entryIntent}
            objectRefs={mailObjectRefs}
            mailCompose={mailCompose}
            onMailBodyEdit={mailCompose.markEdited}
            onSkillRemoved={(skillId) => {
              if (selectedTemplateSkillId === skillId) {
                setSelectedTemplateSkillId(null);
                setSelectedSkillTemplate(null);
              }
              if (lockedIntent === skillId) {
                setLockedIntent(null);
                setLockedLabel(null);
              }
              if (skillId === "email_compose") mailCompose.clear();
            }}
          />
        </footer></>}
        rail={id ? (
        <SideWorkbench
          embedded runView={taskView} renderArtifact={renderArtifact}
          artifactExtra={crawlCandidateRows.length ? <CrawlArtifact job={crawlJob} events={crawlEvents} candidates={crawlCandidateRows} busy={crawlBusy} error={crawlError} onStart={startCrawl} onStop={stopCrawl} onPrefill={setText} showControls={false} /> : null}
          sessionId={id}
          messages={[...messages, ...taskResultRows]}
          status={status}
          task={task}
          discoveryReturn={discoveryEntry ? (task ? `/?tab=discovery&resume=${encodeURIComponent(task.id)}` : "/?tab=discovery") : undefined}
          statusOverride={discoveryProgress?.label}
          phase={phase}
          remoteLabel={remoteLabel}
          extraEntries={crawlEntries}
          resultExtra={taskWorkspace.task ? <>
            <section aria-label="任务分析依据"><p className="muted">当前依据版本：{taskWorkspace.version}</p>
              {messages.some(message=>{const payload=message.payload as Record<string,unknown>;return payload.task_context_version && (payload.task_context_stale || payload.task_context_version !== taskWorkspace.version);}) ? <p role="status">已有分析的依据已变化，请复核当前事实后重新分析。</p> : null}
            </section>
            <WorkOrderSuggestions key={taskWorkspace.task.task.task_id} taskId={taskWorkspace.task.task.task_id} onChanged={()=>taskWorkspace.refresh()} />
          </> : discoveryWorkspace ? <DiscoveryRuntimeResults actions={runtimeActions} brief={discoveryWorkspace.brief}
            onRefresh={reload}
            analyzing={pending || (status === "running" && !runtimeActions.some((action) => action.state === "pending" && !action.execution))} onAnalyze={taskId => void send({
              text: `请基于本任务已保存的发现条件与采集 ${taskId} 的候选快照，整理可复核简报：候选证据、符合与不符合的条件、无法核验项和下一步。区分采集样本均播与真实最近10条均播；不要重新采集、导入或发信。`,
              intent: "crawler_collect",
            })} /> : undefined}
          focusedMail={focusedMail}
        />
      ) : null}
      />
    </div>
  );
}
