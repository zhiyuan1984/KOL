import { api, type ExpertKind, type ExpertManifestView, type ExpertPrimaryEntry, type ExpertSummonResult } from "./api";

export type { ExpertKind, ExpertPrimaryEntry, ExpertSummonResult };

export type ExpertTask = {
  id: string;
  title: string;
  prompt: string;
};

export type ExpertSource = "api" | "catalog";

export type Expert = {
  id: string;
  name: string;
  expert_version: string;
  profession: string;
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
  kind: ExpertKind;
  primary_entry: ExpertPrimaryEntry;
  skill_ids: string[];
  tool_ids: string[];
  can_summon?: boolean;
  open_count?: number;
  source: ExpertSource;
};

const KOL_MISSION_COPY = "作为 KOL推广岗位身份，帮你看清阶段、准备沟通、给出跟进建议。不发信、不改正式阶段。";
const KOL_CAN_HELP = ["理解往来邮件和跟进节奏", "给出下一步跟进建议", "起草建联和沟通内容"];
const CRAWLER_MISSION_COPY = "把海外平台的发现目标变成可查进度、可取消、可重试的采集作业；完成后只形成候选人，由员工确认后才导入。不通过思考会话召唤，请使用任务控制台。";
const CRAWLER_CAN_HELP = ["提交 YouTube / Instagram 采集作业", "查看采集进度和失败原因", "确认候选后再跟进或导入"];
const APPROVER_MISSION_COPY = "处理待人决定的审批队列：展示申请人、金额、用途和证据。模型不得扩大授权、代人审批或把建议当作决定。不通过思考会话召唤，请使用审批队列。";
const APPROVER_CAN_HELP = ["查看待我处理的审批", "同意或驳回并留下回执", "需要时让合作专员说明风险"];
const CRAWLER_NO_SUMMON_COPY = "分析走作业台，不建思考会话";

function isSafetyCopy(text: string): boolean {
  return /必须由你确认|发送和改阶段|召唤进会话/.test(text);
}

export function expertRoleCopy(expert: Pick<Expert, "profession" | "who" | "name">): string {
  return expert.profession || expert.who || expert.name;
}

export function expertMissionCopy(expert: Pick<Expert, "id" | "mission">): string {
  const id = canonicalExpertId(expert.id);
  if (id === KOL_EXPERT_ID) return expert.mission.trim() || KOL_MISSION_COPY;
  if (id === CRAWLER_EXPERT_ID) return expert.mission.trim() || CRAWLER_MISSION_COPY;
  if (id === APPROVER_EXPERT_ID) return expert.mission.trim() || APPROVER_MISSION_COPY;
  return expert.mission;
}

export function expertCanHelpCopy(expert: Expert): string[] {
  const id = canonicalExpertId(expert.id);
  if (id === KOL_EXPERT_ID) return KOL_CAN_HELP;
  if (id === CRAWLER_EXPERT_ID) {
    const lines = expert.can_finish.filter((line) => line && !isSafetyCopy(line));
    return lines.length ? lines.slice(0, 3) : CRAWLER_CAN_HELP;
  }
  if (id === APPROVER_EXPERT_ID) {
    const lines = expert.can_finish.filter((line) => line && !isSafetyCopy(line));
    return lines.length ? lines.slice(0, 3) : APPROVER_CAN_HELP;
  }
  const lines = expert.can_finish.filter((line) => line && !isSafetyCopy(line));
  return lines.slice(0, 3);
}

export function expertPromptExamples(expert: Expert): string[] {
  const prompts = expert.quick_prompts.length
    ? expert.quick_prompts
    : expert.recommended_tasks.map((task) => task.prompt || task.title);
  return prompts.filter(Boolean).slice(0, 3);
}

export type BoundExpertSession = {
  expert_id: string;
  expert_version: string;
  name: string;
  mission: string;
  intro: string;
  recommended_tasks: ExpertTask[];
};

export const KOL_EXPERT_ID = "expert:kol";
export const CRAWLER_EXPERT_ID = "expert:crawler";
export const APPROVER_EXPERT_ID = "expert:approver";
export const ROLE_EXPERT_IDS = [KOL_EXPERT_ID, CRAWLER_EXPERT_ID, APPROVER_EXPERT_ID] as const;

const PIN_KEY = "lingong:expert-pins";
const RECENT_KEY = "lingong:expert-recent";
const BIND_PREFIX = "expert-session:";

