import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { stashComposerDraft } from "../composer/draft";
import type { ComposerEntryIntent, ComposerObjectRef } from "../composer/types";
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
import DiscoveryWorkspace from "../home/DiscoveryWorkspace";
import ObjectWorkspace from "../home/ObjectWorkspace";
import { scopeRows } from "../home/scopeRows";
import ScopeWorkspace from "../home/ScopeWorkspace";
import type { WorkspacePane } from "../home/WorkspaceShell";
import FollowedPane from "../home/FollowedPane";
import { matchesFollowedSituation, type FollowedSituation } from "../home/FollowedBrief";
import PoolPane from "../home/PoolPane";
import ClaimFollowConfirm from "../home/ClaimFollowConfirm";
import ReleaseFollowConfirm from "../home/ReleaseFollowConfirm";
import { FollowedBatchConfirm } from "../home/FollowedBatchConfirm";
import SkillParamCard, { type SkillParamField } from "../home/workspace/SkillParamCard";
import { usePoolWorkspace } from "../home/usePoolWorkspace";
import { useFollowedWorkspace, type FollowedKol } from "../home/useFollowedWorkspace";
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
  renderDiscoveryBody,
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
  HOME_MODES,
  HOME_MODE_LABELS,
  homeModeQuery,
  parseHomeMode,
  todayTaskSourceLabel,
  type HomeMode,
} from "../home/modes";
import { HOME_COMPOSER_COPY } from "../home/entryRegistry";
import { surfaceDownView, type HomeSurface } from "../home/surfaceError";
import {
  clearComposerDraft,
  isAnalyzeEnqueuePrefill,
  peekComposerDraft,
  type ComposerDraftChip,
} from "../mail/composerDraft";
import { mailHref } from "../mail/fallback";
import {
  ANALYZE_QUEUED_COPY,
  analyzePrefillPrompt,
  followKolToRecord,
  isAnalyzePrefill,
  selectAllMax8,
  toggleSelectMax8,
  type KolSurface,
} from "../home/kolContract";

