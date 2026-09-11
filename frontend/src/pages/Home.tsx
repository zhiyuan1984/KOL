import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  type FromTextResult,
  type HomeWorkbench,
  type KnowledgeRow,
  type Rec,
  type RecommendedTask,
  type StarryBinding,
  type Task,
  type TaskDefinition,
  type TaskRunResult,
} from "../api";
import BrandLockup from "../components/BrandLockup";
import ComposerDock, { type ComposerSubmit } from "../components/ComposerDock";
import { storePending } from "../components/ChatBlocks";
import Markdown from "../components/Markdown";
import { starterPrompt } from "../taskStarters";
import { recIcon, withRecommendedDisplay } from "../recommendedTasks";
import { clearComposerFill, composerStarter, peekComposerFill } from "../knowledgeCopy";
import { FOLLOWED_KOL_TABS, suggestedStageLabel } from "../kolStages";
import { rememberJourney } from "../journey";
import { missingFieldsMessage, fieldLabel } from "../labels";

type HomeTab = "today" | "templates";
type HomeMode = "todo" | "ai" | "lifecycle";
type TaskFilter = "all" | "open" | "high" | "ai";
type KolTab = string;
type TodoBucket = "overdue" | "today" | "waiting" | "later";

type FollowedKol = {
  id: string;
  handle: string;
  brand: string;
  stage_code?: string;
  stage_label: string;
  owner_name?: string;
  platform?: string;
  days_in_stage?: number;
  notes?: string;
  exception?: boolean;
  unbound?: boolean;
  profile_tags?: { id: string; label: string }[];
  follow_style_tags?: { id: string; label: string }[];
  task_history?: string;
  kol_name?: string;
  collab_summary?: string;
  recent_followup?: string;
  current_stage?: string;
  suggested_stage?: string;
  tasks?: { id: string; title: string; status?: string; history_summary?: string }[];
  unread_count?: number;
  mail_threads?: {
    conversation_id: string;
    subject: string;
    unread_count?: number;
    last_snippet?: string;
    last_from?: string;
    last_from_name?: string;
    last_direction?: string;
    last_at?: string | null;
  }[];
};

type TabSummary = { code: string; count: number; task_count?: number };

const openStatuses = new Set(["pending", "waiting", "running", "queued", "in_progress", "failed"]);
const closedStatuses = new Set(["completed", "done", "cancelled"]);
const HOME_MODES: HomeMode[] = ["todo", "ai", "lifecycle"];

function definitionList(
  value: TaskDefinition[] | { task_definitions?: TaskDefinition[]; definitions?: TaskDefinition[] },
): TaskDefinition[] {
  return Array.isArray(value) ? value : value.task_definitions || value.definitions || [];
}

function taskValue(value: Task | { task: Task }): Task {
  return (value as { task?: Task }).task || (value as Task);
}

function sourceLabel(source?: string) {
  return source === "ai" ? "AI 发现" : "手动创建";
}

