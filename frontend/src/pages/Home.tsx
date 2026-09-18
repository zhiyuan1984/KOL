import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  type FromTextResult,
  type HomeWorkbench,
  type KnowledgeRow,
  type RecommendedTask,
  type StarryBinding,
  type Task,
  type TaskDefinition,
  type TaskRunResult,
} from "../api";
import ComposerDock, { type ComposerSubmit } from "../components/ComposerDock";
import { storePending } from "../components/ChatBlocks";
import Markdown from "../components/Markdown";
import { starterPrompt } from "../taskStarters";
import { recIcon, withRecommendedDisplay } from "../recommendedTasks";
import {
  clearComposerFill,
  composerFillText,
  lockedTemplateFromRow,
  peekComposerFill,
  type LockedMailTemplate,
} from "../knowledgeCopy";
import { rememberJourney } from "../journey";
import { missingFieldsMessage, fieldLabel } from "../labels";
import DiscoveryPanel from "../home/DiscoveryPanel";
import TodayPane from "../home/TodayPane";
import TodoPane from "../home/TodoPane";
import FollowedPane from "../home/FollowedPane";
import { FollowedBatchConfirm } from "../home/FollowedBatchConfirm";
import {
  applyChipOverride,
  canSubmitDiscovery,
  defaultDiscoveryBrief,
  DISCOVERY_BODY_PREFIX,
  DISCOVERY_INTENT,
  DISCOVERY_LOCK_LABEL,
  fallbackDiscoveryTemplate,
  mergeDiscoveryBrief,
  parseDiscoveryBody,
  sameClassConflict,
  type DiscoveryBrief,
  type DiscoveryTemplate,
} from "../home/discoveryTemplate";
import {
  isMissingEndpoint,
  loadDiscoveryTemplate,
  refreshWorkbenchSessions,
  runHomeDiscovery,
} from "../home/discoveryHome";
import {
  HOME_MODE_LABELS,
  homeModeQuery,
  parseHomeMode,
  todayTaskSourceLabel,
  type HomeMode,
} from "../home/modes";
import { HOME_COMPOSER_COPY, HOME_HANDOFF_TO_AGENT } from "../home/entryRegistry";
import {
  canOpenExistingTaskFlow,
  definitionList,
  deriveWorkbench,
  isHighValueInsight,
  isInsightTask,
  isOpenTask,
  isTodayActionableTodo,
  isTodoTask,
  matchesTodoFilter,
  openBucket,
  sortOpenWorkItems,
  sortTodayTodos,
  sortedTasks,
  taskValue,
  whyLine,
  withHomeCommandTemplates,
  type TodoListFilter,
} from "../home/homeModel";
import { findDuplicateTodo, recommendationIdentity } from "../home/todoDedupe";
import {
  HOME_CONFIRM_STAGE_BLOCKED_COPY,
  HOME_OPENED_EXISTING_SESSION_COPY,
  HOME_OPENED_EXISTING_SESSION_LANDED_COPY,
} from "../confirmStageFeedback";
import {
  matchesKolSearch,
  matchesStageFilter,
  followedStageEnterCards,
  projectFollowedKolCard,
  sortFollowedKolCards,
  type FollowedKolCardModel,
  type FollowedKolRecord,
} from "../followedKolCard";
import {
  HOME_TASK_POLL_MS,
  isActiveRun,
  isAwaitingApproval,
  recognizeElapsedSeconds,
  recognizeTimedOut,
  unwrapTaskList,
  waitDisplayOf,
  waitProgressHint,
  waitStatusLabel,
} from "../waitStatus";

type HomeTab = "today" | "templates";
type TaskFilter = "all" | "open" | "high" | "ai";
type FollowedKol = FollowedKolRecord;

const openStatuses = new Set(["pending", "waiting", "running", "queued", "in_progress", "failed"]);

function sourceLabel(source?: string) {
  return todayTaskSourceLabel(source);
}

function statusLabel(status?: string) {
  return waitStatusLabel(status);
}

function entityLine(entities: Record<string, unknown> | undefined, key: string, label: string): string {
  const raw = entities?.[key];
  const value = Array.isArray(raw) ? raw.map(String).filter(Boolean).join("、") : String(raw || "").trim();
  return value ? `${label} ${value}` : "";
}

function understoodFields(entities?: Record<string, unknown>): string[] {
  return [
    entityLine(entities, "mailboxEmail", "发件"),
    entityLine(entities, "to", "收件"),
    entityLine(entities, "subject", "主题"),
  ].filter(Boolean);
}

function sourceMark(task: Task) {
  if (task.status === "completed" || task.status === "done") return "✓";
  if (task.status === "running" || task.status === "waiting" || task.status === "queued") return "◷";
  if (task.status === "failed" || task.risk) return "!";
  return task.source === "ai" ? "✦" : "○";
}

function dueBucket(task: Task): "today" | "tomorrow" | "later" {
  if (!task.due_at) return "today";
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return "today";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = new Date(due);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - start.getTime()) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return "later";
}

function matchesFilter(task: Task, filter: TaskFilter) {
  if (filter === "open") return openStatuses.has(String(task.status || "pending"));
  if (filter === "high") return task.priority === "high" || task.priority === "urgent";
  if (filter === "ai") return task.source === "ai";
  return true;
}

function CardFields({
  kolName,
  collabSummary,
  recentFollowup,
  currentStage,
  suggestedStage,
  compact,
}: {
  kolName?: string;
  collabSummary?: string;
  recentFollowup?: string;
  currentStage?: string;
  suggestedStage?: string;
  compact?: boolean;
}) {
  const statusFields = (
    <>
      <div className="kol-card-field">
        <dt>最近跟进</dt>
        <dd data-recent-followup data-task-history title={recentFollowup || "暂无任务历史"}>
          {recentFollowup || "暂无任务历史"}
        </dd>
      </div>
      <div className="kol-card-field">
        <dt>所处阶段</dt>
        <dd data-current-stage title={currentStage || "—"}>{currentStage || "—"}</dd>
      </div>
      <div className="kol-card-field">
        <dt>建议进入阶段</dt>
        <dd data-suggested-stage title={suggestedStage || "—"}>{suggestedStage || "—"}</dd>
      </div>
    </>
  );
  return (
    <dl
      className={"kol-card-fields" + (compact ? " is-compact" : "")}
      data-kol-card-cols={compact ? "5" : undefined}
    >
      {kolName ? (
        <div className="kol-card-field">
          <dt>KOL 名称</dt>
          <dd data-kol-name title={kolName}>{kolName}</dd>
        </div>
      ) : null}
      <div className="kol-card-field">
        <dt>合作摘要</dt>
        <dd data-collab-summary title={collabSummary || "暂无合作摘要"}>
          {collabSummary || "暂无合作摘要"}
        </dd>
      </div>
      {compact ? (
        <div className="kol-card-status-line" data-kol-status-line>
          {statusFields}
        </div>
      ) : statusFields}
    </dl>
  );
}

