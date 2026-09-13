import { api, type AgentViewEntry, type RecommendedTask, type SessionRow, type Task, type TaskRunResult } from "./api";
import { storePending } from "./components/ChatBlocks";
import { recIcon } from "./recommendedTasks";
import { starterPrompt } from "./taskStarters";

export const MAX_AGENT_NEXT_STEPS = 6;
const RECENT_KEY = "lingong:recent-agents";

export type AgentPageTab = "work" | "teams" | "spec";

export type AgentKolLike = {
  id?: string;
  handle: string;
  stage_label?: string;
  stage_code?: string;
  exception?: boolean;
  unbound?: boolean;
  days_in_stage?: number;
  unread_count?: number;
  notes?: string;
};

export type AgentNextStep = {
  id: string;
  title: string;
  reason: string;
  cta: string;
  source: "board" | "kol" | "task" | "catalog";
  sourceLabel: string;
  intent?: string;
  prompt: string;
  handle?: string;
  collaborationId?: string;
  sessionId?: string;
  icon?: string;
};

export type RecentAgent = {
  id: string;
  title: string;
  intent?: string;
  prompt: string;
  handle?: string;
  at: number;
};

const CLOSED = new Set(["completed", "done", "cancelled"]);

export function parseAgentTab(value: string | null): AgentPageTab {
  if (value === "teams" || value === "spec") return value;
  return "work";
}

export function kolPrompt(intent: string, handle?: string): string {
  const raw = handle ? handle.replace(/^@/, "").trim() : "";
  if (intent === "email_compose") {
    return raw
      ? `写合作邮件 发件箱 [发件邮箱] 发给 @${raw} 主题：[主题]`
      : starterPrompt({ id: "email_compose", title: "写合作邮件" });
  }
  if (intent === "reply_analysis") return raw ? `回复分析 @${raw}` : starterPrompt({ id: "reply_analysis", title: "回复分析" });
  if (intent === "creator_profile") return raw ? `达人画像 ${raw}` : starterPrompt({ id: "creator_profile", title: "达人画像" });
  if (intent === "risk_scan") return raw ? `超时/风险扫描 @${raw}` : starterPrompt({ id: "risk_scan", title: "超时/风险扫描" });
  if (intent === "confirm_stage") return raw ? `提出阶段变更 ${raw} 到 [目标阶段]` : starterPrompt({ id: "confirm_stage", title: "记状态" });
  const base = starterPrompt({ id: intent, title: intent });
  return raw ? `${base} @${raw}` : base;
}

function kolAttentionScore(kol: AgentKolLike): number {
  let score = 0;
  if (kol.exception) score += 100;
  if (kol.unbound) score += 70;
  score += Math.min(40, Number(kol.unread_count || 0) * 8);
  const days = Number(kol.days_in_stage || 0);
  if (days >= 14) score += 50;
  else if (days >= 7) score += 30;
  return score;
}

function stepFromKol(kol: AgentKolLike): AgentNextStep {
  const handle = kol.handle.replace(/^@/, "");
  const collab = kol.id || undefined;
  if (kol.exception) {
    return {
      id: `kol-exception-${handle}`,
      title: `处理 @${handle} 的异常`,
      reason: [kol.stage_label || "异常", kol.notes].filter(Boolean).join(" · ") || "需要人确认后再回主时间线",
      cta: "开始风险扫描",
      source: "kol",
      sourceLabel: "跟进中的红人",
      intent: "risk_scan",
      prompt: kolPrompt("risk_scan", handle),
      handle,
      collaborationId: collab,
      icon: recIcon("risk_scan"),
    };
  }
  if (kol.unbound) {
    return {
      id: `kol-unbound-${handle}`,
      title: `给 @${handle} 补画像`,
      reason: "尚未进入生命周期，先补齐画像再写邮件",
      cta: "开始画像",
      source: "kol",
      sourceLabel: "跟进中的红人",
      intent: "creator_profile",
      prompt: kolPrompt("creator_profile", handle),
      handle,
      collaborationId: collab,
      icon: recIcon("creator_profile"),
    };
  }
  if (Number(kol.unread_count || 0) > 0) {
    return {
      id: `kol-unread-${handle}`,
      title: `看 @${handle} 的未读来信`,
      reason: `${kol.unread_count} 封未读${kol.stage_label ? ` · ${kol.stage_label}` : ""}`,
      cta: "分析回复",
      source: "kol",
      sourceLabel: "跟进中的红人",
      intent: "reply_analysis",
      prompt: kolPrompt("reply_analysis", handle),
      handle,
      collaborationId: collab,
      icon: recIcon("reply_analysis"),
    };
  }
  if (Number(kol.days_in_stage || 0) >= 7) {
    return {
      id: `kol-stuck-${handle}`,
      title: `跟进卡住的 @${handle}`,
      reason: `${kol.stage_label || "当前阶段"}已停留 ${kol.days_in_stage} 天`,
      cta: "写跟进邮件",
      source: "kol",
      sourceLabel: "跟进中的红人",
      intent: "email_compose",
      prompt: kolPrompt("email_compose", handle),
      handle,
      collaborationId: collab,
      icon: recIcon("email_compose"),
    };
  }
  return {
    id: `kol-follow-${handle}`,
    title: `继续跟进 @${handle}`,
    reason: kol.stage_label || "从跟进中的红人接着做",
    cta: "写合作邮件",
    source: "kol",
    sourceLabel: "跟进中的红人",
    intent: "email_compose",
    prompt: kolPrompt("email_compose", handle),
    handle,
    collaborationId: collab,
    icon: recIcon("email_compose"),
  };
}

