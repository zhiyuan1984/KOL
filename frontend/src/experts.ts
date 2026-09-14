import { api } from "./api";

export type ExpertTask = {
  id: string;
  title: string;
  prompt: string;
};

export type Expert = {
  id: string;
  name: string;
  mission: string;
  who: string;
  good_at: string[];
  can_finish: string[];
  how_to_start: string;
  working_style: string;
  quick_prompts: string[];
  recommended_tasks: ExpertTask[];
  intro_message: string;
  recommended?: boolean;
  // TODO: organization_scope / available_agents when ExpertManifest ships
};

export type ExpertSummonResult = {
  session_id: string;
  expert_id: string;
  intro_message: string;
  recommended_tasks: ExpertTask[];
  bound?: boolean;
};

export type ExpertView = "recommend" | "mine" | "all" | "search";

export type BoundExpertSession = {
  expert_id: string;
  name: string;
  mission: string;
  intro_message: string;
  recommended_tasks: ExpertTask[];
};

export const KOL_EXPERT_ID = "expert:kol";
const PIN_KEY = "lingong:expert-pins";
const RECENT_KEY = "lingong:expert-recent";
const BIND_PREFIX = "expert-session:";

export const KOL_EXPERT: Expert = {
  id: KOL_EXPERT_ID,
  name: "KOL 合作专员",
  who: "KOL 合作专员",
  mission: "帮你把海外达人合作从发现做到跟进，只交出可改的结果，不替你发信或改阶段。",
  good_at: ["海外达人建联", "合作邮件草稿", "回复分析", "阶段变更提案"],
  can_finish: ["可改的合作邮件草稿", "回复要点与缺口", "待你确认的阶段变更提案"],
  how_to_start: "召唤后在会话里用一句话交代这一件。发送和改阶段仍要你确认。",
  working_style: "先问清品牌、红人和目标，再给出草稿或提案。发信与正式阶段写入必须另走确认。",
  quick_prompts: [
    "给 @小美妆日记 写一封合作询价邮件",
    "看这条回复里对方有没有接受报价",
    "提出把 @小美妆日记 推进到样品寄出",
  ],
  recommended_tasks: [
    { id: "compose", title: "写合作邮件", prompt: "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]" },
    { id: "reply", title: "分析回复", prompt: "回复分析 [会话或红人]" },
    { id: "stage", title: "提出阶段变更", prompt: "提出阶段变更 [红人] 到 [目标阶段]" },
  ],
  intro_message: "我是 KOL 合作专员。告诉我品牌、红人和这一件要完成的事，我先给出可改的草稿或提案。召唤我不会发信，也不会改阶段。",
  recommended: true,
};

const MOCK_CATALOG = [KOL_EXPERT];

export function canonicalExpertId(raw: string): string {
  const decoded = decodeURIComponent(String(raw || "").trim());
  if (!decoded) return "";
  return decoded.startsWith("expert:") ? decoded : `expert:${decoded}`;
}

export function expertSlug(id: string): string {
  return canonicalExpertId(id).replace(/^expert:/, "");
}

export function expertDetailPath(id: string): string {
  return `/agents/${encodeURIComponent(expertSlug(id))}`;
}

export function parseExpertView(value: string | null): ExpertView {
  if (value === "mine" || value === "all" || value === "search") return value;
  return "recommend";
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { status?: number }).status === 404);
}

function normalizeExpert(row: Partial<Expert> | null | undefined): Expert | null {
  if (!row || typeof row !== "object") return null;
  const id = canonicalExpertId(String(row.id || ""));
  if (!id) return null;
  const fallback = id === KOL_EXPERT_ID ? KOL_EXPERT : null;
  const name = String(row.name || fallback?.name || "").trim();
  if (!name) return null;
  const tasks = Array.isArray(row.recommended_tasks)
    ? row.recommended_tasks
      .map((task) => ({
        id: String(task.id || ""),
        title: String(task.title || ""),
        prompt: String(task.prompt || task.title || ""),
      }))
      .filter((task) => task.id && task.title)
    : fallback?.recommended_tasks || [];
  return {
    id,
    name,
    who: String(row.who || name),
    mission: String(row.mission || fallback?.mission || ""),
    good_at: Array.isArray(row.good_at) ? row.good_at.map(String) : fallback?.good_at || [],
    can_finish: Array.isArray(row.can_finish) ? row.can_finish.map(String) : fallback?.can_finish || [],
    how_to_start: String(row.how_to_start || fallback?.how_to_start || ""),
    working_style: String(row.working_style || fallback?.working_style || ""),
    quick_prompts: Array.isArray(row.quick_prompts) ? row.quick_prompts.map(String) : fallback?.quick_prompts || [],
    recommended_tasks: tasks.slice(0, 3),
    intro_message: String(row.intro_message || fallback?.intro_message || ""),
    recommended: row.recommended !== undefined ? Boolean(row.recommended) : fallback?.recommended,
  };
}