const KOL_MANIFEST: ExpertManifestView = {
  id: KOL_EXPERT_ID,
  version: "0.1.0",
  status: "published",
  display_name: "KOL推广",
  profession: "KOL推广",
  description: "分析合作、展示适用 SOP、准备沟通草稿和跟进建议。发信与正式阶段写入必须由你确认，不会自动发送或改阶段。",
  avatar: "/api/experts/expert:kol/avatar",
  category: "KOL推广",
  tags: ["KOL推广", "建联", "跟进", "阶段建议"],
  mission: KOL_MISSION_COPY,
  quick_prompts: [
    "帮我看一下这个红人现在该怎么跟进",
    "准备一封建联邮件",
    "这封回复是什么意思",
    "这一阶段要准备什么",
  ],
  entry_skill: "stage_sop",
  kind: "business",
  primary_entry: "think",
  skill_ids: [
    "stage_sop",
    "creator_outreach",
    "email_compose",
    "reply_analysis",
    "creator_profile",
    "confirm_stage",
    "email_conversation_read",
    "discovery_brief",
    "discovery_plan",
    "today_plan",
    "today_analyze",
  ],
  tool_ids: ["starrykol"],
};

const CRAWLER_MANIFEST: ExpertManifestView = {
  id: CRAWLER_EXPERT_ID,
  version: "0.1.0",
  status: "published",
  display_name: "爬虫工程师",
  profession: "采集作业",
  description: "把海外发现目标变成可追踪的采集作业。采集完成只形成候选人，不导入正式库、不发信、不创建合作承诺。",
  avatar: "/api/experts/expert:crawler/avatar",
  category: "采集作业",
  tags: ["海外采集", "候选人", "作业控制台"],
  mission: CRAWLER_MISSION_COPY,
  quick_prompts: [
    "查看进行中的采集作业",
    "按关键词发现海外候选人",
    "采集完成后只保留候选人",
  ],
  entry_skill: "creator_discovery",
  kind: "collector",
  primary_entry: "job_console",
  skill_ids: ["creator_discovery"],
  tool_ids: ["mediacrawler"],
};

const APPROVER_MANIFEST: ExpertManifestView = {
  id: APPROVER_EXPERT_ID,
  version: "0.1.0",
  status: "published",
  display_name: "审批员",
  profession: "业务审批",
  description: "处理待决审批队列。模型可以整理材料，不能代人批准。",
  avatar: "/api/experts/expert:approver/avatar",
  category: "业务审批",
  tags: ["审批队列", "待决", "人工决定"],
  mission: APPROVER_MISSION_COPY,
  quick_prompts: [
    "查看待我决定的审批",
    "这条申请缺什么证据",
    "说明这次审批的风险",
  ],
  entry_skill: "business_approval",
  kind: "governance",
  primary_entry: "approval_queue",
  skill_ids: ["business_approval"],
  tool_ids: [],
};

/** Offline stand-in. Always includes all three posts — never hide crawler/approver. */
const MOCK_CATALOG = [KOL_MANIFEST, CRAWLER_MANIFEST, APPROVER_MANIFEST];

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

export function expertKindOf(value: unknown, fallback: ExpertKind): ExpertKind {
  if (value === "business" || value === "collector" || value === "governance") return value;
  return fallback;
}

export function expertPrimaryEntryOf(value: unknown, fallback: ExpertPrimaryEntry): ExpertPrimaryEntry {
  if (value === "think" || value === "job_console" || value === "approval_queue") return value;
  if (value === "jobs") return "job_console";
  if (value === "queue") return "approval_queue";
  return fallback;
}

export function defaultPrimaryEntry(kind: ExpertKind): ExpertPrimaryEntry {
  if (kind === "collector") return "job_console";
  if (kind === "governance") return "approval_queue";
  return "think";
}

/** Only think-entry roles may POST /summon. Crawler/approver never summon. */
export function expertCanSummon(expert: Pick<Expert, "primary_entry" | "kind">): boolean {
  return expert.primary_entry === "think" && expert.kind !== "collector" && expert.kind !== "governance";
}

export function expertPrimaryCta(expert: Pick<Expert, "id" | "kind" | "primary_entry">): string {
  if (expert.primary_entry === "job_console" || expert.kind === "collector") return "查看采集作业";
  if (expert.primary_entry === "approval_queue" || expert.kind === "governance") return "处理审批";
  return "开始跟进工作";
}

export function expertSecondaryCta(): string {
  return "进入工作台";
}

export function expertWorkbenchPath(expert: Pick<Expert, "id" | "kind" | "primary_entry">): string {
  if (expert.primary_entry === "job_console" || expert.kind === "collector") return expertDetailPath(CRAWLER_EXPERT_ID);
  if (expert.primary_entry === "approval_queue" || expert.kind === "governance") return expertDetailPath(APPROVER_EXPERT_ID);
  return expertDetailPath(expert.id || KOL_EXPERT_ID);
}