function statusLabel(status?: string) {
  if (status === "completed" || status === "done") return "已完成";
  if (status === "running" || status === "in_progress") return "进行中";
  if (status === "waiting" || status === "queued") return "等待中";
  if (status === "failed") return "有风险";
  return "待处理";
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

function dueTime(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function workPriorityScore(task: Task) {
  let score = 0;
  if (task.risk || task.status === "failed") score += 100;
  const due = dueTime(task.due_at);
  if (Number.isFinite(due)) {
    const days = (due - Date.now()) / 86_400_000;
    if (days < 0) score += 90;
    else if (days < 1) score += 70;
    else if (days < 3) score += 40;
  }
  if (task.priority === "high" || task.priority === "urgent") score += 50;
  if (task.status === "waiting" || task.status === "queued") score += 30;
  if (task.source === "ai") score += 20;
  return score;
}

function whyLine(task: Task) {
  const origin = task.source === "ai" ? "AI发现" : "我的任务";
  if (task.risk) return `${origin} · ${task.risk}`;
  if (task.description) return `${origin} · ${task.description}`;
  if (task.context) return `${origin} · ${task.context}`;
  if (task.history_summary) return `${origin} · ${task.history_summary}`;
  if (task.due_at) {
    const due = new Date(task.due_at);
    if (!Number.isNaN(due.getTime())) {
      const today = new Date();
      const sameDay = due.toDateString() === today.toDateString();
      if (due < today && !sameDay) return `${origin} · 已超过计划时间`;
      if (sameDay) return `${origin} · 今天截止`;
      return `${origin} · ${due.toLocaleDateString("zh-CN")} 截止`;
    }
  }
  return [origin, task.skill, task.profile].filter(Boolean).join(" · ");
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

function sortedTasks(rows: Task[], sort: string) {
  return [...rows].sort((a, b) => {
    if (sort === "due") return String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"));
    if (sort === "progress") return Number(b.progress || 0) - Number(a.progress || 0);
    const byScore = workPriorityScore(b) - workPriorityScore(a);
    if (byScore) return byScore;
    const rank = { high: 0, urgent: 0, medium: 1, normal: 1, low: 2 };
    return (rank[a.priority as keyof typeof rank] ?? 3) - (rank[b.priority as keyof typeof rank] ?? 3);
  });
}

function isClosedTask(task: Task) {
  return closedStatuses.has(String(task.status || ""));
}

function isInsightTask(task: Task) {
  return task.source === "ai" && !task.promoted_at && !task.dismissed_at && !isClosedTask(task);
}

function isTodoTask(task: Task) {
  if (isClosedTask(task) || task.dismissed_at) return false;
  return task.source !== "ai" || Boolean(task.promoted_at);
}

function isHighValueInsight(task: Task) {
  return task.priority === "high" || task.priority === "urgent" || Boolean(task.risk) || task.status === "failed";
}

function todoBucket(task: Task): TodoBucket {
  if (task.due_at) {
    const due = new Date(task.due_at);
    if (!Number.isNaN(due.getTime())) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const day = new Date(due);
      day.setHours(0, 0, 0, 0);
      const diff = Math.round((day.getTime() - start.getTime()) / 86_400_000);
      if (diff < 0) return "overdue";
      if (diff === 0) return "today";
    }
  }
  if (task.status === "waiting" || task.status === "queued") return "waiting";
  return "later";
}

function urgencyLabel(task: Task) {
  const bucket = todoBucket(task);
  if (bucket === "overdue") return "逾期";
  if (bucket === "today") return "今天到期";
  if (task.status === "failed" || task.risk) return "有风险";
  if (task.priority === "high" || task.priority === "urgent") return "高优先";
  if (bucket === "waiting") return "等待中";
  return "待处理";
}

function dueLabel(task: Task) {
  if (!task.due_at) return "";
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return "";
  return due.toLocaleDateString("zh-CN");
}

function handleLine(task: Task) {
  const handle = String(task.kol_name || "").replace(/^@/, "").trim();
  const stage = String(task.current_stage || "").trim();
  const named = handle && handle !== "未指定红人" ? `@${handle}` : "";
  const staged = stage && stage !== "阶段未知" ? stage : "";
  if (named && staged) return `${named} · ${staged}`;
  return named || staged;
}

function parseHomeMode(value: string | null): HomeMode {
  return HOME_MODES.includes(value as HomeMode) ? value as HomeMode : "todo";
}

function deriveWorkbench(tasks: Task[], kols: FollowedKol[]): HomeWorkbench {
  const todo = sortedTasks(tasks.filter(isTodoTask), "priority");
  const insights = sortedTasks(tasks.filter(isInsightTask), "priority");
  return {
    summary: {
      open: todo.length,
      overdue: todo.filter((task) => todoBucket(task) === "overdue").length,
      due_today: todo.filter((task) => todoBucket(task) === "today").length,
      waiting: todo.filter((task) => task.status === "waiting" || task.status === "queued").length,
      insights: insights.length,
    },
    todo,
    insights,
    recommendations: [],
    lifecycle: {
      exception_count: kols.filter((kol) => kol.exception).length,
      stay_too_long: kols.filter((kol) => !kol.unbound && Number(kol.days_in_stage || 0) >= 7),
    },
  };
}

function matchesKolTab(kol: FollowedKol, tab: KolTab) {
  if (tab === "all") return true;
  if (tab === "exception") return Boolean(kol.exception);
  return String(kol.stage_code || "") === tab;
}

function withKolCard(kol: FollowedKol): FollowedKol {
  const collabSummary = kol.collab_summary || [
    kol.unbound ? "尚未进入生命周期" : "",
    kol.brand ? `${kol.brand}品牌合作` : "",
    kol.owner_name ? `负责人 ${kol.owner_name}` : "",
    kol.notes || "",
  ].filter(Boolean).join(" · ") || "暂无合作摘要";
  const currentStage = kol.current_stage || [
    kol.unbound ? "未进入生命周期" : kol.stage_label,
    !kol.unbound && kol.days_in_stage != null ? `停留 ${kol.days_in_stage} 天` : "",
    kol.exception ? "异常" : "",
  ].filter(Boolean).join(" · ");
  return {
    ...kol,
    kol_name: kol.kol_name || kol.handle,
    collab_summary: collabSummary,
    recent_followup: kol.recent_followup || kol.task_history || "暂无任务历史",
    current_stage: currentStage,
    suggested_stage: suggestedStageLabel(kol),
  };
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
        <dd data-recent-followup data-task-history>{recentFollowup || "暂无任务历史"}</dd>
      </div>
      <div className="kol-card-field">
        <dt>所处阶段</dt>
        <dd data-current-stage>{currentStage || "—"}</dd>
      </div>
      <div className="kol-card-field">
        <dt>建议进入阶段</dt>
        <dd data-suggested-stage>{suggestedStage || "—"}</dd>
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
          <dd data-kol-name>{kolName}</dd>
        </div>
      ) : null}
      <div className="kol-card-field">
        <dt>合作摘要</dt>
        <dd data-collab-summary>{collabSummary || "暂无合作摘要"}</dd>
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
  const [home, setHome] = useState<{ brand: string; h1: string; recs: Rec[] }>({
    brand: "灵工 工作",
    h1: "今天有什么工作要处理？",
    recs: [],
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
  const [tab, setTab] = useState<HomeTab>("today");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [kolTab, setKolTab] = useState<KolTab>("all");
  const [followedKols, setFollowedKols] = useState<FollowedKol[]>([]);
  const [tabSummaries, setTabSummaries] = useState<TabSummary[]>([]);
  const [boardWorkbench, setBoardWorkbench] = useState<HomeWorkbench | null>(null);
  const [followScope, setFollowScope] = useState<StarryBinding | null>(null);
  const [sort, setSort] = useState("priority");
  const initialFill = peekComposerFill();
  const [text, setText] = useState(initialFill?.starter || "");
  const [lockedIntent, setLockedIntent] = useState<string | null>(initialFill?.skill_id || null);
  const [lockedLabel, setLockedLabel] = useState<string | null>(initialFill?.title || null);
  const [lockedKnowledgeId, setLockedKnowledgeId] = useState<string | null>(initialFill?.id || null);
  const [params, setParams] = useSearchParams();
  const [draftFocus, setDraftFocus] = useState(initialFill ? 1 : 0);
  const [blockSubmit, setBlockSubmit] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FromTextResult | null>(null);
  const lastComposer = useRef<ComposerSubmit | null>(null);
  const missingAlertRef = useRef<HTMLElement | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(Boolean(initialFill));
  const [stageScrolled, setStageScrolled] = useState(false);
  const nav = useNavigate();
  const mode = parseHomeMode(params.get("tab"));

  const setMode = (next: HomeMode) => {
    const nextParams = new URLSearchParams(params);
    if (next === "todo") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  const applyBoard = (board: Awaited<ReturnType<typeof api.homeBoard>>) => {
    if (Array.isArray(board.kols)) setFollowedKols((board.kols as FollowedKol[]).map(withKolCard));
    if (Array.isArray(board.tasks)) setTasks(board.tasks as Task[]);
    if (Array.isArray(board.tabs)) setTabSummaries(board.tabs as TabSummary[]);
    setBoardWorkbench(board.workbench || null);
    setFollowScope(board.follow_scope || null);
  };

  useEffect(() => {
    let cancelled = false;
    void api.home().then((legacyHome) => {
      if (cancelled) return;
      setHome(legacyHome);
      if (!definitions.length && legacyHome.recs?.length) {
        setDefinitions(legacyHome.recs.map((rec: Rec) => ({
          ...rec,
          description: rec.description || rec.profile,
        })));
      }
    }).catch(() => undefined);
    void api.taskDefinitions().then(definitionList).then((taskDefinitions) => {
      if (!cancelled && taskDefinitions.length) setDefinitions(taskDefinitions);
    }).catch(() => undefined);
    void api.homeBoard().then((board) => {
      if (!cancelled) applyBoard(board);
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
    if (stashed?.starter) {
      setText(stashed.starter);
      setLockedIntent(stashed.skill_id || null);
      setLockedLabel(stashed.title);
      setLockedKnowledgeId(stashed.id);
      setComposerFocused(true);
      setDraftFocus((value) => (value === 0 ? 1 : value));
    }
    void api.knowledgeItem(kid).then((row) => {
      if (row.status && row.status !== "published") return;
      setText(composerStarter(row));
      setLockedIntent(row.skill_id || row.intent || null);
      setLockedLabel(row.title);
      setLockedKnowledgeId(row.id);
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
      knowledge_id: pending.knowledge_id ? String(pending.knowledge_id) : undefined,
      collaboration_id: pending.collaboration_id ? String(pending.collaboration_id) : undefined,
      attachments: Array.isArray(pending.attachments) ? pending.attachments as ComposerSubmit["attachments"] : undefined,
      model_tier: pending.model_tier ? String(pending.model_tier) : undefined,
      work_item_id: String(pending.work_item_id || result.work_item_id || result.task.id),
      task_type: String(pending.task_type || result.task.task_type || result.task.skill || ""),
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
      setTasks((current) => current.some((task) => task.id === created.id) ? current : [created, ...current]);
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
    setLockedKnowledgeId(null);
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
    setLockedKnowledgeId(null);
    setPanelOpen(false);
    setComposerFocused(true);
    setDraftFocus((value) => value + 1);
    setBlockSubmit(true);
    window.setTimeout(() => setBlockSubmit(false), 500);
    rememberJourney({ kind: "skill", skillId: intent || undefined, skillLabel: rec.title, handle: rec.handle });
  };

  const openKol = (kol: FollowedKol) => {
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
      sessionStorage.setItem(`kol-session:${session.id}`, "1");
      nav(`/s/${session.id}`, { state: { kolSession: true } });
    }).catch(() => {
      nav(`/pipeline?kol=${encodeURIComponent(kol.handle)}`);
    });
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

  const refreshBoard = (force = false) => api.homeBoard({ refresh: force }).then(applyBoard).catch(() => undefined);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshBoard(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const promoteInsight = async (task: Task) => {
    setBusy(true);
    setErr("");
    try {
      await api.promoteTask(task.id);
      await refreshBoard();
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
      await refreshBoard();
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
    const knowledgeId = lockedKnowledgeId || p.knowledge_id;
    lastComposer.current = { ...p, text: prompt, knowledge_id: knowledgeId };
    setBusy(true);
    setErr("");
    setFeedback(null);
    rememberJourney({ kind: "compose", skillId: intent || undefined, skillLabel: lockedLabel || undefined });
    try {
      const ses = await api.createSession(prompt.slice(0, 40) || "新任务", p.collaboration_id);
      storePending(ses.id, {
        text: prompt,
        knowledge_id: knowledgeId,
        attachments: p.attachments,
        model_tier: p.model_tier,
        collaboration_id: p.collaboration_id,
      });
      setLockedIntent(null);
      setLockedLabel(null);
      setLockedKnowledgeId(null);
      nav(`/s/${ses.id}`);
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
    () => boardWorkbench || deriveWorkbench(tasks, followedKols),
    [boardWorkbench, followedKols, tasks],
  );

  const todoItems = useMemo(
    () => sortedTasks(workbench.todo || tasks.filter(isTodoTask), "priority"),
    [tasks, workbench.todo],
  );

  const insightItems = useMemo(
    () => sortedTasks(workbench.insights || tasks.filter(isInsightTask), "priority"),
    [tasks, workbench.insights],
  );

  const recommendedItems = useMemo(
    () => withRecommendedDisplay(workbench.recommendations || [], definitions),
    [definitions, workbench.recommendations],
  );

  const visibleKols = useMemo(
    () => followedKols.filter((kol) => matchesKolTab(kol, kolTab)),
    [followedKols, kolTab],
  );

  const kolCounts = useMemo(() => {
    const counts: Record<string, number> = { all: followedKols.length, exception: 0 };
    for (const tabSpec of FOLLOWED_KOL_TABS) {
      if (tabSpec.code !== "all") counts[tabSpec.code] = 0;
    }
    for (const kol of followedKols) {
      if (kol.exception) counts.exception += 1;
      else if (kol.stage_code) counts[kol.stage_code] = (counts[kol.stage_code] || 0) + 1;
    }
    return counts;
  }, [followedKols]);

  const taskCounts = {
    all: tasks.length,
    open: tasks.filter((task) => openStatuses.has(String(task.status || "pending"))).length,
    high: tasks.filter((task) => task.priority === "high" || task.priority === "urgent").length,
    ai: tasks.filter((task) => task.source === "ai").length,
  };

  const summary = workbench.summary || {};
  const openCount = summary.open ?? todoItems.length;
  const overdueCount = summary.overdue ?? todoItems.filter((task) => todoBucket(task) === "overdue").length;
  const dueTodayCount = summary.due_today ?? todoItems.filter((task) => todoBucket(task) === "today").length;
  const waitingCount = summary.waiting ?? todoItems.filter((task) => task.status === "waiting" || task.status === "queued").length;
  const insightCount = summary.insights ?? insightItems.length;
  const highValueCount = insightItems.filter(isHighValueInsight).length;

  const statsText = `${openCount}项待处理 · ${overdueCount}逾期 · ${dueTodayCount}今天到期`;

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
    >
      <div className="home-stage">
        <div className="home-hero">
          <BrandLockup variant="home" />
          <h1>{home.h1}</h1>
          <p className="home-stats" data-today-summary data-home-stats>
            {statsText}
            {waitingCount ? ` · ${waitingCount}等待中` : ""}
          </p>

          <div className="home-mode-tabs" role="tablist" aria-label="工作台视图" data-home-modes>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "todo"}
              data-home-mode="todo"
              onClick={() => setMode("todo")}
            >
              我的待办 {openCount}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "ai"}
              data-home-mode="ai"
              onClick={() => setMode("ai")}
            >
              AI发现 {insightCount}
              {highValueCount ? <span className="home-mode-dot" data-insight-mark aria-label="有高价值发现" /> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "lifecycle"}
              data-home-mode="lifecycle"
              onClick={() => setMode("lifecycle")}
            >
              生命周期
            </button>
            <button type="button" className="home-templates-link" data-open-work-panel onClick={() => openPanel("templates")}>
              任务模板
            </button>
          </div>
        </div>

        <div
          className="home-board"
          onScroll={(event) => setStageScrolled(event.currentTarget.scrollTop > 40)}
        >
          {mode === "todo" ? (
            <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo">
              <RecommendedTaskList items={recommendedItems} busy={busy} onPick={onRecommend} />
              <TodoActionList tasks={todoItems} onOpen={(task) => void openTask(task)} />
            </section>
          ) : null}

          {mode === "ai" ? (
            <section className="home-mode-pane" data-home-pane="ai" data-ai-insights>
              <InsightList
                tasks={insightItems}
                busy={busy}
                onPromote={(task) => void promoteInsight(task)}
                onDismiss={(task) => void dismissInsight(task)}
                onOpen={(task) => void openTask(task)}
              />
            </section>
          ) : null}

          {mode === "lifecycle" ? (
            <section className="home-mode-pane recommend-work" data-home-pane="lifecycle" data-lifecycle-overview>
              <div className="home-pane-sticky">
              <div className="kol-stage-tabs" role="tablist" aria-label="跟进红人状态" data-kol-tabs>
                {FOLLOWED_KOL_TABS.map((tabSpec) => {
                  const summaryRow = tabSummaries.find((item) => item.code === tabSpec.code);
                  const count = summaryRow?.count ?? kolCounts[tabSpec.code] ?? 0;
                  return (
                    <button
                      key={tabSpec.code}
                      type="button"
                      role="tab"
                      aria-selected={kolTab === tabSpec.code}
                      title={tabSpec.label}
                      onClick={() => setKolTab(tabSpec.code)}
                      data-kol-tab={tabSpec.code}
                    >
                      <span className="kol-tab-name">{tabSpec.short} {count}</span>
                    </button>
                  );
                })}
              </div>
              <h2>
                {kolTab === "all"
                  ? "我跟进的红人"
                  : kolTab === "exception"
                    ? "异常 KOL"
                    : (FOLLOWED_KOL_TABS.find((item) => item.code === kolTab)?.label || "这一阶段")}
                {followedKols.some((kol) => Number(kol.unread_count || 0) > 0) ? (
                  <span className="unread-total" data-unread-total>
                    未读 {followedKols.reduce((sum, kol) => sum + Number(kol.unread_count || 0), 0)}
                  </span>
                ) : null}
                <button type="button" className="btn ghost sm" data-refresh-mail onClick={() => void refreshBoard(true)}>
                  刷新收取
                </button>
              </h2>
              </div>
              {visibleKols.length ? (
                <ol className="recommend-list">
                  {visibleKols.map((kol) => (
                    <li
                      key={kol.id}
                      className={"recommend-row followed-kol" + (kol.exception ? " is-exception" : "") + (kol.unbound ? " is-unbound" : "")}
                      data-followed-kol={kol.handle}
                    >
                      <span className="task-source-mark" aria-hidden>{kol.exception ? "!" : kol.unbound ? "◎" : "○"}</span>
                      <button
                        type="button"
                        className="task-main"
                        onClick={() => openKol(kol)}
                      >
                        <strong>@{kol.handle}</strong>
                        {Number(kol.unread_count || 0) > 0 ? (
                          <span className="unread-badge" data-unread-count={kol.unread_count}>未读 {kol.unread_count}</span>
                        ) : null}
                        {kol.follow_style_tags?.length ? (
                          <span className="follow-style-tags" data-follow-style-tags>
                            {kol.follow_style_tags.map((tag) => (
                              <span key={tag.id + tag.label} className="follow-style-tag" data-follow-style-tag={tag.id}>{tag.label}</span>
                            ))}
                          </span>
                        ) : null}
                        {kol.profile_tags?.length ? (
                          <span className="profile-tags" data-profile-tags>
                            {kol.profile_tags.map((tag) => (
                              <span key={tag.id + tag.label} className="profile-tag" data-profile-tag={tag.id}>{tag.label}</span>
                            ))}
                          </span>
                        ) : null}
                        <CardFields
                          compact
                          kolName={kol.kol_name || kol.handle}
                          collabSummary={kol.collab_summary}
                          recentFollowup={kol.recent_followup}
                          currentStage={kol.current_stage}
                          suggestedStage={kol.suggested_stage}
                        />
                        {kol.mail_threads?.length ? (
                          <ul className="kol-mail-threads" data-mail-threads>
                            {kol.mail_threads.map((thread) => (
                              <li key={`${thread.conversation_id}:${thread.subject}`} data-thread-id={thread.conversation_id} data-thread-direction={thread.last_direction || ""}>
                                <span className="thread-subject">{thread.subject}</span>
                                <span className="muted">{thread.last_direction === "outbound" ? "去信" : thread.last_direction === "inbound" ? "来信" : "往来"}</span>
                                {Number(thread.unread_count || 0) > 0 ? <span>未读 {thread.unread_count}</span> : null}
                                {thread.last_from_name || thread.last_from ? (
                                  <span data-thread-from>{[thread.last_from_name, thread.last_from].filter(Boolean).join(" · ")}</span>
                                ) : null}
                                {thread.last_at ? <span data-thread-time>{new Date(thread.last_at).toLocaleString("zh-CN", { hour12: false })}</span> : null}
                                {thread.last_snippet ? <span className="thread-snippet">{thread.last_snippet}</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </button>
                      <span className="recommend-go" aria-hidden>{kol.unbound ? "补画像 →" : "打开会话 →"}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="task-empty" data-follow-empty={followScope?.required && !followScope.bound ? "unbound" : followScope?.status === "expired" ? "expired" : "none"}>
                  <strong>
                    {followScope?.required && !followScope.bound
                      ? "尚未绑定跟进邮箱"
                      : followScope?.status === "expired"
                        ? "Starry 连接已过期"
                        : followedKols.length ? "这一状态还没有跟进中的红人" : followScope?.bound ? "该邮箱下暂无跟进红人" : "还没有跟进中的红人"}
                  </strong>
                  <p>
                    {followScope?.required && !followScope.bound
                      ? "绑定 Starry 发件箱后，这里只显示该邮箱负责人跟进的红人及生命周期。"
                      : followScope?.status === "expired"
                        ? "重新连接后即可继续查看你跟进的红人。"
                        : followScope?.bound
                          ? `当前绑定 ${followScope.mailbox_email || "已选邮箱"}${followScope.owner_name ? ` · ${followScope.owner_name}` : ""}。`
                          : "正式阶段共 15 个，异常状态单独一栏。完整资产在左侧「生命周期」。"}
                  </p>
                  {followScope?.required && (!followScope.bound || followScope.status === "expired") ? (
                    <button type="button" className="btn work" onClick={() => nav("/settings?tab=starry")}>
                      {followScope.status === "expired" ? "重新连接" : "去绑定"}
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {err && <p className="error composer-err" role="alert">{err}</p>}
          {busy && !feedback && !err ? (
            <section className="creation-feedback" data-kind="recognizing" data-creation-feedback role="status" aria-busy="true">
              <strong>正在理解任务…</strong>
              <p>正在识别任务方向和已填写的字段，不会改你已经写出的发件、收件和主题。</p>
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

      <div className="home-composer-dock">
        <ComposerDock
          variant="workspace"
          value={text}
          onChange={setText}
          onSubmit={onComposer}
          disabled={busy || blockSubmit}
          onFocusChange={setComposerFocused}
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
          autoFocus={draftFocus > 0}
          autoFocusToken={draftFocus}
          selectFirstPlaceholder={draftFocus > 0}
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
                    {([["all", "全部"], ["open", "待处理"], ["high", "高优先级"], ["ai", "✦ AI发现"]] as const).map(([value, label]) => (
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
    </div>
  );
}

function RecommendedTaskList({
  items,
  busy,
  onPick,
}: {
  items: RecommendedTask[];
  busy: boolean;
  onPick: (item: RecommendedTask) => void;
}) {
  return (
    <section className="recommended-tasks process-md" data-recommended-tasks aria-label="今天推荐">
      <Markdown>{"**今天推荐**"}</Markdown>
      <ol className="recommend-md-list">
        {items.map((item) => {
          const n = item.n || 0;
          const icon = item.icon || recIcon(item.intent);
          const source = item.source_label || (item.source === "ai" ? "AI发现" : item.source === "catalog" ? "任务模板" : "按阶段");
          return (
            <li key={item.id}>
              <button
                type="button"
                className="recommend-md-item"
                data-recommended-task={item.id}
                data-task-n={n}
                data-recommended-source={item.source || "stage"}
                data-act="ask"
                data-intent={item.intent || ""}
                data-prompt={item.prompt || item.title}
                aria-label={`推荐 ${n}`}
                disabled={busy}
                onClick={() => onPick(item)}
              >
                <span className="recommend-md-n" data-task-n-label>{n}.</span>
                <span className="recommend-md-icon" aria-hidden>{icon}</span>
                <span className="recommend-md-copy">
                  <strong>{item.title}</strong>
                  <span className="recommend-md-reason" data-recommended-reason>
                    {item.reason} · {source}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function todoMark(task: Task) {
  const bucket = todoBucket(task);
  if (bucket === "overdue") return "!";
  if (bucket === "today") return "⚠";
  if (bucket === "waiting") return "…";
  return "○";
}

function TodoActionList({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const grouped: Record<TodoBucket, Task[]> = { overdue: [], today: [], waiting: [], later: [] };
  for (const task of tasks) grouped[todoBucket(task)].push(task);
  if (!tasks.length) {
    return (
      <div className="todo-md-empty">
        <Markdown>{"AI 发现不会自动变成待办。确认后才会出现在这里。"}</Markdown>
      </div>
    );
  }
  return (
    <section className="todo-md process-md" data-todo-md>
      <Markdown>{"**我的待办**"}</Markdown>
      {([["overdue", "逾期"], ["today", "今天到期"], ["waiting", "等待中"], ["later", "后续"]] as const).map(([bucket, label]) => (
        grouped[bucket].length ? (
          <div className="work-day-group" key={bucket} data-todo-bucket={bucket}>
            <Markdown>{`*${label}*`}</Markdown>
            <ol className="recommend-md-list">
              {grouped[bucket].map((task) => (
                <TodoMarkdownRow key={task.id} task={task} onOpen={() => onOpen(task)} />
              ))}
            </ol>
          </div>
        ) : null
      ))}
    </section>
  );
}

function TodoMarkdownRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const handle = handleLine(task);
  const due = dueLabel(task);
  return (
    <li
      className={`task-${task.source || "manual"} status-${task.status || "pending"}`}
      data-todo-card
      data-task-source={task.source || "manual"}
      data-task-status={task.status || "pending"}
    >
      <button type="button" className="recommend-md-item" data-todo-act onClick={onOpen}>
        <span className="recommend-md-n" aria-hidden>{todoMark(task)}</span>
        <span className="recommend-md-icon" aria-hidden>○</span>
        <span className="recommend-md-copy">
          <strong>{task.title}</strong>
          <span className="recommend-md-reason" data-todo-reason>
            {[handle, urgencyLabel(task), due, whyLine(task)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}

function InsightList({
  tasks,
  busy,
  onPromote,
  onDismiss,
  onOpen,
}: {
  tasks: Task[];
  busy: boolean;
  onPromote: (task: Task) => void;
  onDismiss: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  if (!tasks.length) {
    return (
      <div className="task-empty">
        <strong>暂时没有新的发现</strong>
        <p>系统注意到的信号会先停在这里，确认后才进入我的待办。</p>
      </div>
    );
  }
  return (
    <ol className="insight-card-list">
      {tasks.map((task) => (
        <li
          key={task.id}
          className={"insight-card" + (isHighValueInsight(task) ? " is-high" : "")}
          data-insight-card
          data-task-source="ai"
        >
          <div className="insight-card-body">
            <div className="todo-card-head">
              <strong>{task.title}</strong>
              <span className="todo-urgency">AI发现</span>
              {isHighValueInsight(task) ? <span className="insight-high">高价值</span> : null}
            </div>
            {handleLine(task) ? <p className="todo-handle">{handleLine(task)}</p> : null}
            <p className="todo-reason">{whyLine(task)}</p>
          </div>
          <div className="insight-actions">
            <button type="button" data-promote-task={task.id} disabled={busy} onClick={() => onPromote(task)}>
              转为我的待办
            </button>
            <button type="button" className="is-ghost" data-open-insight={task.id} disabled={busy} onClick={() => onOpen(task)}>
              查看沟通记录
            </button>
            <button type="button" className="is-ghost" data-dismiss-insight={task.id} disabled={busy} onClick={() => onDismiss(task)}>
              忽略
            </button>
          </div>
        </li>
      ))}
    </ol>
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
    <li className={`today-task task-${task.source || "manual"} status-${task.status || "pending"}`} data-task-source={task.source || "manual"} data-task-status={task.status || "pending"}>
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
        {task.risk && <span className="task-risk">! {task.risk}</span>}
      </button>
      <span className="task-tail">
        <span>{statusLabel(task.status)}</span>
        {task.due_at && <time>{new Date(task.due_at).toLocaleDateString("zh-CN")}</time>}
        {task.progress != null && <span>{Math.round(Number(task.progress) <= 1 ? Number(task.progress) * 100 : Number(task.progress))}%</span>}
      </span>
    </li>
  );
}