function stepFromTask(task: Task): AgentNextStep {
  const extra = task as Task & { task_type?: string; prompt?: string };
  const intent = String(task.skill_id || task.skill || extra.task_type || "");
  const handle = String(task.kol_name || "").replace(/^@/, "").trim();
  const reason = [task.risk || task.next_action, task.current_stage, handle && `@${handle}`]
    .filter(Boolean)
    .join(" · ") || (task.source === "ai" ? "AI 发现" : "待处理任务");
  return {
    id: `task-${task.id}`,
    title: task.title,
    reason,
    cta: task.session_id ? "回到会话" : "接着做",
    source: "task",
    sourceLabel: "待办",
    intent: intent || undefined,
    prompt: String(extra.prompt || task.title),
    handle: handle || undefined,
    collaborationId: task.collaboration_id ? String(task.collaboration_id) : undefined,
    sessionId: task.session_id,
    icon: recIcon(intent),
  };
}

function ctaForIntent(intent?: string): string {
  if (intent === "email_compose") return "写邮件";
  if (intent === "creator_profile") return "补画像";
  if (intent === "reply_analysis") return "分析回复";
  if (intent === "risk_scan") return "风险扫描";
  if (intent === "confirm_stage") return "记状态";
  return "开始";
}

function stepFromBoard(rec: RecommendedTask): AgentNextStep {
  return {
    id: rec.id,
    title: rec.title,
    reason: rec.reason,
    cta: ctaForIntent(rec.intent),
    source: rec.source === "catalog" ? "catalog" : "board",
    sourceLabel: rec.source_label || (rec.source === "ai" ? "AI 发现" : rec.source === "catalog" ? "任务模板" : "今天推荐"),
    intent: rec.intent,
    prompt: String(rec.prompt || rec.title),
    handle: rec.handle,
    collaborationId: rec.collaboration_id || undefined,
    icon: rec.icon || recIcon(rec.intent),
  };
}

function stepFromEntry(entry: AgentViewEntry): AgentNextStep {
  return {
    id: `entry-${entry.id}`,
    title: entry.title,
    reason: entry.summary,
    cta: ctaForIntent(entry.skillId),
    source: "catalog",
    sourceLabel: "工作入口",
    intent: entry.skillId,
    prompt: entry.prompt || starterPrompt({ id: entry.skillId, title: entry.title }),
    icon: recIcon(entry.skillId),
  };
}

function pushUnique(steps: AgentNextStep[], next: AgentNextStep) {
  if (steps.some((row) => row.id === next.id || (row.title === next.title && row.prompt === next.prompt))) return;
  steps.push(next);
}

export function buildAgentNextSteps(input: {
  recommendations?: RecommendedTask[];
  kols?: AgentKolLike[];
  tasks?: Task[];
  entries?: AgentViewEntry[];
}): AgentNextStep[] {
  const catalog: AgentNextStep[] = [];
  for (const entry of input.entries || []) {
    pushUnique(catalog, stepFromEntry(entry));
    if (catalog.length >= MAX_AGENT_NEXT_STEPS) return catalog;
  }
  // Catalog entries are the /agents work-surface default. Home board
  // recommendations / kols / tasks used to land first and replace this list
  // after GET /api/home/board resolved — do not mix them back in.
  if (catalog.length > 0) return catalog;

  const steps: AgentNextStep[] = [];
  const recommendations = input.recommendations || [];
  const kols = [...(input.kols || [])].sort((a, b) => kolAttentionScore(b) - kolAttentionScore(a));
  const tasks = (input.tasks || []).filter((task) => !CLOSED.has(String(task.status || "")) && !task.dismissed_at);

  for (const rec of recommendations.filter((row) => row.source !== "catalog")) {
    pushUnique(steps, stepFromBoard(rec));
    if (steps.length >= MAX_AGENT_NEXT_STEPS) return steps;
  }

  for (const kol of kols) {
    if (kolAttentionScore(kol) <= 0 && steps.length >= 3) continue;
    pushUnique(steps, stepFromKol(kol));
    if (steps.length >= MAX_AGENT_NEXT_STEPS) return steps;
  }

  for (const task of tasks.slice(0, 4)) {
    pushUnique(steps, stepFromTask(task));
    if (steps.length >= MAX_AGENT_NEXT_STEPS) return steps;
  }

  if (steps.length < 3) {
    for (const rec of recommendations.filter((row) => row.source === "catalog")) {
      pushUnique(steps, stepFromBoard(rec));
      if (steps.length >= 3) break;
    }
  }

  return steps.slice(0, MAX_AGENT_NEXT_STEPS);
}

