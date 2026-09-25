export type SessionRow = {
  id: string;
  title: string;
  archived_at?: string | null;
  expert_id?: string | null;
  expert_version?: string | null;
  agent_status?: "listening" | "running" | "waiting_approval" | "queued";
};

export type ExpertKind = "business" | "collector" | "governance";
export type ExpertPrimaryEntry = "think" | "job_console" | "approval_queue";
export type ExpertSummonNextAction = "open_job_console" | "open_approval_queue" | "use_primary_entry";

export type ExpertManifestView = {
  id: string;
  version: string;
  status: string;
  display_name: string;
  profession: string;
  description: string;
  avatar: string;
  category: string;
  tags: string[];
  mission: string;
  quick_prompts: string[];
  entry_skill: string;
  kind: ExpertKind;
  primary_entry: ExpertPrimaryEntry;
  skill_ids: string[];
  tool_ids: string[];
  can_summon?: boolean;
  open_count?: number;
  pending_count?: number;
  count?: number;
};

export type ExpertSummonResult = {
  session_id: string;
  expert_id: string;
  expert_version: string;
  intro: string;
};

export type AgentRunStatus = NonNullable<SessionRow["agent_status"]>;

export type AgentViewStep = { skillId: string; label: string; prompt: string };
export type AgentViewEntry = { id: string; title: string; summary: string; skillId: string; prompt: string; profileIds: string[] };
export type AgentViewTeam = { id: string; title: string; summary: string; profileIds: string[]; steps: AgentViewStep[] };
export type AgentManifestView = {
  id: string;
  version?: string;
  status: string;
  publish_gate?: { state?: string; employee_submission?: boolean };
  entries: AgentViewEntry[];
  teams: AgentViewTeam[];
};

export type Rec = {
  id: string;
  title: string;
  act: "ask";
  prompt?: string;
  intent?: string;
  to?: string;
  hint?: string;
  category?: string;
  profile?: string;
  description?: string;
  granted?: boolean;
};

export type CronJob = {
  id: string;
  job_key: string;
  title: string;
  owner_account_id?: string | null;
  execute_as?: string;
  execute_identity?: string;
  capability_expert_id?: string | null;
  handler_key: string;
  scope?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  cron_expr?: string;
  timezone?: string;
  frequency?: string;
  status: string;
  enabled?: boolean;
  retry_policy?: Record<string, unknown>;
  takeover_policy?: Record<string, unknown>;
  published_rev?: number;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_terminal_status?: string | null;
  system?: boolean;
  legal_fields_readonly?: boolean;
  schedule?: Record<string, unknown>;
};

export type CronRun = {
  id: string;
  job_id: string;
  trigger: string;
  status: string;
  scheduled_for?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error_code?: string | null;
  error_summary?: string | null;
  receipt?: Record<string, unknown>;
  session_id?: string | null;
  created_at?: string;
};

export type CronAlerts = {
  failed?: number;
  needs_takeover?: number;
};

export type TaskSource = "manual" | "ai" | string;
export type TaskStatus = "pending" | "waiting" | "running" | "completed" | "failed" | string;

export type TaskEvent = {
  id?: string;
  type?: string;
  status?: string;
  title?: string;
  label?: string;
  summary?: string;
  message?: string;
  created_at?: string;
  /** Stable identity of a live process row (harness trace item). */
  item_key?: string;
  [key: string]: unknown;
};

export type CrawlPlatform =
  | "youtube"
  | "instagram"
  | "facebook"
  | "xhs"
  | "dy"
  | "ks"
  | "bili"
  | "wb"
  | "tieba"
  | "zhihu";
export type CrawlMode = "search" | "detail" | "creator";
export type CrawlJobStatus =
  | "starting"
  | "running"
  | "stopping"
  | "queued"
  | "crawling"
  | "uploading"
  | "analyzing"
  | "result_ready"
  | "error"
  | "stopped";

export type CrawlPlan = {
  platform?: CrawlPlatform;
  mode?: CrawlMode;
  keywords?: string[];
  specified_ids?: string[];
  creator_ids?: string[];
};

export type CrawlCandidate = {
  platform?: CrawlPlatform | string;
  creator_id?: string;
  id?: string;
  nickname?: string;
  followers?: number;
  recent_views?: number | number[];
  score_components?: Record<string, number>;
  score_details?: Record<string, number>;
  score?: number;
  confidence?: number | string;
  profile_url?: string;
  [key: string]: unknown;
};

export type CrawlJob = {
  id?: string;
  task_id?: string;
  remote_task_id?: string;
  status: CrawlJobStatus | string;
  platform?: CrawlPlatform;
  mode?: CrawlMode;
  created_at?: string;
  started_at?: string;
  updated_at?: string;
  last_checked_at?: string;
  elapsed_seconds?: number;
  upload_error?: string | null;
  error?: string | null;
  creators?: CrawlCandidate[];
  result?: Record<string, unknown>;
  task_result?: Record<string, unknown>;
  [key: string]: unknown;
};

export type StartCrawlInput = {
  platform: CrawlPlatform;
  mode: CrawlMode;
  keywords?: string[];
  specified_ids?: string[];
  creator_ids?: string[];
  idempotency_key: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  content?: string;
  context?: string;
  source?: TaskSource;
  status?: TaskStatus;
  priority?: "important_urgent" | "important" | "urgent" | "normal" | "low" | "high" | "medium" | string;
  priority_label?: string;
  risk_level?: "none" | "low" | "medium" | "high" | string;
  start_date?: string | null;
  display_status?: "overdue" | "due_soon" | "in_progress" | "not_started" | "completed" | "cancelled" | "failed" | string;
  display_status_label?: string;
  skill?: string;
  skill_id?: string;
  profile?: string;
  project?: string;
  project_id?: string;
  collaboration_id?: string;
  history_summary?: string;
  history?: TaskEvent[];
  kol_name?: string;
  collab_summary?: string;
  recent_followup?: string;
  current_stage?: string;
  suggested_stage?: string;
  suggested_stage_code?: string;
  risk?: string;
  due_at?: string;
  last_acted_at?: string | null;
  acknowledged_at?: string | null;
  promoted_at?: string | null;
  dismissed_at?: string | null;
  next_action?: string;
  next_action_code?: string | null;
  progress?: number;
  session_id?: string;
  /** A discovery work item opens its linked run result rather than a chat session. */
  discovery_run_id?: string | null;
  /** PROD-AGENT-08: unadopted recs/insights. Formal WorkItems are candidate:false. */
  candidate?: boolean;
  suggested_actions?: Array<string | { label?: string; title?: string; prompt?: string }>;
  [key: string]: unknown;
};