function unwrapList(payload: unknown): Expert[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { experts?: unknown[] }).experts)
      ? (payload as { experts: unknown[] }).experts
      : [];
  return rows
    .map((row) => normalizeExpert(row as Partial<Expert>))
    .filter((row): row is Expert => Boolean(row));
}

export async function fetchExperts(): Promise<Expert[]> {
  try {
    const rows = unwrapList(await api.experts());
    if (rows.length) return rows;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return MOCK_CATALOG;
}

export async function fetchExpert(id: string): Promise<Expert | null> {
  const canonical = canonicalExpertId(id);
  try {
    const row = normalizeExpert(await api.expert(canonical) as Partial<Expert>);
    if (row) return row;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return MOCK_CATALOG.find((row) => row.id === canonical) || null;
}

export async function summonExpert(expert: Expert): Promise<ExpertSummonResult> {
  try {
    const summoned = await api.summonExpert(expert.id);
    const sessionId = String(summoned.session_id || "").trim();
    if (!sessionId) throw new Error("召唤未返回会话");
    const tasks = Array.isArray(summoned.recommended_tasks) && summoned.recommended_tasks.length
      ? summoned.recommended_tasks.map((task) => ({
        id: String(task.id || ""),
        title: String(task.title || ""),
        prompt: String(task.prompt || task.title || ""),
      })).filter((task) => task.id && task.title)
      : expert.recommended_tasks;
    return {
      session_id: sessionId,
      expert_id: String(summoned.expert_id || expert.id),
      intro_message: String(summoned.intro_message || expert.intro_message),
      recommended_tasks: tasks,
      bound: true,
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const session = await api.createSession(expert.name);
  return {
    session_id: session.id,
    expert_id: expert.id,
    intro_message: expert.intro_message,
    recommended_tasks: expert.recommended_tasks,
    bound: true,
  };
}

function readJsonList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeJsonList(key: string, value: string[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readPinnedExpertIds(): string[] {
  return readJsonList(PIN_KEY);
}

export function readRecentExpertIds(): string[] {
  return readJsonList(RECENT_KEY);
}

export function isExpertPinned(id: string): boolean {
  return readPinnedExpertIds().includes(canonicalExpertId(id));
}

export function togglePinnedExpert(id: string): string[] {
  const canonical = canonicalExpertId(id);
  const current = readPinnedExpertIds();
  const next = current.includes(canonical)
    ? current.filter((item) => item !== canonical)
    : [canonical, ...current];
  writeJsonList(PIN_KEY, next);
  return next;
}

export function rememberSummonedExpert(id: string): string[] {
  const canonical = canonicalExpertId(id);
  const next = [canonical, ...readRecentExpertIds().filter((item) => item !== canonical)].slice(0, 8);
  writeJsonList(RECENT_KEY, next);
  return next;
}

export function bindExpertSession(sessionId: string, expert: Expert, summoned: ExpertSummonResult): BoundExpertSession {
  const bound: BoundExpertSession = {
    expert_id: summoned.expert_id || expert.id,
    name: expert.name,
    mission: expert.mission,
    intro_message: summoned.intro_message || expert.intro_message,
    recommended_tasks: (summoned.recommended_tasks || expert.recommended_tasks).slice(0, 3),
  };
  sessionStorage.setItem(`${BIND_PREFIX}${sessionId}`, JSON.stringify(bound));
  return bound;
}

export function readBoundExpert(sessionId: string): BoundExpertSession | null {
  const raw = sessionStorage.getItem(`${BIND_PREFIX}${sessionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BoundExpertSession;
    if (!parsed?.expert_id || !parsed.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function filterExperts(experts: Expert[], query: string): Expert[] {
  const q = query.trim().toLowerCase();
  if (!q) return experts;
  return experts.filter((expert) => {
    const hay = [
      expert.name,
      expert.who,
      expert.mission,
      expert.how_to_start,
      expert.working_style,
      ...expert.good_at,
      ...expert.can_finish,
      ...expert.quick_prompts,
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function expertsForView(experts: Expert[], view: ExpertView, query: string): Expert[] {
  if (view === "recommend") return experts.filter((row) => row.recommended !== false);
  if (view === "mine") {
    const mine = new Set([...readPinnedExpertIds(), ...readRecentExpertIds()]);
    return experts.filter((row) => mine.has(row.id));
  }
  if (view === "search") return filterExperts(experts, query);
  return experts;
}
