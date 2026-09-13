export type SessionRow = {
  id: string;
  title: string;
  archived_at?: string | null;
  agent_status?: "listening" | "running" | "waiting_approval";
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
  context?: string;
  source?: TaskSource;
  status?: TaskStatus;
  priority?: "high" | "medium" | "low" | string;
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
  promoted_at?: string | null;
  dismissed_at?: string | null;
  next_action?: string;
  next_action_code?: string | null;
  progress?: number;
  session_id?: string;
  suggested_actions?: Array<string | { label?: string; title?: string; prompt?: string }>;
  [key: string]: unknown;
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
  insights?: Task[];
  recommendations?: RecommendedTask[];
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
    missing_fields?: string[];
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
};

export type Account = {
  id?: string;
  name: string;
  handle?: string;
  email?: string;
  phone?: string;
  site?: string;
  exam_passed?: boolean;
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
  const { optional: _optional, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { credentials: "same-origin", ...init, headers });
  const body = await readJson(response);
  if (!response.ok) throw httpError(response.status, body);
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
  home: () => fetch("/api/home").then((r) => r.json()),
  homeBoard: (opts?: { refresh?: boolean }) =>
    fetch(`/api/home/board${opts?.refresh ? "?refresh=1" : ""}`).then((r) => r.json()) as Promise<{
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
  tasks: (params?: { status?: string; source?: string; priority?: string }) => {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return request<Task[] | { tasks: Task[] }>(`/api/tasks${query.size ? `?${query}` : ""}`);
  },
  taskDefinitions: () =>
    request<TaskDefinition[] | { task_definitions?: TaskDefinition[]; definitions?: TaskDefinition[] }>(
      "/api/task-definitions",
    ),
  agentManifest: () => request<AgentManifestView>("/api/agent-manifest"),
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
    fetch(`/api/collaborations/${encodeURIComponent(collaborationId)}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then((r) => r.json() as Promise<{ id: string; collaboration_id?: string; journey?: Record<string, unknown> }>),
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
  approvals: () => fetch("/api/approvals").then((r) => r.json()),
  wecomCards: () => fetch("/api/wecom/cards").then((r) => r.json()),
  decide: (id: string, decision: string, actor?: string) =>
    fetch(`/api/approvals/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, actor }),
    }).then((r) => r.json()),
  skills: () => fetch("/api/skills").then((r) => r.json()),
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
  skillMarket: () => fetch("/api/skills/market").then((r) => r.json()),
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
  cron: () => fetch("/api/cron/risks").then((r) => r.json()),
  riskScan: () => fetch("/api/cron/risk-scan", { method: "POST" }).then((r) => r.json()),
  exam: () => fetch("/api/exam").then((r) => r.json()),
  admin: () => fetch("/api/admin").then((r) => r.json()),
  adminUsers: () => request<Record<string, unknown>[]>("/api/admin/users"),
  connectors: () => request<Record<string, unknown>[]>("/api/connectors"),
  adminConnectors: () => request<Record<string, unknown>[]>("/api/admin/connectors"),
  adminExams: () => request<Record<string, unknown>[]>("/api/admin/exams"),
  adminAssignments: () => request<Record<string, unknown>[]>("/api/admin/exam-assignments"),
  adminDataPolicy: () => request<Record<string, unknown>>("/api/admin/retention-policy"),
  adminAudit: () => request<Record<string, unknown>[]>("/api/audit"),
  adminSave: (path: string, body: Record<string, unknown>, method = "PUT") =>
    request<Record<string, unknown>>(path, { method, body: JSON.stringify(body) }),
  examAssignments: () => request<Record<string, unknown>[]>("/api/exams"),
  submitExam: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/exams/${id}/submit`, {
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
};