export function workbenchPathForSummonAction(nextAction?: string, primaryEntry?: string): string {
  if (nextAction === "open_job_console" || primaryEntry === "job_console") return expertDetailPath(CRAWLER_EXPERT_ID);
  if (nextAction === "open_approval_queue" || primaryEntry === "approval_queue") return expertDetailPath(APPROVER_EXPERT_ID);
  return "/agents";
}

export const CRAWLER_ANALYSIS_COPY = CRAWLER_NO_SUMMON_COPY;

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

function optionalCount(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

type ExpertRow = Partial<Omit<Expert, "kind" | "primary_entry">> & Partial<ExpertManifestView> & {
  kind?: ExpertKind | string;
  primary_entry?: ExpertPrimaryEntry | string;
  recommended_tasks?: Array<Partial<ExpertTask>>;
  source?: ExpertSource;
};

function catalogRow(id: string): ExpertManifestView | undefined {
  return MOCK_CATALOG.find((row) => canonicalExpertId(row.id) === canonicalExpertId(id));
}

function normalizeExpert(row: ExpertRow | null | undefined, source: ExpertSource = "api"): Expert | null {
  if (!row || typeof row !== "object") return null;
  const id = canonicalExpertId(String(row.id || ""));
  if (!id) return null;
  const fallback = catalogRow(id);
  const name = String(row.display_name || row.name || fallback?.display_name || "").trim();
  if (!name) return null;
  const description = String(row.description || row.working_style || fallback?.description || "").trim();
  const tags = asStringList(row.tags);
  const goodAt = asStringList(row.good_at);
  const canFinish = asStringList(row.can_finish);
  const prompts = asStringList(row.quick_prompts);
  const skillIds = asStringList(row.skill_ids);
  const toolIds = asStringList(row.tool_ids);
  const mappedTasks = Array.isArray(row.recommended_tasks)
    ? row.recommended_tasks
      .map((task) => ({
        id: String(task?.id || ""),
        title: String(task?.title || task?.prompt || ""),
        prompt: String(task?.prompt || task?.title || ""),
      }))
      .filter((task) => task.id && task.title)
    : [];
  const kind = expertKindOf(row.kind, expertKindOf(fallback?.kind, "business"));
  const primaryEntry = expertPrimaryEntryOf(
    row.primary_entry,
    expertPrimaryEntryOf(fallback?.primary_entry, defaultPrimaryEntry(kind)),
  );
  const count = optionalCount(row.open_count, row.pending_count, row.count);
  return {
    id,
    name,
    expert_version: String(row.version || row.expert_version || fallback?.version || ""),
    profession: String(row.profession || row.category || fallback?.profession || "").trim(),
    who: String(row.who || row.profession || fallback?.profession || name),
    mission: String(row.mission || fallback?.mission || "").trim(),
    good_at: goodAt.length ? goodAt : (tags.length ? tags : asStringList(fallback?.tags)),
    can_finish: canFinish.length ? canFinish : (description ? [description] : asStringList(fallback?.description ? [fallback.description] : [])),
    how_to_start: String(row.how_to_start || prompts[0] || fallback?.quick_prompts?.[0] || "").trim(),
    working_style: String(row.working_style || description || fallback?.description || ""),
    quick_prompts: prompts.length ? prompts : asStringList(fallback?.quick_prompts),
    recommended_tasks: (mappedTasks.length ? mappedTasks : tasksFromPrompts(prompts.length ? prompts : asStringList(fallback?.quick_prompts))).slice(0, 3),
    intro: String(row.intro || ""),
    recommended: row.recommended !== false,
    kind,
    primary_entry: primaryEntry,
    skill_ids: skillIds.length ? skillIds : asStringList(fallback?.skill_ids),
    tool_ids: toolIds.length ? toolIds : asStringList(fallback?.tool_ids),
    can_summon: row.can_summon === true ? true : row.can_summon === false ? false : fallback?.can_summon,
    open_count: count,
    source,
  };
}

function unwrapList(payload: unknown): ExpertRow[] {
  if (Array.isArray(payload)) return payload as ExpertRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { experts?: unknown[] }).experts)) {
    return (payload as { experts: ExpertRow[] }).experts;
  }
  return [];
}

export function mergeExpertRoster(apiRows: ExpertRow[], source: ExpertSource = "api"): Expert[] {
  const byId = new Map<string, Expert>();
  for (const row of apiRows) {
    const expert = normalizeExpert(row, source);
    if (expert) byId.set(expert.id, expert);
  }
  return ROLE_EXPERT_IDS.map((id) => {
    const fromApi = byId.get(id);
    const catalog = normalizeExpert(catalogRow(id), "catalog");
    if (fromApi && catalog) {
      return {
        ...catalog,
        ...fromApi,
        id,
        kind: fromApi.kind || catalog.kind,
        primary_entry: fromApi.primary_entry || catalog.primary_entry,
        skill_ids: fromApi.skill_ids.length ? fromApi.skill_ids : catalog.skill_ids,
        tool_ids: fromApi.tool_ids.length ? fromApi.tool_ids : catalog.tool_ids,
        source: "api",
      };
    }
    if (fromApi) return fromApi;
    return catalog as Expert;
  });
}