function ChromeIco({ path }: { path: string }) {
  return (
    <svg className="home-chrome-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const HOME_TODAY_TITLE = "今天有什么工作要处理？";

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
  const [tab, setTab] = useState<HomeTab>("today");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [todoFilter, setTodoFilter] = useState<TodoListFilter>("all");
  const [kolQuery, setKolQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selectedKolIds, setSelectedKolIds] = useState<string[]>([]);
  const [hoveredKolId, setHoveredKolId] = useState<string | null>(null);
  const [focusedKolId, setFocusedKolId] = useState<string | null>(null);
  const [pendingBatchCards, setPendingBatchCards] = useState<FollowedKolCardModel[] | null>(null);
  const [dedupeNotice, setDedupeNotice] = useState("");
  const [followedKols, setFollowedKols] = useState<FollowedKol[]>([]);
  const [boardWorkbench, setBoardWorkbench] = useState<HomeWorkbench | null>(null);
  const [followScope, setFollowScope] = useState<StarryBinding | null>(null);
  const [sort, setSort] = useState("priority");
  const initialFill = peekComposerFill();
  const [text, setText] = useState(initialFill ? composerFillText(initialFill) : "");
  const [lockedIntent, setLockedIntent] = useState<string | null>(initialFill?.skill_id || null);
  const [lockedLabel, setLockedLabel] = useState<string | null>(initialFill?.title || null);
  const [lockedKnowledgeId, setLockedKnowledgeId] = useState<string | null>(initialFill?.id || null);
  const [lockedTemplate, setLockedTemplate] = useState<LockedMailTemplate | null>(
    initialFill ? lockedTemplateFromRow(initialFill) : null,
  );
  const applyLockedKnowledge = (
    row: (Pick<KnowledgeRow, "id" | "title"> & {
      skill_id?: string;
      intent?: string;
      subject?: string;
      body_en?: string;
      body?: string;
    }) | null,
  ) => {
    if (!row?.id) {
      setLockedKnowledgeId(null);
      setLockedTemplate(null);
      return;
    }
    setLockedKnowledgeId(row.id);
    setLockedTemplate(lockedTemplateFromRow(row));
    const skill = row.skill_id || row.intent || null;
    const keepWriteMail = lockedLabel === "写合作邮件" || text.includes("写合作邮件");
    if (keepWriteMail && (skill === "email_compose" || !skill)) {
      setLockedIntent("email_compose");
      setLockedLabel("写合作邮件");
      return;
    }
    if (skill) setLockedIntent(skill);
    setLockedLabel(row.title);
  };
  const clearLockedMail = () => {
    setLockedIntent(null);
    setLockedLabel(null);
    applyLockedKnowledge(null);
  };

  const clearDiscoveryLock = () => {
    setDiscoveryBrief(null);
    setDiscoveryOverride(false);
    if (lockedIntent === DISCOVERY_INTENT) {
      setLockedIntent(null);
      setLockedLabel(null);
    }
  };

  const openDiscoveryTemplate = async () => {
    setErr("");
    setFeedback(null);
    try {
      const template = await loadDiscoveryTemplate();
      setDiscoveryCatalog({
        platforms: template.platforms,
        regions: template.regions,
        directions: template.directions,
      });
      setDiscoveryVersion(template.version);
      setDiscoveryBrief(template.defaults);
      setText(template.body);
      setLockedIntent(DISCOVERY_INTENT);
      setLockedLabel(DISCOVERY_LOCK_LABEL);
      applyLockedKnowledge(null);
      setDiscoveryOverride(false);
      setComposerFocused(true);
      setDraftFocus((value) => value + 1);
      if (mode !== "discovery") setMode("discovery");
    } catch {
      const template = fallbackDiscoveryTemplate();
      setDiscoveryCatalog({
        platforms: template.platforms,
        regions: template.regions,
        directions: template.directions,
      });
      setDiscoveryVersion(template.version);
      setDiscoveryBrief(template.defaults);
      setText(template.body);
      setLockedIntent(DISCOVERY_INTENT);
      setLockedLabel(DISCOVERY_LOCK_LABEL);
      applyLockedKnowledge(null);
      setDiscoveryOverride(false);
      setComposerFocused(true);
      setDraftFocus((value) => value + 1);
    }
  };

  const onDiscoveryBriefChange = (next: DiscoveryBrief) => {
    const previous = discoveryBrief;
    setDiscoveryBrief(next);
    if (previous && sameClassConflict(parseDiscoveryBody(text), next)) {
      setDiscoveryOverride(true);
    }
    setText(applyChipOverride(text.startsWith(DISCOVERY_BODY_PREFIX) ? text : `${DISCOVERY_BODY_PREFIX}\n${text}`, next));
    setLockedIntent(DISCOVERY_INTENT);
    setLockedLabel(DISCOVERY_LOCK_LABEL);
  };

  const onComposerText = (next: string) => {
    setText(next);
    if (!discoveryBrief && !next.includes(DISCOVERY_BODY_PREFIX)) return;
    const parsed = parseDiscoveryBody(next);
    const current = discoveryBrief;
    if (!current) return;
    const merged = mergeDiscoveryBrief(current, parsed);
    setDiscoveryBrief(merged);
    if (discoveryOverride && !sameClassConflict(parsed, merged)) {
      setDiscoveryOverride(false);
    }
  };

  const submitDiscovery = async (brief: DiscoveryBrief, body: string, version: string) => {
    if (!canSubmitDiscovery(brief)) {
      setErr("请选择平台并填写关键词后再发送。");
      return;
    }
    setBusy(true);
    setErr("");
    setFeedback(null);
    setLastDiscoverySubmit({ brief, body, version });
    try {
      const result = await runHomeDiscovery({
        brief,
        body,
        expected_brief_version: version,
      });
      setDiscoveryTaskId(result.task_id || null);
      setDiscoveryBatchId(result.batch_id || null);
      refreshWorkbenchSessions();
      setText("");
      clearDiscoveryLock();
      if (mode !== "discovery") setMode("discovery");
    } catch (error) {
      if (isMissingEndpoint(error)) {
        setErr("发现提交接口尚未提供。不会发信、不会改阶段，也没有编造结果。");
      } else {
        setErr(error instanceof Error ? error.message : "发现任务没有提交。");
      }
    } finally {
      setBusy(false);
    }
  };

  const retryDiscoveryRun = async () => {
    if (!lastDiscoverySubmit) {
      await openDiscoveryTemplate();
      return;
    }
    await submitDiscovery(
      lastDiscoverySubmit.brief,
      lastDiscoverySubmit.body,
      lastDiscoverySubmit.version,
    );
  };
  const [params, setParams] = useSearchParams();
  const [draftFocus, setDraftFocus] = useState(initialFill ? 1 : 0);
  const [blockSubmit, setBlockSubmit] = useState(false);
  const [err, setErr] = useState("");
  const [boardError, setBoardError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FromTextResult | null>(null);
  const lastComposer = useRef<ComposerSubmit | null>(null);
  const taskCatalogRef = useRef<Task[]>([]);
  const [taskCatalog, setTaskCatalog] = useState<Task[]>([]);
  const boardRequestedRef = useRef(false);
  const missingAlertRef = useRef<HTMLElement | null>(null);
  const [recognizeStartedAt, setRecognizeStartedAt] = useState<number | null>(null);
  const [recognizeNow, setRecognizeNow] = useState(() => Date.now());
  const [confirmStageBusyId, setConfirmStageBusyId] = useState<string | null>(null);
  const [confirmStageFeedback, setConfirmStageFeedback] = useState<{
    id: string;
    text: string;
    tone: "info" | "error";
  } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(Boolean(initialFill));
  const [stageScrolled, setStageScrolled] = useState(false);
  const [discoveryBrief, setDiscoveryBrief] = useState<DiscoveryBrief | null>(null);
  const [discoveryCatalog, setDiscoveryCatalog] = useState<Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null>(null);
  const [discoveryVersion, setDiscoveryVersion] = useState<string>("discovery-brief.v1");
  const [discoveryOverride, setDiscoveryOverride] = useState(false);
  const [discoveryTaskId, setDiscoveryTaskId] = useState<string | null>(null);
  const [discoveryBatchId, setDiscoveryBatchId] = useState<string | null>(null);
  const [lastDiscoverySubmit, setLastDiscoverySubmit] = useState<{
    brief: DiscoveryBrief;
    body: string;
    version: string;
  } | null>(null);
  const nav = useNavigate();
  const mode = parseHomeMode(params.get("tab"));

  const setMode = (next: HomeMode) => {
    const nextParams = new URLSearchParams(params);
    const query = homeModeQuery(next);
    if (!query) nextParams.delete("tab");
    else nextParams.set("tab", query);
    setParams(nextParams, { replace: true });
  };

  const applyBoard = (board: Awaited<ReturnType<typeof api.homeBoard>>) => {
    if (Array.isArray(board.kols)) setFollowedKols(board.kols as FollowedKol[]);
    setBoardWorkbench(board.workbench || null);
    setFollowScope(board.follow_scope || null);
    setBoardError("");
  };

  const applyTaskCatalog = (catalog: Task[]) => {
    taskCatalogRef.current = catalog;
    setTaskCatalog(catalog);
    setTasks(catalog);
  };

  const prependTask = (created: Task) => {
    const next = (current: Task[]) => (
      current.some((task) => task.id === created.id) ? current : [created, ...current]
    );
    setTasks(next);
    setTaskCatalog((current) => {
      const updated = next(current);
      taskCatalogRef.current = updated;
      return updated;
    });
  };

  const fetchHomeTasks = () => api.tasks().then(unwrapTaskList).then(applyTaskCatalog);

  const loadBoard = (force = false) => {
    if (!force && boardRequestedRef.current) return Promise.resolve();
    boardRequestedRef.current = true;
    return api.homeBoard({ refresh: force }).then(applyBoard).catch((error) => {
      if (!force) boardRequestedRef.current = false;
      setBoardError(error instanceof Error ? error.message : "工作台读取失败");
    });
  };

  useEffect(() => {
    let cancelled = false;
    // Mount: task definitions + GET /api/tasks (full catalog).
    // Today/Todo filter buckets in FE. view=open is the memory list (compat view=todo).
    // Do not GET /api/home or GET /api/home/board here — board waits for
    // first「我跟进的红人」entry or the refresh control.
    void api.taskDefinitions().then(definitionList).then((taskDefinitions) => {
      if (!cancelled && taskDefinitions.length) {
        setDefinitions(withHomeCommandTemplates(taskDefinitions));
      }
    }).catch(() => undefined);
    void api.tasks().then(unwrapTaskList).then((catalog) => {
      if (!cancelled) applyTaskCatalog(catalog);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Initial requests load independently so the input and task shell render immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stashed = peekComposerFill();
    const kid = stashed?.id || params.get("knowledge_id");
    if (!kid) return;
    if (stashed) {
      setText(composerFillText(stashed));
      applyLockedKnowledge(stashed);
      setComposerFocused(true);
      setDraftFocus((value) => (value === 0 ? 1 : value));
    }
    void api.knowledgeItem(kid).then((row) => {
      if (row.status && row.status !== "published") return;
      setText(composerFillText(row));
      applyLockedKnowledge(row);
      setComposerFocused(true);
      setDraftFocus((value) => value + 1);
    }).catch(() => undefined).finally(() => {
      clearComposerFill();
      if (params.get("knowledge_id")) {
        const next = new URLSearchParams(params);
        next.delete("knowledge_id");
        setParams(next, { replace: true });
      }
    });
  }, [params, setParams]);

  const openRun = (result: TaskRunResult) => {
    sessionStorage.setItem(`task:${result.session_id}`, result.task.id);
    const pending = (result.pending_message || result.pending || {}) as Record<string, unknown>;
    storePending(result.session_id, {
      text: String(pending.text || result.task.title),
      intent: String(pending.intent || pending.task_type || result.task.task_type || result.task.skill || lockedIntent || ""),
      knowledge_id: pending.knowledge_id ? String(pending.knowledge_id) : undefined,
      collaboration_id: pending.collaboration_id ? String(pending.collaboration_id) : undefined,
      attachments: Array.isArray(pending.attachments) ? pending.attachments as ComposerSubmit["attachments"] : undefined,
      model_tier: pending.model_tier ? String(pending.model_tier) : undefined,
      work_item_id: String(pending.work_item_id || result.work_item_id || result.task.id),
      task_type: String(pending.task_type || result.task.task_type || result.task.skill || lockedIntent || ""),
      run_id: String(pending.run_id || result.run_id || ""),
      entities: pending.entities && typeof pending.entities === "object" ? pending.entities as Record<string, unknown> : undefined,
    });
    nav(`/s/${result.session_id}`);
  };

  const legacyAsk = async (prompt: string, definition?: TaskDefinition, p?: ComposerSubmit) => {
    const ses = await api.createSession(prompt.slice(0, 24));
    storePending(ses.id, {
      text: prompt,
      knowledge_id: p?.knowledge_id,
      attachments: p?.attachments,
      model_tier: p?.model_tier,
      collaboration_id: p?.collaboration_id,
    });
    nav(`/s/${ses.id}`);
  };

  const createAndRun = async (definition: TaskDefinition | Task, composer?: ComposerSubmit) => {
    let created: Task;
    if ("status" in definition && definition.id) {
      created = definition as Task;
    } else {
      const response = await api.createTask({
        task_type: definition.id,
        title: definition.title,
        description: definition.description,
        prompt: definition.prompt || composer?.text,
        source: "manual",
        intent: composer?.intent || definition.skill_id,
        attachments: composer?.attachments,
        model_tier: composer?.model_tier,
        collaboration_id: composer?.collaboration_id,
        knowledge_id: composer?.knowledge_id,
        entities: composer?.entities,
        text: composer?.text,
      });
      created = taskValue(response);
    }
    if (created.status === "needs_clarification") {
      const resolution = created.resolution as { missing_fields?: string[]; entities?: Record<string, unknown> } | undefined;
      const missing = resolution?.missing_fields || [];
      prependTask(created);
      setFeedback({
        task: created,
        tasks: [created],
        needs_clarification: true,
        clarification_kind: "missing_fields",
        resolution: { missing_fields: missing, entities: resolution?.entities, clarification_kind: "missing_fields" },
        clarification: missing.length
          ? missingFieldsMessage(missing, "可使用输入框补充后再执行。")
          : "请补充任务所需信息后再执行。",
        candidates: missing.map((field) => ({ id: field, title: `补充${fieldLabel(field)}` })),
      });
      setBusy(false);
      return;
    }
    openRun(await api.runTask(created.id));
  };

  const onTemplate = (definition: TaskDefinition) => {
    if (definition.granted === false) {
      setErr(`“${definition.title}”尚未授权，请联系管理员在技能授权中开通。`);
      return;
    }
    setErr("");
    setFeedback(null);
    setText(starterPrompt(definition));
    setLockedIntent(definition.skill_id || definition.id);
    setLockedLabel(definition.title);
    applyLockedKnowledge(null);
    setPanelOpen(false);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setBlockSubmit(true);
    window.setTimeout(() => setBlockSubmit(false), 500);
    rememberJourney({ kind: "skill", skillId: definition.skill_id || definition.id, skillLabel: definition.title });
  };

  const onRecommend = (rec: RecommendedTask) => {
    const intent = rec.intent || "";
    const granted = !intent || definitions.find((definition) => definition.id === intent)?.granted !== false;
    if (!granted) {
      setErr(`“${rec.title}”尚未授权，请联系管理员在技能授权中开通。`);
      return;
    }
    setErr("");
    setFeedback(null);
    setText(String(rec.prompt || rec.title));
    setLockedIntent(intent || null);
    setLockedLabel(rec.title);
    applyLockedKnowledge(null);
    setPanelOpen(false);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setBlockSubmit(true);
    window.setTimeout(() => setBlockSubmit(false), 500);
    rememberJourney({ kind: "skill", skillId: intent || undefined, skillLabel: rec.title, handle: rec.handle });
  };

  const openKol = (kol: FollowedKol, focusThread?: string) => {
    rememberJourney({
      kind: "kol",
      handle: kol.handle,
      stageCode: kol.stage_code,
      skillId: kol.unbound ? "creator_profile" : undefined,
      skillLabel: kol.unbound ? "达人画像" : undefined,
    });
    if (kol.unbound) {
      setText(`达人画像 ${kol.handle}`);
      setLockedIntent("creator_profile");
      setLockedLabel("达人画像");
      setComposerFocused(true);
      setDraftFocus((value) => value + 1);
      return;
    }
    void api.openKolSession(kol.id).then((session) => {
      if (!session?.id) throw new Error("未能打开会话，请稍后重试。");
      sessionStorage.setItem(`kol-session:${session.id}`, "1");
      nav(`/s/${session.id}`, { state: { kolSession: true, focusThread: focusThread || undefined } });
    }).catch((error) => {
      setErr(error instanceof Error && error.message ? error.message : "未能打开会话，请稍后重试。");
    });
  };

  const startCompose = (kol: FollowedKol) => {
    setText(`写合作邮件 @${kol.handle}`);
    setLockedIntent("email_compose");
    setLockedLabel("写合作邮件");
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    rememberJourney({ kind: "kol", handle: kol.handle, stageCode: kol.stage_code, skillId: "email_compose", skillLabel: "写合作邮件" });
  };

  const openConfirmStage = (kol: FollowedKol, card: FollowedKolCardModel) => {
    if (!card.recommended_action.can_write_stage || !card.recommended_action.target_stage_code) {
      setConfirmStageFeedback({
        id: card.id,
        text: HOME_CONFIRM_STAGE_BLOCKED_COPY,
        tone: "error",
      });
      return;
    }
    if (card.task && canOpenExistingTaskFlow(card.task)) {
      setConfirmStageBusyId(card.id);
      setConfirmStageFeedback({
        id: card.id,
        text: HOME_OPENED_EXISTING_SESSION_COPY,
        tone: "info",
      });
      rememberJourney({
        kind: "task",
        skillId: String(card.task.skill_id || card.task.skill || card.task.task_type || ""),
        skillLabel: card.task.title,
        handle: card.task.kol_name || kol.handle,
      });
      const goExisting = (sessionId: string, kolSession: boolean) => {
        sessionStorage.setItem(`task:${sessionId}`, card.task!.id);
        if (kolSession) sessionStorage.setItem(`kol-session:${sessionId}`, "1");
        nav(`/s/${sessionId}`, {
          state: {
            kolSession,
            confirmStageOpenedExisting: true,
            confirmStageNotice: HOME_OPENED_EXISTING_SESSION_LANDED_COPY,
          },
        });
      };
      void (async () => {
        try {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          if (card.task!.session_id) {
            goExisting(card.task!.session_id, Boolean(card.task!.collaboration_id || card.task!.project_id));
            return;
          }
          const collabId = String(card.task!.collaboration_id || card.task!.project_id || "");
          if (collabId) {
            const session = await api.openKolSession(collabId);
            goExisting(session.id, true);
            return;
          }
          await openTask(card.task!);
        } catch (error) {
          setConfirmStageFeedback({
            id: card.id,
            text: error instanceof Error ? error.message : "未能打开已有会话",
            tone: "error",
          });
        } finally {
          setConfirmStageBusyId(null);
        }
      })();
      return;
    }
    rememberJourney({
      kind: "kol",
      handle: kol.handle,
      stageCode: kol.stage_code,
      skillId: "confirm_stage",
      skillLabel: "提出阶段变更",
    });
    setConfirmStageBusyId(card.id);
    setConfirmStageFeedback({
      id: card.id,
      text: "正在打开会话，尚未改正式阶段。",
      tone: "info",
    });
    void api.openKolSession(kol.id).then((session) => {
      if (!session?.id) throw new Error("未能打开会话，请稍后重试。");
      storePending(session.id, {
        text: `提出阶段变更 @${kol.handle} 到 ${card.recommended_action.target_stage_label}`,
        collaboration_id: kol.id,
        intent: "confirm_stage",
        entities: {
          handle: kol.handle,
          stage_code: card.recommended_action.target_stage_code,
        },
      });
      sessionStorage.setItem(`kol-session:${session.id}`, "1");
      nav(`/s/${session.id}`, { state: { kolSession: true } });
    }).catch((error) => {
      setConfirmStageBusyId(null);
      const text = error instanceof Error && error.message ? error.message : "未能打开会话，请稍后重试。";
      setConfirmStageFeedback({
        id: card.id,
        text,
        tone: "error",
      });
      setErr(text);
    });
  };

  const runKolCardAction = (kol: FollowedKol, card: FollowedKolCardModel) => {
    const kind = card.recommended_action.kind;
    if (kind === "profile") {
      openKol(kol);
      return;
    }
    if (kind === "confirm-stage") {
      openConfirmStage(kol, card);
      return;
    }
    if ((kind === "confirm-send" || kind === "approval") && card.task && canOpenExistingTaskFlow(card.task)) {
      void openTask(card.task);
      return;
    }
    if (kind === "compose") {
      if (card.task && canOpenExistingTaskFlow(card.task)) {
        void openTask(card.task);
        return;
      }
      startCompose(kol);
      return;
    }
    openKol(kol, card.focus_thread);
  };

  const toggleSelectedKol = (id: string, on: boolean) => {
    setSelectedKolIds((current) => {
      if (on) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  };

  const toggleSelectAllKols = (on: boolean) => {
    setSelectedKolIds(on ? visibleKols.map((card) => card.id) : []);
  };

  const runSelectedStageEnter = () => {
    const targets = selectedStageEnterCards;
    if (!targets.length) return;
    if (targets.length === 1) {
      openConfirmStage(targets[0].source, targets[0]);
      return;
    }
    setPendingBatchCards(targets);
  };

  const confirmSelectedStageEnter = () => {
    const first = pendingBatchCards?.[0];
    setPendingBatchCards(null);
    if (first) openConfirmStage(first.source, first);
  };

  const mergeCatalogTask = (updated: Task) => {
    const next = (current: Task[]) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row));
    setTasks(next);
    setTaskCatalog((current) => {
      const mapped = next(current);
      taskCatalogRef.current = mapped;
      return mapped;
    });
  };

  const actOnMemoryTask = async (task: Task) => {
    rememberJourney({
      kind: "task",
      skillId: String(task.skill_id || task.skill || task.task_type || ""),
      skillLabel: task.title,
      handle: task.kol_name,
    });
    setBusy(true);
    setErr("");
    try {
      const written = taskValue(await api.acknowledgeTask(task.id));
      const latest = taskValue(await api.task(written.id).catch(() => written));
      mergeCatalogTask(latest);
      void fetchHomeTasks().catch(() => undefined);
      const bucket = openBucket(latest) || openBucket(task);
      if (bucket === "approval") {
        const approvalId = String(latest.approval_id || task.approval_id || "").trim();
        nav(approvalId ? `/approvals/${encodeURIComponent(approvalId)}` : "/approvals");
        return;
      }
      if (latest.session_id) {
        sessionStorage.setItem(`task:${latest.session_id}`, latest.id);
        if (latest.collaboration_id || latest.project_id) {
          sessionStorage.setItem(`kol-session:${latest.session_id}`, "1");
        }
        nav(`/s/${latest.session_id}`, {
          state: { kolSession: Boolean(latest.collaboration_id || latest.project_id) },
        });
        return;
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openTask = async (task: Task) => {
    rememberJourney({
      kind: "task",
      skillId: String(task.skill_id || task.skill || task.task_type || ""),
      skillLabel: task.title,
      handle: task.kol_name,
    });
    if (task.session_id) {
      sessionStorage.setItem(`task:${task.session_id}`, task.id);
      if (task.collaboration_id || task.project_id) sessionStorage.setItem(`kol-session:${task.session_id}`, "1");
      nav(`/s/${task.session_id}`, { state: { kolSession: Boolean(task.collaboration_id || task.project_id) } });
      return;
    }
    const collabId = String(task.collaboration_id || task.project_id || "");
    if (collabId) {
      try {
        const session = await api.openKolSession(collabId);
        sessionStorage.setItem(`kol-session:${session.id}`, "1");
        nav(`/s/${session.id}`, { state: { kolSession: true } });
        return;
      } catch {
        /* fall through to run the task */
      }
    }
    setBusy(true);
    setErr("");
    try {
      await createAndRun(task);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const refreshTasks = () => fetchHomeTasks().catch(() => undefined);

  const refreshBoard = (force = false) => Promise.all([
    loadBoard(force),
    refreshTasks(),
  ]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshTasks();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (mode !== "lifecycle") return;
    void loadBoard();
    // First entry to「我跟进的红人」loads board once; later tab switches stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const recognizing = busy && !feedback && !err;
    if (!recognizing) {
      setRecognizeStartedAt(null);
      return;
    }
    setRecognizeStartedAt((started) => started ?? Date.now());
    const timer = window.setInterval(() => setRecognizeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, feedback, err]);

  const promoteInsight = async (task: Task) => {
    const duplicate = findDuplicateTodo(todoItems, {
      id: task.id,
      title: task.title,
      handle: task.kol_name,
      intent: String(task.skill_id || task.skill || task.task_type || ""),
      collaboration_id: task.collaboration_id,
    });
    if (duplicate) {
      setDedupeNotice("已在待办中，未重复添加");
      setMode("todo");
      return;
    }
    setBusy(true);
    setErr("");
    setDedupeNotice("");
    try {
      await api.adoptRecommendation({
        work_item_id: task.id,
        recommendation_id: task.id,
        title: task.title,
        handle: task.kol_name,
        intent: String(task.skill_id || task.skill || task.task_type || ""),
        collaboration_id: task.collaboration_id,
      });
      await refreshTasks();
      setMode("todo");
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const convertSuggestion = async (item: RecommendedTask) => {
    const identity = recommendationIdentity(item);
    const duplicate = findDuplicateTodo(todoItems, identity);
    if (duplicate) {
      setDedupeNotice("已在待办中，未重复添加");
      setMode("todo");
      return;
    }
    setBusy(true);
    setErr("");
    setDedupeNotice("");
    const mergeAdopted = (created: Task) => {
      if (findDuplicateTodo(taskCatalog.filter(isTodoTask), identity)) return;
      prependTask(created);
      setBoardWorkbench((current) => (
        current
          ? {
            ...current,
            todo: [created, ...(current.todo || []).filter((row) => row.id !== created.id)],
            insights: (current.insights || []).filter((row) => row.id !== created.id),
          }
          : current
      ));
    };
    try {
      const adopted = await api.adoptRecommendation({
        recommendation_id: item.id,
        title: item.title,
        handle: item.handle,
        intent: item.intent,
        collaboration_id: item.collaboration_id,
        reason: item.reason,
        prompt: item.prompt || item.title,
      });
      mergeAdopted({ ...taskValue(adopted), title: item.title, candidate: false });
      await refreshTasks();
      setMode("todo");
    } catch {
      const local: Task = {
        id: `todo-local-${item.id}`,
        title: item.title,
        source: "manual",
        status: "pending",
        skill_id: item.intent,
        skill: item.intent,
        kol_name: item.handle,
        description: item.reason,
        collaboration_id: item.collaboration_id || undefined,
        promoted_at: new Date().toISOString(),
        candidate: false,
        entities: { recommendation_id: item.id, handle: item.handle },
      };
      mergeAdopted(local);
      setMode("todo");
    } finally {
      setBusy(false);
    }
  };

  const dismissInsight = async (task: Task) => {
    setBusy(true);
    setErr("");
    try {
      await api.dismissTask(task.id);
      await refreshTasks();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onComposer = async (p: ComposerSubmit) => {
    const prompt = p.text.trim();
    if (!prompt && !p.attachments?.length) return;
    const intent = lockedIntent || p.intent;
    if (intent === DISCOVERY_INTENT || prompt.startsWith(DISCOVERY_BODY_PREFIX)) {
      const brief = discoveryBrief || mergeDiscoveryBrief(
        defaultDiscoveryBrief(),
        parseDiscoveryBody(prompt),
      );
      await submitDiscovery(brief, prompt, discoveryVersion);
      return;
    }
    const knowledgeId = lockedKnowledgeId || p.knowledge_id;
    lastComposer.current = { ...p, text: prompt, knowledge_id: knowledgeId };
    setBusy(true);
    setErr("");
    setFeedback(null);
    rememberJourney({ kind: "compose", skillId: intent || undefined, skillLabel: lockedLabel || undefined });
    try {
      // Exception care is a deliberate mail action. Keep it on the session
      // path so the worker can build the delay template from the KOL context;
      // it still cannot send or change the official stage automatically.
      // Chinese text has no ASCII word-boundary after the template title;
      // match the explicit template prefix instead of relying on \b.
      if (/^延期关怀(?:\s|$|\[)/.test(prompt)) {
        // Bind the generic exception template to the visible exception row so
        // the Host can load its real mailbox, recipient and stage context.
        const exceptionKol = followedKols.find((kol) => kol.exception && !kol.unbound)
          || followedKols.find((kol) => /异常|争议/.test(`${kol.stage_label} ${kol.notes || ""}`) && !kol.unbound);
        const collaborationId = p.collaboration_id || exceptionKol?.id;
        const ses = await api.createSession(prompt.slice(0, 40), collaborationId);
        storePending(ses.id, {
          text: prompt,
          intent: "email_compose",
          knowledge_id: knowledgeId,
          attachments: p.attachments,
          model_tier: p.model_tier,
          collaboration_id: collaborationId,
          entities: { exception_template: "delay_followup.v1" },
        });
        clearLockedMail();
        nav(`/s/${ses.id}`);
        return;
      }
      // Home is a task intake surface. Recognize first so a missing field or
      // ambiguous request remains on the home page with an actionable card;
      // only a resolved task opens a session and starts the run.
      const recognized = await api.createTaskFromText({
        text: prompt,
        task_type: intent || undefined,
        intent: intent || undefined,
        source: "text",
        attachments: p.attachments,
        model_tier: p.model_tier,
        collaboration_id: p.collaboration_id,
        knowledge_id: knowledgeId,
        entities: p.entities,
      });
      const resolution = recognized.resolution || {};
      const missing = resolution.missing_fields || [];
      const boundHandle = Boolean(
        p.collaboration_id
        || resolution.entities?.handle
        || resolution.entities?.collaboration_id,
      );
      // First-touch / unlabeled compose stays on home. A bound @红人 already
      // has From/To in Host, so open the session instead of blocking on the
      // intake card.
      if (!recognized.task || recognized.clarification_kind === "direction" || (recognized.needs_clarification && !boundHandle)) {
        setFeedback({
          ...recognized,
          needs_clarification: true,
          clarification_kind: recognized.clarification_kind || (missing.length ? "missing_fields" : "direction"),
          clarification: recognized.clarification
            || recognized.message
            || (missing.length ? missingFieldsMessage(missing, "可使用输入框补充后再执行。") : "请补充任务所需信息后再执行。"),
          candidates: recognized.candidates || resolution.alternatives?.map((candidate) => ({
            id: candidate.task_type || candidate.id || "",
            title: candidate.title || candidate.task_type || "候选任务",
          })) || [],
        });
        setBusy(false);
        return;
      }
      const created = recognized.task;
      prependTask(created);
      clearLockedMail();
      openRun(await api.runTask(created.id));
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const visibleTasks = useMemo(
    () => sortedTasks(tasks.filter((task) => matchesFilter(task, filter)), sort),
    [filter, sort, tasks],
  );

  const workbench = useMemo(
    () => boardWorkbench || deriveWorkbench(taskCatalog, mode === "lifecycle" ? followedKols : []),
    [boardWorkbench, followedKols, mode, taskCatalog],
  );

  const todoItems = useMemo(
    () => sortOpenWorkItems(taskCatalog.filter(isOpenTask)),
    [taskCatalog],
  );

  const todayTodos = useMemo(
    () => sortTodayTodos(taskCatalog.filter(isTodayActionableTodo)),
    [taskCatalog],
  );

  const visibleTodoItems = useMemo(
    () => todoItems.filter((task) => matchesTodoFilter(task, todoFilter)),
    [todoFilter, todoItems],
  );

  const insightItems = useMemo(
    () => sortedTasks(taskCatalog.filter(isInsightTask), "priority"),
    [taskCatalog],
  );

  const hasActiveRuns = useMemo(
    () => [...todoItems, ...insightItems, ...tasks].some(isActiveRun),
    [insightItems, tasks, todoItems],
  );

  useEffect(() => {
    if (!hasActiveRuns) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void fetchHomeTasks().catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, HOME_TASK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveRuns]);

  const recommendedItems = useMemo(
    () => withRecommendedDisplay(workbench.recommendations || [], definitions),
    [definitions, workbench.recommendations],
  );

  const kolCards = useMemo(
    () => mode === "lifecycle"
      ? followedKols.map((kol) => projectFollowedKolCard(kol, todoItems))
      : [],
    [followedKols, mode, todoItems],
  );

  const visibleKols = useMemo(() => {
    const filtered = kolCards.filter((card) => (
      matchesKolSearch(card, kolQuery) && matchesStageFilter(card, stageFilter)
    ));
    return sortFollowedKolCards(filtered, "need");
  }, [kolCards, kolQuery, stageFilter]);

  const selectedKolCards = useMemo(
    () => visibleKols.filter((card) => selectedKolIds.includes(card.id)),
    [visibleKols, selectedKolIds],
  );
  const selectedStageEnterCards = useMemo(
    () => followedStageEnterCards(selectedKolCards),
    [selectedKolCards],
  );

  useEffect(() => {
    if (mode !== "lifecycle") return;
    const ids = new Set(visibleKols.map((card) => card.id));
    setSelectedKolIds((current) => {
      const next = current.filter((id) => ids.has(id));
      return next.length === current.length ? current : next;
    });
    if (hoveredKolId && !ids.has(hoveredKolId)) setHoveredKolId(null);
    if (focusedKolId && !ids.has(focusedKolId)) setFocusedKolId(null);
  }, [visibleKols, hoveredKolId, focusedKolId, mode]);

  const followEmptyKind = followScope?.required && !followScope.bound
    ? "unbound"
    : followScope?.status === "expired"
      ? "expired"
      : followedKols.length
        ? "filtered"
        : followScope?.bound
          ? "mailbox"
          : "none";

  const followEmptyTitle = followEmptyKind === "unbound"
    ? "尚未绑定跟进邮箱"
    : followEmptyKind === "expired"
      ? "Starry 连接已过期"
      : followEmptyKind === "filtered"
        ? "没有匹配的跟进对象"
        : followEmptyKind === "mailbox"
          ? "该邮箱下暂无跟进红人"
          : "还没有跟进中的红人";

  const followEmptyBody = followEmptyKind === "unbound"
    ? "绑定 Starry 发件箱后，这里只显示该邮箱负责人跟进的红人。"
    : followEmptyKind === "expired"
      ? "重新连接后即可继续查看你跟进的红人。"
      : followEmptyKind === "filtered"
        ? "换个关键词或阶段，再看跟进中的红人和合作对象。"
        : followEmptyKind === "mailbox"
          ? `当前绑定 ${followScope?.mailbox_email || "已选邮箱"}${followScope?.owner_name ? ` · ${followScope.owner_name}` : ""}。`
          : "跟进中的红人和合作对象会出现在这里。可从 AI发现 加入。";

  const taskCounts = {
    all: tasks.length,
    open: tasks.filter((task) => openStatuses.has(String(task.status || "pending"))).length,
    high: tasks.filter((task) => task.priority === "high" || task.priority === "urgent").length,
    ai: tasks.filter((task) => task.source === "ai").length,
  };

  const openCount = todoItems.length;
  const overdueCount = todoItems.filter((task) => openBucket(task) === "overdue").length;
  const dueTodayCount = todoItems.filter((task) => openBucket(task) === "due_today").length;
  const awaitingApprovalCount = todoItems.filter((task) => isAwaitingApproval(task)).length;
  const todayCount = todayTodos.length;
  const recognizeSeconds = recognizeElapsedSeconds(recognizeStartedAt, recognizeNow);
  const recognizeOverdue = recognizeTimedOut(recognizeStartedAt, recognizeNow);

  const statsText = mode === "todo"
    ? `${openCount}项未了结 · ${overdueCount}已逾期 · ${dueTodayCount}今天到期`
    : `${openCount}项待处理 · ${overdueCount}逾期 · ${dueTodayCount}今天到期`;

  const groups = definitions.reduce<Map<string, TaskDefinition[]>>((catalog, definition) => {
    const category = definition.category || definition.profile || "常用任务";
    catalog.set(category, [...(catalog.get(category) || []), definition]);
    return catalog;
  }, new Map());
  const categoryOrder = ["线索", "商机", "谈判", "履约", "增长", "管理", "异常"];
  const orderedGroups = [...groups.entries()].sort(
    ([a], [b]) => (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a)) -
      (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)),
  );

  const feedbackTasks = feedback?.tasks || [];
  const candidates = feedback?.candidates || [];
  const feedbackKind = feedback?.clarification_kind || feedback?.resolution?.clarification_kind
    || (feedback?.resolution?.missing_fields?.length ? "missing_fields" : candidates.length ? "direction" : "none");
  const understood = understoodFields(feedback?.resolution?.entities);
  const composerReading = stageScrolled && !composerFocused;

  useEffect(() => {
    if (feedbackKind === "missing_fields") missingAlertRef.current?.focus();
  }, [feedbackKind, feedback]);

  const openPanel = (nextTab: HomeTab = "templates") => {
    setTab(nextTab);
    setPanelOpen(true);
  };

  return (
    <div
      className={
        "home-pane"
        + (composerFocused ? " is-composer-focused" : "")
        + (composerReading ? " is-composer-reading" : "")
      }
      data-home
      data-home-active-mode={mode}
      data-followed-chrome={mode === "lifecycle" ? "compact" : undefined}
      data-home-task-poll={hasActiveRuns ? "active" : "idle"}
    >
      <div className="home-stage">
        <div className="home-hero">
          <div className="home-chrome" data-home-chrome>
            <div className="home-chrome-actions" data-home-chrome-actions>
                <button
                  type="button"
                  className="home-chrome-icon"
                  data-home-chrome-action="search"
                  aria-label="搜索任务"
                  title="搜索任务"
                  onClick={() => {
                    const input = document.querySelector<HTMLTextAreaElement>("[data-home] [data-composer-input]");
                    input?.focus();
                    input?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  <ChromeIco path="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z M16 16l5 5" />
                </button>
                <button
                  type="button"
                  className="home-chrome-icon"
                  data-home-chrome-action="refresh"
                  data-home-entry="pull-board"
                  aria-label="刷新工作台"
                  title="刷新工作台"
                  onClick={() => void refreshBoard(true)}
                >
                  <ChromeIco path="M4 12a8 8 0 0 1 13.7-5.6L20 8 M20 12a8 8 0 0 1-13.7 5.6L4 16 M20 4v4h-4 M4 20v-4h4" />
                </button>
                <a
                  className="home-chrome-icon"
                  data-home-chrome-action="external"
                  href="/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="新窗口打开工作台"
                  title="新窗口打开工作台"
                >
                  <ChromeIco path="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4 M14 4h6v6 M10 14L20 4" />
                </a>
                <Link
                  className="home-chrome-icon"
                  data-home-chrome-action="settings"
                  to="/settings"
                  aria-label="个人设置"
                  title="个人设置"
                >
                  <ChromeIco path="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.2.6a8 8 0 0 0-1.7-1L15 4h-4l-.6 2a8 8 0 0 0-1.7 1l-2.2-.6-2 3.4 2 1.2a7.8 7.8 0 0 0 0 2l-2 1.2 2 3.4 2.2-.6a8 8 0 0 0 1.7 1l.6 2h4l.6-2a8 8 0 0 0 1.7-1l2.2.6 2-3.4z" />
                </Link>
            </div>
          </div>
          {mode === "today" ? <h1 data-home-title="today">{HOME_TODAY_TITLE}</h1> : null}
          <p className="home-stats" data-today-summary data-home-stats>
            {statsText}
            {awaitingApprovalCount ? ` · ${awaitingApprovalCount}等审批` : ""}
          </p>

          <div className="home-mode-tabs" role="tablist" aria-label="首页模式" data-home-modes>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "today"}
              data-home-mode="today"
              data-home-entry="switch-tab"
              data-today-count={todayCount}
              onClick={() => setMode("today")}
            >
              {HOME_MODE_LABELS.today} <span className="home-mode-count">{todayCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "todo"}
              data-home-mode="todo"
              data-home-entry="switch-tab"
              onClick={() => setMode("todo")}
            >
              {HOME_MODE_LABELS.todo} <span className="home-mode-count">{openCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "discovery"}
              data-home-mode="discovery"
              data-home-entry="switch-tab"
              onClick={() => setMode("discovery")}
            >
              {HOME_MODE_LABELS.discovery}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "lifecycle"}
              data-home-mode="lifecycle"
              data-home-entry="switch-tab"
              onClick={() => setMode("lifecycle")}
            >
              {HOME_MODE_LABELS.lifecycle}
            </button>
            <button type="button" className="home-templates-link" data-open-work-panel onClick={() => openPanel("templates")}>
              任务模板
            </button>
          </div>
        </div>

        <div
          className="home-board"
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop;
            setStageScrolled((current) => (current ? top > 8 : top > 40));
          }}
        >
          {mode === "today" ? (
            <TodayPane
              todayTodos={todayTodos}
              busy={busy}
              onAct={(task) => void actOnMemoryTask(task)}
            />
          ) : null}

          {mode === "todo" ? (
            <TodoPane
              tasks={visibleTodoItems}
              filter={todoFilter}
              onFilter={setTodoFilter}
              dedupeNotice={dedupeNotice}
              busy={busy}
              onAct={(task) => void actOnMemoryTask(task)}
            />
          ) : null}

          {mode === "discovery" ? (
            <DiscoveryPanel
              templateOpen={Boolean(discoveryBrief) || text.startsWith(DISCOVERY_BODY_PREFIX)}
              activeTaskId={discoveryTaskId}
              activeBatchId={discoveryBatchId}
              briefVersion={discoveryVersion}
              onOpenTemplate={() => void openDiscoveryTemplate()}
              onRetryRun={() => void retryDiscoveryRun()}
            />
          ) : null}

          {mode === "lifecycle" ? (
            <FollowedPane
              visibleKols={visibleKols}
              allCards={kolCards}
              kolQuery={kolQuery}
              stageFilter={stageFilter}
              selectedKolIds={selectedKolIds}
              hoveredKolId={hoveredKolId}
              focusedKolId={focusedKolId}
              confirmStageBusyId={confirmStageBusyId}
              confirmStageFeedback={confirmStageFeedback}
              followScope={followScope}
              followEmptyKind={followEmptyKind}
              queryDown={Boolean(boardError) && !followedKols.length}
              onQuery={setKolQuery}
              onStageFilter={setStageFilter}
              onHover={setHoveredKolId}
              onFocus={setFocusedKolId}
              onToggleSelect={toggleSelectedKol}
              onToggleSelectAll={toggleSelectAllKols}
              onOpenDetail={(card) => openKol(card.source)}
              onPrimary={(card) => runKolCardAction(card.source, card)}
              onOpenMail={(card) => openKol(card.source, card.latest_fact.thread_id || card.focus_thread)}
              onCompose={(card) => runKolCardAction(card.source, card)}
              onConfirmStage={(card) => openConfirmStage(card.source, card)}
              onBatchConfirm={runSelectedStageEnter}
              onBind={() => nav("/settings?tab=starry")}
            />
          ) : null}

          {boardError ? (
            <section className="task-empty" data-home-query-error data-empty-kind="service-down" role="alert">
              <strong>工作台读取失败</strong>
              <p>{boardError}</p>
              <button
                type="button"
                className="btn work sm"
                data-home-handoff-agent
                data-home-entry="composer-analyze"
                onClick={() => {
                  setText(`${HOME_COMPOSER_COPY}：${boardError}`);
                  setComposerFocused(true);
                  setDraftFocus((value) => value + 1);
                }}
              >
                {HOME_HANDOFF_TO_AGENT}
              </button>
            </section>
          ) : null}

          {err && <p className="error composer-err" role="alert" data-home-session-error={err.includes("未能打开会话") ? "true" : undefined}>{err}</p>}
          {busy && !feedback && !err ? (
            <section className="creation-feedback" data-kind="recognizing" data-creation-feedback data-wait-status="识别中" role="status" aria-busy="true">
              <strong>识别中</strong>
              <p>
                正在识别任务方向和已填写的字段，不会改你已经写出的发件、收件和主题。
                {recognizeSeconds ? ` 已等待 ${recognizeSeconds} 秒。` : ""}
              </p>
              {recognizeOverdue ? (
                <p data-recognize-timeout>识别时间较长，可再试一次或补充字段后发送。</p>
              ) : null}
            </section>
          ) : null}
          {feedback && (
            <section
              ref={missingAlertRef}
              className="creation-feedback"
              data-kind={feedbackKind}
              data-creation-feedback
              role={feedbackKind === "missing_fields" ? "alert" : "status"}
              tabIndex={feedbackKind === "missing_fields" ? -1 : undefined}
              aria-live={feedbackKind === "missing_fields" ? "assertive" : "polite"}
            >
              <strong>
                {feedbackKind === "missing_fields"
                  ? (feedback.resolution?.missing_fields?.length
                    ? `还缺${feedback.resolution.missing_fields.map((field) => fieldLabel(field)).join("、")}`
                    : "还缺必要字段")
                  : feedbackKind === "direction"
                    ? "需要确认任务方向"
                    : `已识别 ${feedbackTasks.length || 1} 个任务`}
              </strong>
              <p>{feedback.clarification || feedback.message || (feedbackKind === "direction" ? "请选择最符合你意图的任务，不会自动执行。" : "任务已创建，可分别查看。")}</p>
              {understood.length ? (
                <ul className="creation-feedback-fields">
                  {understood.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : null}
              <div className="feedback-links">
                {feedbackKind !== "missing_fields" && feedbackTasks.map((task) => (
                  <button key={task.id} type="button" className="clarification-chip" onClick={() => void createAndRun(task)}>
                    {task.title}
                  </button>
                ))}
                {candidates.map((candidate, index) => {
                  const label = candidate.title || (typeof candidate.label === "string" ? candidate.label : "") || `候选 ${index + 1}`;
                  const fieldId = String(candidate.id || "");
                  return (
                    <button
                      key={fieldId || label}
                      type="button"
                      className="clarification-chip"
                      onClick={() => {
                        if (feedbackKind === "missing_fields") {
                          const bound = followScope?.mailbox_email || "";
                          if (fieldId === "mailboxEmail" && bound && !text.includes(bound)) {
                            setText(`${text.trim()} 发件: ${bound}`.trim());
                          }
                          setComposerFocused(true);
                          setDraftFocus((value) => value + 1);
                          return;
                        }
                        const skillId = fieldId || label;
                        setLockedIntent(skillId);
                        setLockedLabel(label);
                        const next = lastComposer.current || { text };
                        void onComposer({ ...next, text: next.text || text, intent: skillId });
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
                {feedback.resolution?.source === "none" || feedback.message?.includes("识别服务未就绪") ? (
                  <button
                    type="button"
                    className="clarification-chip"
                    onClick={() => {
                      const next = lastComposer.current || { text };
                      void onComposer(next);
                    }}
                  >
                    再试一次
                  </button>
                ) : null}
              </div>
            </section>
          )}
        </div>
      </div>

      <div
        className="home-composer-dock"
        data-home-entry={discoveryBrief || lockedIntent === DISCOVERY_INTENT ? "new-discovery" : "composer-analyze"}
      >
        <ComposerDock
          variant="workspace"
          value={text}
          onChange={onComposerText}
          onSubmit={onComposer}
          disabled={busy || blockSubmit}
          onFocusChange={setComposerFocused}
          lockedIntent={lockedIntent}
          lockedLabel={lockedLabel}
          lockedKnowledgeId={lockedKnowledgeId}
          lockedTemplate={lockedTemplate}
          stageCode={followedKols.find((kol) => kol.handle && text.includes(`@${kol.handle}`))?.stage_code}
          onKnowledgeChange={applyLockedKnowledge}
          autoFocus={draftFocus > 0}
          autoFocusToken={draftFocus}
          selectFirstPlaceholder={draftFocus > 0}
          discoveryBrief={discoveryBrief}
          discoveryCatalog={discoveryCatalog}
          discoveryOverride={discoveryOverride}
          onDiscoveryBriefChange={onDiscoveryBriefChange}
          onOpenDiscoveryTemplate={() => void openDiscoveryTemplate()}
          onClearDiscoveryLock={clearDiscoveryLock}
        />
      </div>

      {panelOpen && (
        <div className="work-panel-layer" data-work-panel>
          <button type="button" className="work-panel-backdrop" aria-label="关闭全部工作" onClick={() => setPanelOpen(false)} />
          <aside className="work-panel" role="dialog" aria-label="全部工作">
            <header className="work-panel-head">
              <h2>全部工作</h2>
              <button type="button" className="icon-btn" aria-label="关闭全部工作" onClick={() => setPanelOpen(false)}>×</button>
            </header>
            <div className="home-tabs" role="tablist" aria-label="任务视图">
              <button role="tab" aria-selected={tab === "today"} onClick={() => setTab("today")} data-home-tab="today">今日任务</button>
              <button role="tab" aria-selected={tab === "templates"} onClick={() => setTab("templates")} data-home-tab="templates">任务模板</button>
            </div>
            {tab === "today" ? (
              <section className="today-workbench" data-today-tasks>
                <div className="task-controls">
                  <div className="task-filters" aria-label="筛选全部工作">
                    {([["all", "全部"], ["open", "待处理"], ["high", "高优先级"], ["ai", "✦ 今天推荐"]] as const).map(([value, label]) => (
                      <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} data-panel-filter={value}>
                        {label} {taskCounts[value]}
                      </button>
                    ))}
                  </div>
                  <select aria-label="任务排序" value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value="priority">优先级排序</option>
                    <option value="due">截止时间排序</option>
                    <option value="progress">进度排序</option>
                  </select>
                </div>
                <TodayTaskList
                  tasks={visibleTasks}
                  emptyTitle={tasks.length ? "没有符合筛选条件的任务" : "今天还没有任务"}
                  emptyHint="试试描述你想完成的工作。"
                  onOpen={(task) => void openTask(task)}
                />
              </section>
            ) : (
              <div className="task-catalog" aria-label="KOL 任务目录">
                {orderedGroups.map(([category, recs]) => (
                  <section className="task-group" key={category} data-task-category={category}>
                    <h2>{category}</h2>
                    <div className="recs">
                      {recs.map((definition) => (
                        <button
                          key={definition.id}
                          type="button"
                          className="rec"
                          data-task-template
                          data-act="ask"
                          data-prompt={starterPrompt(definition)}
                          data-intent={definition.skill_id || definition.id}
                          data-granted={definition.granted === false ? "false" : "true"}
                          disabled={busy || definition.granted === false}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void onTemplate(definition);
                          }}
                        >
                          <span className="rec-title">{definition.title}</span>
                          <span className="rec-description">{definition.description || definition.profile || definition.prompt || "在会话中分析并生成结果"}</span>
                          {definition.granted === false && <span className="rec-lock">未授权</span>}
                          <span className="rec-arrow" aria-hidden>→</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      <FollowedBatchConfirm
        open={Boolean(pendingBatchCards?.length)}
        cards={pendingBatchCards || []}
        busy={Boolean(pendingBatchCards?.[0] && confirmStageBusyId === pendingBatchCards[0].id)}
        onConfirm={confirmSelectedStageEnter}
        onCancel={() => setPendingBatchCards(null)}
      />
    </div>
  );
}

function TodayTaskList({
  tasks,
  emptyTitle,
  emptyHint,
  onOpen,
}: {
  tasks: Task[];
  emptyTitle: string;
  emptyHint: string;
  onOpen: (task: Task) => void;
}) {
  const hasDueDates = tasks.some((task) => task.due_at);
  const grouped: Record<"today" | "tomorrow" | "later", Task[]> = { today: [], tomorrow: [], later: [] };
  for (const task of tasks) grouped[dueBucket(task)].push(task);
  if (!tasks.length) {
    return (
      <div className="task-empty">
        <strong>{emptyTitle}</strong>
        <p>{emptyHint}</p>
      </div>
    );
  }
  if (hasDueDates) {
    return (
      <>
        {([["today", "今天"], ["tomorrow", "明天"], ["later", "之后"]] as const).map(([bucket, label]) => (
          grouped[bucket].length ? (
            <div className="work-day-group" key={bucket}>
              <h3>{label}</h3>
              <ol className="today-task-list">
                {grouped[bucket].map((task, index) => (
                  <TaskRow key={task.id} task={task} index={index} onOpen={() => onOpen(task)} />
                ))}
              </ol>
            </div>
          ) : null
        ))}
      </>
    );
  }
  return (
    <ol className="today-task-list">
      {tasks.map((task, index) => (
        <TaskRow key={task.id} task={task} index={index} onOpen={() => onOpen(task)} />
      ))}
    </ol>
  );
}

function TaskRow({ task, index, onOpen }: { task: Task; index: number; onOpen: () => void }) {
  const hasKolCard = Boolean(task.kol_name || task.collab_summary || task.current_stage);
  return (
    <li className={`today-task task-${task.source || "manual"} status-${task.status || "pending"}`} data-task-source={task.source || "manual"} data-task-status={task.status || "pending"} data-wait-status={waitStatusLabel(task.status)}>
      <span className="task-source-mark" aria-label={sourceLabel(task.source)}>{sourceMark(task)}</span>
      <span className="task-index">{String(index + 1).padStart(2, "0")}</span>
      <button type="button" className="task-main" onClick={onOpen}>
        <strong>{task.title}</strong>
        {hasKolCard ? (
          <CardFields
            kolName={task.kol_name && task.kol_name !== "未指定红人" ? `@${task.kol_name}` : task.kol_name}
            collabSummary={task.collab_summary}
            recentFollowup={task.recent_followup || task.history_summary}
            currentStage={task.current_stage}
            suggestedStage={task.suggested_stage}
          />
        ) : (
          <>
            <span className="task-meta">{whyLine(task)}</span>
            {task.history_summary && <span className="task-history" data-task-history>{task.history_summary}</span>}
          </>
        )}
        {task.risk && waitDisplayOf(task.status) !== "failed" ? <span className="task-risk">! {task.risk}</span> : null}
      </button>
      <span className="task-tail">
        <span>{statusLabel(task.status)}</span>
        {task.due_at && <time>{new Date(task.due_at).toLocaleDateString("zh-CN")}</time>}
        {task.progress != null && <span>{Math.round(Number(task.progress) <= 1 ? Number(task.progress) * 100 : Number(task.progress))}%</span>}
      </span>
    </li>
  );
}
