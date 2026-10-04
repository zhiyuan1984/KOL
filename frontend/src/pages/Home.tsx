import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  type FromTextResult,
  type HomeWorkbench,
  type KnowledgeRow,
  type QuestionTemplateRow,
  type RecommendedTask,
  type StarryBinding,
  type Task,
  type TaskDefinition,
  type SkillTemplate,
  type TaskRunResult,
} from "../api";
import ComposerDock, { type ComposerSubmit } from "../components/ComposerDock";
import { storePending } from "../components/ChatBlocks";
import { stashComposerDraft } from "../composer/draft";
import type { ComposerEntryIntent, ComposerObjectRef } from "../composer/types";
import Markdown from "../components/Markdown";
import { starterPrompt } from "../taskStarters";
import {
  clearComposerFill,
  composerFillText,
  lockedTemplateFromRow,
  peekComposerFill,
  type LockedMailTemplate,
} from "../knowledgeCopy";
import { rememberJourney } from "../journey";
import { fieldLabel, friendlyApiError, missingFieldsMessage } from "../labels";
import DiscoveryWorkspace from "../home/DiscoveryWorkspace";
import { discoveryWorkspaceOf } from "../home/discoveryWorkspaceState";
import ObjectWorkspace from "../home/ObjectWorkspace";
import { scopeRows } from "../home/scopeRows";
import ScopeWorkspace from "../home/ScopeWorkspace";
import StreamingLines from "../home/StreamingLines";
import { RECOGNIZE_WAIT_LINES, RECOGNIZE_WAIT_OVERDUE } from "../home/recognizeWait";
import type { WorkspacePane } from "../home/WorkspaceShell";
import FollowedPane from "../home/FollowedPane";
import FollowedInteraction from "../home/FollowedInteraction";
import { matchesFollowedSituation, type FollowedSituation } from "../home/FollowedBrief";
import PoolInteraction, {
  QUESTION_TEMPLATE_MISSING_COPY,
  type PoolAnalysisKind,
  type PoolScoreConfirm,
} from "../home/PoolInteraction";
import PoolPane from "../home/PoolPane";
import ReleaseFollowConfirm from "../home/ReleaseFollowConfirm";
import { FollowedBatchConfirm } from "../home/FollowedBatchConfirm";
import SkillParamCard, { type SkillParamField } from "../home/workspace/SkillParamCard";
import SkillTemplateContext from "../components/SkillTemplateContext";
import { defaultTemplateValues, nonEmptyTemplateEntities, templateInputFields } from "../skillTemplate";
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
import { sharedRead } from "../home/sharedRead";
import { SHELL_READ_DELAY_MS } from "../home/firstPaint";

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
  KOL_BATCH_SIZE,
  poolAnalysisPrefill,
  selectAll,
  toggleSelect,
  type KolSurface,
} from "../home/kolContract";
import { nextPoolSort } from "../home/poolView";

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
import {
  SCOPE_CONFIG,
  TODAY_PLAN_START_EVENT,
  TODO_PLAN_START_EVENT,
  type PlanScope,
} from "../home/todayPlan";
import { usePlanScope } from "../home/usePlanScope";
import { fetchTodayTasks, fetchTodoTasks } from "../home/todayTasksApi";
import { loadAllWorkbenchTasks } from "../home/workbenchPagination";
import { findDuplicateTodo } from "../home/todoDedupe";
import { useMailComposeFlow } from "../hooks/useMailComposeFlow";
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

/**
 * Home quick-command presets. 「今日任务」/「我的待办」只拥有下一次提交，而且是
 * 一次性的：正文一旦偏离它写入的起始文案、或用户此后做了任何显式选择（选技能、
 * 换模板、进入别的面预填、切走 tab），这个预设锁就必须失效 —— 否则它会劫持
 * 之后那次「选技能 / 改需求」的提交，把意图错判成 Codex 规划。
 */
type HomePreset = "creator_daily_tasks" | "todo_plan";

const PRESET_LABEL: Record<HomePreset, string> = {
  creator_daily_tasks: "今日任务",
  todo_plan: "我的待办",
};

const PRESET_MODE: Record<HomePreset, HomeMode> = {
  creator_daily_tasks: "today",
  todo_plan: "todo",
};

function presetStarter(preset: HomePreset): string {
  return starterPrompt({ id: preset, title: PRESET_LABEL[preset] });
}

/**
 * Text written by a shortcut (never by the employee): the two plan starters or a
 * discovery brief body. An explicit pick must be allowed to replace this instead
 * of inheriting it as its own prompt.
 */
function isPresetStarterText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === presetStarter("creator_daily_tasks")
    || trimmed === presetStarter("todo_plan")
    || value.startsWith(DISCOVERY_BODY_PREFIX);
}