import { enqueueKolAnalyze, loadHomeFollowing, releaseFollowedKol } from "../home/kolSurfaceApi";
import {
  canOpenExistingTaskFlow,
  definitionList,
  deriveWorkbench,
  isHighValueInsight,
  isInsightTask,
  isOpenTask,
  isPlanningTask,
  isTodoTask,
  openBucket,
  sortOpenWorkItems,
  sortedTasks,
  taskValue,
  whyLine,
  withHomeCommandTemplates,
} from "../home/homeModel";
import { isTodayScheduled } from "../home/schedule";
import EditTaskDialog from "../home/EditTaskDialog";
import {
  SCOPE_CONFIG,
  TODAY_PLAN_REFRESH_EVENT,
  TODAY_PLAN_START_EVENT,
  TODO_PLAN_START_EVENT,
  type PlanScope,
} from "../home/todayPlan";
import { usePlanScope } from "../home/usePlanScope";
import { fetchTodayTasks, fetchTodoTasks } from "../home/todayTasksApi";
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

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
  const [tab, setTab] = useState<HomeTab>("today");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [selectedKolIds, setSelectedKolIds] = useState<string[]>([]);
  const [dedupeNotice, setDedupeNotice] = useState("");
  const [analyzeSurface, setAnalyzeSurface] = useState<KolSurface | null>(null);
  const [analyzeUids, setAnalyzeUids] = useState<string[]>([]);
  const [queuedNotice, setQueuedNotice] = useState("");
  const [boardWorkbench, setBoardWorkbench] = useState<HomeWorkbench | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const [followScope, setFollowScope] = useState<StarryBinding | null>(null);
  const [sort, setSort] = useState("priority");
  const initialFill = peekComposerFill();
  const initialHomeMode = parseHomeMode(new URLSearchParams(window.location.search).get("tab"));
  // AI发现 tab：条件卡与提问框正文在首帧就位，不等 GET /api/home/discovery/template。
  const discoveryEntryTab = initialHomeMode === "discovery";
  const todayEntryDefault = !initialFill && !discoveryEntryTab && initialHomeMode === "today";
  const todoEntryDefault = !initialFill && !discoveryEntryTab && initialHomeMode === "todo";
  const [text, setText] = useState(
    initialFill
      ? composerFillText(initialFill)
      : discoveryEntryTab
        ? renderDiscoveryBody(defaultDiscoveryBrief())
        : todayEntryDefault
          ? starterPrompt({ id: "creator_daily_tasks", title: "今日任务" })
          : todoEntryDefault
            ? starterPrompt({ id: "todo_plan", title: "我的待办" })
            : "",
  );
  const [lockedIntent, setLockedIntent] = useState<string | null>(
    initialFill?.skill_id
      || (discoveryEntryTab ? DISCOVERY_INTENT : todayEntryDefault ? "creator_daily_tasks" : todoEntryDefault ? "todo_plan" : null),
  );
  const [lockedLabel, setLockedLabel] = useState<string | null>(
    initialFill?.title
      || (discoveryEntryTab ? DISCOVERY_LOCK_LABEL : todayEntryDefault ? "今日任务" : todoEntryDefault ? "我的待办" : null),
  );
  const [lockedKnowledgeId, setLockedKnowledgeId] = useState<string | null>(initialFill?.id || null);
  const [lockedTemplate, setLockedTemplate] = useState<LockedMailTemplate | null>(
    initialFill ? lockedTemplateFromRow(initialFill) : null,
  );
  const [composerChips, setComposerChips] = useState<ComposerDraftChip[]>([]);
  const [analyzePeople, setAnalyzePeople] = useState<string[]>([]);
  const [enqueueNotice, setEnqueueNotice] = useState("");
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
    if (lockedIntent === DISCOVERY_INTENT) {
      setLockedIntent(null);
      setLockedLabel(null);
    }
    if (entryIntent === "discover") setEntryIntent("free");
    // 「清除发现条件」得真的把条件清掉：条件就是正文本身，留着的话下次发送仍会命中
    // startsWith(DISCOVERY_BODY_PREFIX) 再走一遍发现，按钮名就成了假的。判据与提交
    // 成功后的清空一致，避免连带丢掉无关输入。
    if (text.startsWith(DISCOVERY_BODY_PREFIX)) setText("");
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
      setEntryIntent("discover");
      applyLockedKnowledge(null);
      setComposerFocused(true);
      setDraftFocus((value) => value + 1);
      stashComposerDraft({
        text: template.body,
        intent: "discover",
        chips: [{ kind: "discovery", id: DISCOVERY_INTENT, label: DISCOVERY_LOCK_LABEL }],
        client_entry: "start-crawl",
      });
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
      setEntryIntent("discover");
      applyLockedKnowledge(null);
      setComposerFocused(true);
      setDraftFocus((value) => value + 1);
      stashComposerDraft({
        text: template.body,
        intent: "discover",
        chips: [{ kind: "discovery", id: DISCOVERY_INTENT, label: DISCOVERY_LOCK_LABEL }],
        client_entry: "start-crawl",
      });
    }
  };

  /**
   * AI发现 tab 首屏只拉字典（memory GET，零 session / 零模型）。
   * 条件卡与提问框正文由 seedDiscoveryEntry 本地补种（零 session / 零模型），
   * 这里只负责用 API/fallback 标签精修（不覆盖用户已改的条件真值）。
   */
  const ensureDiscoveryCatalog = async () => {
    if (discoveryCatalogRef.current) return;
    discoveryCatalogRef.current = true;
    try {
      const template = await loadDiscoveryTemplate();
      setDiscoveryCatalog({ platforms: template.platforms, regions: template.regions, directions: template.directions });
      setDiscoveryVersion(template.version);
      setDiscoveryFormBrief((current) => current ?? template.defaults);
    } catch {
      const template = fallbackDiscoveryTemplate();
      setDiscoveryCatalog({ platforms: template.platforms, regions: template.regions, directions: template.directions });
      setDiscoveryFormBrief((current) => current ?? template.defaults);
    }
  };

  /**
   * 进入 AI发现：条件卡与提问框正文都取本地默认 brief，首屏既有条件也可编辑。
   * 只在提问框为空、或已经是【发现任务】正文时才写入 —— 用户别处打的字不动。
   * 不走 openDiscoveryTemplate（那会 stash 草稿，等同显式点选）。
   */
  const seedDiscoveryEntry = () => {
    const brief = discoveryFormBrief || discoveryBrief || defaultDiscoveryBrief();
    setDiscoveryFormBrief((current) => current ?? brief);
    // 模板起始文本不算用户输入：切到 AI发现 时允许被发现正文替换，
    // 只有员工真正打过的字才受保护。
    const isStarterText = (value: string) => (
      value === starterPrompt({ id: "creator_daily_tasks", title: "今日任务" })
      || value === starterPrompt({ id: "todo_plan", title: "我的待办" })
    );
    if (text.trim() && !text.startsWith(DISCOVERY_BODY_PREFIX) && !isStarterText(text)) return;
    setDiscoveryBrief((current) => current ?? brief);
    setText((current) => (current.trim() && !current.startsWith(DISCOVERY_BODY_PREFIX) && !isStarterText(current)
      ? current
      : renderDiscoveryBody(brief)));
    setLockedIntent(DISCOVERY_INTENT);
    setLockedLabel(DISCOVERY_LOCK_LABEL);
    setEntryIntent("discover");
  };

  const onDiscoveryBriefChange = (next: DiscoveryBrief) => {
    setDiscoveryBrief(next);
    // 条件卡与提问框的条件编辑共用同一真值：芯片改了条件，正文（可编辑）同步改写。
    setDiscoveryFormBrief(next);
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
    // 正文是条件卡的另一半：改正文，卡片跟着走。
    setDiscoveryFormBrief(merged);
  };

  const submitDiscovery = async (brief: DiscoveryBrief, body: string, version: string) => {
    setDiscoverySubmitFailed(false);
    if (!canSubmitDiscovery(brief)) {
      setErr("请选择平台并填写关键词后再发送。");
      return;
    }
    setBusy(true);
    setIntakeRunning(true);
    intakeCancelled.current = false;
    setErr("");
    setFeedback(null);
    setLastDiscoverySubmit({ brief, body, version });
    // 发送即清空：重试从 lastDiscoverySubmit 重发，草稿不必留在输入框里。
    // Composer 的草稿可能与本流程无关（用户先写了别的再切到 AI发现卡片提交），
    // 只有确实是发现模板正文时才清空，避免连带丢掉无关输入。
    if (text.startsWith(DISCOVERY_BODY_PREFIX)) setText("");
    try {
      const result = await runHomeDiscovery({
        brief,
        body,
      });
      // ▪ 只中止客户端后续动作：不调用后端取消，也不改任何服务端状态。
      if (intakeCancelled.current) return;
      setDiscoveryTaskId(result.work_item_id || null);
      setDiscoveryRunId(result.run_id || null);
      refreshWorkbenchSessions();
      clearDiscoveryLock();
      if (mode !== "discovery") setMode("discovery");
    } catch (error) {
      setDiscoverySubmitFailed(true);
      if (isMissingEndpoint(error)) {
        setErr("发现提交接口尚未提供。不会发信、不会改阶段，也没有编造结果。");
      } else {
        setErr(error instanceof Error ? error.message : "发现任务没有提交。");
      }
    } finally {
      setBusy(false);
      setIntakeRunning(false);
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
  const [retryingSurface, setRetryingSurface] = useState<HomeSurface | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FromTextResult | null>(null);
  const [skillParamValues, setSkillParamValues] = useState<Record<string, unknown>>({});
  const [skillParamErrors, setSkillParamErrors] = useState<Record<string, string>>({});
  const paramSkillId = useRef<string | null>(null);
  const lastComposer = useRef<ComposerSubmit | null>(null);
  const taskCatalogRef = useRef<Task[]>([]);
  const [taskCatalog, setTaskCatalog] = useState<Task[]>([]);
  const boardRequestedRef = useRef(false);
  const missingAlertRef = useRef<HTMLElement | null>(null);
  const [recognizeStartedAt, setRecognizeStartedAt] = useState<number | null>(null);
  const [recognizeNow, setRecognizeNow] = useState(() => Date.now());
  const [panelOpen, setPanelOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(Boolean(initialFill));
  const [stageScrolled, setStageScrolled] = useState(false);
  const [discoveryBrief, setDiscoveryBrief] = useState<DiscoveryBrief | null>(
    () => (discoveryEntryTab ? defaultDiscoveryBrief() : null),
  );
  /** 条件卡表单真值；进入 AI发现 时与 Composer 的发现锁同源（同一份 brief）。 */
  const [discoveryFormBrief, setDiscoveryFormBrief] = useState<DiscoveryBrief | null>(
    () => (discoveryEntryTab ? defaultDiscoveryBrief() : null),
  );
  const fallbackDiscoveryFormBrief = useMemo(() => defaultDiscoveryBrief(), []);
  const [discoveryCatalog, setDiscoveryCatalog] = useState<Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null>(null);
  const [discoveryVersion, setDiscoveryVersion] = useState<string>("discovery-brief.v1");
  const [discoveryTaskId, setDiscoveryTaskId] = useState<string | null>(null);
  const [discoveryRunId, setDiscoveryRunId] = useState<string | null>(null);
  const [entryIntent, setEntryIntent] = useState<ComposerEntryIntent>(
    initialFill?.skill_id === DISCOVERY_INTENT || discoveryEntryTab ? "discover" : "free",
  );
  const [objectRefs, setObjectRefs] = useState<ComposerObjectRef[]>([]);
  const [lastDiscoverySubmit, setLastDiscoverySubmit] = useState<{
    brief: DiscoveryBrief;
    body: string;
    version: string;
  } | null>(null);
  /** 发现提交失败后可重试：正文已在发送时清空，不能只留一条错误文案。 */
  const [discoverySubmitFailed, setDiscoverySubmitFailed] = useState(false);
  const [editTaskTarget, setEditTaskTarget] = useState<Task | null>(null);
  const todayPlan = usePlanScope("today", {
    listOpenTasks: () => api.tasks({ view: "open" }).then(unwrapTaskList),
    getBrief: () => api.todayBrief(),
    startPlan: () => api.planToday(),
    getDisplayTasks: () => fetchTodayTasks(),
  });
  const todoPlan = usePlanScope("todo", {
    listOpenTasks: () => api.tasks({ view: "open" }).then(unwrapTaskList),
    getBrief: () => api.todoBrief(),
    startPlan: () => api.planTodo(),
    getDisplayTasks: () => fetchTodoTasks(),
  });
  const nav = useNavigate();
  const mode = parseHomeMode(params.get("tab"));

  const setMode = (next: HomeMode) => {
    const nextParams = new URLSearchParams(params);
    const query = homeModeQuery(next);
    if (!query) nextParams.delete("tab");
    else nextParams.set("tab", query);
    setParams(nextParams, { replace: true });
    setSelectedKolIds([]);
    followedUiRef.current.setHoveredId(null);
    followedUiRef.current.setFocusedId(null);
    setAnalyzeSurface(null);
    setAnalyzeUids([]);
  };

  const onFillComposer = (text: string, intent?: string, label?: string) => {
    setText(text);
    if (intent) setLockedIntent(intent);    if (label) setLockedLabel(label);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
  };

  const boardKolsRef = useRef<Array<Record<string, unknown>>>([]);
  const discoveryCatalogRef = useRef(false);
  const poolSetErrorRef = useRef<(message: string) => void>(() => {});
  const followedSetErrorRef = useRef<(message: string) => void>(() => {});
  const openTaskRef = useRef<(task: Task) => Promise<void>>(async () => {});
  const onReleasedRef = useRef<(kolId: string) => Promise<void>>(async () => {});
  const todoItemsRef = useRef<Task[]>([]);
  const followedWorkspaceRef = useRef<{ loadSurface: () => Promise<void>; ensureLoaded: () => Promise<void>; rows: FollowedKol[] }>({ loadSurface: async () => {}, ensureLoaded: async () => {}, rows: [] });
  const followedUiRef = useRef<{ setHoveredId: (id: string | null) => void; setFocusedId: (id: string | null) => void }>({
    setHoveredId: () => {},
    setFocusedId: () => {},
  });

  const setSurfaceError = (surface: HomeSurface, message: string) => {
    if (surface === "following") followedSetErrorRef.current(message);
    else poolSetErrorRef.current(message);
  };

  const applyBoard = (board: Awaited<ReturnType<typeof api.homeBoard>>, surface: HomeSurface) => {
    if (Array.isArray(board.kols)) boardKolsRef.current = board.kols;
    setBoardWorkbench(board.workbench || null);
    setLibraryCount(Number(board.library?.count || 0));
    setFollowScope(board.follow_scope || null);
    setSurfaceError(surface, "");
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

  const loadBoard = (surface: HomeSurface, force = false) => {
    if (!force && boardRequestedRef.current) return Promise.resolve();
    boardRequestedRef.current = true;
    return api.homeBoard({ refresh: force }).then((board) => applyBoard(board, surface)).catch((error) => {
      if (!force) boardRequestedRef.current = false;
      setSurfaceError(surface, error instanceof Error ? error.message : "工作台读取失败");
    });
  };

  const poolWorkspace = usePoolWorkspace({
    loadBoard,
    boardKols: () => boardKolsRef.current,
    onClaimed: async (kolUid) => {
      setSelectedKolIds((current) => current.filter((id) => id !== kolUid));
      await followedWorkspaceRef.current.loadSurface();
    },
  });
  poolSetErrorRef.current = poolWorkspace.setError;

  /** 重试只重发这一面的读取，不切 Tab、不写会话。 */
  const retrySurface = async (surface: HomeSurface) => {
    setRetryingSurface(surface);
    try {
      await loadBoard(surface, true);
      await (surface === "following" ? followedWorkspaceRef.current.loadSurface() : poolWorkspace.loadSurface());
    } finally {
      setRetryingSurface(null);
    }
  };

  /** 交给 Agent：把这一面的失败事实写进 Composer，由用户决定是否发问。 */
  const handoffSurface = (label: string, raw: string) => {
    const reason = raw ? `原始错误：${raw}。` : "";
    setText(`${HOME_COMPOSER_COPY}：${label}读取失败。${reason}请确认工作台服务是否可用。`);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
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
    if (!lockedIntent) {
      paramSkillId.current = null;
      setSkillParamValues({});
      setSkillParamErrors({});
      return;
    }
    const definition = definitions.find((item) => item.id === lockedIntent);
    if (!definition || paramSkillId.current === lockedIntent) return;
    paramSkillId.current = lockedIntent;
    const fields = Array.isArray(definition.input_schema) ? definition.input_schema as SkillParamField[] : [];
    setSkillParamValues(Object.fromEntries(fields.flatMap((field) => field.default !== undefined && field.default !== null
      ? [[field.key, field.default]] : [])));
    setSkillParamErrors({});
  }, [definitions, lockedIntent]);

  // Home 的「生成中」只覆盖识别 + 发起这几秒；真正的长时间生成在 /s/:id，
  // 停止键由会话页的 Composer 负责。这里能停的是「还没开跑就打住」。
  const [intakeRunning, setIntakeRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const intakeCancelled = useRef(false);

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

  useEffect(() => {
    const draft = peekComposerDraft();
    if (!draft) return;
    setText(draft.text);
    setComposerChips(draft.chips);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    if (draft.kind === "mail-reply") {
      setLockedIntent("email_compose");
      setLockedLabel("回复");
      setAnalyzePeople([]);
    } else {
      setLockedIntent("kol-analyze-enqueue");
      setLockedLabel("分析");
      setAnalyzePeople(draft.kol_uids);
    }
    clearComposerDraft();
  }, []);

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

  const toggleSelectedKol = (id: string, on: boolean) => {
    setSelectedKolIds((current) => toggleSelectMax8(current, id, on));
  };

  const toggleSelectAllKols = (on: boolean) => {
    setSelectedKolIds(selectAllMax8(followedWorkspace.visibleCards.map((card) => card.id), on));
  };

  const toggleSelectedPool = (id: string, on: boolean) => {
    setSelectedKolIds((current) => toggleSelectMax8(current, id, on));
  };

  const toggleSelectAllPool = (on: boolean) => {
    setSelectedKolIds(selectAllMax8(poolWorkspace.visibleCards.map((card) => card.kol_uid), on));
  };

  const prefillAnalyze = (surface: KolSurface, cards: Array<{ identity: { display: string } }>, uids: string[]) => {
    setAnalyzeSurface(surface);
    setAnalyzeUids(uids);
    setText(analyzePrefillPrompt(cards, surface));
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setQueuedNotice("");
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

  const handleTaskEdited = (updated: Task) => {
    setEditTaskTarget(null);
    mergeCatalogTask(updated);
    void fetchHomeTasks().catch(() => undefined);
    window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT));
  };

  const actOnMemoryTask = async (task: Task) => {
    if (String(task.display_verb || "") === "edit") {
      setEditTaskTarget(task);
      return;
    }
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
  openTaskRef.current = openTask;

  const refreshTasks = () => fetchHomeTasks().catch(() => undefined);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshTasks();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    setSelectedKolIds([]);
    followedUiRef.current.setHoveredId(null);
    followedUiRef.current.setFocusedId(null);
    setAnalyzeSurface(null);
    setAnalyzeUids([]);
    setQueuedNotice("");
    // 失败态属于它发生的那一面：切 Tab 就收起来，不让它跟着用户跑到别的模式。
    followedWorkspace.setError("");
    poolWorkspace.setError("");
    setText((current) => (isAnalyzePrefill(current) ? "" : current));
  }, [mode]);

  useEffect(() => {
    if (mode !== "lifecycle") return;
    void followedWorkspaceRef.current.ensureLoaded();
    // First entry to「我跟进的红人」loads following (B.active); tab switch does not create sessions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "pool") return;
    void poolWorkspace.ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "discovery") return;
    // Tab entry: condition card + ask-box body come from the local brief on the
    // first paint (memory only), then the dictionary GET refines labels.
    // Never openDiscoveryTemplate() here — that stashes a draft and behaves like
    // an explicit click.
    seedDiscoveryEntry();
    void ensureDiscoveryCatalog();
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
    } catch (error) {
      setErr(error instanceof Error ? error.message : "未能采纳建议，正式待办未创建");
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
    const skillFromScope = p.scope?.skills?.[0];
    const intent = lockedIntent || skillFromScope || p.intent;
    const selectedDefinition = intent ? definitions.find((definition) => definition.id === intent) : undefined;
    const submittedSchemaFields = Array.isArray(selectedDefinition?.input_schema)
      ? selectedDefinition.input_schema as SkillParamField[] : [];
    if (!prompt && !p.attachments?.length && !skillFromScope && !submittedSchemaFields.length) return;
    const intakeText = prompt || selectedDefinition?.title || "";
    const submittedSkillValues = genericParamDefinition?.id === intent
      ? skillParamValues
      : Object.fromEntries(submittedSchemaFields.flatMap((field) => field.default === undefined ? [] : [[field.key, field.default]]));
    if (selectedDefinition?.input_schema && Array.isArray(selectedDefinition.input_schema)) {
      setLockedIntent(selectedDefinition.id);
      setLockedLabel(selectedDefinition.title);
    }
    // Submission transfers the draft into task intake. Clear the editor at the
    // click boundary so the running task gets the vertical space, regardless
    // of which intake route handles it next.
    setText("");
    if (intent === "creator_daily_tasks") {
      window.dispatchEvent(new Event(TODAY_PLAN_START_EVENT));
      return;
    }
    if (intent === "todo_plan") {
      window.dispatchEvent(new Event(TODO_PLAN_START_EVENT));
      return;
    }
    if (isAnalyzeEnqueuePrefill(prompt, intent)) {
      const people = analyzePeople.length ? analyzePeople : [];
      if (!people.length) {
        setErr("请指定要分析的红人");
        return;
      }
      setBusy(true);
      setIntakeRunning(true);
      intakeCancelled.current = false;
      setErr("");
      setFeedback(null);
      setEnqueueNotice("");
      try {
        const queued = await api.enqueueKolAnalyze({
          kol_uids: people,
          title: "分析已选",
          prompt,
        });
        // ▪ 只中止客户端后续动作：不调用后端取消，也不改任何服务端状态。
        if (intakeCancelled.current) return;
        if (queued.creates_session) throw new Error("分析入队不应创建会话");
        setComposerChips([]);
        setAnalyzePeople([]);
        setLockedIntent(null);
        setLockedLabel(null);
        setText("");
        setEnqueueNotice("已入队，等待分析。没有走 from-text，也没有创建会话。");
        rememberJourney({ kind: "compose", skillId: "kol-analyze-enqueue", skillLabel: "分析" });
      } catch (error) {
        setErr(error instanceof Error && error.message ? error.message : "无法入队分析");
      } finally {
        setBusy(false);
        setIntakeRunning(false);
      }
      return;
    }
    if (intent === DISCOVERY_INTENT || prompt.startsWith(DISCOVERY_BODY_PREFIX)) {
      const brief = discoveryBrief || mergeDiscoveryBrief(
        defaultDiscoveryBrief(),
        parseDiscoveryBody(prompt),
      );
      await submitDiscovery(brief, prompt, discoveryVersion);
      return;
    }
    const knowledgeId = lockedKnowledgeId || p.knowledge_id;
    lastComposer.current = { ...p, text: intakeText, knowledge_id: knowledgeId };
    setBusy(true);
    setIntakeRunning(true);
    intakeCancelled.current = false;
    setErr("");
    setFeedback(null);
    setQueuedNotice("");
    rememberJourney({ kind: "compose", skillId: intent || undefined, skillLabel: lockedLabel || undefined });
    try {
      const analyzeUidsNow = analyzeUids.length ? analyzeUids : selectedKolIds;
      if ((analyzeSurface || isAnalyzePrefill(prompt)) && analyzeUidsNow.length) {
        const queued = await enqueueKolAnalyze({
          kol_uids: analyzeUidsNow.slice(0, 8),
          prompt,
          surface: analyzeSurface || (mode === "pool" ? "pool" : "following"),
        });
        setQueuedNotice(queued.queued_copy || ANALYZE_QUEUED_COPY);
        setAnalyzeSurface(null);
        setBusy(false);
        setIntakeRunning(false);
        return;
      }
      // Exception care is a deliberate mail action. Keep it on the session
      // path so the worker can build the delay template from the KOL context;
      // it still cannot send or change the official stage automatically.
      // Chinese text has no ASCII word-boundary after the template title;
      // match the explicit template prefix instead of relying on \b.
      if (/^延期关怀(?:\s|$|\[)/.test(prompt)) {
        // Bind the generic exception template to the visible exception row so
        // the Host can load its real mailbox, recipient and stage context.
        const exceptionKol = followedWorkspace.rows.find((kol) => kol.exception && !kol.unbound)
          || followedWorkspace.rows.find((kol) => /异常|争议/.test(`${kol.stage_label} ${kol.notes || ""}`) && !kol.unbound);
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
        text: intakeText,
        task_type: intent || undefined,
        intent: intent || undefined,
        source: "text",
        attachments: p.attachments,
        model_tier: p.model_tier,
        input: Object.fromEntries(submittedSchemaFields.flatMap((field) => {
          const value = submittedSkillValues[field.key];
          return value === undefined || value === null || value === "" ? [] : [[field.key, value]];
        })),
        collaboration_id: p.collaboration_id,
        knowledge_id: knowledgeId,
        entities: p.entities,
        scope: p.scope,
        object_refs: p.object_refs,
        client_entry: p.client_entry,
      });
      if (intakeCancelled.current) {
        setBusy(false);
        setIntakeRunning(false);
        return;
      }
      const resolution = recognized.resolution || {};
      const missing = resolution.missing_fields || [];
      if (selectedDefinition?.input_schema && Array.isArray(selectedDefinition.input_schema)) {
        const resolvedEntities = resolution.entities || {};
        setSkillParamValues((current) => {
          const next = { ...current };
          for (const field of selectedDefinition.input_schema as SkillParamField[]) {
            if (next[field.key] !== undefined && next[field.key] !== null && next[field.key] !== "") continue;
            const prefillKey = field.prefill?.startsWith("entities.") ? field.prefill.slice("entities.".length) : field.key;
            const value = resolvedEntities[prefillKey];
            if (value !== undefined && value !== null && value !== "") next[field.key] = value;
          }
          return next;
        });
      }
      setSkillParamErrors({
        ...(resolution.invalid_fields || {}),
        ...Object.fromEntries(missing.map((key) => [key, "必填项"])),
      });
      const boundHandle = Boolean(
        p.collaboration_id
        || resolution.entities?.handle
        || resolution.entities?.collaboration_id,
      );
      // First-touch / unlabeled compose stays on home. A bound @红人 already
      // has From/To in Host, so open the session instead of blocking on the
      // intake card.
      if (!recognized.task || recognized.clarification_kind === "direction"
        || Object.keys(resolution.invalid_fields || {}).length > 0
        || (recognized.needs_clarification && !boundHandle)) {
        const clarificationDefinition = resolution.task_type
          ? definitions.find((definition) => definition.id === resolution.task_type
            && Array.isArray(definition.input_schema)
            && definition.granted !== false
            && definition.employee_visible !== false)
          : undefined;
        if (clarificationDefinition) {
          setLockedIntent(clarificationDefinition.id);
          setLockedLabel(clarificationDefinition.title);
        }
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
        setIntakeRunning(false);
        return;
      }
      const created = recognized.task;
      prependTask(created);
      clearLockedMail();
      const run = await api.runTask(created.id);
      setIntakeRunning(false);
      if (intakeCancelled.current) return;
      openRun(run);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setBusy(false);
      setIntakeRunning(false);
    }
  };

  const stopIntake = () => {
    intakeCancelled.current = true;
    setStopping(true);
    window.setTimeout(() => setStopping(false), 1000);
  };

  const visibleTasks = useMemo(
    () => sortedTasks(tasks.filter((task) => matchesFilter(task, filter)), sort),
    [filter, sort, tasks],
  );


  const homeMemoryTasks = (mode === "today" ? todayPlan.memoryTasks : mode === "todo" ? todoPlan.memoryTasks : null) ?? taskCatalog;

  // The tab badges describe their own pane, so they read the matching memory
  // scope instead of `homeMemoryTasks`, which follows the active tab. Reading
  // the pane-scoped list keeps 今日任务 / 我的待办 numbers stable when the user
  // switches to AI发现 and `homeMemoryTasks` falls back to the raw catalog.
  const todayBadgeTasks = todayPlan.memoryTasks ?? taskCatalog;
  const todoBadgeTasks = todoPlan.memoryTasks ?? taskCatalog;

  const todoItems = useMemo(
    () => sortOpenWorkItems(homeMemoryTasks.filter(isOpenTask)),
    [homeMemoryTasks],
  );
  todoItemsRef.current = todoItems;

  // 今日任务 / 我的待办 render one workspace over one row projection; only the
  const followedWorkspace = useFollowedWorkspace({
    loadBoard,
    boardKols: () => boardKolsRef.current,
    followScope,
    setFollowScope,
    selectedIds: selectedKolIds,
    todoItems: todoItemsRef.current,
    openTask: (task) => openTaskRef.current(task),
    onFillComposer,
    navigate: nav,
    onError: setErr,
    onReleased: (kolId) => onReleasedRef.current(kolId),
  });
  followedSetErrorRef.current = followedWorkspace.setError;
  followedUiRef.current = {
    setHoveredId: followedWorkspace.setHoveredId,
    setFocusedId: followedWorkspace.setFocusedId,
  };
  onReleasedRef.current = async (kolId) => {
    setSelectedKolIds((current) => current.filter((id) => id !== kolId));
    await poolWorkspace.loadSurface();
  };

  followedWorkspaceRef.current = followedWorkspace;

  const workbench = useMemo(
    () => boardWorkbench || deriveWorkbench(taskCatalog, mode === "lifecycle" ? followedWorkspace.rows : []),
    [boardWorkbench, followedWorkspace.rows, mode, taskCatalog],
  );

  // slice each pane answers for differs, and that lives in scopeRows.
  const paneScope: PlanScope | null = mode === "today" || mode === "todo" ? mode : null;
  // Home 五模式统一走 WorkspaceShell；共享几何与恢复语义，不共享业务对象模型。
  const workspacePane: WorkspacePane = mode;
  const activePlan = mode === "todo" ? todoPlan : todayPlan;
  const paneRows = useMemo(
    () => (paneScope ? scopeRows(paneScope, homeMemoryTasks, activePlan.brief?.todo_layout) : []),
    [paneScope, homeMemoryTasks, activePlan.brief],
  );

  const tabTodayCount = useMemo(
    () => todayBadgeTasks.filter((task) => !isPlanningTask(task) && isTodayScheduled(task)).length,
    [todayBadgeTasks],
  );

  const tabOpenTodoItems = useMemo(
    () => todoBadgeTasks.filter(isOpenTask),
    [todoBadgeTasks],
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


  useEffect(() => {
    if (mode !== "lifecycle") return;
    const ids = new Set(followedWorkspace.visibleCards.map((card) => card.id));
    setSelectedKolIds((current) => {
      const next = current.filter((id) => ids.has(id));
      return next.length === current.length ? current : next;
    });
    if (followedWorkspace.hoveredId && !ids.has(followedWorkspace.hoveredId)) followedWorkspace.setHoveredId(null);
    if (followedWorkspace.focusedId && !ids.has(followedWorkspace.focusedId)) followedWorkspace.setFocusedId(null);
  }, [followedWorkspace.visibleCards, followedWorkspace.hoveredId, followedWorkspace.focusedId, mode]);

  const followEmptyKind = followedWorkspace.followEmptyKind;

  const followingDown = followedWorkspace.error && !followedWorkspace.rows.length
    ? surfaceDownView(followedWorkspace.error, "跟进列表读取失败", {
      retrying: retryingSurface === "following",
      onRetry: () => void retrySurface("following"),
      onHandoff: () => handoffSurface("跟进列表", followedWorkspace.error),
    })
    : null;

  const poolDown = poolWorkspace.error && !poolWorkspace.cards.length
    ? surfaceDownView(poolWorkspace.error, "公海读取失败", {
      retrying: retryingSurface === "pool",
      onRetry: () => void retrySurface("pool"),
      onHandoff: () => handoffSurface("公海", poolWorkspace.error),
    })
    : null;

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

  const openCount = tabOpenTodoItems.length;
  const overdueCount = tabOpenTodoItems.filter((task) => openBucket(task) === "overdue").length;
  const dueTodayCount = tabOpenTodoItems.filter((task) => openBucket(task) === "due_today").length;
  const awaitingApprovalCount = tabOpenTodoItems.filter((task) => isAwaitingApproval(task)).length;
  const todayOverdueCount = paneRows.filter((task) => openBucket(task) === "overdue").length;
  const todayDueCount = paneRows.filter((task) => openBucket(task) === "due_today").length;
  const todayApprovalCount = paneRows.filter((task) => isAwaitingApproval(task)).length;
  const todayCount = tabTodayCount;
  const recognizeSeconds = recognizeElapsedSeconds(recognizeStartedAt, recognizeNow);
  const recognizeOverdue = recognizeTimedOut(recognizeStartedAt, recognizeNow);

  const statsText = mode === "todo"
    ? `${overdueCount} 已逾期 · ${dueTodayCount} 今天到期`
    : `${todayOverdueCount} 逾期 · ${todayDueCount} 今天到期`;
  const scopeApprovalCount = mode === "today" ? todayApprovalCount : awaitingApprovalCount;

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

  const activateTodaySkill = () => {
    setMode("today");
    setLockedIntent("creator_daily_tasks");
    setLockedLabel("今日任务");
    setText(starterPrompt({ id: "creator_daily_tasks", title: "今日任务" }));
    setComposerFocused(false);
  };

  const activateTodoSkill = () => {
    setMode("todo");
    setLockedIntent("todo_plan");
    setLockedLabel("我的待办");
    setText(starterPrompt({ id: "todo_plan", title: "我的待办" }));
    setComposerFocused(false);
  };

  const genericParamDefinition = lockedIntent
    ? definitions.find((definition) => definition.id === lockedIntent
      && definition.granted !== false
      && definition.employee_visible !== false
      && ![DISCOVERY_INTENT, "today_plan", "todo_plan", "creator_daily_tasks"].includes(definition.id))
    : undefined;
  const genericParamFields = Array.isArray(genericParamDefinition?.input_schema)
    ? genericParamDefinition.input_schema as SkillParamField[] : [];
  const genericParamErrors = {
    ...skillParamErrors,
    ...(feedback?.resolution?.invalid_fields || {}),
    ...Object.fromEntries((feedback?.resolution?.missing_fields || []).map((key) => [key, "必填项"])),
  };
  const genericParamCard = genericParamDefinition && genericParamFields.length ? (
    <SkillParamCard
      key={genericParamDefinition.id}
      fields={genericParamFields}
      values={skillParamValues}
      errors={genericParamErrors}
      title={genericParamDefinition.title}
      mode={feedback?.needs_clarification ? "needs_input" : "edit"}
      onFieldChange={(key, value) => {
        setSkillParamValues((current) => ({ ...current, [key]: value }));
        setSkillParamErrors((current) => { const next = { ...current }; delete next[key]; return next; });
        setFeedback(null);
      }}
    />
  ) : null;

  const quickTaskBar = (
    <div className="home-quick-tasks" role="tablist" aria-label="Home 工作模式" data-home-quick-tasks data-home-modes>
      {HOME_MODES.map((homeMode) => (
        <button
          key={homeMode}
          type="button"
          role="tab"
          aria-selected={mode === homeMode}
          data-home-mode={homeMode}
          data-home-entry="switch-tab"
          onClick={() => {
            if (homeMode === "today") activateTodaySkill();
            else if (homeMode === "todo") activateTodoSkill();
            else setMode(homeMode);
          }}
        >
          <span className="home-mode-label">
            {homeMode === "lifecycle" ? "我的红人" : HOME_MODE_LABELS[homeMode]}
          </span>
          {homeMode === "today" && todayCount > 0 ? <span className="home-mode-count" aria-hidden>{todayCount}</span> : null}
          {homeMode === "todo" && openCount > 0 ? <span className="home-mode-count" aria-hidden>{openCount}</span> : null}
        </button>
      ))}
    </div>
  );

  const interactionFeedback = (
    <div className="workspace-interaction-feedback" data-workspace-interaction-feedback>
      {genericParamCard}
      {enqueueNotice ? <p className="muted" role="status" data-analyze-enqueue>{enqueueNotice}</p> : null}
      {err && <p className="error composer-err" role="alert" data-home-session-error={err.includes("未能打开会话") ? "true" : undefined}>{err}</p>}
      {discoverySubmitFailed && !busy ? (
        <div className="composer-err" data-home-discovery-submit-error>
          <button
            type="button"
            className="btn ghost sm"
            data-home-entry="retry-discovery-run"
            onClick={() => void retryDiscoveryRun()}
          >
            重试
          </button>
        </div>
      ) : null}
      {queuedNotice ? (
        <section className="creation-feedback" data-kind="queued" data-analyze-queued role="status">
          <strong>已入队</strong>
          <p>{queuedNotice}</p>
        </section>
      ) : null}
      {busy && !feedback && !err && !queuedNotice ? (
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
      {feedback ? (
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
              const fieldId = String(candidate.id || "");
              const label = fieldId === DISCOVERY_INTENT
                ? "在 AI发现 中继续"
                : candidate.title || (typeof candidate.label === "string" ? candidate.label : "") || `候选 ${index + 1}`;
              return (
                <button
                  key={fieldId || label}
                  type="button"
                  className="clarification-chip"
                  onClick={() => {
                    if (fieldId === DISCOVERY_INTENT) {
                      void (async () => {
                        const template = await loadDiscoveryTemplate().catch(() => fallbackDiscoveryTemplate());
                        const entities = feedback.resolution?.entities || {};
                        const numericEntity = (key: string) => {
                          const value = entities[key];
                          if (value === undefined || value === null || value === "") return undefined;
                          const number = Number(value);
                          return Number.isFinite(number) ? number : undefined;
                        };
                        const platforms = Array.isArray(entities.platforms)
                          ? entities.platforms.map(String)
                          : entities.platform ? [String(entities.platform)] : [];
                        const brief = mergeDiscoveryBrief(template.defaults, {
                          platforms: platforms as DiscoveryBrief["platforms"],
                          region: entities.region ? String(entities.region) as DiscoveryBrief["region"] : undefined,
                          directions: Array.isArray(entities.directions)
                            ? entities.directions.map(String) as DiscoveryBrief["directions"]
                            : undefined,
                          keywords: Array.isArray(entities.keywords)
                            ? entities.keywords.map(String)
                            : entities.keywords ? [String(entities.keywords)] : undefined,
                          min_followers: numericEntity("min_followers"),
                          max_followers: numericEntity("max_followers"),
                          min_avg_plays_10: numericEntity("min_avg_plays_10"),
                          expect_count: numericEntity("expect_count"),
                        });
                        setDiscoveryCatalog({ platforms: template.platforms, regions: template.regions, directions: template.directions });
                        setDiscoveryVersion(template.version);
                        setDiscoveryBrief(brief);
                        setDiscoveryFormBrief(brief);
                        setText(renderDiscoveryBody(brief, template));
                        setLockedIntent(DISCOVERY_INTENT);
                        setLockedLabel(DISCOVERY_LOCK_LABEL);
                        setEntryIntent("discover");
                        setFeedback(null);
                        setMode("discovery");
                        setComposerFocused(true);
                        setDraftFocus((value) => value + 1);
                      })();
                      return;
                    }
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
      ) : null}
    </div>
  );

  const renderComposerDock = () => (
    <div
      className="home-composer-dock home-composer-dock--dock"
      data-home-entry={
        analyzeSurface || isAnalyzePrefill(text)
          ? "kol-analyze-enqueue"
          : (discoveryBrief || lockedIntent === DISCOVERY_INTENT ? "new-discovery" : "composer-analyze")
      }
      data-composer-rhythm="dock"
    >
      {quickTaskBar}
      {stopping ? <p className="composer-override-hint" role="status" data-home-stopping>正在停止…</p> : null}
      <ComposerDock
        variant="workspace"
        placement="dock"
        value={text}
        onChange={onComposerText}
        onSubmit={onComposer}
        disabled={busy || blockSubmit}
        running={intakeRunning}
        onStop={stopIntake}
        onFocusChange={setComposerFocused}
        lockedIntent={lockedIntent}
        lockedLabel={lockedLabel}
        lockedKnowledgeId={lockedKnowledgeId}
        lockedTemplate={lockedTemplate}
        stageCode={followedWorkspace.rows.find((kol) => kol.handle && text.includes(`@${kol.handle}`))?.stage_code}
        onKnowledgeChange={applyLockedKnowledge}
        autoFocus={draftFocus > 0}
        autoFocusToken={draftFocus}
        selectFirstPlaceholder={draftFocus > 0}
        discoveryBrief={discoveryBrief}
        discoveryCatalog={discoveryCatalog}
        showDiscoveryEditor={false}
        onDiscoveryBriefChange={onDiscoveryBriefChange}
        onOpenDiscoveryTemplate={() => void openDiscoveryTemplate()}
        onClearDiscoveryLock={clearDiscoveryLock}
        contextChips={composerChips}
        entryIntent={entryIntent}
        objectRefs={objectRefs}
        onObjectRefsChange={setObjectRefs}
      />
    </div>
  );

  return (
    <div
      className={
        "home-pane"
        + (composerFocused ? " is-composer-focused" : "")
        + (composerReading ? " is-composer-reading" : "")
        + " is-composer-dock"
      }
      data-home
      data-home-active-mode={mode}
      data-home-workspace={workspacePane ?? undefined}
      data-followed-chrome={mode === "lifecycle" || mode === "pool" ? "compact" : undefined}
      data-home-task-poll={hasActiveRuns ? "active" : "idle"}
    >
      <div
        className="home-stage"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setStageScrolled((current) => (current ? top > 8 : top > 40));
        }}
      >
        <div className="home-board">
          {paneScope ? (
            <ScopeWorkspace
              scope={paneScope}
              rows={paneRows}
              busy={busy}
              onAct={(task) => void actOnMemoryTask(task)}
              onEdit={setEditTaskTarget}
              notice={paneScope === "todo" ? dedupeNotice : ""}
              brief={activePlan.brief}
              phase={activePlan.phase}
              events={activePlan.events}
              previousBrief={activePlan.prevBrief}
              previousEvents={activePlan.prevEvents}
              memoryPending={activePlan.memoryTasks === null}
              recommendations={(workbench.recommendations || []).filter((item) => item.candidate !== false).slice(0, 3).map((item) => ({
                id: item.id,
                title: item.title,
                reason: item.reason,
                intent: item.intent,
                handle: item.handle,
                status: "candidate" as const,
              }))}
              onAdoptRecommendation={(recommendation) => {
                const selected = workbench.recommendations?.find((item) => item.id === recommendation.id);
                if (selected) void convertSuggestion(selected);
              }}
              centerHeader={(
                <div className="home-hero today-center-hero">
                  <h1 data-home-title={paneScope}>{SCOPE_CONFIG[paneScope].heroTitle}</h1>
                  <p className="home-stats" data-today-summary data-home-stats>
                    {statsText}
                    {scopeApprovalCount ? ` · ${scopeApprovalCount} 等审批` : ""}
                  </p>
                </div>
              )}
              centerSupplement={interactionFeedback}
              centerFooter={renderComposerDock()}
            />
          ) : null}

          {mode === "discovery" ? (
            <DiscoveryWorkspace
              brief={discoveryFormBrief ?? fallbackDiscoveryFormBrief}
              catalog={discoveryCatalog}
              schema={(() => {
                const declared = definitions.find((definition) => definition.id === "creator_discovery")?.input_schema;
                return Array.isArray(declared) ? declared as import("../home/workspace/SkillParamCard").SkillParamField[] : undefined;
              })()}
              onBriefChange={onDiscoveryBriefChange}
              activeTaskId={discoveryTaskId}
              activeRunId={discoveryRunId}
              lastSubmit={lastDiscoverySubmit}
              onRetrySubmit={() => void retryDiscoveryRun()}
              centerSupplement={interactionFeedback}
              centerFooter={renderComposerDock()}
            />
          ) : null}

          {mode === "lifecycle" ? (
            <ObjectWorkspace
              pane="lifecycle"
              title="我的红人"
              description="围绕已跟进对象提问、分析风险或判断下一步；对象事实与受控动作保留在右栏。"
              selectedCount={selectedKolIds.length}
              resultCount={followedWorkspace.visibleCards.length}
              railLabel="我的红人结果"
              railToggleLabel="我的红人"
              railStorageKey="ui:home-followed-rail-collapsed"
              interaction={interactionFeedback}
              centerFooter={renderComposerDock()}
              rail={(
                <FollowedPane
                  visibleKols={followedWorkspace.visibleCards}
                  allCards={followedWorkspace.cards}
                  kolQuery={followedWorkspace.query}
                  stageFilter={followedWorkspace.stageFilter}
                  situation={followedWorkspace.situation}
                  selectedKolIds={selectedKolIds}
                  hoveredKolId={followedWorkspace.hoveredId}
                  focusedKolId={followedWorkspace.focusedId}
                  confirmStageBusyId={followedWorkspace.confirmStageBusyId}
                  confirmStageFeedback={followedWorkspace.confirmStageFeedback}
                  followScope={followScope}
                  followEmptyKind={followEmptyKind}
                  down={followingDown}
                  onQuery={followedWorkspace.setQuery}
                  onStageFilter={followedWorkspace.setStageFilter}
                  onSituation={followedWorkspace.setSituation}
                  onHover={followedWorkspace.setHoveredId}
                  onFocus={followedWorkspace.setFocusedId}
                  onToggleSelect={toggleSelectedKol}
                  onToggleSelectAll={toggleSelectAllKols}
                  onOpenDetail={followedWorkspace.openDetails}
                  onPrimary={followedWorkspace.runCardAction}
                  onOpenMail={followedWorkspace.openMail}
                  onCompose={followedWorkspace.compose}
                  onConfirmStage={followedWorkspace.confirmStage}
                  onBatchConfirm={followedWorkspace.runBatch}
                  onAnalyzeSelected={() => prefillAnalyze(
                    "following",
                    followedWorkspace.selectedCards,
                    followedWorkspace.selectedCards.map((card) => String(card.source.kol_uid || card.id)),
                  )}
                  onRelease={(card) => followedWorkspace.requestRelease(card.source)}
                  onBind={() => nav("/settings?tab=starry")}
                />
              )}
            />
          ) : null}

          {mode === "pool" ? (
            <ObjectWorkspace
              pane="pool"
              title="公海"
              description="从当前可见的公开对象中选择分析范围；领取跟进仍是右栏里的独立确认动作。"
              selectedCount={selectedKolIds.length}
              resultCount={poolWorkspace.cards.length}
              railLabel="公海结果"
              railToggleLabel="公海"
              railStorageKey="ui:home-pool-rail-collapsed"
              interaction={interactionFeedback}
              centerFooter={renderComposerDock()}
              rail={(
                <PoolPane
                  cards={poolWorkspace.cards}
                  selectedIds={selectedKolIds}
                  hoveredId={followedWorkspace.hoveredId}
                  query={poolWorkspace.query}
                  down={poolDown}
                  libraryCount={libraryCount}
                  syncBusy={retryingSurface === "pool"}
                  claimBusyId={poolWorkspace.claimBusy && poolWorkspace.claimTarget ? poolWorkspace.claimTarget.kol_uid : null}
                  onQuery={poolWorkspace.setQuery}
                  onHover={followedWorkspace.setHoveredId}
                  onToggleSelect={toggleSelectedPool}
                  onToggleSelectAll={toggleSelectAllPool}
                  onSyncLibrary={() => void retrySurface("pool")}
                  onAnalyzeSelected={() => {
                    const selected = poolWorkspace.cards.filter((card) => selectedKolIds.includes(card.kol_uid));
                    prefillAnalyze("pool", selected, selected.map((card) => card.kol_uid));
                  }}
                  onClaim={poolWorkspace.requestClaim}
                />
              )}
            />
          ) : null}

        </div>
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
        open={Boolean(followedWorkspace.batchPending?.length)}
        cards={followedWorkspace.batchPending || []}
        busy={Boolean(followedWorkspace.batchPending?.[0] && followedWorkspace.confirmStageBusyId === followedWorkspace.batchPending[0].id)}
        onConfirm={followedWorkspace.confirmBatch}
        onCancel={followedWorkspace.cancelBatch}
      />
      <EditTaskDialog
        task={editTaskTarget}
        onClose={() => setEditTaskTarget(null)}
        onSaved={handleTaskEdited}
      />
      <ClaimFollowConfirm
        card={poolWorkspace.claimTarget}
        busy={poolWorkspace.claimBusy}
        error={poolWorkspace.claimError}
        onConfirm={() => void poolWorkspace.confirmClaim()}
        onCancel={poolWorkspace.cancelClaim}
      />
      <ReleaseFollowConfirm
        handle={followedWorkspace.releaseTarget?.handle}
        open={Boolean(followedWorkspace.releaseTarget)}
        busy={followedWorkspace.releaseBusy}
        error={followedWorkspace.releaseError}
        onConfirm={() => void followedWorkspace.confirmRelease()}
        onCancel={followedWorkspace.cancelRelease}
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