export type TodayBriefPrimary = {
  verb?: string;
  label?: string;
  object_id?: string | null;
  object_type?: string;
  person_id?: string | null;
};

export type TodayBriefSection = {
  title?: string;
  body?: string;
  items?: string[];
};

export type TodoLayoutItem = {
  work_item_id: string;
  rank?: number;
  why?: string;
};

export type TodayBrief = {
  lead?: string;
  stats?: Record<string, number | string>;
  primary?: TodayBriefPrimary;
  sections?: TodayBriefSection[];
  todo_layout?: TodoLayoutItem[];
  reasoning?: string[];
  analysis_hints?: Array<Record<string, unknown>>;
  source_cursor?: Record<string, unknown>;
  increment_summary?: string;
};

export type TodayBriefResponse = {
  planning?: boolean;
  brief?: TodayBrief | null;
  events?: TaskEvent[];
  work_item_id?: string | null;
  session_id?: string | null;
  run_id?: string | null;
  /** The plan before the current one, folded to one row by the pane. */
  previous_brief?: TodayBrief | null;
  previous_events?: TaskEvent[];
  previous_work_item_id?: string | null;
  creates_session?: boolean;
  calls_model?: boolean;
};

export type TodayPlanResult = {
  planning?: boolean;
  attached?: boolean;
  work_item_id?: string;
  session_id?: string;
  run_id?: string;
  creates_session?: boolean;
};

export type RecommendedTask = {
  id: string;
  n?: number;
  icon?: string;
  markdown?: string;
  title: string;
  reason: string;
  source: "stage" | "ai" | "catalog" | string;
  source_label?: string;
  act?: "ask";
  intent?: string;
  prompt?: string;
  handle?: string;
  collaboration_id?: string | null;
  candidate_id?: string;
  candidate?: boolean;
};