export default function Home() {
  const homeRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
  const [tab, setTab] = useState<HomeTab>("today");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [selectedKolIds, setSelectedKolIds] = useState<string[]>([]);
  const [dedupeNotice, setDedupeNotice] = useState("");
  const [analyzeSurface, setAnalyzeSurface] = useState<KolSurface | null>(null);
  const [analyzeUids, setAnalyzeUids] = useState<string[]>([]);
  const [queuedNotice, setQueuedNotice] = useState("");
  const [poolTemplates, setPoolTemplates] = useState<Partial<Record<PoolAnalysisKind, QuestionTemplateRow>>>({});
  const [poolTemplateNotice, setPoolTemplateNotice] = useState("");
  const [scoreConfirm, setScoreConfirm] = useState<PoolScoreConfirm | null>(null);
  const [boardWorkbench, setBoardWorkbench] = useState<HomeWorkbench | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const [followScope, setFollowScope] = useState<StarryBinding | null>(null);
  const followScopeRef = useRef<StarryBinding | null>(null);
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
  // 一次性快捷指令预设：只有在下一次提交时它仍然「没被动过」，才拥有这次提交。
  const [preset, setPreset] = useState<HomePreset | null>(
    todayEntryDefault ? "creator_daily_tasks" : todoEntryDefault ? "todo_plan" : null,
  );
  const presetRef = useRef<HomePreset | null>(preset);
  presetRef.current = preset;
  const releasePreset = () => {
    const active = presetRef.current;
    if (!active) return;
    presetRef.current = null;
    setPreset(null);
    setLockedIntent((current) => (current === active ? null : current));
    setLockedLabel((current) => (current === PRESET_LABEL[active] ? null : current));
  };
  const [lockedKnowledgeId, setLockedKnowledgeId] = useState<string | null>(initialFill?.id || null);
  const [lockedTemplate, setLockedTemplate] = useState<LockedMailTemplate | null>(
    initialFill ? lockedTemplateFromRow(initialFill) : null,
  );
  const [composerChips, setComposerChips] = useState<ComposerDraftChip[]>([]);
  const [analyzePeople, setAnalyzePeople] = useState<string[]>([]);
  const [enqueueNotice, setEnqueueNotice] = useState("");
  const mailCompose = useMailComposeFlow({
    onApplyBody: setText,
    onPrepared: (response) => {
      if (!response.template) return;
      setLockedIntent("email_compose");
      setLockedLabel("写合作邮件");
      setLockedKnowledgeId(response.template.knowledge_id);
      setLockedTemplate({
        id: response.template.knowledge_id,
        title: response.template.title,
        subject: response.editor?.subject || "",
        body_en: response.editor?.body || "",
      });
    },
  });
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
    // A knowledge/template fill that names no skill is not a plan shortcut: drop
    // any stale preset lock so it cannot hijack the next submit.
    if (!skill) releasePreset();
    if (lockedIntent === "email_compose" && (skill === "email_compose" || !skill)) {
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
    mailCompose.clear();
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
    // A shortcut preset is one-shot: once the user edits its text, the preset
    // must not leak into the next submission. This applies to every preset, not
    // just the two planning ids — leaving one behind silently rewrites a later
    // "typed my own requirement" submit into the old shortcut.
    const activePreset = presetRef.current;
    if (activePreset && next.trim() !== presetStarter(activePreset)) {
      releasePreset();
    }
    if (!discoveryBrief && !next.includes(DISCOVERY_BODY_PREFIX)) return;
    const parsed = parseDiscoveryBody(next);
    const current = discoveryBrief;
    if (!current) return;
    const merged = mergeDiscoveryBrief(current, parsed);
    setDiscoveryBrief(merged);
    // 正文是条件卡的另一半：改正文，卡片跟着走。
    setDiscoveryFormBrief(merged);
  };

  const onPickComposerSkill = (skill: import("../components/ComposerDock").SkillOption, ctx: { mention: string; rest: string; collaborationId?: string }) => {
    // Picking a skill is an explicit choice: it releases any one-shot preset and
    // must never inherit a stale preset starter as its own prompt.
    releasePreset();
    const pickedDefinition = definitions.find((definition) => definition.id === skill.id);
    setText((current) => (
      isPresetStarterText(current)
        ? starterPrompt(pickedDefinition || { id: skill.id, title: skill.title || skill.label || skill.id })
        : current
    ));
    setLockedIntent(skill.id);
    setLockedLabel(skill.title || skill.label || skill.id);
    if (skill.id !== "email_compose") {
      mailCompose.clear();
      return;
    }
    const collaboration = objectRefs.find((ref) => ref.kind === "collaboration");
    const kol = objectRefs.find((ref) => ref.kind === "kol");
    void mailCompose.prepare({
      body: ctx.rest,
      collaboration_id: ctx.collaborationId || collaboration?.id,
      handle: kol?.id,
      knowledge_id: lockedKnowledgeId || undefined,
      object_refs: objectRefs,
    });
  };

  const submitDiscovery = async (brief: DiscoveryBrief, body: string, version: string) => {
    if (busy) return;
    setDiscoverySubmitFailed(false);
    setDiscoverySubmitError("");
    if (!canSubmitDiscovery(brief)) {
      setDiscoverySubmitError("请选择平台并填写关键词后再发送。");
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
      const fingerprint = JSON.stringify({ brief, body, version });
      if (discoveryRequest.current?.fingerprint !== fingerprint) {
        const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
        discoveryRequest.current = { fingerprint, id: requestId };
      }
      const result = await api.createDiscoveryWorkspace({ brief, text: body, version, request_id: discoveryRequest.current.id });
      // ▪ 只中止客户端后续动作：不调用后端取消，也不改任何服务端状态。
      if (intakeCancelled.current) return;
      sessionStorage.setItem(`task:${result.session_id}`, result.task_id);
      if (result.pending) storePending(result.session_id, result.pending);
      refreshWorkbenchSessions();
      clearDiscoveryLock();
      await import("./Chat").catch(() => undefined);
      nav(`/s/${result.session_id}`, { state: { discoverySession: result.session_id } });
    } catch (error) {
      setDiscoverySubmitFailed(true);
      if (isMissingEndpoint(error)) {
        setDiscoverySubmitError("发现提交接口尚未提供。不会发信、不会改阶段，也没有编造结果。");
      } else {
        setDiscoverySubmitError(friendlyApiError(error, "发现任务没有提交。"));
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
  const [skillParamTouched, setSkillParamTouched] = useState<Set<string>>(() => new Set());
  const [selectedSkillTemplate, setSelectedSkillTemplate] = useState<SkillTemplate | null>(null);
  const paramSkillId = useRef<string | null>(null);
  const lastComposer = useRef<ComposerSubmit | null>(null);
  const taskCatalogRef = useRef<Task[]>([]);
  const [taskCatalog, setTaskCatalog] = useState<Task[]>([]);
  /** 进行中的 board 读：后到者共享同一 promise，不把「在途」当成「已就绪」。 */
  const boardRequestRef = useRef<Promise<boolean> | null>(null);
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
  /** 失败原因的可读文案：只在中栏 AI发现 面渲染，切页签不得跟着出现。 */
  const [discoverySubmitError, setDiscoverySubmitError] = useState("");
  const discoveryRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const [resumedDiscoverySession, setResumedDiscoverySession] = useState<string | null>(null);
  const resumeDiscoveryId = params.get("resume");
  useEffect(() => {
    let active = true;
    setResumedDiscoverySession(null);
    if (!resumeDiscoveryId || params.get("tab") !== "discovery") return;
    void api.task(resumeDiscoveryId).then(value => {
      if (!active) return;
      const restored = ("task" in value ? value.task : value) as Task;
      const workspace = discoveryWorkspaceOf(restored);
      if (!workspace) throw new Error("该任务没有可恢复的发现条件。");
      setDiscoveryFormBrief(workspace.brief);
      setDiscoveryBrief(workspace.brief);
      setText(workspace.submitted_text || renderDiscoveryBody(workspace.brief));
      setLockedIntent(DISCOVERY_INTENT);
      setLockedLabel(DISCOVERY_LOCK_LABEL);
      setEntryIntent("discover");
      setResumedDiscoverySession(String(restored.session_id || "") || null);
    }).catch(() => {
      if (active) setDiscoverySubmitError("无法恢复该发现任务，请从任务中心核对访问权限。已有输入仍保留。");
    });
    return () => { active = false; };
  }, [resumeDiscoveryId]);
  const mode = parseHomeMode(params.get("tab"));
  // 计划作用域只在对应 tab 激活时读取：公海/我的红人不再替今日与待办预读。
  const todayPlan = usePlanScope("today", {
    listOpenTasks: (signal) => loadAllWorkbenchTasks("today", undefined, signal),
    getBrief: (signal) => api.workbenchPlan(signal),
    startPlan: () => api.startWorkbenchPlan(),
    getDisplayTasks: (signal) => fetchTodayTasks(signal),
  }, { enabled: mode === "today" });
  const todoPlan = usePlanScope("todo", {
    listOpenTasks: (signal) => loadAllWorkbenchTasks("todo", undefined, signal),
    getBrief: (signal) => api.workbenchPlan(signal),
    startPlan: () => api.startWorkbenchPlan(),
    getDisplayTasks: (signal) => fetchTodoTasks(signal),
  }, { enabled: mode === "todo" });
  const nav = useNavigate();

  // 快捷指令预设是一次性的：离开它所属的 tab 就作废（否则「今日任务」会跟着用户
  // 跑到别的面，把下一次提交变成一次规划）。离开 AI发现 还要复位入口意图与发现
  // 条件，否则「发现」同样会泄漏到别的面，把下一次提交变成一次真实采集。
  useEffect(() => {
    if (presetRef.current && PRESET_MODE[presetRef.current] !== mode) releasePreset();
    if (mode === "discovery") return;
    setEntryIntent((current) => (current === "discover" ? "free" : current));
    // Leaving AI发现 must release both halves of the lock.  Previously only
    // entryIntent/text were reset; lockedIntent stayed creator_discovery, so a
    // normal submit on another tab could still be routed to discovery.
    setLockedIntent((current) => (current === DISCOVERY_INTENT ? null : current));
    setLockedLabel((current) => (current === DISCOVERY_LOCK_LABEL ? null : current));
    setDiscoveryBrief((current) => (current ? null : current));
    setDiscoveryFormBrief((current) => (current ? null : current));
    setText((current) => (current.startsWith(DISCOVERY_BODY_PREFIX) ? "" : current));
  }, [mode]);

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
    releasePreset();
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
    const scope = board.follow_scope || null;
    followScopeRef.current = scope;
    setFollowScope(scope);
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

  const loadBoard = (surface: HomeSurface, force = false): Promise<boolean> => {
    if (!force && boardRequestRef.current) return boardRequestRef.current;
    const request = api.homeBoard({ refresh: force }).then((board) => {
      applyBoard(board, surface);
      return true;
    }).catch((error) => {
      if (boardRequestRef.current === request) boardRequestRef.current = null;
      setSurfaceError(surface, error instanceof Error ? error.message : "工作台读取失败");
      return false;
    });
    boardRequestRef.current = request;
    return request;
  };

  const poolWorkspace = usePoolWorkspace({
    active: mode === "pool",
    selectedIds: selectedKolIds,
    loadBoard,
    boardKols: () => boardKolsRef.current,
    onClaimed: async (kolUid) => {
      setSelectedKolIds((current) => current.filter((id) => id !== kolUid));
      await followedWorkspaceRef.current.loadSurface();
    },
    onClaimUndone: async (kolUid) => {
      setSelectedKolIds((current) => current.filter((id) => id !== kolUid));
      await followedWorkspaceRef.current.loadSurface();
    },
  });
  poolSetErrorRef.current = poolWorkspace.setError;

  /** 四个入口的可点击状态由知识库模板决定，而不是由写死文案决定。 */
  const poolTemplateState = useMemo(() => {
    const slot = (kind: PoolAnalysisKind) => ({
      ready: Boolean(String(poolTemplates[kind]?.body || "").trim()),
      title: poolTemplates[kind]?.title || "",
    });
    return {
      potential: slot("potential"),
      risk: slot("risk"),
      completeness: slot("completeness"),
      score: slot("score"),
    };
  }, [poolTemplates]);

  /** 重试只重发这一面的读取，不切 Tab、不写会话。 */
  const retrySurface = async (surface: HomeSurface) => {
    setRetryingSurface(surface);
    try {
      const boardReady = surface === "pool" ? true : await loadBoard(surface, true);
      if (surface === "following" && boardReady) await followedWorkspaceRef.current.loadSurface();
      else if (surface === "pool") await poolWorkspace.loadSurface(true);
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
    // 任务目录与任务定义只服务今日/待办与模板面板：让位首屏后再读，不与公海首读抢时隙。
    // Mount: task definitions + GET /api/tasks (full catalog).
    // Today/Todo filter buckets in FE. view=open is the memory list (compat view=todo).
    // Do not GET /api/home or GET /api/home/board here — board waits for
    // first「我跟进的红人」entry or the refresh control.
    const timer = window.setTimeout(() => {
      void api.taskDefinitions().then(definitionList).then((taskDefinitions) => {
        if (!cancelled && taskDefinitions.length) {
          setDefinitions(withHomeCommandTemplates(taskDefinitions));
        }
      }).catch(() => undefined);
      void api.tasks().then(unwrapTaskList).then((catalog) => {
        if (!cancelled) applyTaskCatalog(catalog);
      }).catch(() => undefined);
      // board 是「我的红人」对账（旧协作投影）与今日/待办推荐的共享来源：首屏之后再预热一次，
      // 免得首次点「我的红人」还要现场等它。
      void loadBoard("following");
    }, SHELL_READ_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Initial requests load independently so the input and task shell render immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // A selected template is only meaningful while it belongs to the active
    // skill. Switching panes or skills must not keep the previous form alive.
    const activeSkillId = lockedIntent;
    if (!activeSkillId) {
      paramSkillId.current = null;
      setSkillParamValues({});
      setSkillParamErrors({});
      setSkillParamTouched(new Set());
      return;
    }
    const definition = definitions.find((item) => item.id === activeSkillId);
    const template = selectedSkillTemplate?.skill_id === activeSkillId
      ? selectedSkillTemplate
      : definition?.ui_template || null;
    const paramKey = template ? `${template.id}:${template.version}` : activeSkillId;
    if (!definition || paramSkillId.current === paramKey) return;
    paramSkillId.current = paramKey;
    const fields = templateInputFields(template, Array.isArray(definition.input_schema) ? definition.input_schema as SkillParamField[] : []);
    setSkillParamValues(defaultTemplateValues(fields));
    setSkillParamErrors({});
    setSkillParamTouched(new Set());
  }, [definitions, lockedIntent, selectedSkillTemplate]);

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
    releasePreset();
    if (definition.granted === false) {
      setErr(`“${definition.title}”尚未授权，请联系管理员在技能授权中开通。`);
      return;
    }
    setErr("");
    setFeedback(null);
    setText(starterPrompt(definition));
    setLockedIntent(definition.skill_id || definition.id);
    setLockedLabel(definition.title);
    setSelectedSkillTemplate(definition.ui_template || null);
    applyLockedKnowledge(null);
    setPanelOpen(false);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setBlockSubmit(true);
    window.setTimeout(() => setBlockSubmit(false), 500);
    rememberJourney({ kind: "skill", skillId: definition.skill_id || definition.id, skillLabel: definition.title });
  };

  const onRecommend = (rec: RecommendedTask) => {
    releasePreset();
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
    setSelectedKolIds((current) => toggleSelect(current, id, on));
  };

  const toggleSelectAllKols = (on: boolean) => {
    setSelectedKolIds(selectAll(followedWorkspace.visibleCards.map((card) => card.id), on));
  };

  const prefillAnalyze = (surface: KolSurface, cards: Array<{ identity: { display: string } }>, uids: string[]) => {
    // Leaving the plain-ask path for a KOL analysis: a leftover plan preset must
    // not hijack this submit (it would swallow the prefill and start planning).
    releasePreset();
    setAnalyzeSurface(surface);
    setAnalyzeUids(uids);
    setText(analyzePrefillPrompt(cards, surface));
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setQueuedNotice("");
  };

  const applyPoolSelection = (nextIds: string[]) => {
    setSelectedKolIds(nextIds);
    const selected = poolWorkspace.analysisCards.filter((card) => nextIds.includes(card.kol_uid));
    if (selected.length) {
      prefillAnalyze("pool", selected, selected.map((card) => card.kol_uid));
      return;
    }
    setAnalyzeSurface(null);
    setAnalyzeUids([]);
    if (isAnalyzePrefill(text)) setText("");
  };

  const toggleSelectedPool = (id: string, on: boolean) => {
    applyPoolSelection(toggleSelect(selectedKolIds, id, on));
  };

  const toggleSelectAllPool = (visibleIds: string[], on: boolean) => {
    if (!on) {
      applyPoolSelection(selectedKolIds.filter((id) => !visibleIds.includes(id)));
      return;
    }
    applyPoolSelection([...new Set([...selectedKolIds, ...visibleIds])]);
  };

  const poolTemplateBody = (kind: PoolAnalysisKind): string => String(poolTemplates[kind]?.body || "").trim();

  /**
   * 四个入口只预填空草稿：名单 + 知识库模板正文，绝不提交或执行。
   * 模板缺失时禁用入口并如实提示，不回落成写死的问题（CONST-09/10）。
   */
  const prefillPoolQuestion = (kind: PoolAnalysisKind, targets: string[]): boolean => {
    releasePreset();
    const body = poolTemplateBody(kind);
    if (!body) {
      setPoolTemplateNotice(QUESTION_TEMPLATE_MISSING_COPY);
      return false;
    }
    const cards = poolWorkspace.analysisCards.filter((card) => targets.includes(card.kol_uid));
    setPoolTemplateNotice("");
    setAnalyzeSurface("pool");
    setAnalyzeUids(targets);
    setText(poolAnalysisPrefill(cards, "pool", body));
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setQueuedNotice("");
    return true;
  };

  const startPoolAnalysis = (kind: PoolAnalysisKind) => {
    const selected = selectedKolIds.filter((id) => poolWorkspace.analysisCards.some((card) => card.kol_uid === id));
    if (kind !== "score" && !selected.length) return;
    if (!prefillPoolQuestion(kind, selected)) return;
    if (kind === "score") setScoreConfirm({ busy: false, count: selected.length, error: null });
  };

  const confirmPoolScore = async () => {
    const targets = analyzeUids;
    // 当前 AI 发现条件就是这次评分的口径：模型据此判「量级是否达标 / 方向地区是否匹配」，
    // 没有条件时不带 target_criteria（模型不得自己编匹配）。
    setScoreConfirm({ busy: true, count: targets.length, error: null });
    try {
      const criteria = discoveryBrief ? { ...discoveryBrief } : null;
      // The backend protects each Jev request at eight targets. A full-page
      // selection is therefore executed in bounded batches, with each batch
      // persisted and refreshed before the next one starts.
      if (!targets.length) {
        await poolWorkspace.assessWithJev(undefined, criteria);
      } else {
        for (let offset = 0; offset < targets.length; offset += KOL_BATCH_SIZE) {
          await poolWorkspace.assessWithJev(targets.slice(offset, offset + KOL_BATCH_SIZE), criteria);
        }
      }
      setScoreConfirm(null);
    } catch (cause) {
      setScoreConfirm({ busy: false, count: targets.length, error: cause instanceof Error ? cause.message : "KOL评分失败" });
    }
  };

  const cancelPoolScore = () => {
    if (scoreConfirm?.busy) return;
    setScoreConfirm(null);
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

  /** Discovery history belongs to the task system; opening one task restores only that run's result page. */
  const openDiscoveryTaskResult = (task: Task): boolean => {
    const runId = String(task.discovery_run_id || "").trim();
    if (String(task.task_type || "") !== "discovery_crawl" || !runId) return false;
    setDiscoveryTaskId(task.id);
    setDiscoveryRunId(runId);
    setMode("discovery");
    return true;
  };

  const actOnMemoryTask = async (task: Task) => {
    if (openDiscoveryTaskResult(task)) return;
    if (String(task.display_verb || "") === "edit") {
      nav("/tasks?view=created");
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

  function taskSessionId(task: Task): string {
    const direct = String(task.session_id || "").trim();
    if (direct) return direct;
    const runs = Array.isArray(task.runs) ? task.runs as Array<Record<string, unknown>> : [];
    for (const run of [...runs].reverse()) {
      const sessionId = String(run.session_id || "").trim();
      if (sessionId) return sessionId;
    }
    return "";
  }

  const openTask = async (task: Task) => {
    if (openDiscoveryTaskResult(task)) return;
    // 任务列表是记忆投影；进入详情前按稳定 task.id 读取一次完整任务，
    // 用 runs 中最近一次 session_id 恢复原任务页，而不是创建一次新执行。
    let current = task;
    try {
      current = taskValue(await api.task(task.id));
      mergeCatalogTask(current);
    } catch {
      // 列表投影已有 session_id 时仍可直接恢复；新任务继续走原启动流程。
    }
    const sessionId = taskSessionId(current);
    rememberJourney({
      kind: "task",
      skillId: String(current.skill_id || current.skill || current.task_type || ""),
      skillLabel: current.title,
      handle: current.kol_name,
    });
    if (sessionId) {
      sessionStorage.setItem(`task:${sessionId}`, current.id);
      if (current.collaboration_id || current.project_id) sessionStorage.setItem(`kol-session:${sessionId}`, "1");
      nav(`/s/${sessionId}`, { state: { kolSession: Boolean(current.collaboration_id || current.project_id) } });
      return;
    }
    const collabId = String(current.collaboration_id || current.project_id || "");
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
      await createAndRun(current);
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
    poolWorkspace.cancelClaim();
  }, [poolWorkspace.query, poolWorkspace.filter, poolWorkspace.sort, poolWorkspace.offset]);

  useEffect(() => {
    let alive = true;
    // 只读已发布的问题模板（memory 入口，零会话零模型）；缺失时入口禁用并如实提示。
    sharedRead("home:question-templates", () => api.questionTemplates())
      .then((rows) => {
        if (!alive) return;
        const next: Partial<Record<PoolAnalysisKind, QuestionTemplateRow>> = {};
        for (const row of rows || []) {
          if (!(["potential", "risk", "completeness", "score"] as const).includes(row.slot as PoolAnalysisKind)) continue;
          next[row.slot as PoolAnalysisKind] = row;
        }
        setPoolTemplates(next);
      })
      .catch(() => { if (alive) setPoolTemplates({}); });
    return () => { alive = false; };
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
    // 一次性快捷指令预设只在正文仍等于它写入的起始文案时，才算「这次提交的选择」。
    // 用户一旦改过正文、选过技能或换了模板，它就必须让位给显式选择与正文识别，
    // 否则「今日任务」会劫持之后那次「选技能 / 写需求」的提交。
    const presetIntent = presetRef.current && p.text.trim() === presetStarter(presetRef.current)
      ? presetRef.current
      : null;
    const intent = p.intent === "email_compose" || mailCompose.active
      ? "email_compose"
      // Explicit choices win, in order: a skill picked from + / the picker, an
      // in-pane intent (AI发现), then an untouched one-shot shortcut preset,
      // then any persistent lock (template / knowledge) as a last resort.
      : (presetIntent || skillFromScope || (p.intent && p.intent !== "free" ? p.intent : undefined) || lockedIntent);
    const selectedDefinition = intent ? definitions.find((definition) => definition.id === intent) : undefined;
    const submittedTemplate = selectedSkillTemplate?.skill_id === intent
      ? selectedSkillTemplate
      : selectedDefinition?.ui_template || null;
    const submittedSchemaFields = templateInputFields(
      submittedTemplate,
      Array.isArray(selectedDefinition?.input_schema) ? selectedDefinition.input_schema as SkillParamField[] : [],
    );
    const submittedParamKey = submittedTemplate ? `${submittedTemplate.id}:${submittedTemplate.version}` : intent || "";
    if (!prompt && !p.attachments?.length && !skillFromScope && !submittedSchemaFields.length) return;
    const intakeText = prompt || selectedDefinition?.title || "";
    const submittedSkillValues = paramSkillId.current === submittedParamKey
      ? skillParamValues
      : defaultTemplateValues(submittedSchemaFields);
    const submittedTouched = paramSkillId.current === submittedParamKey
      ? skillParamTouched
      : new Set<string>();
    const submittedEntities = {
      ...(p.entities || {}),
      ...nonEmptyTemplateEntities(submittedSchemaFields, submittedSkillValues, submittedTouched),
    };
    if (selectedDefinition?.input_schema && Array.isArray(selectedDefinition.input_schema)) {
      setLockedIntent(selectedDefinition.id);
      setLockedLabel(selectedDefinition.title);
    }
    // A mail draft is authored content. Keep it in place until task intake and
    // run both accept it, so a validation or transport failure can never lose
    // the user's body or subject.
    if (intent !== "email_compose") setText("");
    if (intent === "creator_daily_tasks") {
      releasePreset();
      window.dispatchEvent(new Event(TODAY_PLAN_START_EVENT));
      return;
    }
    if (intent === "todo_plan") {
      releasePreset();
      window.dispatchEvent(new Event(TODO_PLAN_START_EVENT));
      return;
    }
    if (isAnalyzeEnqueuePrefill(prompt, intent) && !analyzeSurface && !analyzeUids.length) {
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
    // A newly selected skill is an explicit override, even if the composer
    // still contains the discovery preset body from an earlier shortcut.
    if (intent === DISCOVERY_INTENT || (prompt.startsWith(DISCOVERY_BODY_PREFIX) && !skillFromScope)) {
      const brief = discoveryBrief || mergeDiscoveryBrief(
        defaultDiscoveryBrief(),
        parseDiscoveryBody(prompt),
      );
      await submitDiscovery(brief, prompt, discoveryVersion);
      return;
    }
    const knowledgeId = p.knowledge_id || lockedKnowledgeId || undefined;
    lastComposer.current = { ...p, text: intakeText, knowledge_id: knowledgeId };
    setBusy(true);
    setIntakeRunning(true);
    intakeCancelled.current = false;
    setErr("");
    setFeedback(null);
    setQueuedNotice("");
    rememberJourney({ kind: "compose", skillId: intent || undefined, skillLabel: lockedLabel || undefined });
    try {
      if (intent === "email_compose") mailCompose.markSubmitting();
      const analyzeUidsNow = analyzeUids.length ? analyzeUids : selectedKolIds;
      if ((analyzeSurface || isAnalyzePrefill(prompt)) && analyzeUidsNow.length) {
        const queued = await enqueueKolAnalyze({
          kol_uids: analyzeUidsNow,
          prompt,
          surface: analyzeSurface || (mode === "pool" ? "pool" : "following"),
        });
        setQueuedNotice(queued.queued_copy || ANALYZE_QUEUED_COPY);
        setAnalyzeSurface(null);
        if (intakeCancelled.current) {
          setBusy(false);
          setIntakeRunning(false);
          return;
        }
        // 入队只写耐久记录；执行走既有任务运行链路（queued → running），不另造入口。
        const run = await api.runTask(queued.work_item_id, { text: prompt });
        if (intakeCancelled.current) return;
        openRun(run);
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
        input: {
          ...nonEmptyTemplateEntities(submittedSchemaFields, submittedSkillValues, submittedTouched),
          ...(submittedTemplate?.version ? { skill_template_version: submittedTemplate.version } : {}),
        },
        skill_template_version: p.skill_template_version || submittedTemplate?.version,
        collaboration_id: p.collaboration_id,
        knowledge_id: knowledgeId,
        entities: submittedEntities,
        scope: p.scope,
        object_refs: p.object_refs,
        client_entry: p.client_entry,
        compose_input: p.compose_input,
      });
      if (intakeCancelled.current) {
        setBusy(false);
        setIntakeRunning(false);
        return;
      }
      const resolution = recognized.resolution || {};
      const missing = resolution.missing_fields || [];
      if (submittedSchemaFields.length) {
        const resolvedEntities = resolution.entities || {};
        setSkillParamValues((current) => {
          const next = { ...current };
          for (const field of submittedSchemaFields) {
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
        if (intent === "email_compose") {
          mailCompose.markFailed(recognized.clarification || recognized.message || "邮件草稿尚缺少必要上下文，已保留编辑内容。");
        }
        setBusy(false);
        setIntakeRunning(false);
        return;
      }
      const created = recognized.task;
      prependTask(created);
      const run = await api.runTask(created.id, {
        intent,
        knowledge_id: knowledgeId,
        scope: p.scope,
        object_refs: p.object_refs,
        compose_input: p.compose_input,
        input: {
          ...nonEmptyTemplateEntities(submittedSchemaFields, submittedSkillValues, submittedTouched),
          ...(submittedTemplate?.version ? { skill_template_version: submittedTemplate.version } : {}),
        },
        skill_template_version: p.skill_template_version || submittedTemplate?.version,
        entities: submittedEntities,
      });
      setIntakeRunning(false);
      if (intakeCancelled.current) return;
      if (intent === "email_compose") setText("");
      clearLockedMail();
      openRun(run);
    } catch (error) {
      if (intent === "email_compose") {
        setText(intakeText);
        setLockedIntent("email_compose");
        setLockedLabel("写合作邮件");
        mailCompose.markFailed(error instanceof Error ? error.message : "提交失败，已保留邮件草稿。");
      }
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


  // 计划记忆（分页 GET /api/workbench/tasks）是今日/待办列表的唯一来源：读到之前列表为空，
  // 不用任务目录冒充，否则「今日」会在记忆未到时先出一批目录行与行内推荐动作。
  const planMemoryTasks = mode === "today" ? todayPlan.memoryTasks : mode === "todo" ? todoPlan.memoryTasks : null;
  const homeMemoryTasks = mode === "today" || mode === "todo"
    ? planMemoryTasks ?? []
    : planMemoryTasks ?? taskCatalog;

  // Scope-level stats stay tied to the matching plan memory when switching tabs.
  const todoScopeTasks = mode === "todo" ? todoPlan.memoryTasks ?? [] : todoPlan.memoryTasks ?? taskCatalog;

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
    latestFollowScope: followScopeRef,
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
    await poolWorkspace.loadSurface(true);
  };

  followedWorkspaceRef.current = followedWorkspace;

  const workbench = useMemo(
    () => boardWorkbench || deriveWorkbench(taskCatalog),
    [boardWorkbench, taskCatalog],
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

  const tabOpenTodoItems = useMemo(
    () => todoScopeTasks.filter(isOpenTask),
    [todoScopeTasks],
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
    if (!hasActiveRuns || mode === "pool") return;
    const controller = new AbortController();
    let inFlight = false;
    const tick = () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      void api.tasks(undefined, controller.signal).then(unwrapTaskList).then((catalog) => {
        if (!controller.signal.aborted) applyTaskCatalog(catalog);
      }).catch(() => undefined).finally(() => { inFlight = false; });
    };
    const kickoff = window.setTimeout(tick, SHELL_READ_DELAY_MS);
    const timer = window.setInterval(tick, HOME_TASK_POLL_MS);
    return () => { controller.abort(); window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, [hasActiveRuns, mode]);


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

  // 名单还在屏上、只有最近一次读取失败：不吞掉已读到的对象，也不假装读取成功。
  const followListError = followingDown ? "" : followedWorkspace.error;

  const taskCounts = {
    all: tasks.length,
    open: tasks.filter((task) => openStatuses.has(String(task.status || "pending"))).length,
    high: tasks.filter((task) => task.priority === "high" || task.priority === "urgent").length,
    ai: tasks.filter((task) => task.source === "ai").length,
  };

  const overdueCount = tabOpenTodoItems.filter((task) => openBucket(task) === "overdue").length;
  const dueTodayCount = tabOpenTodoItems.filter((task) => openBucket(task) === "due_today").length;
  const awaitingApprovalCount = tabOpenTodoItems.filter((task) => isAwaitingApproval(task)).length;
  const todayOverdueCount = paneRows.filter((task) => openBucket(task) === "overdue").length;
  const todayDueCount = paneRows.filter((task) => openBucket(task) === "due_today").length;
  const todayApprovalCount = paneRows.filter((task) => isAwaitingApproval(task)).length;
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
    if (mode !== "discovery") return;
    const home = homeRef.current;
    const content = home?.querySelector(".scope-workspace-center-content");
    if (!home || !content) return;
    let frame = 0;
    let followFocus = true;
    const keepFocusedInputVisible = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!followFocus) return;
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !home.contains(focused)
          || !focused.matches("[data-ai-prompt-submit], [data-composer-input]")) return;
        const rect = focused.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          focused.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
      });
    };
    // Async context can grow after Tab has already focused the dock. The
    // browser does not automatically reveal focus again after that layout shift.
    const observer = new ResizeObserver(keepFocusedInputVisible);
    const onFocus = () => { followFocus = true; keepFocusedInputVisible(); };
    const onManualScroll = () => { followFocus = false; };
    observer.observe(content);
    home.addEventListener("focusin", onFocus);
    home.addEventListener("wheel", onManualScroll, { passive: true });
    home.addEventListener("touchmove", onManualScroll, { passive: true });
    return () => {
      observer.disconnect();
      home.removeEventListener("focusin", onFocus);
      home.removeEventListener("wheel", onManualScroll);
      home.removeEventListener("touchmove", onManualScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [mode]);

  useEffect(() => {
    if (feedbackKind === "missing_fields") missingAlertRef.current?.focus();
  }, [feedbackKind, feedback]);

  const openPanel = (nextTab: HomeTab = "templates") => {
    setTab(nextTab);
    setPanelOpen(true);
  };

  const activateTodaySkill = () => {
    setPreset("creator_daily_tasks");
    setMode("today");
    setLockedIntent("creator_daily_tasks");
    setLockedLabel("今日任务");
    setText(starterPrompt({ id: "creator_daily_tasks", title: "今日任务" }));
    setComposerFocused(false);
  };

  const activateTodoSkill = () => {
    setPreset("todo_plan");
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
  const activeSkillTemplate = selectedSkillTemplate?.skill_id === lockedIntent
    ? selectedSkillTemplate
    : genericParamDefinition?.ui_template
      || (lockedIntent === DISCOVERY_INTENT ? definitions.find(definition => definition.id === "crawler_collect")?.ui_template : null)
      || (lockedIntent === "creator_daily_tasks"
        ? definitions.find((definition) => definition.id === "creator_daily_tasks")?.ui_template || null
        : lockedIntent === "todo_plan"
          ? definitions.find((definition) => definition.id === "todo_plan")?.ui_template || null
          : null);
  const genericParamFields = lockedIntent === DISCOVERY_INTENT ? [] : templateInputFields(
    activeSkillTemplate,
    Array.isArray(genericParamDefinition?.input_schema) ? genericParamDefinition.input_schema as SkillParamField[] : [],
  );
  const genericParamErrors = {
    ...skillParamErrors,
    ...(feedback?.resolution?.invalid_fields || {}),
    ...Object.fromEntries((feedback?.resolution?.missing_fields || []).map((key) => [key, "必填项"])),
  };
  const genericRequiredParamFields = genericParamFields.filter((field) => field.required);
  const genericOptionalParamFields = genericParamFields.filter((field) => !field.required);
  const updateGenericParam = (key: string, value: unknown) => {
    setSkillParamValues((current) => ({ ...current, [key]: value }));
    setSkillParamErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setSkillParamTouched((current) => new Set(current).add(key));
    setFeedback(null);
  };
  const genericParamCard = genericParamFields.length ? (
    <div className="skill-template-param-editor" data-skill-template-param-editor>
      {genericRequiredParamFields.length ? (
        <SkillParamCard
          key={`${activeSkillTemplate ? `${activeSkillTemplate.id}:${activeSkillTemplate.version}` : genericParamDefinition?.id}:required`}
          fields={genericRequiredParamFields}
          values={skillParamValues}
          errors={genericParamErrors}
          title={activeSkillTemplate?.title || genericParamDefinition?.title}
          mode={feedback?.needs_clarification ? "needs_input" : "edit"}
          onFieldChange={updateGenericParam}
        />
      ) : null}
      {genericOptionalParamFields.length ? (
        <details className="skill-template-optional skill-template-param-optional" data-skill-template-optional>
          <summary>可选条件（{genericOptionalParamFields.length}）</summary>
          <SkillParamCard
            key={`${activeSkillTemplate ? `${activeSkillTemplate.id}:${activeSkillTemplate.version}` : genericParamDefinition?.id}:optional`}
            fields={genericOptionalParamFields}
            values={skillParamValues}
            errors={genericParamErrors}
            mode={feedback?.needs_clarification ? "needs_input" : "edit"}
            hideTitle
            onFieldChange={updateGenericParam}
          />
        </details>
      ) : null}
    </div>
  ) : null;
  const skillTemplateContext = activeSkillTemplate
    ? <SkillTemplateContext template={activeSkillTemplate} showOptionalInputs={false} />
    : null;

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
        </button>
      ))}
    </div>
  );

  const interactionFeedback = (
    <div className="workspace-interaction-feedback" data-workspace-interaction-feedback>
      {skillTemplateContext}
      {genericParamCard}
      {enqueueNotice ? <p className="muted" role="status" data-analyze-enqueue>{enqueueNotice}</p> : null}
      {err && <p className="error composer-err" role="alert" data-home-session-error={err.includes("未能打开会话") ? "true" : undefined}>{err}</p>}
      {discoverySubmitError && mode === "discovery" ? (
        <p className="error composer-err" role="alert" data-home-discovery-submit-error-message>{discoverySubmitError}</p>
      ) : null}
      {discoverySubmitFailed && !busy && mode === "discovery" ? (
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
          <StreamingLines lines={RECOGNIZE_WAIT_LINES} seconds={recognizeSeconds} />
          {recognizeOverdue ? (
            <p data-recognize-timeout>{RECOGNIZE_WAIT_OVERDUE}</p>
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
        onPickSkill={onPickComposerSkill}
        onSkillTemplateChange={(template, skill) => {
          releasePreset();
          setSelectedSkillTemplate(template);
          if (template && skill) {
            setLockedIntent(skill.id);
            setLockedLabel(skill.title || skill.label || template.title);
          }
        }}
        mailCompose={mailCompose}
        onMailBodyEdit={mailCompose.markEdited}
        onSkillRemoved={(skillId) => {
          if (selectedSkillTemplate?.skill_id === skillId) setSelectedSkillTemplate(null);
          if (lockedIntent === skillId) {
            setLockedIntent(null);
            setLockedLabel(null);
          }
          if (skillId === "email_compose") clearLockedMail();
        }}
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
      ref={homeRef}
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
              onOpen={(task) => void openTask(task)}
              onEdit={() => nav("/tasks?view=created")}
              notice={paneScope === "todo" ? dedupeNotice : ""}
              brief={activePlan.brief}
              phase={activePlan.phase}
              events={activePlan.events}
              previousBrief={activePlan.prevBrief}
              previousEvents={activePlan.prevEvents}
              snapshot={activePlan.snapshot}
              memoryPending={activePlan.memoryTasks === null}
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
              busy={busy}
              schema={(() => {
                const declared = definitions.find((definition) => definition.id === "creator_discovery")?.input_schema;
                return Array.isArray(declared) ? declared as import("../home/workspace/SkillParamCard").SkillParamField[] : undefined;
              })()}
              onBriefChange={onDiscoveryBriefChange}
              activeTaskId={discoveryTaskId}
              activeRunId={discoveryRunId}
              lastSubmit={lastDiscoverySubmit}
              onRetrySubmit={() => void retryDiscoveryRun()}
              centerSupplement={<>
                {resumedDiscoverySession ? <p role="status" data-discovery-resume>
                  已恢复上次条件。<button className="btn ghost" onClick={() => nav(`/s/${resumedDiscoverySession}`)}>继续原发现任务</button>
                  <span className="muted">修改条件后提交将新建发现任务，原结果保留。</span>
                </p> : null}
                {interactionFeedback}
              </>}
              centerFooter={renderComposerDock()}
            />
          ) : null}

          {mode === "lifecycle" ? (
            <ObjectWorkspace
              pane="lifecycle"
              title="我的红人"
              description="围绕已跟进对象提问、分析风险或判断下一步；对象事实与受控动作保留在右栏。"
              selectedCount={selectedKolIds.length}
              resultCount={followedWorkspace.visibleCards.length || undefined}
              railLabel="我的红人结果"
              railToggleLabel="我的红人"
              railStorageKey="ui:home-followed-rail-collapsed"
              interaction={interactionFeedback}
              centerContent={(
                <FollowedInteraction
                  cards={followedWorkspace.cards}
                  completeness={followedWorkspace.completeness}
                  stageFilter={followedWorkspace.stageFilter}
                  situation={followedWorkspace.situation}
                  selectedCount={selectedKolIds.length}
                  onStageFilter={followedWorkspace.setStageFilter}
                  onSituation={followedWorkspace.setSituation}
                  publicPoolNewCount={poolWorkspace.poolLoaded ? poolWorkspace.newCount : null}
                  onOpenPublicPoolNew={() => {
                    poolWorkspace.setQuery("");
                    poolWorkspace.setSort("default");
                    poolWorkspace.setFilter("new");
                    setMode("pool");
                  }}
                  interaction={interactionFeedback}
                />
              )}
              centerFooter={renderComposerDock()}
              rail={(
                <FollowedPane
                  visibleKols={followedWorkspace.visibleCards}
                  allCards={followedWorkspace.cards}
                  kolQuery={followedWorkspace.query}
                  sort={followedWorkspace.sort}
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
                  listError={followListError}
                  onReload={() => void followedWorkspace.loadSurface()}
                  onQuery={followedWorkspace.setQuery}
                  onSort={followedWorkspace.setSort}
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
                  onOpenPool={() => setMode("pool")}
                  onOpenDiscovery={() => setMode("discovery")}
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
              resultCount={poolWorkspace.matchedCount}
              railLabel="公海结果"
              railToggleLabel="公海"
              railStorageKey="ui:home-pool-rail-collapsed-v2"
              centerContent={(
                <PoolInteraction
                  totalCount={poolWorkspace.totalCount}
                  selectedCount={selectedKolIds.length}
                  maintenanceBusy={poolWorkspace.maintenanceBusy}
                  maintenanceNotice={poolWorkspace.maintenanceNotice}
                  maintenanceError={poolWorkspace.maintenanceError}
                  interaction={interactionFeedback}
                  templates={poolTemplateState}
                  templateNotice={poolTemplateNotice}
                  criteriaNote={discoveryBrief
                    ? "评分口径：当前 AI 发现条件（平台 / 地区 / 方向 / 关键词 / 粉丝与均播门槛）。"
                    : "评分口径：未设置 AI 发现条件，按公开资料通用口径。"}
                  scoreConfirm={scoreConfirm}
                  onAnalyze={startPoolAnalysis}
                  onConfirmScore={() => void confirmPoolScore()}
                  onCancelScore={cancelPoolScore}
                />
              )}
              centerFooter={renderComposerDock()}
              rail={(
                <PoolPane
                  cards={poolWorkspace.visibleCards}
                  totalCount={poolWorkspace.totalCount}
                  page={poolWorkspace.page}
                  onPage={poolWorkspace.setOffset}
                  isFiltered={Boolean(poolWorkspace.query.trim()) || poolWorkspace.filter !== "all"}
                  selectedIds={selectedKolIds}
                  query={poolWorkspace.query}
                  filter={poolWorkspace.filter}
                  sort={poolWorkspace.sort}
                  down={poolDown}
                  libraryCount={poolWorkspace.poolLibraryCount ?? libraryCount}
                  poolLoaded={poolWorkspace.poolLoaded}
                  syncBusy={poolWorkspace.syncBusy}
                  syncError={poolWorkspace.syncError}
                  syncNotice={poolWorkspace.syncNotice}
                  claimBusyId={poolWorkspace.claimBusy && poolWorkspace.claimTarget ? poolWorkspace.claimTarget.kol_uid : null}
                  claimTarget={poolWorkspace.claimTarget}
                  claimError={poolWorkspace.claimError}
                  claimedId={poolWorkspace.claimedId}
                  undoAvailable={poolWorkspace.undoAvailable}
                  undoBusy={poolWorkspace.undoBusy}
                  undoError={poolWorkspace.undoError}
                  onQuery={poolWorkspace.setQuery}
                  onFilter={poolWorkspace.setFilter}
                  onToggleSort={(field) => poolWorkspace.setSort(nextPoolSort(poolWorkspace.sort, field))}
                  onToggleSelect={toggleSelectedPool}
                  onToggleSelectAll={toggleSelectAllPool}
                  onSyncLibrary={() => void poolWorkspace.syncLibrary()}
                  onClaim={poolWorkspace.requestClaim}
                  onConfirmClaim={() => void poolWorkspace.confirmClaim()}
                  onCancelClaim={poolWorkspace.cancelClaim}
                  onUndoClaim={() => void poolWorkspace.undoLatestClaim()}
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
