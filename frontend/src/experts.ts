import { api, type ExpertManifestView, type ExpertSummonResult } from "./api";

export type { ExpertSummonResult };

export type ExpertTask = {
  id: string;
  title: string;
  prompt: string;
};

export type Expert = {
  id: string;
  name: string;
  expert_version: string;
  mission: string;
  who: string;
  good_at: string[];
  can_finish: string[];
  how_to_start: string;
  working_style: string;
  quick_prompts: string[];
  recommended_tasks: ExpertTask[];
  intro: string;
  recommended?: boolean;
};

export type ExpertView = "recommend" | "mine" | "all" | "search";

export type BoundExpertSession = {
  expert_id: string;
  expert_version: string;
  name: string;
  mission: string;
  intro: string;
  recommended_tasks: ExpertTask[];
};

export const KOL_EXPERT_ID = "expert:kol";
const PIN_KEY = "lingong:expert-pins";
const RECENT_KEY = "lingong:expert-recent";
const BIND_PREFIX = "expert-session:";

/** Offline stand-in matching experts/kol/manifest.yaml. Not a second catalog. */
const KOL_MANIFEST: ExpertManifestView = {
  id: KOL_EXPERT_ID,
  version: "0.1.0",
  status: "published",
  display_name: "KOL 合作专员",
  profession: "达人合作",
  description: "分析合作、展示适用 SOP、准备草稿和跟进建议。发信与正式阶段写入必须由你确认。",
  avatar: "/api/experts/expert:kol/avatar",
  category: "达人合作",
  tags: ["建联", "跟进", "阶段建议"],
  mission: "帮你把达人合作往前推进：看清阶段、准备沟通、给出跟进建议。",
  quick_prompts: [
    "帮我看一下这个红人现在该怎么跟进",
    "准备一封建联邮件",
    "这封回复是什么意思",
    "这一阶段要准备什么",
  ],
  entry_skill: "stage_sop",
};

const MOCK_CATALOG = [KOL_MANIFEST];

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

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function tasksFromPrompts(prompts: string[]): ExpertTask[] {
  return prompts.slice(0, 3).map((prompt, index) => ({
    id: `prompt-${index + 1}`,
    title: prompt,
    prompt,
  }));
}

type ExpertSource = Partial<Expert> & Partial<ExpertManifestView> & {
  recommended_tasks?: Array<Partial<ExpertTask>>;
};

function normalizeExpert(row: ExpertSource | null | undefined): Expert | null {
  if (!row || typeof row !== "object") return null;
  const id = canonicalExpertId(String(row.id || ""));
  if (!id) return null;
  const name = String(row.display_name || row.name || "").trim();
  if (!name) return null;
  const description = String(row.description || row.working_style || "").trim();
  const tags = asStringList(row.tags);
  const goodAt = asStringList(row.good_at);
  const canFinish = asStringList(row.can_finish);
  const prompts = asStringList(row.quick_prompts);
  const mappedTasks = Array.isArray(row.recommended_tasks)
    ? row.recommended_tasks
      .map((task) => ({
        id: String(task?.id || ""),
        title: String(task?.title || task?.prompt || ""),
        prompt: String(task?.prompt || task?.title || ""),
      }))
      .filter((task) => task.id && task.title)
    : [];
  return {
    id,
    name,
    expert_version: String(row.version || row.expert_version || ""),
    who: String(row.who || name),
    mission: String(row.mission || "").trim(),
    good_at: goodAt.length ? goodAt : tags,
    can_finish: canFinish.length ? canFinish : (description ? [description] : []),
    how_to_start: String(row.how_to_start || prompts[0] || "").trim(),
    working_style: String(row.working_style || description),
    quick_prompts: prompts,
    recommended_tasks: (mappedTasks.length ? mappedTasks : tasksFromPrompts(prompts)).slice(0, 3),
    intro: String(row.intro || ""),
    recommended: row.recommended !== false,
  };
}

function unwrapList(payload: unknown): Expert[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { experts?: unknown[] }).experts)
      ? (payload as { experts: unknown[] }).experts
      : [];
  return rows
    .map((row) => normalizeExpert(row as ExpertSource))
    .filter((row): row is Expert => Boolean(row));
}

export async function fetchExperts(): Promise<Expert[]> {
  try {
    return unwrapList(await api.experts());
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return unwrapList(MOCK_CATALOG);
}

export async function fetchExpert(id: string): Promise<Expert | null> {
  const canonical = canonicalExpertId(id);
  try {
    return normalizeExpert(await api.expert(canonical));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const fallback = MOCK_CATALOG.find((row) => canonicalExpertId(row.id) === canonical);
  return fallback ? normalizeExpert(fallback) : null;
}

function readSummon(payload: Partial<ExpertSummonResult> | null | undefined, expert: Expert): ExpertSummonResult | null {
  const sessionId = String(payload?.session_id || "").trim();
  if (!sessionId) return null;
  return {
    session_id: sessionId,
    expert_id: String(payload?.expert_id || expert.id),
    expert_version: String(payload?.expert_version || expert.expert_version || ""),
    intro: String(payload?.intro || expert.intro || ""),
  };
}

export async function summonExpert(expert: Expert): Promise<ExpertSummonResult> {
  try {
    const summoned = readSummon(await api.summonExpert(expert.id), expert);
    if (summoned) return summoned;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const session = await api.createSession(expert.name);
  return {
    session_id: session.id,
    expert_id: expert.id,
    expert_version: expert.expert_version,
    intro: expert.intro,
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
    expert_version: summoned.expert_version || expert.expert_version,
    name: expert.name,
    mission: expert.mission,
    intro: summoned.intro || expert.intro,
    recommended_tasks: expert.recommended_tasks.slice(0, 3),
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