export type SkillResultMemory = {
  id: string;
  skill_id: string;
  skill_version: string;
  run_id: string;
  validity: "current" | "stale";
  summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SkillResultMemoryPage = { items: SkillResultMemory[]; next_cursor: string | null };

export type AdoptRecommendationInput = {
  recommendation_id?: string;
  id?: string;
  work_item_id?: string;
  title: string;
  status?: "candidate";
  reason?: string;
  prompt?: string;
  intent?: string;
  task_type?: string;
  handle?: string;
  collaboration_id?: string | null;
};

export type HomeWorkbench = {
  summary?: {
    open?: number;
    overdue?: number;
    due_today?: number;
    waiting?: number;
    insights?: number;
  };
  todo?: Task[];
  open?: Task[];
  today?: Task[];
  insights?: Task[];
  recommendations?: RecommendedTask[];
  discovery?: {
    pending_count?: number;
    ready?: boolean;
    candidates?: Array<Record<string, unknown>>;
  };
  lifecycle?: {
    stages?: Array<{ code: string; label: string; count: number }>;
    domains?: Array<{ id: string; label: string; count: number }>;
    exception_count?: number;
    stay_too_long?: Array<Record<string, unknown>>;
  };
};

export type TaskDefinition = {
  id: string;
  title: string;
  description?: string;
  prompt?: string;
  category?: string;
  skill?: string;
  skill_id?: string;
  profile?: string;
  granted?: boolean;
  [key: string]: unknown;
};

export type TaskRunResult = {
  task: Task;
  run?: Record<string, unknown>;
  session_id: string;
  pending?: Record<string, unknown>;
  pending_message?: Record<string, unknown>;
  work_item_id?: string;
  run_id?: string;
};

export type ClarificationKind = "none" | "missing_fields" | "direction";

export type FromTextResult = {
  task?: Task;
  tasks?: Task[];
  resolved_tasks?: Array<Task | TaskDefinition>;
  candidates?: Array<TaskDefinition | { id?: string; label?: string; title?: string; prompt?: string }>;
  confidence?: number | "low" | "medium" | "high";
  clarification?: string;
  message?: string;
  needs_clarification?: boolean;
  clarification_kind?: ClarificationKind;
  resolution?: {
    confidence?: number;
    needs_clarification?: boolean;
    clarification_kind?: ClarificationKind;
    task_type?: string;
    missing_fields?: string[];
    invalid_fields?: Record<string, string>;
    entities?: Record<string, unknown>;
    source?: string;
    error?: string;
    alternatives?: Array<{ task_type?: string; id?: string; title?: string; confidence?: number }>;
  };
};

export type AttachmentRef = { id?: string; name: string; path: string; size?: number; type?: string };

export type PendingAsk = {
  text: string;
  model_tier?: string;
  intent?: string;
  collaboration_id?: string;
  knowledge_id?: string;
  attachments?: AttachmentRef[];
  work_item_id?: string;
  task_type?: string;
  run_id?: string;
  entities?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  object_refs?: Array<{ kind: string; id: string; label?: string }>;
  client_entry?: string;
};

export type KnowledgeRow = {
  id: string;
  title: string;
  body: string;
  tags?: string;
  kind?: string;
  skill_id?: string;
  brand?: string;
  lang?: string;
  subject?: string;
  body_en?: string;
  placeholders?: string[];
  stage_codes?: string[];
  status?: string;
  current_version?: number;
  cited?: boolean;
  deprecated?: boolean;
  deprecate_reason?: string;
  deprecate_reason_label?: string;
  cite_count?: number;
  in_market?: number;
  intent?: string;
  starter?: string;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  approved_at?: string;
};

export type StarryBinding = {
  required?: boolean;
  bound?: boolean;
  mailbox_email?: string;
  mailbox_id?: string;
  owner_name?: string;
  status?: "connected" | "expired" | "unbound" | string;
  has_token?: boolean;
  updated_at?: string | null;
  bindings?: Array<{
    mailbox_email: string;
    owner_name: string;
    mailbox_id: string;
    status: "connected" | "expired" | string;
    is_default: boolean;
    synced_at: string | null;
    updated_at: string | null;
  }>;
};

export type Account = {
  id?: string;
  name: string;
  handle?: string;
  email?: string;
  phone?: string;
  site?: string;
  exam_passed?: boolean;
  exam_todo_count?: number;
  brands?: string[];
  mailboxes?: string[];
  roles?: string[];
  role?: string;
  available_modes?: ("employee" | "admin")[];
  starry_binding?: StarryBinding;
};

export type AuthStatus = {
  authenticated: boolean;
  setup_required?: boolean;
  account?: Account;
  user?: Account;
  available_modes?: ("employee" | "admin")[];
};

type RequestOptions = RequestInit & { optional?: boolean };

function httpError(status: number, payload?: unknown, fallback?: string): Error & { status?: number; payload?: unknown } {
  const detail = payload && typeof payload === "object"
    ? (payload as { detail?: unknown; message?: string }).detail
    : undefined;
  const message =
    typeof detail === "string"
      ? detail
      : (detail as { message?: string } | undefined)?.message ||
        (payload as { message?: string } | undefined)?.message ||
        fallback ||
        `请求失败 (${status || 502})`;
  const error = new Error(message) as Error & { status?: number; payload?: unknown };
  error.status = status;
  error.payload = payload;
  return error;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  const html = trimmed.startsWith("<") || /text\/html/i.test(response.headers.get("content-type") || "");
  if (html) {
    throw httpError(response.status >= 400 ? response.status : 502);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw httpError(response.status >= 400 ? response.status : 502);
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { optional, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const signals = [init.signal, AbortSignal.timeout(45_000)].filter(Boolean) as AbortSignal[];
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  } catch (cause) {
    const name = String((cause as Error)?.name || "");
    if (name === "TimeoutError" || name === "AbortError") {
      throw httpError(0, null, "请求超时或网络中断，请稍后重试");
    }
    throw cause;
  }
  const body = await readJson(response);
  if (!response.ok) {
    if (optional && (response.status === 404 || response.status === 405)) return null as T;
    throw httpError(response.status, body);
  }
  return body as T;
}

export type Message = {
  id: string;
  session_id: string;
  role: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TraceStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type ProcessTraceItem = {
  id?: string;
  label?: string;
  title?: string;
  phase?: string;
  status?: TraceStatus | string;
  kind?: string;
  summary?: string;
  reasoning_summary?: string;
  streaming?: boolean;
};

export type OperationTraceItem = {
  id?: string;
  label?: string;
  tool_label?: string;
  name?: string;
  tool?: string | { label?: string; name?: string };
  status?: TraceStatus | string;
  summary?: string;
  streaming?: boolean;
};

export type TaskResultSection = {
  title?: string;
  heading?: string;
  content?: string;
  body?: string;
  summary?: string;
  items?: Array<string | Record<string, unknown>>;
};

export type TaskResultMetric = {
  label?: string;
  name?: string;
  value?: string | number;
  detail?: string;
  change?: string | number;
};

export type TaskResultCard = {
  title?: string;
  summary?: string;
  sections?: TaskResultSection[] | Record<string, unknown>;
  metrics?: TaskResultMetric[] | Record<string, string | number>;
  recommended_actions?: Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }>;
  actions?: Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }>;
  compose_loop?: {
    kind?: string;
    quote?: boolean;
    amount_usd?: number | null;
    currency?: string | null;
    rate_unit?: string | null;
    tracking?: string | null;
    carrier?: string | null;
    digest?: string;
    title?: string;
    gap?: { field?: string | null; label?: string; placeholder?: string; prompt?: string; result_action?: string };
  };
  suggested_follow_tags?: Array<{ id?: string; label?: string; reason?: string; custom?: boolean }>;
  follow_style_tags?: Array<{ id?: string; label?: string }>;
  subject?: string;
  body?: string;
  from?: string;
  to?: string;
  draft_id?: string;
  draft?: Record<string, unknown>;
  type?: string;
};

export type RunQueueItem = {
  id: string;
  text?: string;
  intent?: string;
};

export type PostMessageResult = {
  messages: Message[];
  worker?: unknown;
  draft?: unknown;
  accepted?: boolean;
  queued?: boolean;
  agent_status?: string;
  run_queue?: RunQueueItem[];
};

export type EmailCard = {
  draft_id: string;
  collaboration_id?: string;
  expected_version?: number;
  from: string;
  send_from?: string;
  allowed_from_mailboxes?: { brand: string; email: string; authorized: boolean }[];
  from_locked?: boolean;
  from_lock_text?: string;
  to: string;
  cc: string;
  lang: string;
  subject: string;
  body: string;
  body_zh_internal?: string;
  amount_usd?: number | null;
  currency?: string;
  rate_unit?: string | null;
  deliverables?: string;
  brand?: string;
  cpm?: number;
  approval_policy?: string;
  approval_id?: string | null;
  keep_stage: boolean;
  official_stage: string;
  official_stage_label: string;
  proposed_stage?: string;
  proposed_stage_label?: string;
  targets?: { code: string; label: string; capability_domain?: string | null; advancement_mode?: string; track?: string; track_label?: string; kind?: string; note?: string; suggested?: boolean }[];
  tracks?: { id: string; label: string; items: { code: string; label: string; kind?: string; note?: string; suggested?: boolean }[] }[];
  status?: string;
  send_error?: string;
  send_disabled?: boolean;
  footer?: string;
  buttons: string[];
  skill?: string;
};

const parse = async (r: Response): Promise<unknown> => readJson(r);

/** Scope-parameterized today/todo brief & plan. Shared by both panes. */
export type HomePlanScope = "today" | "todo";

export function scopeBrief(scope: HomePlanScope): Promise<TodayBriefResponse> {
  return request<TodayBriefResponse>(`/api/home/${scope}-brief`);
}

export function planScope(scope: HomePlanScope): Promise<TodayPlanResult> {
  return request<TodayPlanResult>(`/api/home/${scope}-brief/plan`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  setup: (body: { name: string; email: string; password: string }) =>
    request<AuthStatus>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
  login: async (body: { email?: string; username?: string; password: string } | string, password?: string) => {
    if (typeof body === "string") {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: body, password }),
      });
      const data = (await readJson(r)) as AuthStatus & { detail?: unknown };
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "登录失败");
      return data as AuthStatus;
    }
    return request<AuthStatus>("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
  },
  logout: async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    return request<{ ok?: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => ({ ok: true }));
  },
  home: () => fetch("/api/home", { cache: "no-store" }).then((r) => r.json()),
  homeBoard: (opts?: { refresh?: boolean }) =>
    fetch(`/api/home/board${opts?.refresh ? "?refresh=1" : ""}`, { cache: "no-store" }).then((r) => r.json()) as Promise<{
      kols?: Array<Record<string, unknown>>;
      tasks?: Task[];
      tabs?: Array<{ code: string; count: number; task_count?: number }>;
      workbench?: HomeWorkbench;
      creators_loaded?: number;
      tasks_loaded?: number;
      library?: { ok?: boolean; source?: string; count?: number; error?: string };
      mail?: { ok?: boolean; unread?: number; conversations?: number; inbound?: number; error?: string };
      follow_scope?: StarryBinding;
    }>,
  starryBinding: () => request<StarryBinding>("/api/me/starry-binding"),
  probeStarryBinding: (body?: { bearer?: string }) =>
    request<{ mailboxes: Array<{ id: string; mailbox_email: string; owner_name: string; brand: string }>; used_pasted_token?: boolean }>(
      "/api/me/starry-binding/probe",
      { method: "POST", body: JSON.stringify(body || {}) },
    ),
  saveStarryBinding: (body: { mailbox_email: string; bearer?: string; mailbox_id?: string; owner_name?: string }) =>
    request<StarryBinding>("/api/me/starry-binding", { method: "POST", body: JSON.stringify(body) }),
  clearStarryBinding: () => request<StarryBinding>("/api/me/starry-binding", { method: "DELETE" }),
  tasks: (params?: { status?: string; source?: string; priority?: string; view?: string }) => {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return request<Task[] | { tasks: Task[] }>(`/api/tasks${query.size ? `?${query}` : ""}`);
  },
  version: () =>
    request<{ version: string; started_at: string }>("/api/version"),
  taskDefinitions: () =>
    request<TaskDefinition[] | { task_definitions?: TaskDefinition[]; definitions?: TaskDefinition[] }>(
      "/api/task-definitions",
    ),
  agentManifest: () => request<AgentManifestView>("/api/agent-manifest"),
  experts: () => request<ExpertManifestView[] | { experts?: ExpertManifestView[] }>("/api/experts"),
  expert: (id: string) => request<ExpertManifestView>(`/api/experts/${encodeURIComponent(id)}`),
  summonExpert: (id: string) =>
    request<ExpertSummonResult>(`/api/experts/${encodeURIComponent(id)}/summon`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  createTask: (body: Record<string, unknown>) =>
    request<Task | { task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  createTaskFromText: (body: Record<string, unknown>) =>
    request<FromTextResult>("/api/tasks/from-text", { method: "POST", body: JSON.stringify(body) }),
  runTask: (id: string, body: Record<string, unknown> = {}) =>
    request<TaskRunResult>(`/api/tasks/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  task: (id: string) => request<Task | { task: Task }>(`/api/tasks/${encodeURIComponent(id)}`),
  taskBySession: (sessionId: string) =>
    request<Task | { task: Task }>(`/api/tasks/by-session/${encodeURIComponent(sessionId)}`),
  taskEvents: (id: string) =>
    request<TaskEvent[] | { events: TaskEvent[] }>(`/api/tasks/${encodeURIComponent(id)}/events`),
  startCrawl: (id: string, body: StartCrawlInput) =>
    request<CrawlJob | { crawl_job: CrawlJob; job?: CrawlJob }>(
      `/api/tasks/${encodeURIComponent(id)}/actions/start-crawl`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  stopCrawl: (id: string) =>
    request<CrawlJob | { crawl_job: CrawlJob; job?: CrawlJob }>(
      `/api/tasks/${encodeURIComponent(id)}/actions/stop-crawl`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  crawlJob: (id: string) =>
    request<CrawlJob | { crawl_job: CrawlJob; job?: CrawlJob }>(
      `/api/tasks/${encodeURIComponent(id)}/crawl-job`,
    ),
  crawlEvents: (id: string) =>
    request<TaskEvent[] | { events: TaskEvent[] }>(
      `/api/tasks/${encodeURIComponent(id)}/crawl-job/events`,
    ),
  retryCrawlUpload: (jobId: string) =>
    request<CrawlJob | { crawl_job: CrawlJob; job?: CrawlJob }>(
      `/api/admin/crawl-jobs/${encodeURIComponent(jobId)}/retry-upload`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  clearCrawlHistory: () =>
    request<{ ok?: boolean; cleared?: number }>("/api/admin/crawl-history/clear", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    }),
  completeTask: (id: string) =>
    request<Task | { task: Task; message?: string }>(`/api/tasks/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  promoteTask: (id: string) =>
    request<Task>(`/api/tasks/${encodeURIComponent(id)}/promote`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  updateTask: (id: string, fields: {
    title?: string;
    content?: string;
    status?: string;
    priority?: string;
    risk_level?: string;
    start_date?: string | null;
    due_at?: string | null;
  }) =>
    request<Task | { task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(30_000),
    }),
  editTaskByText: (id: string, text: string) =>
    request<{ task: Task; applied_fields?: string[]; source?: string }>(
      `/api/tasks/${encodeURIComponent(id)}/edit`,
      { method: "POST", body: JSON.stringify({ text }), signal: AbortSignal.timeout(90_000) },
    ),
  acknowledgeTask: (id: string) =>
    request<Task & { creates_session?: boolean; entry?: string }>(
      `/api/tasks/${encodeURIComponent(id)}/acknowledge`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),
  adoptRecommendation: (body: AdoptRecommendationInput) =>
    request<Task & { reused?: boolean; created?: boolean }>("/api/tasks/adopt-recommendation", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  homeFollowing: () =>
    request<{
      entry?: string;
      creates_session?: boolean;
      calls_model?: boolean;
      kind?: string;
      contract?: string;
      index?: string;
      authority?: string;
      employee_id?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
      follow_scope?: StarryBinding;
    }>("/api/home/following"),
  homePool: () =>
    request<{
      entry?: string;
      creates_session?: boolean;
      calls_model?: boolean;
      kind?: string;
      index?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool"),
  syncHomePool: () =>
    request<{
      entry?: string;
      kind?: string;
      creates_session?: boolean;
      creates_turn?: boolean;
      calls_model?: boolean;
      ok?: boolean;
      count?: number;
      tool?: string;
      message?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/sync", { method: "POST", body: JSON.stringify({}) }),
  homePoolSyncStatus: () =>
    request<{
      entry?: string;
      kind?: string;
      status?: "idle" | "running" | "succeeded" | "failed";
      ok?: boolean;
      count?: number;
      tool?: string;
      message?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/sync"),
  enqueueKolAnalyze: (body: { kol_uids?: string[]; kolUids?: string[]; people?: string[]; handles?: string[]; title?: string; prompt?: string }) =>
    request<{
      entry?: string;
      kind?: string;
      creates_session?: boolean;
      calls_model?: boolean;
      task_type?: string;
      work_item_id?: string;
      session_id?: string | null;
      people?: string[];
      artifact_type?: string;
      recognizeTaskIntent?: boolean;
      status?: string;
      queued_copy?: string;
    }>("/api/home/kol-analyze/enqueue", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  claimKol: (kolUid: string, body?: Record<string, unknown>) =>
    request<{
      ok?: boolean;
      reused?: boolean;
      created?: boolean;
      follow?: Record<string, unknown>;
      kol_uid?: string;
      follow_id?: string;
      collaboration_id?: string;
      stage_unchanged?: boolean;
      sent?: boolean;
    }>(`/api/kols/${encodeURIComponent(kolUid)}/claim`, {
      method: "POST",
      body: JSON.stringify({ confirm: true, confirmed: true, ...(body || {}) }),
    }),
  releaseFollow: (followId: string, body?: Record<string, unknown>) =>
    request<{
      ok?: boolean;
      action?: string;
      follow_id?: string;
      kol_uid?: string;
      stage_unchanged?: string | null;
    }>(`/api/follows/${encodeURIComponent(followId)}/release`, {
      method: "POST",
      body: JSON.stringify({ confirm: true, confirmed: true, reason: "manual_release", ...(body || {}) }),
    }),
  todayBrief: () => scopeBrief("today"),
  planToday: () => planScope("today"),
  todoBrief: () => scopeBrief("todo"),
  planTodo: () => planScope("todo"),
  enqueueTodayAnalyze: (body: Record<string, unknown> = {}) =>
    request<TodayPlanResult>("/api/home/today-brief/enqueue", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  dismissTask: (id: string) =>
    request<Task>(`/api/tasks/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  me: () => request<Account>("/api/me"),
  updateMe: (body: Partial<Account>) => request<Account>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    request<{ ok?: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify(body) }),
  preferences: () => request<Record<string, unknown>>("/api/preferences"),
  savePreferences: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/preferences", { method: "PATCH", body: JSON.stringify(body) }),
  memories: () => request<Record<string, unknown>[]>("/api/memory"),
  createMemory: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/memory", { method: "POST", body: JSON.stringify(body) }),
  updateMemory: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/memory/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMemory: (id: string) => request<{ ok?: boolean }>(`/api/memory/${id}`, { method: "DELETE" }),
  dataSummary: () => request<Record<string, unknown>>("/api/me/data-summary"),
  cookiePrivacy: () => request<Record<string, unknown>>("/api/privacy/cookies"),
  setPersona: (persona: string) =>
    fetch("/api/me/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona }),
    }).then((r) => r.json()),
  sessions: (includeArchived = false) =>
    request<SessionRow[]>(`/api/sessions${includeArchived ? "?include_archived=1" : ""}`),
  session: (id: string, opts?: { sync?: boolean; force?: boolean }) =>
    request<{
      messages: Message[];
      agent_status?: string;
      collaboration_id?: string | null;
      journey?: Record<string, unknown> | null;
      run_queue?: RunQueueItem[];
    }>(
      `/api/sessions/${id}${opts?.sync ? `?sync=1${opts.force ? "&force=1" : ""}` : ""}`,
    ),
  createSession: (title: string, collaborationId?: string) =>
    request<{ id: string; collaboration_id?: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title, ...(collaborationId ? { collaboration_id: collaborationId } : {}) }),
    }),
  openKolSession: (collaborationId: string) =>
    request<{ id: string; collaboration_id?: string; journey?: Record<string, unknown> }>(
      `/api/collaborations/${encodeURIComponent(collaborationId)}/session`,
      { method: "POST" },
    ),
  saveFollowStyleTags: (
    collaborationId: string,
    body: { tags: Array<{ id?: string; label: string } | string>; mode?: "replace" | "add"; session_id?: string },
  ) =>
    request<{
      ok?: boolean;
      follow_style_tags?: Array<{ id: string; label: string; custom?: boolean }>;
      follow_style_presets?: Array<{ id: string; label: string }>;
      journey?: Record<string, unknown> | null;
    }>(`/api/collaborations/${encodeURIComponent(collaborationId)}/follow-style-tags`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  composePreview: (
    sid: string,
    body: { text?: string; collaboration_id?: string; handle?: string },
  ) => request<{
    subject: string;
    body: string;
    amount_usd?: number | null;
    currency?: string | null;
    rate_unit?: string | null;
    source?: string;
  }>(`/api/sessions/${sid}/compose-preview`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
  postMessage: async (
    sid: string,
    pending: (PendingAsk & { model_tier?: string }) | string,
  ): Promise<PostMessageResult> => {
    const p: PendingAsk = typeof pending === "string" ? { text: pending } : pending;
    const r = await fetch(`/api/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: p.text,
        content: p.text,
        act: "ask",
        model_tier: p.model_tier || "default",
        intent: p.intent,
        collaboration_id: p.collaboration_id,
        knowledge_id: p.knowledge_id,
        attachments: p.attachments,
        work_item_id: p.work_item_id,
        task_type: p.task_type,
        run_id: p.run_id,
        entities: p.entities,
        scope: p.scope,
        object_refs: p.object_refs,
        client_entry: p.client_entry,
      }),
    });
    const b = (await parse(r)) as {
      messages?: Message[];
      detail?: unknown;
      worker?: unknown;
      accepted?: boolean;
      queued?: boolean;
      agent_status?: string;
      run_queue?: RunQueueItem[];
    };
    if (!r.ok) {
      const d = b.detail;
      throw new Error(typeof d === "string" ? d : JSON.stringify(d || b));
    }
    return b as PostMessageResult;
  },
  stopSession: (sid: string) =>
    request<{ stopped: boolean; run_queue?: RunQueueItem[]; agent_status?: string }>(
      `/api/sessions/${sid}/stop`,
      { method: "POST", body: "{}" },
    ),
  removeQueued: (sid: string, qid: string) =>
    request<{ ok?: boolean; run_queue?: RunQueueItem[] }>(
      `/api/sessions/${sid}/queue/${encodeURIComponent(qid)}`,
      { method: "DELETE" },
    ),
  sendDraft: async (id: string, extra?: { cc?: string; from_addr?: string; to_addr?: string }) => {
    const r = await fetch(`/api/drafts/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(extra || {}),
    });
    const b = (await parse(r)) as { ok?: boolean; detail?: { message?: string; status?: string; toast_success?: boolean } };
    if (!r.ok) {
      const d = b.detail || b;
      const err = new Error((d as { message?: string }).message || JSON.stringify(d));
      (err as Error & { payload: unknown }).payload = d;
      throw err;
    }
    return b;
  },
  confirmSessionStage: (sid: string, body: Record<string, unknown>) =>
    fetch(`/api/sessions/${sid}/confirm-stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const b = await parse(r);
      if (!r.ok) throw httpError(r.status, b, "阶段确认未完成");
      return b;
    }),
  translate: async (id: string) => {
    const r = await fetch(`/api/drafts/${id}/translate`, { method: "POST" });
    const b = (await parse(r)) as { zh?: string; detail?: { message?: string } | string };
    if (!r.ok) {
      const detail = b.detail;
      throw new Error(
        typeof detail === "string"
          ? detail
          : detail?.message || "暂时无法生成中文译稿",
      );
    }
    return b as { zh: string };
  },
  patchDraft: (id: string, body: Record<string, unknown>) =>
    request(`/api/drafts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  pipeline: (exception = 0) => fetch(`/api/pipeline?exception=${exception}`).then((r) => r.json()),
  approvals: (box?: "inbox" | "submitted" | "done") =>
    fetch(box ? `/api/approvals?box=${encodeURIComponent(box)}` : "/api/approvals").then((r) => r.json()),
  approvalBadge: () => request<{ count: number }>("/api/approvals/badge"),
  approval: (id: string) => request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}`),
  wecomCards: () => fetch("/api/wecom/cards").then((r) => r.json()),
  previewApproval: (body: {
    kind: "expense";
    amount: number;
    currency: string;
    requester_id?: string;
    requester_name?: string;
    purpose?: string;
    business_type?: string;
  }) =>
    request<{
      kind: "expense";
      expected_version?: number;
      plan: {
        rule_id?: string;
        explanation?: string;
        amount?: number;
        currency?: string;
        amount_base?: number;
        requester_name?: string;
      };
      steps: { name: string; role: string }[];
    }>("/api/approvals/preview", { method: "POST", body: JSON.stringify(body) }),
  createApproval: (body: {
    kind: "expense";
    amount: number;
    currency: string;
    requester_id?: string;
    requester_name?: string;
    purpose?: string;
    business_type?: string;
    expected_version?: number;
    idempotency_key?: string;
  }) =>
    request<{
      id: string;
      kind?: string;
      status?: string;
      can_decide?: boolean;
      expected_role?: string;
      chain_detail?: { name: string; role: string }[];
      payload?: Record<string, unknown>;
    }>("/api/approvals", { method: "POST", body: JSON.stringify(body) }),
  decide: (
    id: string,
    decision: string,
    actor?: string,
    reason?: string,
    gate?: { expected_version: number; idempotency_key: string },
  ) =>
    request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        ...(actor ? { actor } : {}),
        ...(reason ? { reason } : {}),
        ...(gate || {}),
      }),
    }),
  skills: () => request<Array<Record<string, unknown>>>("/api/skills"),
  skill: (id: string) => fetch(`/api/skills/${encodeURIComponent(id)}`).then((r) => r.json()),
  saveSkillSop: async (id: string, body: { summary: string; body: string }) => {
    const r = await fetch(`/api/skills/${encodeURIComponent(id)}/sop`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "保存技能说明失败");
    return data;
  },
  resetSkillSop: async (id: string) => {
    const r = await fetch(`/api/skills/${encodeURIComponent(id)}/sop`, { method: "DELETE" });
    const data = await r.json();
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "恢复技能说明失败");
    return data;
  },
  adminSkills: () => fetch("/api/admin/skills").then((r) => r.json()),
  skillLifecycleStage: (id: string, stage: string, reason?: string) =>
    request<{ id: string; stage: string }>(`/api/admin/skills/${encodeURIComponent(id)}/stage`, {
      method: "POST",
      body: JSON.stringify({ stage, reason }),
    }),
  skillStageHistory: (id: string) =>
    request<{ history: Array<Record<string, unknown>> }>(`/api/admin/skills/${encodeURIComponent(id)}/stage-history`),
  skillLifecycleMetaSave: (id: string, body: { owner?: string; business_stage?: string; tags?: string[] }) =>
    request<{ lifecycle: Record<string, unknown> }>(`/api/admin/skills/${encodeURIComponent(id)}/lifecycle`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  skillVersions: (id: string) =>
    request<{ versions: Array<Record<string, unknown>> }>(`/api/admin/skills/${encodeURIComponent(id)}/versions`),
  publishSkillVersion: (id: string, description?: string) =>
    request<{ version: number }>(`/api/admin/skills/${encodeURIComponent(id)}/versions`, {
      method: "POST",
      body: JSON.stringify({ description }),
    }),
  rollbackSkillVersion: (id: string, version: number) =>
    request<{ version: number }>(`/api/admin/skills/${encodeURIComponent(id)}/versions/rollback`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  skillTests: (id: string) =>
    request<{ tests: Array<Record<string, unknown>>; runs: Array<Record<string, unknown>> }>(
      `/api/admin/skills/${encodeURIComponent(id)}/tests`,
    ),
  createSkillTest: (id: string, body: { name: string; input?: string; expected?: string }) =>
    request<Record<string, unknown>>(`/api/admin/skills/${encodeURIComponent(id)}/tests`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteSkillTest: (id: string, testId: string) =>
    request<{ ok: boolean }>(`/api/admin/skills/${encodeURIComponent(id)}/tests/${encodeURIComponent(testId)}`, {
      method: "DELETE",
    }),
  runSkillTests: (id: string, results: { test_id: string; passed: boolean; fail_reason?: string }[]) =>
    request<{ total: number; passed: number; failed: number }>(`/api/admin/skills/${encodeURIComponent(id)}/tests/run`, {
      method: "POST",
      body: JSON.stringify({ results }),
    }),
  skillMetrics: (id: string, days = 7) =>
    request<{ calls: number; success_rate: number | null; avg_duration_ms: number | null; alerts: number; trend: { day: string; n: number }[] }>(
      `/api/admin/skills/${encodeURIComponent(id)}/metrics?days=${days}`,
    ),
  createAdminSkill: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/admin/skills", { method: "POST", body: JSON.stringify(body) }),
  patchAdminSkill: (id: string, body: {
    in_market?: boolean;
    title?: string;
    description?: string;
    body?: string;
    aliases?: string;
    profile?: string;
    funnel?: string;
    required_inputs?: string[];
    input_schema?: unknown[];
    result_type?: string;
    result_schema?: Record<string, unknown>;
    next_actions?: unknown[];
    memory_policy?: Record<string, unknown>;
    supports?: Record<string, boolean>;
  }) =>
    request<Record<string, unknown>>(`/api/admin/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAdminSkill: (id: string) =>
    request<{ ok?: boolean; id: string }>(`/api/admin/skills/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveSkillGrants: async (id: string, body: { org: string[]; team: string[]; user: string[] }) => {
    const r = await fetch(`/api/admin/skills/${encodeURIComponent(id)}/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "保存分配失败");
    return data;
  },
  profiles: () => fetch("/api/profiles").then((r) => r.json()),
  skillMarket: () => request<Array<Record<string, unknown>>>("/api/skills/market"),
  knowledge: () => request<KnowledgeRow[]>("/api/knowledge"),
  kbMarket: () => request<KnowledgeRow[]>("/api/knowledge/market"),
  knowledgeItem: (id: string) => request<KnowledgeRow>(`/api/knowledge/${encodeURIComponent(id)}`),
  citeKnowledge: (id: string) =>
    request<KnowledgeRow>(`/api/knowledge/${encodeURIComponent(id)}/cite`, { method: "POST", body: JSON.stringify({}) }),
  unciteKnowledge: (id: string) =>
    request<KnowledgeRow>(`/api/knowledge/${encodeURIComponent(id)}/cite`, { method: "DELETE" }),
  deprecateKnowledge: (id: string, reason: string, note = "") =>
    request<KnowledgeRow>(`/api/knowledge/${encodeURIComponent(id)}/deprecate`, {
      method: "POST",
      body: JSON.stringify({ reason, note }),
    }),
  undeprecateKnowledge: (id: string) =>
    request<KnowledgeRow>(`/api/knowledge/${encodeURIComponent(id)}/deprecate`, { method: "DELETE" }),
  knowledgeVersions: (id: string) =>
    request<Record<string, unknown>[]>(`/api/knowledge/${encodeURIComponent(id)}/versions`),
  adminKnowledge: () => request<KnowledgeRow[]>("/api/admin/knowledge"),
  adminKnowledgeRaw: () => request<Record<string, unknown>[]>("/api/admin/knowledge/raw"),
  adminKnowledgeJobs: () => request<Record<string, unknown>[]>("/api/admin/knowledge/extract-jobs"),
  adminKnowledgeReview: () => request<KnowledgeRow[]>("/api/admin/knowledge/review"),
  adminKnowledgeStats: () => request<Record<string, unknown>>("/api/admin/knowledge/deprecate-stats"),
  adminKnowledgeProposals: () => request<Record<string, unknown>[]>("/api/admin/knowledge/proposals"),
  createKnowledge: (body: Record<string, unknown>) =>
    request<KnowledgeRow>("/api/admin/knowledge", { method: "POST", body: JSON.stringify(body) }),
  editKnowledge: (id: string, body: Record<string, unknown>) =>
    request<KnowledgeRow>(`/api/admin/knowledge/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  approveKnowledge: (id: string) =>
    request<KnowledgeRow>(`/api/admin/knowledge/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({}) }),
  archiveKnowledge: (id: string) =>
    request<KnowledgeRow>(`/api/admin/knowledge/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({}) }),
  deleteKnowledge: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" }),
  extractKnowledge: (rawId: string) =>
    request<Record<string, unknown>>(`/api/admin/knowledge/extract/${encodeURIComponent(rawId)}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  proposeKnowledgeEvolve: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/admin/knowledge/evolve/propose", { method: "POST", body: JSON.stringify(body) }),
  reviewKnowledgeProposal: (id: string, action: "approve" | "reject", reject_reason = "") =>
    request<Record<string, unknown>>(`/api/admin/knowledge/evolve/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ action, reject_reason }),
    }),
  transferKnowledgeBrand: (id: string, to_brand: string) =>
    request<Record<string, unknown>>(`/api/admin/knowledge/${encodeURIComponent(id)}/transfer`, {
      method: "POST",
      body: JSON.stringify({ to_brand }),
    }),
  uploadKnowledgeRaw: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Record<string, unknown>>("/api/admin/knowledge/upload", { method: "POST", body: fd });
  },
  cron: () => request<Record<string, unknown>>("/api/cron/risks"),
  cronJobs: () => request<{ jobs: CronJob[]; alerts?: CronAlerts }>("/api/cron/jobs"),
  createCronJob: (body: Record<string, unknown>) =>
    request<CronJob>("/api/cron/jobs", { method: "POST", body: JSON.stringify(body) }),
  cronJob: (id: string) =>
    request<{ job: CronJob; runs: CronRun[] }>(`/api/cron/jobs/${encodeURIComponent(id)}`),
  patchCronJob: (id: string, body: Record<string, unknown>) =>
    request<{ job: CronJob }>(`/api/cron/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  runCronJob: (id: string) =>
    request<{ run_id: string; session_id?: string; run?: CronRun; job?: CronJob }>(`/api/cron/jobs/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  cronJobRuns: (id: string) =>
    request<{ runs: CronRun[] }>(`/api/cron/jobs/${encodeURIComponent(id)}/runs`),
  cronRun: (runId: string) =>
    request<{ run: CronRun; job?: CronJob }>(`/api/cron/runs/${encodeURIComponent(runId)}`),
  riskScan: () => request<{ run_id: string; session_id?: string }>("/api/cron/risk-scan", { method: "POST" }),
  exam: () => fetch("/api/exam").then((r) => r.json()),
  admin: () => fetch("/api/admin").then((r) => r.json()),
  adminUsers: () => request<Record<string, unknown>[]>("/api/admin/users"),
  connectors: () => request<Record<string, unknown>[]>("/api/connectors"),
  adminConnectors: () => request<Record<string, unknown>[]>("/api/admin/connectors"),
  adminExams: () => request<Record<string, unknown>[]>("/api/admin/exams"),
  adminExamItems: (id: string) =>
    request<Record<string, unknown>[]>(`/api/admin/exams/${encodeURIComponent(id)}/items`),
  createExam: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/admin/exams", { method: "POST", body: JSON.stringify(body) }),
  addExamItem: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/admin/exams/${encodeURIComponent(id)}/items`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generateExamItems: (id: string, knowledgeIds: string[]) =>
    request<Record<string, unknown>>(`/api/admin/exams/${encodeURIComponent(id)}/generate`, {
      method: "POST",
      body: JSON.stringify({ knowledge_ids: knowledgeIds }),
    }),
  acceptExamItem: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/exam-items/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  publishExam: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/exams/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  assignExam: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/admin/exams/${encodeURIComponent(id)}/assign`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminExamScores: () => request<Record<string, unknown>[]>("/api/admin/exam-scores"),
  adminAssignments: () => request<Record<string, unknown>[]>("/api/admin/exam-assignments"),
  adminDataPolicy: () => request<Record<string, unknown>>("/api/admin/retention-policy"),
  adminAudit: () => request<Record<string, unknown>[]>("/api/audit"),
  adminSave: (path: string, body: Record<string, unknown>, method = "PUT") =>
    request<Record<string, unknown>>(path, { method, body: JSON.stringify(body) }),
  examAssignments: () => request<Record<string, unknown>[]>("/api/exams"),
  startExam: (id: string) =>
    request<Record<string, unknown>>(`/api/exams/${encodeURIComponent(id)}/start`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  examResult: (id: string) =>
    request<Record<string, unknown>>(`/api/exams/${encodeURIComponent(id)}/result`),
  submitExam: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/exams/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renameSession: (id: string, title: string) =>
    request<SessionRow>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  archiveSession: (id: string) => request<{ ok?: boolean }>(`/api/sessions/${id}/archive`, { method: "POST" }),
  unarchiveSession: (id: string) => request<{ ok?: boolean }>(`/api/sessions/${id}/unarchive`, { method: "POST" }),
  deleteSession: (id: string) => request<{ ok?: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
  shareSession: (id: string) =>
    request<{ token?: string; url?: string; expires_at?: string }>(`/api/sessions/${id}/share`, {
      method: "POST",
      body: JSON.stringify({ expires_in_seconds: 86400, include_internal: false }),
    }),
  revokeShare: (id: string) => request<{ ok?: boolean }>(`/api/sessions/${id}/share`, { method: "DELETE" }),
  sharedSession: (token: string) => request<Record<string, unknown>>(`/api/shared/${encodeURIComponent(token)}`),
  inboundSearch: (id: string, q: string) => fetch(`/api/inbound/${id}/search?q=${encodeURIComponent(q)}`).then((r) => r.json()),
  inboundBind: (id: string, collaboration_id: string) =>
    fetch(`/api/inbound/${id}/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collaboration_id }),
    }).then((r) => r.json()),
  inboundCreate: (id: string, handle: string) =>
    fetch(`/api/inbound/${id}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle }),
    }).then((r) => r.json()),
  inboundDefer: (id: string) =>
    fetch(`/api/inbound/${id}/defer`, { method: "POST" }).then((r) => r.json()),
  inboundResume: (id: string) =>
    fetch(`/api/inbound/${id}/resume`, { method: "POST" }).then((r) => r.json()),
  discoveryRequests: () => request<Array<Record<string, unknown>>>("/api/discovery/requests"),
  createDiscoveryRequest: (body: {
    keywords: string[];
    platforms: string[];
    mode?: string;
    filters?: Record<string, unknown>;
    brand?: string;
    scope?: Record<string, unknown>;
    start?: boolean;
  }) =>
    request<Record<string, unknown>>("/api/discovery/requests", {
      method: "POST",
      body: JSON.stringify({ ...body, start: body.start === true }),
    }),
  discoveryRequest: (id: string) =>
    request<Record<string, unknown>>(`/api/discovery/requests/${encodeURIComponent(id)}`),
  discoveryResults: (id: string) =>
    request<Record<string, unknown>>(`/api/discovery/requests/${encodeURIComponent(id)}/results`),
  startDiscoveryRun: (requestId: string, body?: { platform?: string }) =>
    request<Record<string, unknown>>(`/api/discovery/requests/${encodeURIComponent(requestId)}/runs`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  discoveryRun: (runId: string) =>
    request<Record<string, unknown>>(`/api/discovery/runs/${encodeURIComponent(runId)}`),
  discoveryRunCandidates: (runId: string, query?: { status?: string; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (query?.status) search.set("status", query.status);
    if (query?.limit != null) search.set("limit", String(query.limit));
    if (query?.offset != null) search.set("offset", String(query.offset));
    const qs = search.size ? `?${search}` : "";
    return request<{ items?: Array<Record<string, unknown>>; total?: number; limit?: number; offset?: number; run?: Record<string, unknown> }>(
      `/api/discovery/runs/${encodeURIComponent(runId)}/candidates${qs}`,
    );
  },
  discoveryCandidate: (id: string) =>
    request<Record<string, unknown>>(`/api/discovery/candidates/${encodeURIComponent(id)}`),
  followDiscoveryCandidate: (id: string, body?: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/discovery/candidates/${encodeURIComponent(id)}/follow`, {
      method: "POST",
      body: JSON.stringify({ confirmed: true, ...(body || {}) }),
    }),
  followDiscoveryCandidatesBatch: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/discovery/candidates/follow-batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  dismissDiscoveryCandidate: (id: string) =>
    request<Record<string, unknown>>(`/api/discovery/candidates/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  discoveryConnection: () =>
    request<Record<string, unknown>>("/api/discovery/connection"),
  checkDiscoveryConnection: () =>
    request<Record<string, unknown>>("/api/discovery/connection", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  homeDiscoveryTemplate: () =>
    request<Record<string, unknown> | null>("/api/home/discovery/template", { optional: true }),
  skillResultMemories: (skillId: string, cursor?: string) => {
    const query = new URLSearchParams({ limit: "10", ...(cursor ? { cursor } : {}) });
    return request<SkillResultMemoryPage>(`/api/skills/${encodeURIComponent(skillId)}/memories?${query.toString()}`);
  },
  homeDiscoveryRuns: () =>
    request<Record<string, unknown> | Array<Record<string, unknown>>>("/api/home/discovery/runs"),
  homeDiscoveryRun: (runId: string) =>
    request<Record<string, unknown>>(`/api/home/discovery/runs/${encodeURIComponent(runId)}`),
  retryHomeDiscoveryRun: (runId: string) =>
    request<Record<string, unknown>>(`/api/home/discovery/runs/${encodeURIComponent(runId)}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  homeDiscoveryRunCandidates: (runId: string) =>
    request<Record<string, unknown> | Array<Record<string, unknown>>>(
      `/api/home/discovery/runs/${encodeURIComponent(runId)}/candidates`,
    ),
  runHomeDiscovery: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/home/discovery/run", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ingestHomeDiscovery: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/home/discovery/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  mailBox: (box?: string) =>
    request<Record<string, unknown>>(box ? `/api/mail/box?box=${encodeURIComponent(box)}` : "/api/mail/box"),
  mailConversations: (box?: string) =>
    request<{
      entry?: string;
      creates_session?: boolean;
      mailbox?: string;
      conversations?: Array<Record<string, unknown>>;
    }>(box ? `/api/mail/conversations?box=${encodeURIComponent(box)}` : "/api/mail/conversations"),
  mailConversation: (id: string) =>
    request<Record<string, unknown>>(`/api/mail/conversations/${encodeURIComponent(id)}`),
  mailPerson: (box: string, p: string) =>
    request<Record<string, unknown>>(`/api/mail/person?box=${encodeURIComponent(box)}&p=${encodeURIComponent(p)}`),
  syncMailboxMail: (body: Record<string, unknown> = {}) =>
    request<{
      entry?: string;
      creates_session?: boolean;
      ok?: boolean;
      mailbox?: string;
      listed?: number;
      inserted?: number;
      updated?: number;
      unread?: number;
      synced_at?: string;
      cursor_at?: string;
      error?: string;
    }>("/api/mail/sync", { method: "POST", body: JSON.stringify(body) }),
  /** Optional endpoint: resolves null on 404/405 so callers can ignore silently. */
  markMailConversationRead: (id: string) =>
    request<{ ok?: boolean } | null>(`/api/mail/conversations/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: "{}",
      optional: true,
    }).catch(() => null),
  /** Optional endpoint: resolves null on 404/405; callers fall back to local state. */
  updateMailConversation: (id: string, fields: { starred?: boolean }) =>
    request<Record<string, unknown> | null>(`/api/mail/conversations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
      optional: true,
    }).catch(() => null),
};