export async function fetchExperts(): Promise<Expert[]> {
  try {
    return mergeExpertRoster(unwrapList(await api.experts()), "api");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return mergeExpertRoster(MOCK_CATALOG, "catalog");
}

export async function fetchExpert(id: string): Promise<Expert | null> {
  const canonical = canonicalExpertId(id);
  const catalog = normalizeExpert(catalogRow(canonical), "catalog");
  try {
    const fromApi = normalizeExpert(await api.expert(canonical), "api");
    if (fromApi && catalog) {
      return {
        ...catalog,
        ...fromApi,
        id: canonical,
        kind: fromApi.kind || catalog.kind,
        primary_entry: fromApi.primary_entry || catalog.primary_entry,
        skill_ids: fromApi.skill_ids.length ? fromApi.skill_ids : catalog.skill_ids,
        tool_ids: fromApi.tool_ids.length ? fromApi.tool_ids : catalog.tool_ids,
        source: "api",
      };
    }
    return fromApi || catalog;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return catalog || null;
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

export class ExpertSummonRefusedError extends Error {
  status: number;
  code: string;
  next_action?: string;
  primary_entry?: string;
  path: string;
  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    next_action?: string;
    primary_entry?: string;
  }) {
    super(input.message);
    this.name = "ExpertSummonRefusedError";
    this.status = input.status ?? 409;
    this.code = input.code || "expert_summon_not_allowed";
    this.next_action = input.next_action;
    this.primary_entry = input.primary_entry;
    this.path = workbenchPathForSummonAction(input.next_action, input.primary_entry);
  }
}

function summonRefusalFromExpert(expert: Pick<Expert, "name" | "primary_entry" | "kind">): ExpertSummonRefusedError {
  const entry = expert.primary_entry || defaultPrimaryEntry(expert.kind);
  const next = entry === "job_console" ? "open_job_console" : entry === "approval_queue" ? "open_approval_queue" : "use_primary_entry";
  return new ExpertSummonRefusedError({
    message: entry === "job_console"
      ? "该数字员工不通过思考会话召唤，请使用任务控制台。"
      : entry === "approval_queue"
        ? "该数字员工不通过思考会话召唤，请使用审批队列。模型不得代人批准。"
        : `${expert.name} 不走思考入口，不能召唤进会话`,
    next_action: next,
    primary_entry: entry,
  });
}

export function parseSummonRefusal(error: unknown): ExpertSummonRefusedError {
  if (error instanceof ExpertSummonRefusedError) return error;
  const payload = error && typeof error === "object" ? (error as { payload?: unknown }).payload : undefined;
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const detail = root.detail && typeof root.detail === "object"
    ? root.detail as Record<string, unknown>
    : root;
  const message = String(
    detail.message
    || (typeof root.detail === "string" ? root.detail : "")
    || (error instanceof Error ? error.message : "")
    || "该数字员工不通过思考会话召唤。",
  );
  return new ExpertSummonRefusedError({
    message,
    status: error && typeof error === "object" ? Number((error as { status?: number }).status || 409) : 409,
    code: String(detail.code || "expert_summon_not_allowed"),
    next_action: detail.next_action ? String(detail.next_action) : undefined,
    primary_entry: detail.primary_entry ? String(detail.primary_entry) : undefined,
  });
}

function isConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { status?: number }).status === 409);
}

/** Only think-entry roles may POST /summon. Never create a plain session for crawler/approver. */
export async function summonExpert(expert: Expert): Promise<ExpertSummonResult> {
  if (!expertCanSummon(expert)) {
    throw summonRefusalFromExpert(expert);
  }
  try {
    const summoned = readSummon(await api.summonExpert(expert.id), expert);
    if (summoned) return summoned;
  } catch (error) {
    if (isConflict(error)) throw parseSummonRefusal(error);
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
    mission: expertMissionCopy(expert),
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
      expert.profession,
      expert.who,
      expert.mission,
      expertMissionCopy(expert),
      expert.how_to_start,
      expert.working_style,
      expert.kind,
      expert.primary_entry,
      ...expert.good_at,
      ...expert.can_finish,
      ...expertCanHelpCopy(expert),
      ...expert.quick_prompts,
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });
}