export function asTaskList(value: Task[] | { tasks?: Task[] } | unknown): Task[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { tasks?: Task[] }).tasks)) {
    return (value as { tasks: Task[] }).tasks;
  }
  return [];
}

/** FE-only: GET /api/sessions.agent_status is enough for 运行中 / 最近在用. */
export function runningSessions(sessions: SessionRow[]): SessionRow[] {
  return sessions.filter((row) => row.agent_status === "running" || row.agent_status === "waiting_approval");
}

export function failedTaskReason(task: Task): string {
  const last = Array.isArray(task.history) && task.history.length
    ? task.history[task.history.length - 1]
    : undefined;
  return String(
    task.history_summary
    || last?.summary
    || last?.message
    || task.risk
    || task.next_action
    || "执行失败",
  );
}

/**
 * Retry a failed work item with the existing POST /api/tasks/:id/run.
 * TODO(backend): list payloads have no last_error; crash-durable running
 * (stale agent_status=running after host death) and a dedicated retry-last-turn
 * API are also missing. Do not invent those here.
 */
export async function retryFailedTask(task: Task): Promise<{ id: string; kolSession?: boolean }> {
  const result: TaskRunResult = await api.runTask(task.id);
  sessionStorage.setItem(`task:${result.session_id}`, result.task.id);
  const pending = (result.pending_message || result.pending || {}) as Record<string, unknown>;
  storePending(result.session_id, {
    text: String(pending.text || result.task.title || task.title),
    intent: String(pending.intent || pending.task_type || result.task.skill || task.skill || ""),
    collaboration_id: pending.collaboration_id
      ? String(pending.collaboration_id)
      : (task.collaboration_id ? String(task.collaboration_id) : undefined),
    work_item_id: String(pending.work_item_id || result.work_item_id || result.task.id),
    task_type: String(pending.task_type || result.task.skill || task.skill || ""),
    run_id: pending.run_id || result.run_id ? String(pending.run_id || result.run_id || "") : undefined,
  });
  return { id: result.session_id, kolSession: Boolean(task.collaboration_id || task.project_id) };
}

export function recentIdleSessions(sessions: SessionRow[], runningIds: Set<string>, limit = 6): SessionRow[] {
  return sessions.filter((row) => !runningIds.has(row.id)).slice(0, limit);
}

export function sessionStatusLabel(status?: SessionRow["agent_status"]): string {
  if (status === "running") return "运行中";
  if (status === "waiting_approval") return "等我确认";
  return "可继续";
}

export function readRecentAgents(): RecentAgent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentAgent[];
    return Array.isArray(parsed) ? parsed.filter((row) => row?.id && row.title).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberRecentAgent(row: Omit<RecentAgent, "at">) {
  const next: RecentAgent = { ...row, at: Date.now() };
  const rest = readRecentAgents().filter((item) => item.id !== next.id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([next, ...rest].slice(0, 6)));
  } catch {
    /* ignore quota */
  }
}

export async function startAgentWork(step: AgentNextStep): Promise<{ id: string; kolSession?: boolean }> {
  rememberRecentAgent({
    id: step.id,
    title: step.title,
    intent: step.intent,
    prompt: step.prompt,
    handle: step.handle,
  });

  if (step.sessionId) {
    return { id: step.sessionId, kolSession: Boolean(step.collaborationId) };
  }

  if (step.collaborationId) {
    try {
      const ses = await api.openKolSession(step.collaborationId);
      storePending(ses.id, {
        text: step.prompt,
        intent: step.intent,
        collaboration_id: step.collaborationId,
      });
      return { id: ses.id, kolSession: true };
    } catch {
      /* fall through to a new session bound to the same collaboration */
    }
  }

  const ses = await api.createSession(step.prompt.slice(0, 24), step.collaborationId);
  storePending(ses.id, {
    text: step.prompt,
    intent: step.intent,
    collaboration_id: step.collaborationId,
  });
  return { id: ses.id, kolSession: Boolean(step.collaborationId) };
}
