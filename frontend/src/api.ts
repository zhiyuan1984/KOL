export type HomePoolPage = { offset: number; limit: number; total: number; matched: number; new_count: number; next_offset: number | null };
export type HomePoolOptions = { query?: string; filter?: string; sort?: string; offset?: number; limit?: number };

export type RuntimeActionView = {
  events?: Array<{ sequence: string; source: string; state: string; recorded_at: string }>;
  created_at?: string; updated_at?: string; actor_name?: string;
  id: string; skill_id: string; operation: string; arguments: Record<string, unknown>;
  state: string; risk: "L3"; confirmation_version: string; blocked_reason: string | null;
  receipt: Record<string, unknown> | null; error_code: string | null;
  run_id?: string;
  can_retry?: boolean;
  progress?: { state: string; label: string; summary: string; replace_result: boolean; result: TaskResultCard } | null;
  crawl?: { id: string; remote_task_id: string | null; state: string; status_json: Record<string, unknown> | null; error_code: string | null;
    result_state?: string; result_error?: string | null; result_json?: { task_id: string; complete: boolean; captured_at: string; candidates: Array<{
      id: string; name: string; platform: string; source_url: string | null; followers: number | null; avg_views_10: number | null; region: string | null;
        sampled_views_count?: number; sampled_views_avg?: number | null;
        avatar_url?: string | null; direction?: string | null; ignored?: boolean; followed?: boolean; in_pool?: boolean; snapshot_version?: string;
      followers_evidence?: { state: "source_recorded" | "missing_source" | "unavailable"; raw_text: string | null;
        source_field: string | null; captured_at: string | null; parser_version: string | null };
    }> } | null } | null;
  execution?: { id: string; status: string; error_code: string | null } | null;
};
export type OperationJob = {
  id: string;
  status: "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled" | "uncertain";
  error_summary?: string | null;
  receipt?: Record<string, unknown> | null;
};
import type {
  DeclaredMountResult,
  McpImportPreview,
  McpImportResult,
  OpenApiPreview,
  OrganizationUnitsResponse,
  RuntimeConnectorConfig,
  RuntimeCredentialMetadata,
  RuntimeSkillConnector,
  RuntimeSkillTool,
  RuntimeToolDefinition,
  RuntimeToolPolicy,
  SkillCoverage,
} from "./runtimeConnectorUi.js";
import type { MailComposeLetter } from "./mail/types.js";
import type { ReplyContext } from "./mail/reply-context.js";

export type SessionRow = {
  id: string;
  title: string;
  archived_at?: string | null;
  agent_status?: "listening" | "running" | "waiting_approval" | "queued";
};

export type AdminEmployeeMailbox = {
  mailbox_email: string;
  mailbox_id: string | null;
  owner_name: string;
  status: string;
  is_default: boolean;
  updated_at: string | null;
  synced_at: string | null;
  last_error: string | null;
};

export type AdminEmployeeKol = {
  id: string;
  kol_uid: string;
  display_name: string;
  scope_brand: string;
  stage_code: string;
  mailbox_email: string | null;
  claimed_at: string | null;
};

export type AdminEmployeeContext = {
  user: Record<string, unknown>;
  mailboxes: AdminEmployeeMailbox[];
  kols: AdminEmployeeKol[];
};

export type AdminOrganizationPerson = {
  person_ref: string;
  display_name: string;
  avatar_url: string | null;
  title: string | null;
  org_unit_id: string | null;
  user_id: string | null;
};

export type AdminEmployeeTool = {
  id: string;
  label: string;
  summary: string;
  category: string;
  published: boolean;
  granted: boolean;
  assignable: boolean;
};

export type AdminAgentBinding = {
  id: string;
  agent_id: string;
  target_type: "organization_unit" | "person";
  target_id: string;
  company_id: string;
  status?: string;
  binding_version: number;
  org_version: number;
  reason?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AdminAgentAccess = {
  person_ref: string;
  user_id: string | null;
  display_name: string | null;
  via: "binding_target" | "unit_head" | "unit_member" | "ancestor_head";
  via_unit_id: string;
  via_unit_display_name: string | null;
  binding_id: string;
};

export type AdminAgentCoverage = {
  agent_id?: string;
  org_version: number;
  users: AdminAgentAccess[];
  person_refs?: string[];
  user_ids: string[];
};

export type AdminAgentRow = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "disabled";
  version: number;
  created_at?: string;
  updated_at?: string;
  skills: Array<{ agent_id: string; skill_id: string; enabled: number; version: number }>;
  bindings: AdminAgentBinding[];
  coverage: AdminAgentCoverage;
  knowledge: Array<{ id: string; skill_id: string; selector: string; enabled: number; note: string }>;
};

/** 员工维度的可用 Agent：via 说明资格来源，只有 binding_target 可直接撤销。 */
export type AdminEmployeeAgent = AdminAgentAccess & {
  id: string;
  name: string;
  status: AdminAgentRow["status"];
};

/** 绑定预览（无副作用）：before/after 为覆盖集合，added/removed 为差集明细。 */
export type AdminBindingPreview = {
  agent_id: string;
  org_version: number;
  before: { person_refs: string[]; user_ids: string[] };
  after: { person_refs: string[]; user_ids: string[] };
  added: AdminAgentAccess[];
  removed: AdminAgentAccess[];
};

export type AdminSkillRecommendation = {
  agent_id: string;
  agent_version: number;
  status: "completed";
  model: string;
  assessment_version: string;
  items: Array<{ id: string; label: string; summary: string; category?: string; rank: number; score: number; reason: string }>;
};

export type AdminAgentAuditResponse = {
  items: AdminAuditEvent[];
  next_cursor: number | string | null;
};

export type AdminAgentsResponse = {
  agents: AdminAgentRow[];
  units: Array<{ id: string; display_name: string; company_id: string; parent_id: string | null; level: number; status: string }>;
  people: Array<{ person_ref: string; display_name: string; user_id: string | null; status: string; company_id?: string | null; unit_ids?: string[] }>;
  skills: Array<{ id: string; label: string; category: string; summary: string; document_query?: boolean }>;
  bases: KnowledgeBaseRow[];
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
  handler?: Record<string, unknown>;
  active_run_status?: string | null;
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
export type TaskStatus = "pending" | "waiting" | "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | string;

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

/** Schema fields published by a Skill's interaction contract. */
export type TaskInputField = {
  key: string;
  label: string;
  kind: "single" | "multiple" | "text" | "number" | "date" | "object";
  required?: boolean;
  options_source?: string;
  options?: Array<string | { code: string; label: string }>;
  prefill?: string;
  reason?: string;
  min?: number;
  max?: number;
  default?: unknown;
};

/** Read-only projection of the authorized SKILL.md execution contract. */
export type SkillTemplate = {
  id: string;
  kind: "skill_template";
  skill_id: string;
  version: string;
  title: string;
  description: string;
  steps: string[];
  inputs: TaskInputField[];
  starter: string;
  output: { type: string; title: string };
  constraints: string[];
  evidence?: string[];
  decisions?: string[];
  recovery?: string[];
  source: "skill";
  read_only: true;
};

export type Task = {
  execution?: { run_id: string; status: string; result_ready: boolean } | null;
  id: string;
  title: string;
  description?: string;
  content?: string;
  context?: string;
  source?: TaskSource;
  status?: TaskStatus;
  created_at?: string;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  wait_reason?: string | null;
  queue_position?: number | null;
  cancelable?: boolean;
  retryable?: boolean;
  last_error?: string | null;
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
  plan_view?: "today" | "todo";
  progress?: number;
  session_id?: string;
  /** A discovery work item opens its linked run result rather than a chat session. */
  discovery_run_id?: string | null;
  /** PROD-AGENT-08: unadopted recs/insights. Formal WorkItems are candidate:false. */
  candidate?: boolean;
  /** Creation-time skill contract snapshot; legacy tasks are server-projected. */
  skill_template?: SkillTemplate | null;
  [key: string]: unknown;
};

export type TaskDetail = Task & {
  runs?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  watchers?: Array<Record<string, unknown>>;
  basis_refs?: Array<Record<string, unknown>>;
  business_events?: Array<Record<string, unknown>>;
  acceptance?: Record<string, unknown> | null;
  acceptance_history?: Array<Record<string, unknown>>;
  audit?: Array<Record<string, unknown>>;
};

export type TaskListPage = {
  items: Task[];
  page: { limit: number; next_cursor: string | null; total: number };
  as_of: string;
  request_id?: string;
  source_refs?: Array<Record<string, unknown>>;
};

export type WorkbenchTaskPage = {
  items: Task[];
  page: { limit: number; next_cursor: string | null; total_estimate: number };
  as_of: string;
  request_id?: string;
  evaluated_at: string;
  timezone: string;
  projection_version: string;
  schema_version: string;
};

/** Target ticket read-model. `Task` remains the compatibility projection during migration. */
export type Ticket = Task & {
  ticket_id: string;
  data_version?: number;
  missing_fields: string[];
  allowed_actions: string[];
  source_refs: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  watchers?: Array<Record<string, unknown>>;
  basis_refs?: Array<Record<string, unknown>>;
  business_events?: Array<Record<string, unknown>>;
  acceptance?: Record<string, unknown> | null;
  acceptance_history?: Array<Record<string, unknown>>;
  audit?: Array<Record<string, unknown>>;
};

export type WorkOrderTemplate = {
  id: string;
  template_code: string;
  version: number;
  title: string;
  description: string;
  status: "draft" | "published" | "disabled" | "retired" | string;
  automation_level: "A0" | "A1" | "A2" | "A3" | "L3" | string;
  business_category: string | null;
  trigger_event_types: string[];
  input_schema: Record<string, unknown>;
  fill_policy: Record<string, unknown>;
  acceptance_criteria: string[];
  routing_policy_code: string | null;
  stage_policy: Record<string, unknown>;
  created_by: string;
  published_by: string | null;
  created_at: string;
  published_at: string | null;
  updated_at: string;
};

export type WorkOrderTemplateDraftInput = {
  template_code: string;
  title: string;
  description?: string;
  automation_level: "A0" | "A1" | "A2" | "A3" | "L3";
  business_category?: string;
  trigger_event_types: string[];
  acceptance_criteria: string[];
  routing_policy_code?: string;
  input_schema?: Record<string, unknown>;
  fill_policy?: Record<string, unknown>;
  stage_policy?: Record<string, unknown>;
  idempotency_key: string;
};

export type WorkOrderAutomationRelease = {
  template_id: string;
  automation_level: "A1" | "A2" | "A3" | string;
  status: "enabled" | "disabled" | string;
  minimum_confidence: number;
  routing_policy_code: string | null;
  enabled_by: string | null;
  enabled_at: string | null;
  disabled_by: string | null;
  disabled_at: string | null;
  reason: string;
  created_at: string;
  updated_at: string;
};

export type AiTaskRoot = {
  workspace_allowed?: boolean;
  task_id: string;
  title: string;
  goal: string;
  status: string;
  priority: string;
  due_at: string | null;
  data_version: number;
  created_at: string;
  updated_at: string;
};

export type AiWorkOrderSummary = {
  work_order_id: string;
  template_code: string;
  template_version: number;
  template_title: string;
  status: string;
  priority: string;
  stage_code: string | null;
  title: string;
  objective: string;
  due_at: string | null;
  automation_level: string;
  automatic_created: boolean;
  automatic_assigned: boolean;
  creation_mode: "automatic" | "manual";
  assignment_origin: "automatic" | "manual_or_unverified" | "unassigned";
  routing_policy_code: string | null;
  created_at: string;
  updated_at: string;
  primary_assignee: { principal_id: string; person_ref: string | null; org_unit_id: string | null } | null;
  latest_decision: { id: string; decision_mode: string; outcome: string; status: string; confidence: number | null; created_at: string } | null;
};

export type AiTaskWorkOrderCounts = {
  total: number;
  open: number;
  blocked: number;
  waiting_review: number;
  completed: number;
  automatic_created: number;
  automatic_assigned: number;
};

export type AiTaskWorkOrderCompact = Pick<AiWorkOrderSummary,
  "work_order_id" | "template_code" | "template_version" | "template_title" |
  "status" | "stage_code" | "title" | "automation_level" |
  "automatic_created" | "automatic_assigned" | "creation_mode" |
  "assignment_origin" | "routing_policy_code" | "primary_assignee"
>;

export type AiTaskWorkOrderAggregate = {
  task: AiTaskRoot;
  work_orders: AiWorkOrderSummary[];
  verified_events: Array<{ id: string; event_type: string; occurred_at: string; summary: string; evidence_ref: string; verified_by: string; verified_at: string }>;
  counts: AiTaskWorkOrderCounts;
  current_blocking_work_order: AiWorkOrderSummary | null;
  as_of: string;
  source: "postgresql_task_work_orders" | string;
};

export type TaskCollaborationContext = {
  task_id: string; risk: "L1"; calls_model: false; version: string; cursor: number; has_more: boolean; as_of: string;
  gates: Array<{ work_order_id: string; action_id: string; configured: boolean; allowed: boolean; version: string; blockers: string[];
    prerequisites: Array<{ id: string; status: string; version: number }>;
    review: { id: string; company_id: string; status: string; version: number; round: number } | null }>;
  events: Array<{ sequence: string | number; source_type: string; source_id: string; company_id: string | null; source_version: number; event_type: string;
    before_state: { status?: string; version?: number } | null; after_state: { status?: string; version?: number }; occurred_at: string }>;
};

export type WorkOrderSuggestion = {
  decision_id: string; task_id: string; outcome: string; template_title: string; template_code: string; template_version: number;
  source_event: { id: string; summary: string; evidence_ref: string; source_version: string; occurred_at: string } | null;
  candidates: Array<{ id: string; title: string; status: string; version: number }>;
  actions: string[]; blockers: string[]; existing_work_order_id: string | null; version: string; risk: "L3";
  execution_receipt: { id: string; status: string; work_order_id: string } | null;
  automation_level: string; assignment_target: { id: string; name: string } | null;
};

export type AiTaskWorkOrderList = {
  items: Array<Pick<AiTaskWorkOrderAggregate, "task" | "counts" | "current_blocking_work_order">>;
  as_of: string;
  source: "postgresql_task_work_orders" | string;
  request_id: string;
};

export type AiTaskWorkOrderDashboard = {
  report_version: "task-work-order-dashboard.v1" | string;
  as_of: string;
  timezone: string;
  scope: "personal_authorized" | "organization_authorized" | string;
  source: "postgresql_task_work_orders" | string;
  summary: {
    tasks: { total: number; open: number; blocked: number; waiting_review: number; completed: number };
    work_orders: AiTaskWorkOrderCounts;
  };
  by_template: Array<{
    template_code: string;
    template_version: number;
    template_title: string;
    automation_level: string;
    total: number;
    automatic_created: number;
    automatic_assigned: number;
    open: number;
    blocked: number;
    waiting_review: number;
    completed: number;
  }>;
  tasks: {
    items: Array<{
      task: AiTaskRoot;
      counts: AiTaskWorkOrderCounts;
      current_blocking_work_order: AiTaskWorkOrderCompact | null;
      next_work_order: AiTaskWorkOrderCompact | null;
    }>;
    page: { limit: number; next_cursor: string | null; total: number };
  };
  request_id: string;
};

export type TicketCommandInput =
  | { action: "accept" | "cancel" | "reopen"; expected_version: number; idempotency_key: string; reason?: string }
  | { action: "complete"; expected_version: number; idempotency_key: string; acceptance_evidence: Record<string, unknown> }
  | { action: "assign" | "add_collaborator"; expected_version: number; idempotency_key: string; assignee_person_ref: string; assignee_unit_id: string; cross_group_reason?: string }
  | { action: "remove_collaborator"; expected_version: number; idempotency_key: string; assignee_person_ref: string };

export type TicketCommandResult = {
  ticket_id: string;
  action: string;
  status?: string;
  version: number;
  replayed: boolean;
  ticket?: Ticket;
};

export type TicketRun = {
  id: string;
  run_id: string;
  ticket_id: string;
  status: string;
  session_id?: string | null;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: Record<string, unknown> | string | null;
  [key: string]: unknown;
};

export type TicketTimelinePage = {
  ticket_id: string;
  items: Array<{ event_id: string; sequence: number; type: string; phase: string; status: string; occurred_at: string; safe_summary?: string | null; [key: string]: unknown }>;
  related_business_events?: Array<Record<string, unknown>>;
  next_sequence: number;
  request_id: string;
  as_of: string;
};

export type TicketSummary = {
  ticket_id: string;
  goal: string;
  progress: string;
  risk: string;
  conclusion: string | null;
  evidence_refs: Array<Record<string, unknown>>;
  source_fingerprint: string;
  producer: "rule" | string;
  status: "current" | "stale" | string;
  stale_reason?: string | null;
  [key: string]: unknown;
};

export type PersonalTicketRawCountReport = {
  report_version: "ticket-personal-raw-count.v1" | string;
  as_of: string;
  timezone: string;
  scope: "personal_authorized" | string;
  source: "postgresql_formal_tickets" | string;
  note: string;
  total_authorized: number;
  by_status: Record<string, number>;
  memberships: { created: number; assigned_primary: number; watching: number };
  request_id: string;
};

export type OrganizationTicketRawCountReport = {
  report_version: "ticket-organization-raw-count.v1" | string;
  as_of: string;
  timezone: string;
  scope: "organization_authorized" | string;
  authorization: {
    mode: "company_admin" | "organization_head" | string;
    companies: string[];
    root_units: Array<{ id: string; display_name: string; type: string }>;
  };
  source: "postgresql_formal_tickets" | string;
  note: string;
  total_authorized: number;
  by_status: Record<string, number>;
  by_assignee_unit: Array<{ org_unit_id: string; display_name: string; type: string; total: number; by_status: Record<string, number> }>;
  request_id: string;
};

export type OrganizationTicketStageRawReport = {
  report_version: "ticket-organization-stage-raw.v1" | string;
  as_of: string;
  timezone: string;
  scope: "organization_authorized" | string;
  authorization: OrganizationTicketRawCountReport["authorization"];
  source: "postgresql_formal_tickets" | string;
  note: string;
  total_authorized: number;
  by_business_category: Array<{ business_category: string; total: number; by_status: Record<string, number> }>;
  by_stage: Array<{ business_category: string; stage_group: string; stage_code: string; total: number; by_status: Record<string, number> }>;
  request_id: string;
};

export type TicketOrganizationUnit = {
  id: string;
  display_name: string;
  type: string;
  parent_id: string | null;
  level: number;
  head_person_ref: string | null;
  head_display_name: string | null;
};

export type TicketAssigneeCandidate = {
  person_ref: string;
  display_name: string;
  user_id: string | null;
  org_unit_id: string | null;
  position: string | null;
  assignable: boolean;
  quality_issue: string | null;
};

export type TicketFormBootstrap = {
  creator: {
    person_ref: string | null;
    org_unit_id: string | null;
    company_id: string | null;
    org_version: number | null;
    supervisor_person_ref: string | null;
    supervisor_user_id: string | null;
    quality_issues: string[];
  };
  organization_units: TicketOrganizationUnit[];
  assignee_candidates: TicketAssigneeCandidate[];
  formal_submission_enabled: boolean;
  quality_warnings: string[];
  request_id: string;
  as_of: string;
};

export type CreateFormalTicketInput = {
  title: string;
  goal: string;
  business_category: "kol" | "marketing" | "operations" | "data" | "general";
  stage_group?: string;
  stage_code?: string;
  priority: "important_urgent" | "important" | "urgent" | "normal" | "low";
  due_at?: string;
  no_due_reason?: string;
  timezone: string;
  acceptance_criteria: string[];
  assignee_person_ref: string;
  assignee_unit_id: string;
  cross_group_reason?: string;
  basis_refs?: Array<{ source_type: string; source_id: string; source_version?: string; occurred_at?: string; summary?: Record<string, unknown> }>;
  idempotency_key: string;
};

export type CreateFormalTicketResult = {
  ticket_id: string;
  status: "pending";
  data_version: number;
  replayed: boolean;
  org_version: number;
  created_at: string;
  request_id: string;
  as_of: string;
};

export type EditFormalTicketInput = {
  expected_version: number;
  idempotency_key: string;
  title?: string;
  goal?: string | null;
  priority?: "important_urgent" | "important" | "urgent" | "normal" | "low";
  due_at?: string | null;
  no_due_reason?: string | null;
  acceptance_criteria?: string[];
};

export type EditFormalTicketResult = {
  ticket_id: string;
  action: "edit";
  version: number;
  event_id: string;
  replayed: boolean;
  ticket: Ticket;
  request_id: string;
  as_of: string;
};

export type TicketOrganizationQualityIssue = {
  type: "person_without_account" | "person_without_org" | "unit_head_without_account";
  subject_ref: string;
  display_name: string;
  org_unit_id: string | null;
  message: string;
};

export type TicketOrganizationQualityReport = {
  registry_revision: string | null;
  seeded_at: string | null;
  active_unit_count: number;
  active_person_count: number;
  issue_count: number;
  issues: TicketOrganizationQualityIssue[];
  request_id: string;
  as_of: string;
};

export type ExecutionJob = {
  id: string;
  job_type: string;
  status: string;
  risk_level: string;
  attempts: number;
  max_attempts: number;
  lease_until?: string | null;
  error_code?: string | null;
  error_summary?: string | null;
  created_at: string;
  [key: string]: unknown;
};

export type ExecutionWorker = {
  worker_id: string;
  worker_kind: string;
  status: string;
  details?: Record<string, unknown>;
  started_at: string;
  heartbeat_at: string;
  stopped_at?: string | null;
  stale: boolean;
};

export type ExecutionOutboxHealth = Record<string, number | string | null | undefined> & {
  stale_publishing_count?: number;
  oldest_stale_publishing_updated_at?: string | null;
};

export type SchedulingRule = {
  id: string;
  version: number;
  rule_type: string;
  title: string;
  status: "draft" | "published" | "disabled" | "superseded" | string;
  scope: Record<string, unknown>;
  definition: Record<string, unknown>;
  created_by: string;
  published_by?: string | null;
  created_at: string;
  published_at?: string | null;
  updated_at: string;
};

export type SchedulingRuleSimulation = {
  id: string;
  rule_id: string;
  rule_version: number;
  rule_fingerprint: string;
  result: Record<string, unknown>;
  sample_count: number;
  matched_count: number;
  data_as_of: string;
  evaluated_by: string;
  created_at: string;
};

export type SchedulingRuleGovernance = {
  rules: Array<SchedulingRule & { fingerprint?: string }>;
  policy: { automation: string; execution_effect: string; requirement: string };
  as_of: string;
};

export type SchedulingRuleDetail = {
  rule: SchedulingRule & { fingerprint?: string };
  simulations: SchedulingRuleSimulation[];
  audit_events: Array<{
    id: string;
    action: string;
    actor_account_id: string;
    reason: string | null;
    request: Record<string, unknown>;
    result: Record<string, unknown>;
    created_at: string;
  }>;
};

export type FormalBusinessEventType =
  | "mail.reply_verified"
  | "mail.commitment_verified"
  | "deadline.quote"
  | "deadline.contract"
  | "deadline.sample"
  | "deadline.content"
  | "risk.detected"
  | "approval_or_material.missing";

export type SchedulingRuleEvaluation = {
  id: string;
  rule_id: string;
  rule_version: number;
  rule_title: string;
  rule_type: string;
  outcome: "matched" | "skipped" | "missing_fields" | string;
  ticket_id: string | null;
  scope: Record<string, unknown>;
  details: Record<string, unknown>;
  evaluated_at: string;
  evaluated_by: string;
  confirmation: {
    id: string;
    decision: "confirmed" | "dismissed" | string;
    reason: string;
    decided_by: string;
    decided_at: string;
  } | null;
  event: {
    id: string;
    event_type: FormalBusinessEventType | string;
    source_system: string;
    source_event_id: string;
    source_version: string;
    company_id: string;
    brand_id: string | null;
    region_id: string | null;
    occurred_at: string;
    summary: string;
    evidence_ref: string;
  };
};

export type SchedulingRuleEffectivenessRawReport = {
  report_version: string;
  as_of: string;
  source: string;
  timezone: string;
  totals: { rules: number; evaluations: number; distinct_events: number; matched: number; skipped: number; missing_fields: number; failed: number; confirmations_recorded: number; confirmed: number; dismissed: number; matched_pending: number };
  note: string;
  rules: Array<{
    rule_id: string;
    rule_version: number;
    title: string;
    rule_type: string;
    rule_status: string;
    published_at: string | null;
    evaluations: number;
    distinct_events: number;
    linked_tickets: number;
    by_outcome: { matched: number; skipped: number; missing_fields: number; failed: number };
    manual_confirmation: { matched_pending: number; confirmed: number; dismissed: number; confirmations_recorded: number; coverage_status: string };
    execution_effect: string;
  }>;
};

export type AdminAuditEvent = {
  id: number;
  ts: string;
  actor: string;
  event_type: string;
  payload: Record<string, unknown>;
};

export type WorkReportView = "accepted" | "processing" | "waiting" | "exception";

export type AdminWorkReportTicket = {
  ticket_id: string;
  title: string;
  status: string;
  kind: string;
  owner_user_id: string;
  owner_name?: string | null;
  due_at?: string | null;
  updated_at?: string | null;
  accepted_at?: string | null;
  attribution_status?: "accepted_owner_snapshot" | "legacy_unattributed" | string;
  accepted_owner_user_id?: string | null;
  accepted_owner_name?: string | null;
  accepted_by_user_id?: string | null;
  accepted_by_name?: string | null;
};

export type AdminWorkReport = {
  report_version: string;
  as_of: string;
  data_cutoff_at: string;
  period: { date: string; timezone: string; start: string; end: string };
  filters: { owner: string | null; kind: string | null; team: string | null };
  filter_options: {
    owners: Array<{ id: string; name: string; username: string }>;
    kinds: Array<{ id: string; count: number }>;
    teams: Array<{ id: string; name: string }>;
  };
  summary: { accepted: number; accepted_attributed: number; accepted_unattributed: number; processing: number; waiting: number; exception: number };
  employees: Array<{ user_id: string; name: string; username: string | null; site: string | null; responsible: number; processing: number; waiting: number; earliest_waiting_at: string | null; accepted: number; last_accepted_at: string | null }>;
  process: {
    blockers: Array<{ kind: "blocker"; ticket_id: string; title: string; status: string; owner_user_id: string; owner_name: string | null; due_at: string | null; occurred_at: string; ticket_kind: string }>;
    activity: Array<{ kind: "event"; event_id: string; ticket_id: string; title: string; event_type: string; label: string; status: string; safe_summary: string | null; occurred_at: string; owner_user_id: string; owner_name: string | null; ticket_kind: string }>;
  };
  attribution: { accepted_owner: string; accepted_actor: string; legacy_accepted: number; legacy_note: string | null; team_scope_note: string | null };
  contribution_note: string;
  source_refs: Array<Record<string, unknown>>;
};

export type AdminWorkReportDetail = {
  ticket: { ticket_id: string; title: string; goal: string; status: string; kind: string; source: string; owner_user_id: string; owner_name: string | null; owner_username: string | null; due_at: string | null; created_at: string; updated_at: string };
  acceptance: { accepted_at: string; acceptance_event_id: string | null; owner_user_id_at_acceptance: string | null; owner_name_at_acceptance: string | null; accepted_by_user_id: string | null; accepted_by_name: string | null; evidence: Record<string, unknown> | null; attribution_status: string; rules_version: string | null } | null;
  timeline: Array<{ event_id: string; sequence: number; type: string; label: string; status: string; safe_summary: string | null; occurred_at: string; run_id: string | null }>;
  runs: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  as_of: string;
  source_refs: Array<Record<string, unknown>>;
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
  stats?: Record<string, number | string | Record<string, number>>;
  stage_counts?: Record<string, number>;
  primary?: TodayBriefPrimary;
  sections?: TodayBriefSection[];
  todo_layout?: TodoLayoutItem[];
  reasoning?: string[];
  analysis_hints?: Array<Record<string, unknown>>;
  source_cursor?: Record<string, unknown>;
  increment_summary?: string;
};

export type TodayBriefResponse = {
  plan_id?: string | null;
  status?: "ready" | "running" | "stale" | "empty" | string;
  producer?: "deterministic_organize" | "agent_plan" | string;
  source_revision?: string | null;
  generated_at?: string | null;
  stale_reason?: string | null;
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
  execution_job_id?: string;
  job_id?: string;
  status?: "queued" | "running" | string;
  producer?: "deterministic_organize" | "agent_plan" | string;
  mode?: "deterministic_organize" | "agent_plan" | string;
  creates_session?: boolean;
  calls_model?: boolean;
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
};

export type TaskDefinition = {
  id: string;
  title: string;
  description?: string;
  prompt?: string;
  category?: string;
  skill?: string;
  skill_id?: string;
  ui_template?: SkillTemplate | null;
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

/** User-edited L2 draft preserved through task/message intake; never send authorization. */
export type ComposeInput = {
  mode: "edited_draft";
  knowledge_version: number;
  context_version?: string;
  subject: string;
  body: string;
  variables?: Record<string, unknown>;
  source_draft_id?: string | null;
};

export type EmailComposePrepareRequest = {
  skill_id: "email_compose";
  session_id?: string;
  collaboration_id?: string;
  handle?: string;
  knowledge_id?: string;
  scene_hint?: string;
  variables?: Record<string, unknown>;
  object_refs?: Array<{ kind: string; id: string; label?: string }>;
};

export type EmailComposePrepareResponse = {
  status: "ready" | "needs_context" | "needs_template" | "needs_fields" | "blocked";
  skill_id: "email_compose";
  message?: string;
  context: { collaboration_id?: string; stage_code?: string; stage_source?: string; scene?: string; brand?: string };
  template?: { knowledge_id: string; published_version: number; template_id?: string; title: string; source: "knowledge" };
  editor?: { from: string; to: string[]; subject: string; body: string };
  missing_fields: string[];
  candidates: Array<{ knowledge_id: string; title: string; published_version: number }>;
  context_version?: string;
};

export type DraftSendSnapshot = { from: string; to: string; cc: string; subject: string; body: string };
export type DraftActionView = {
  action_id: string;
  label: string;
  risk_level: "L1" | "L2" | "L3";
  state: "ready" | "blocked" | "awaiting_selection" | "awaiting_approval" | "completed";
  allowed: boolean;
  enabled: boolean;
  confirmation_version: string | null;
  disabled_reason?: string;
  selection_required: boolean;
  selection_ready: boolean;
  confirmation_required: boolean;
  approval_state: "not_required" | "required" | "pending" | "approved" | "rejected";
  receipt_id: string | null;
};
export type DraftActionsResponse = { draft_id: string; action: DraftActionView; snapshot: DraftSendSnapshot; request_id?: string; reply_context?: Pick<ReplyContext, "version" | "complete" | "sources"> };

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
  compose_input?: ComposeInput;
  /** Optimistic template version; server owns and snapshots the actual DTO. */
  skill_template_version?: string;
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
  published_version?: number | null;
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
  expires_at?: string;
  /** 分类与库（2026-10-01 契约）：族 → 域 → 库，分类不承载权限。 */
  base_id?: string;
  base_code?: string;
  base_name?: string;
  domain_id?: string;
  domain_name?: string;
  family_id?: string;
  family_name?: string;
  /** 库类型：structured | unstructured。 */
  base_kind?: string;
  /** 结构化字段（kind 专有字段的对象）。 */
  structured?: Record<string, unknown> | null;
};

/** 主题域族 / 主题域（knowledge_domains，两级分类树，只做业务归类）。 */
export type KnowledgeDomainRow = {
  id: string;
  code: string;
  name: string;
  level: "family" | "domain" | string;
  parent_id: string | null;
  sort?: number;
  status?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
};

/** 知识库容器＝容器＋策略（knowledge_bases）。 */
export type KnowledgeBaseRow = {
  id: string;
  code: string;
  name: string;
  domain_id: string;
  domain_name?: string;
  family_id?: string | null;
  family_name?: string | null;
  kind: "structured" | "unstructured" | string;
  description?: string;
  owner_user_id?: string | null;
  status?: string;
  settings?: Record<string, unknown> | null;
  external_ref?: unknown;
  version?: number;
  entries?: number;
  created_at?: string;
  updated_at?: string;
};

/** 非结构化资料（P1，2026-10-02）：PageIndex 本地流水线。 */
export type KnowledgeDocumentJobRow = {
  id: string;
  document_id: string;
  kind: "normalize" | "index" | string;
  status: "queued" | "running" | "done" | "failed" | "cancelled" | string;
  progress_done: number;
  progress_total: number;
  detail?: Record<string, unknown> | null;
  error?: string;
  attempt: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type KnowledgeDocumentRow = {
  id: string;
  base_id: string;
  base_name?: string;
  publication_label?: string;
  current_version?: number;
  title: string;
  filename: string;
  media_type: string;
  mime?: string;
  size_bytes: number;
  status: "uploaded" | "normalizing" | "indexing" | "pending_review" | "published" | "archived" | "failed" | "cancelled" | string;
  error?: string;
  retry_count: number;
  artifacts?: Record<string, unknown> | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  latest_job?: KnowledgeDocumentJobRow | null;
};

export type KnowledgeDocumentDetail = {
  actions?: {edit:boolean;start:boolean;retry:boolean;cancel:boolean;revision:boolean};
  document: KnowledgeDocumentRow;
  base: {
    id: string;
    name: string;
    kind: string;
    status: string;
    domain_name: string;
    family_name: string;
  } | null;
  jobs: KnowledgeDocumentJobRow[];
  text_preview: { name: string; text: string } | null;
};

export type KnowledgeSearchCitation = {
  document: string;
  engine_doc_id: string;
  page: number | null;
  document_id: string | null;
  title: string;
};

export type KnowledgeSearchResult = {
  answer: string;
  citations: KnowledgeSearchCitation[];
  usage?: Record<string, unknown> | null;
  engine?: { mode: string; model: string };
  scope?: {
    base_id: string;
    include_pending: boolean;
    documents: { id: string; title: string; status: string }[];
  };
};

export type KnowledgeIndexHealth = {
  ok: boolean;
  mode: string;
  python?: string;
  pageindex?: string;
  code?: string;
  message?: string;
};

/** 公海工作台四类动作的问题模板（kind='question_template' 的已发布知识）。 */
export type QuestionTemplateRow = {
  slot: string;
  knowledge_id: string;
  published_version: number;
  title: string;
  body: string;
  placeholders: string[];
  starter: string;
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
  avatar_url?: string | null;
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

export type TicketAccountBindingOptions = {
  accounts: Array<{ id: string; username: string; name: string; roles: string[]; bound_person_ref: string | null }>;
  people: Array<{ person_ref: string; display_name: string; org_unit_id: string | null; user_id: string | null }>;
  request_id: string;
  as_of: string;
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
  if(path.startsWith("/api/admin/knowledge") && typeof window!=="undefined") { const company=new URLSearchParams(window.location.search).get("reviewCompany") || sessionStorage.getItem("review.company");if(company)headers.set("X-Review-Company",company); }
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

export type TraceStatus = "pending" | "running" | "done" | "failed" | "skipped" | "interrupted";

export type ProcessTraceItem = {
  observed_at?: string;
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
  observed_at?: string;
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
  reply_context_version?: string | null;
  reply_context_stale?: boolean;
  reply_evidence?: Array<{ id: string; version: string }>;
  knowledge_id?: string | null;
  knowledge_version?: number | null;
  knowledge_title?: string | null;
  collaboration_id?: string;
  expected_version?: number;
  from: string;
  send_from?: string;
  /** 发件箱默认来源：user_binding = 当前用户挂载的邮箱。 */
  from_source?: string | null;
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

/** 「成本与预算」治理面（/admin/costs，ADR-2026-09-29）：用量是线程级估计值，金额相位未建。 */
export type AdminCostBudgetState = "unconfigured" | "disabled" | "ok" | "warn" | "stopped";

/** 预算覆盖面：公司 → Agent → 员工（闸门按此顺序判定，员工行只阻断该员工触发的新运行）。 */
export type AdminCostScope = "company" | "agent" | "user";

export type AdminCostTotals = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  events: number;
};

export type AdminCostBudgetRow = {
  scope: AdminCostScope;
  scope_ref: string;
  /** null = 不设限（不判定）。 */
  limit_tokens: number | null;
  warn_percent: number;
  hard_stop_percent: number;
  /** null = 未配置；0 = 已停用；1 = 启用。 */
  enabled: 0 | 1 | null;
  /** null = 未配置行；保存时 expected_version 传 version ?? 0。 */
  version: number | null;
  used_tokens: number;
  /** null = 无上限，不显示百分比。 */
  percent: number | null;
  state: AdminCostBudgetState;
};

export type AdminCostsSummary = {
  month: string;
  timezone: string;
  window: { start: string; end: string };
  totals: AdminCostTotals;
  agents: Array<{ agent_id: string } & AdminCostTotals>;
  /** 仅统计带 user_id 的事件，按总量倒序；名字要另取 /api/admin/users。 */
  users: Array<{ user_id: string } & AdminCostTotals>;
  budgets: AdminCostBudgetRow[];
  notes: string[];
};

export type AdminCostEventRow = {
  id: string;
  occurred_at: string;
  agent_id: string | null;
  user_id?: string | null;
  skill_id: string | null;
  session_id: string | null;
  thread_id: string | null;
  source: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number;
  cost_cents: number | null;
};

export type AdminSaveBudgetInput = {
  scope: AdminCostScope;
  scope_ref: string;
  limit_tokens: number | null;
  warn_percent?: number;
  hard_stop_percent?: number;
  enabled?: boolean;
  expected_version: number;
};

export const api = {
  replyContext: (sessionId: string) => request<ReplyContext>(`/api/queries/mail.reply-context?session_id=${encodeURIComponent(sessionId)}`),
  runtimeActions: (sessionId: string) => request<{ actions: RuntimeActionView[] }>(`/api/queries/runtime.actions?session_id=${encodeURIComponent(sessionId)}`),
  retryCrawlResults: (actionId: string) => request<{ state: string }>("/api/actions/runtime.crawl.results.retry", { method: "POST", body: JSON.stringify({ action_id: actionId }) }),
  discoveryCandidateCommand: (actionId: string, candidateId: string, verb: "follow" | "ignore" | "restore" | "ingest", snapshotVersion: string) =>
    request<{ ok: boolean }>(`/api/home/discovery/runtime/${encodeURIComponent(actionId)}/candidates/${encodeURIComponent(candidateId)}/${verb}`, {
      method: "POST", body: JSON.stringify({ snapshot_version: snapshotVersion, confirmed: verb === "follow" || verb === "ingest" }),
    }),
  confirmRuntimeAction: (id: string, version: string) => request("/api/actions/runtime.confirm", { method: "POST", body: JSON.stringify({ action_id: id, confirmation_version: version }) }),
  cancelRuntimeAction: (id: string) => request("/api/actions/runtime.cancel", { method: "POST", body: JSON.stringify({ action_id: id }) }),
  proposeCrawlStop: (id: string) => request("/api/actions/runtime.crawl.stop", { method: "POST", body: JSON.stringify({ action_id: id }) }),
  proposeCrawlRetry: (id: string) => request("/api/actions/runtime.crawl.retry", { method: "POST", body: JSON.stringify({ action_id: id }) }),
  get: (path: string) => request<unknown>(path),
  post: (path: string, body?: unknown) =>
    request<unknown>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: (path: string, body?: unknown) =>
    request<unknown>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
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
    request(`/api/home/board${opts?.refresh ? "?refresh=1" : ""}`, { cache: "no-store" }) as Promise<{
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
  tasks: (params?: { status?: string; source?: string; priority?: string; view?: string; q?: string; skill?: string; from?: string; to?: string }, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return request<Task[] | { tasks: Task[] }>(`/api/tasks${query.size ? `?${query}` : ""}`, { signal });
  },
  taskPage: (opts: { cursor?: string; limit?: number; view?: string; q?: string; from?: string; to?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(opts).forEach(([key, value]) => { if (value != null && value !== "") query.set(key, String(value)); });
    return request<TaskListPage>(`/api/tasks?${query}`);
  },
  workbenchTasks: (view: "today" | "todo", opts?: { cursor?: string; limit?: number; signal?: AbortSignal }) => {
    const query = new URLSearchParams({ view });
    if (opts?.cursor) query.set("cursor", opts.cursor);
    if (opts?.limit) query.set("limit", String(opts.limit));
    return request<WorkbenchTaskPage>(`/api/workbench/tasks?${query}`, { signal: opts?.signal });
  },
  tickets: (opts: {
    cursor?: string; limit?: number; view?: "authorized" | "created" | "assigned" | "watching" | "completed";
    status?: string; priority?: string; category?: string; stage?: string; org_unit?: string; assignee?: string; due?: "all" | "overdue" | "none"; q?: string; from?: string; to?: string;
  } = {}) => {
    const query = new URLSearchParams();
    Object.entries(opts).forEach(([key, value]) => { if (value != null && value !== "") query.set(key, String(value)); });
    return request<{ items: Ticket[]; page: { limit: number; next_cursor: string | null }; request_id: string; as_of: string; schema_version: string }>(`/api/tickets${query.size ? `?${query}` : ""}`);
  },
  aiTaskWorkOrderDashboard: (opts: { limit?: number; cursor?: string; timezone?: string } = {}) => {
    const query = new URLSearchParams();
    if (opts.limit != null) query.set("limit", String(Math.max(1, Math.min(100, Math.floor(opts.limit)))));
    if (opts.cursor) query.set("cursor", opts.cursor);
    query.set("timezone", opts.timezone || "Asia/Shanghai");
    return request<AiTaskWorkOrderDashboard>(`/api/task-work-orders/dashboard?${query}`);
  },
  aiTaskWorkOrders: (limit = 50) => request<AiTaskWorkOrderList>(`/api/task-work-orders?limit=${Math.max(1, Math.min(100, Math.floor(limit)))}`),
  createAiTaskWorkOrderRoot: (body: { title: string; goal?: string; priority?: "important_urgent" | "important" | "urgent" | "normal" | "low"; due_at?: string; idempotency_key: string }) => request<{ task: AiTaskRoot; request_id: string; as_of: string; schema_version: string }>("/api/task-work-orders/tasks", {
    method: "POST", headers: { "Idempotency-Key": body.idempotency_key }, body: JSON.stringify(body),
  }),
  aiTaskWorkOrder: (taskId: string) => request<AiTaskWorkOrderAggregate & { request_id: string }>(`/api/task-work-orders/${encodeURIComponent(taskId)}`),
  taskCollaborationContext: (taskId: string, after = 0) => request<TaskCollaborationContext>(`/api/task-work-orders/${encodeURIComponent(taskId)}/collaboration-context?after=${after}`),
  openTaskCollaborationWorkspace: (taskId: string) => request<{ id: string; task_id: string; replayed: boolean; calls_model: false }>(`/api/task-work-orders/${encodeURIComponent(taskId)}/workspace`, { method: "POST" }),
  taskSessionWorkspace: (sessionId: string) => request<{ workspace: { task_id: string; title: string; evidence_version: string } | null }>(`/api/task-work-orders/sessions/${encodeURIComponent(sessionId)}/context`),
  workOrderSuggestions: (taskId: string) => request<{ suggestions: WorkOrderSuggestion[]; calls_model: false }>(`/api/task-work-orders/${encodeURIComponent(taskId)}/suggestions`),
  adoptWorkOrderSuggestion: (decisionId: string, body: { idempotency_key: string; confirmed: true; basis_version: string; action: string; target_id?: string }) =>
    request<{ attempt: { id: string; status: string; reason_code: string | null }; work_order: { id: string; status: string; data_version: number } | null; replayed: boolean }>(`/api/task-work-orders/decisions/${encodeURIComponent(decisionId)}/adopt`, { method: "POST", body: JSON.stringify(body) }),
  recordAiTaskVerifiedEvent: (taskId: string, body: { source_system: string; source_event_id: string; source_version?: string; event_type: string; occurred_at: string; summary: string; evidence_ref: string; evidence: Record<string, unknown>; payload?: Record<string, unknown>; work_order_id?: string; idempotency_key: string }) => request<{ event: { id: string; replayed: boolean }; decision: { id: string; outcome: string; status: string; confidence: number | null }; execution_job: { id: string; status: string; job_type: string }; execution_mode: string; request_id: string }>(`/api/task-work-orders/tasks/${encodeURIComponent(taskId)}/verified-events`, {
    method: "POST", headers: { "Idempotency-Key": body.idempotency_key }, body: JSON.stringify(body),
  }),
  ticketFormBootstrap: () => request<TicketFormBootstrap>("/api/tickets/form-bootstrap"),
  adminTicketOrganizationQuality: () => request<TicketOrganizationQualityReport>("/api/admin/work-orders/data-quality"),
  adminTicketAccountBindingOptions: () => request<TicketAccountBindingOptions>("/api/admin/work-orders/account-bindings/options"),
  adminWorkOrderTemplates: (status?: string) => request<{ templates: WorkOrderTemplate[]; request_id: string; as_of: string }>(`/api/admin/work-orders/templates${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createWorkOrderTemplateDraft: (body: WorkOrderTemplateDraftInput) => request<{ template: WorkOrderTemplate; replayed: boolean; request_id: string }>("/api/admin/work-orders/templates/drafts", {
    method: "POST", headers: { "Idempotency-Key": body.idempotency_key }, body: JSON.stringify(body),
  }),
  publishWorkOrderTemplate: (id: string, body: { expected_version: number; idempotency_key: string }) => request<{ template: WorkOrderTemplate; replayed: boolean; request_id: string }>(`/api/admin/work-orders/templates/${encodeURIComponent(id)}/publish`, {
    method: "POST", headers: { "Idempotency-Key": body.idempotency_key }, body: JSON.stringify(body),
  }),
  disableWorkOrderTemplate: (id: string, body: { reason: string; idempotency_key: string }) => request<{ template: WorkOrderTemplate & { disable_reason?: string }; replayed: boolean; request_id: string }>(`/api/admin/work-orders/templates/${encodeURIComponent(id)}/disable`, {
    method: "POST", headers: { "Idempotency-Key": body.idempotency_key }, body: JSON.stringify(body),
  }),
  adminWorkOrderAutomationReleases: () => request<{ releases: WorkOrderAutomationRelease[]; request_id: string; as_of: string }>("/api/admin/work-orders/automation-releases"),
  setWorkOrderAutomationRelease: (id: string, body: { action: "enabled" | "disabled"; minimum_confidence?: number; routing_policy_code?: string; reason: string; idempotency_key: string }) => request<{ release: WorkOrderAutomationRelease; replayed: boolean; request_id: string }>(`/api/admin/work-orders/templates/${encodeURIComponent(id)}/automation-release`, {
    method: "POST", headers: { "Idempotency-Key": body.idempotency_key }, body: JSON.stringify(body),
  }),
  bindTicketAccountToOrganizationPerson: (body: { person_ref: string; account_id: string; reason: string }) =>
    request<{ person_ref: string; account_id: string; username: string; changed: boolean; prior_account_id: string | null; request_id: string }>("/api/admin/work-orders/account-bindings", { method: "POST", body: JSON.stringify(body) }),
  createFormalTicket: (body: CreateFormalTicketInput) => request<CreateFormalTicketResult>("/api/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": body.idempotency_key },
    body: JSON.stringify(body),
  }),
  editFormalTicket: (id: string, body: EditFormalTicketInput) => request<EditFormalTicketResult>(`/api/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": body.idempotency_key },
    body: JSON.stringify(body),
  }),
  ticket: (id: string) => request<Ticket & { latest_run: TicketRun | null; summary: TicketSummary; request_id: string; as_of: string }>(`/api/tickets/${encodeURIComponent(id)}`),
  ticketSummary: (id: string) => request<TicketSummary & { request_id: string; as_of: string }>(`/api/tickets/${encodeURIComponent(id)}/summary`),
  ticketTimeline: (id: string, opts: { after?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (opts.after != null) query.set("after", String(opts.after));
    if (opts.limit != null) query.set("limit", String(opts.limit));
    return request<TicketTimelinePage>(`/api/tickets/${encodeURIComponent(id)}/timeline${query.size ? `?${query}` : ""}`);
  },
  personalTicketRawCountReport: (timezone = "Asia/Shanghai") => request<PersonalTicketRawCountReport>(`/api/tickets/reports/personal?timezone=${encodeURIComponent(timezone)}`),
  organizationTicketRawCountReport: (timezone = "Asia/Shanghai") => request<OrganizationTicketRawCountReport>(`/api/tickets/reports/organization?timezone=${encodeURIComponent(timezone)}`),
  organizationTicketStageRawReport: (timezone = "Asia/Shanghai") => request<OrganizationTicketStageRawReport>(`/api/tickets/reports/organization/stages?timezone=${encodeURIComponent(timezone)}`),
  ticketCommand: (id: string, body: TicketCommandInput) =>
    request<TicketCommandResult>(`/api/tickets/${encodeURIComponent(id)}/commands`, {
      method: "POST",
      headers: { "Idempotency-Key": body.idempotency_key },
      body: JSON.stringify(body),
    }),
  ticketRun: (id: string) => request<TicketRun & { request_id: string; as_of: string }>(`/api/runs/${encodeURIComponent(id)}`),
  ticketRunEvents: (id: string, opts: { after?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (opts.after != null) query.set("after", String(opts.after));
    if (opts.limit != null) query.set("limit", String(opts.limit));
    return request<TicketTimelinePage>(`/api/runs/${encodeURIComponent(id)}/events${query.size ? `?${query}` : ""}`);
  },
  ticketRunStreamUrl: (id: string, after = 0) =>
    `/api/runs/${encodeURIComponent(id)}/stream?after=${Math.max(0, Math.floor(after))}`,
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
  pendingDiscoveryWorkspace: (id: string) => request<{ pending: PendingAsk | null }>(`/api/home/discovery/workspace/${encodeURIComponent(id)}/pending`),
  createDiscoveryWorkspace: (body: Record<string, unknown>) =>
    request<{ task_id: string; session_id: string; pending: PendingAsk | null }>("/api/home/discovery/workspace", { method: "POST", body: JSON.stringify(body) }),
  createTaskFromText: (body: Record<string, unknown>) =>
    request<FromTextResult>("/api/tasks/from-text", { method: "POST", body: JSON.stringify(body) }),
  runTask: (id: string, body: Record<string, unknown> = {}) =>
    request<TaskRunResult>(`/api/tasks/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  task: (id: string) => request<TaskDetail | { task: TaskDetail }>(`/api/tasks/${encodeURIComponent(id)}`),
  taskBySession: (sessionId: string) =>
    request<Task | { task: Task }>(`/api/tasks/by-session/${encodeURIComponent(sessionId)}`),
  taskEvents: (id: string) =>
    request<TaskEvent[] | { events: TaskEvent[] }>(`/api/tasks/${encodeURIComponent(id)}/events`),
  cancelTask: (task: { id: string; data_version?: number | null }) =>
    request<{ ticket_id: string; action: string; status: string; version: number; replayed: boolean; ticket?: Ticket }>(
      `/api/tickets/${encodeURIComponent(task.id)}/commands`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `ticket-cancel-${crypto.randomUUID()}` },
        body: JSON.stringify({
          action: "cancel",
          expected_version: Math.max(1, Number(task.data_version || 1)),
        }),
      },
    ),
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
  completeTask: (task: { id: string; data_version?: number | null }, acceptanceEvidence: Record<string, unknown>) =>
    request<{ ticket_id: string; action: string; status: string; version: number; replayed: boolean; ticket?: Ticket }>(
      `/api/tickets/${encodeURIComponent(task.id)}/commands`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `ticket-complete-${crypto.randomUUID()}` },
        body: JSON.stringify({
          action: "complete",
          expected_version: Math.max(1, Number(task.data_version || 1)),
          acceptance_evidence: acceptanceEvidence,
        }),
      },
    ),
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
    }>("/api/home/following", { signal: AbortSignal.timeout(15_000) }),
  homePool: (options: HomePoolOptions = {}) =>
    request<{
      entry?: string;
      creates_session?: boolean;
      calls_model?: boolean;
      kind?: string;
      index?: string;
      /** 红人库同步状态（app_state 同源事实），供公海空态区分「库未同步」。 */
      library?: { ok?: boolean; count?: number; synced_at?: string };
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
      page?: HomePoolPage;
    }>("/api/home/pool" + (Object.keys(options).length ? `?${new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value)]))}` : ""), { priority: "high" }),
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
      missing_metrics?: number;
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
      missing_metrics?: number;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/sync"),
  enrichPoolAvatars: () =>
    request<{
      entry?: string;
      kind?: string;
      creates_session?: boolean;
      creates_turn?: boolean;
      calls_model?: boolean;
      accepted?: boolean;
      started?: boolean;
      status?: "idle" | "running" | "succeeded" | "failed";
      ok?: boolean;
      message?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/avatar-enrich", { method: "POST", body: JSON.stringify({}) }),
  poolAvatarEnrichmentStatus: () =>
    request<{
      status?: "idle" | "running" | "succeeded" | "failed";
      ok?: boolean;
      message?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/avatar-enrich"),
  assessPoolWithJev: (kolUids?: string[], criteria?: Record<string, unknown> | null) =>
    request<{
      entry?: string;
      kind?: string;
      creates_session?: boolean;
      creates_turn?: boolean;
      calls_model?: boolean;
      accepted?: boolean;
      started?: boolean;
      status?: "idle" | "running" | "succeeded" | "failed";
      ok?: boolean;
      message?: string;
      /** 本次评分口径（AI 发现条件摘要）；空表示按公开资料通用口径。 */
      criteria_summary?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/jev-assess", {
      method: "POST",
      body: JSON.stringify({
        ...(kolUids?.length ? { kol_uids: kolUids } : {}),
        ...(criteria ? { criteria } : {}),
      }),
    }),
  poolJevAssessmentStatus: () =>
    request<{
      status?: "idle" | "running" | "succeeded" | "failed";
      ok?: boolean;
      message?: string;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/jev-assess"),
  poolCleanupPreview: () =>
    request<{
      scope?: string;
      candidate_count?: number;
      protected_active_follows?: number;
    }>("/api/home/pool/cleanup-preview"),
  cleanupPoolMissingHomepage: (expectedCount: number) =>
    request<{
      ok?: boolean;
      deleted?: number;
      candidate_count?: number;
      protected_active_follows?: number;
      items?: Array<Record<string, unknown>>;
      kols?: Array<Record<string, unknown>>;
    }>("/api/home/pool/cleanup-missing-homepage", {
      method: "POST",
      body: JSON.stringify({ expected_count: expectedCount, confirm: true }),
    }),
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
  workbenchPlan: (signal?: AbortSignal) => request<TodayBriefResponse>("/api/workbench/plan", { signal }),
  startWorkbenchPlan: () => request<TodayPlanResult>("/api/workbench/plan-runs", {
    method: "POST", body: JSON.stringify({ mode: "deterministic_organize" }),
  }),
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
  prepareEmailCompose: (body: EmailComposePrepareRequest, signal?: AbortSignal) =>
    request<EmailComposePrepareResponse>("/api/actions/mail.prepare", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
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
        compose_input: p.compose_input,
        skill_template_version: p.skill_template_version,
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
  draftActions: (id: string) =>
    request<DraftActionsResponse>(`/api/queries/mail.draft-actions?draft_id=${encodeURIComponent(id)}`),
  sendDraft: async (id: string, extra?: { confirmation_version?: string; request_id?: string }) => {
    const r = await fetch("/api/actions/mail.send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...extra, draft_id: id }),
    });
    const b = (await parse(r)) as { ok?: boolean; detail?: { message?: string; status?: string; toast_success?: boolean } };
    if (!r.ok) {
      const d = b.detail || b;
      const err = new Error((d as { message?: string }).message || JSON.stringify(d));
      (err as Error & { payload: unknown; status?: number }).payload = d;
      (err as Error & { payload: unknown; status?: number }).status = r.status;
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
    const r = await fetch("/api/actions/mail.translate-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft_id: id }) });
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
    request<Record<string, unknown>[]>(box ? `/api/approvals?box=${encodeURIComponent(box)}` : "/api/approvals"),
  approvalBadge: () => request<{ count: number }>("/api/approvals/badge"),
  approval: (id: string) => request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}`),
  wecomCards: () => request<Array<{ approval_id: string; body: string; status: string; assignee: string }>>("/api/wecom/cards"),
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
  transferApproval: (
    id: string,
    targetEmployeeId: string,
    reason?: string,
    gate?: { expected_version: number; idempotency_key: string },
  ) =>
    request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}/transfer`, {
      method: "POST",
      body: JSON.stringify({
        target_employee_id: targetEmployeeId,
        ...(reason ? { reason } : {}),
        ...(gate || {}),
      }),
    }),
  withdrawApproval: (id: string, gate?: { expected_version: number; idempotency_key: string }) =>
    request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ ...(gate || {}) }),
    }),
  countersignApproval: (
    id: string,
    targetEmployeeId: string,
    reason?: string,
    gate?: { expected_version: number; idempotency_key: string },
  ) =>
    request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}/countersign`, {
      method: "POST",
      body: JSON.stringify({
        target_employee_id: targetEmployeeId,
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
  adminSkillSop: (id: string) =>
    request<{ id: string; summary: string; body: string; updated_at: string | null; edited: boolean; draft?: boolean }>(
      `/api/admin/skills/${encodeURIComponent(id)}/sop`,
    ),
  adminSkillDraft: (id: string) =>
    request<{ id: string; patch: Record<string, unknown>; updated_at: string | null }>(
      `/api/admin/skills/${encodeURIComponent(id)}/draft`,
    ),
  adminSkillTemplate: (id: string) =>
    request<SkillTemplate>(`/api/admin/skills/${encodeURIComponent(id)}/template`),
  saveAdminSkillDraft: (id: string, patch: Record<string, unknown>) =>
    request<{ id: string; patch: Record<string, unknown>; updated_at: string | null }>(
      `/api/admin/skills/${encodeURIComponent(id)}/draft`,
      { method: "PUT", body: JSON.stringify(patch) },
    ),
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
  importAdminSkill: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/admin/skills/import", { method: "POST", body });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : "导入技能失败");
    }
    return data;
  },
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
  /** @deprecated 旧「直接技能授权」入口（仅旧页 Admin.tsx 引用，已不可达）；人员授权现以 Agent 绑定为唯一入口。 */
  saveSkillGrants: async (id: string, body: { org: string[]; team: string[]; user: string[] }): Promise<{
    id: string;
    grants: { org: string[]; team: string[]; user: string[] };
  }> => {
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
  knowledge: (opts: {
    q?: string;
    kind?: string;
    stage?: string;
    brand?: string;
    /** 分类过滤（id 或 code）：base / domain / family 逐级收窄。 */
    base?: string;
    domain?: string;
    family?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.kind) params.set("kind", opts.kind);
    if (opts.stage) params.set("stage", opts.stage);
    if (opts.brand) params.set("brand", opts.brand);
    if (opts.base) params.set("base", opts.base);
    if (opts.domain) params.set("domain", opts.domain);
    if (opts.family) params.set("family", opts.family);
    const qs = params.toString();
    return request<KnowledgeRow[]>(qs ? `/api/knowledge?${qs}` : "/api/knowledge");
  },
  kbMarket: () => request<KnowledgeRow[]>("/api/knowledge/market"),
  /** Authorized, read-only projection of published SKILL.md interaction contracts. */
  skillTemplates: (signal?: AbortSignal) => request<SkillTemplate[]>("/api/knowledge/skill-templates", { signal }),
  skillTemplate: (skillId: string) =>
    request<SkillTemplate>(`/api/knowledge/skill-templates/${encodeURIComponent(skillId)}`),
  /** 零会话、零模型：只读已发布的问题模板，供公海四个入口预填提问框。 */
  questionTemplates: () => request<QuestionTemplateRow[]>("/api/knowledge/question-templates"),
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
  adminKnowledge: (opts: { base?: string; domain?: string; family?: string; kind?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.base) params.set("base", opts.base);
    if (opts.domain) params.set("domain", opts.domain);
    if (opts.family) params.set("family", opts.family);
    if (opts.kind) params.set("kind", opts.kind);
    const qs = params.toString();
    return request<KnowledgeRow[]>(qs ? `/api/admin/knowledge?${qs}` : "/api/admin/knowledge");
  },
  /** 分类树（主题域族 / 主题域）：只做业务归类，不承载权限。 */
  adminKnowledgeDomains: () =>
    request<{ domains: KnowledgeDomainRow[] }>("/api/admin/knowledge/domains"),
  adminKnowledgeDomainCreate: (body: {
    code: string;
    name: string;
    level: "family" | "domain";
    parent_id?: string;
    sort?: number;
    note?: string;
  }) =>
    request<{ domain: KnowledgeDomainRow }>("/api/admin/knowledge/domains", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminKnowledgeDomainUpdate: (
    id: string,
    body: { name?: string; sort?: number; status?: string; note?: string },
  ) =>
    request<{ domain: KnowledgeDomainRow }>(`/api/admin/knowledge/domains/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminKnowledgeBases: (opts: { domain_id?: string; kind?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.domain_id) params.set("domain_id", opts.domain_id);
    if (opts.kind) params.set("kind", opts.kind);
    const qs = params.toString();
    return request<{ bases: KnowledgeBaseRow[] }>(qs ? `/api/admin/knowledge/bases?${qs}` : "/api/admin/knowledge/bases");
  },
  adminKnowledgeBaseCreate: (body: { code: string; name: string; domain_id: string; kind: string; description?: string }) =>
    request<{ base: KnowledgeBaseRow }>("/api/admin/knowledge/bases", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** 版本冲突返回 409：expected_version 与当前版本不一致时必须重取再提交。 */
  adminKnowledgeBaseUpdate: (
    id: string,
    body: { name?: string; description?: string; status?: string; expected_version: number },
  ) =>
    request<{ base: KnowledgeBaseRow }>(`/api/admin/knowledge/bases/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  /** 非结构化资料（P1）：上传 → 规整 → 索引 → 待审 → 发布 → 试算。 */
  adminKnowledgeDocuments: (opts: { base?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.base) params.set("base", opts.base);
    if (opts.status) params.set("status", opts.status);
    const qs = params.toString();
    return request<{ documents: KnowledgeDocumentRow[] }>(qs ? `/api/admin/knowledge/documents?${qs}` : "/api/admin/knowledge/documents");
  },
  adminKnowledgeDocument: (id: string) =>
    request<KnowledgeDocumentDetail>(`/api/admin/knowledge/documents/${encodeURIComponent(id)}`),
  adminKnowledgeDocumentUpload: (baseId: string, file: File, draft = false, onProgress?: (percent: number | null) => void) => {
    const form = new FormData();
    form.append("base_id", baseId);
    form.append("draft", String(draft));
    form.append("file", file);
    if (onProgress) return new Promise<{ document: KnowledgeDocumentRow }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/knowledge/documents");
      xhr.timeout = 45_000;
      xhr.upload.onprogress = event => onProgress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : null);
      xhr.onerror = () => reject(httpError(0, null, "上传连接中断，结果尚未确认；请刷新资料列表核对后再重试"));
      xhr.ontimeout = () => reject(httpError(0, null, "上传请求超时，结果尚未确认；请刷新资料列表核对后再重试"));
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) reject(httpError(xhr.status, body));
          else resolve(body);
        } catch { reject(httpError(xhr.status >= 400 ? xhr.status : 502)); }
      };
      xhr.send(form);
    });
    return request<{ document: KnowledgeDocumentRow }>("/api/admin/knowledge/documents", { method: "POST", body: form });
  },
  adminKnowledgeDocumentAction: (id: string, action: "start" | "retry" | "cancel" | "reprocess" | "publish" | "archive") =>
    request<{ document: KnowledgeDocumentRow }>(
      `/api/admin/knowledge/documents/${encodeURIComponent(id)}/${action}`,
      { method: "POST" },
    ),
  adminKnowledgeDocumentDelete: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminKnowledgeSearch: (body: { query: string; base_id: string; doc_ids?: string[]; include_pending?: boolean }) =>
    request<KnowledgeSearchResult>("/api/admin/knowledge/search", { method: "POST", body: JSON.stringify(body) }),
  adminKnowledgeIndexHealth: () => request<KnowledgeIndexHealth>("/api/admin/knowledge/index-health"),
  adminKnowledgeRaw: () => request<Record<string, unknown>[]>("/api/admin/knowledge/raw"),
  adminKnowledgeJobs: () => request<Record<string, unknown>[]>("/api/admin/knowledge/extract-jobs"),
  adminKnowledgeReview: () => request<KnowledgeRow[]>("/api/admin/knowledge/review"),
  adminKnowledgeStats: () => request<Record<string, unknown>>("/api/admin/knowledge/deprecate-stats"),
  adminKnowledgeProposals: () => request<Record<string, unknown>[]>("/api/admin/knowledge/proposals"),
  createKnowledge: (body: Record<string, unknown>) =>
    request<KnowledgeRow>("/api/admin/knowledge", { method: "POST", body: JSON.stringify(body) }),
  editKnowledge: (id: string, body: Record<string, unknown>) =>
    request<KnowledgeRow>(`/api/admin/knowledge/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  approveKnowledge: (id: string, expectedVersion: number) =>
    request<KnowledgeRow>(`/api/admin/knowledge/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ expected_version: expectedVersion }) }),
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
  adminKnowledgeAssets: () =>
    request<Array<KnowledgeRow & { ref_skills?: string[]; effective_at?: string; expires_at?: string }>>(
      "/api/admin/knowledge/assets",
    ),
  adminKnowledgeVersion: (id: string, version: number) =>
    request<Record<string, unknown>>(
      `/api/admin/knowledge/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}`,
    ),
  adminKnowledgeRollback: (id: string, version: number) =>
    request<KnowledgeRow>(`/api/admin/knowledge/${encodeURIComponent(id)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  adminKnowledgeGrants: (id: string) =>
    request<{ org: string[]; team: string[]; user: string[] }>(`/api/admin/knowledge/${encodeURIComponent(id)}/grants`),
  adminKnowledgeSetGrants: (id: string, body: { org: string[]; team: string[]; user: string[] }) =>
    request<{ org: string[]; team: string[]; user: string[] }>(`/api/admin/knowledge/${encodeURIComponent(id)}/grants`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminKnowledgeBindings: () => request<Record<string, unknown>[]>("/api/admin/knowledge/bindings"),
  adminKnowledgeBindingSave: (body: Record<string, unknown>) => {
    const id = String(body.id || "");
    return request<Record<string, unknown>>(
      id ? `/api/admin/knowledge/bindings/${encodeURIComponent(id)}` : "/api/admin/knowledge/bindings",
      { method: id ? "PATCH" : "POST", body: JSON.stringify(body) },
    );
  },
  adminKnowledgeBindingDelete: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/knowledge/bindings/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminKnowledgeResolvePreview: (body: { skill_id: string; user_id?: string; stage_code?: string; brand?: string }) =>
    request<{
      resolved: Array<Record<string, unknown>>;
      skipped: Array<Record<string, unknown>>;
      bindings: Array<Record<string, unknown>>;
    }>("/api/admin/knowledge/resolve-preview", { method: "POST", body: JSON.stringify(body) }),
  adminKnowledgeFeedback: () => request<Array<Record<string, unknown>>>("/api/admin/knowledge/feedback"),
  adminKnowledgeFeedbackHandle: (
    id: string,
    body: { user_id: string; action: "to_revision" | "archive" | "ignore"; note?: string },
  ) =>
    request<Record<string, unknown>>(`/api/admin/knowledge/${encodeURIComponent(id)}/feedback-handle`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cron: () => request<Record<string, unknown>>("/api/cron/risks"),
  cronJobs: () => request<{ jobs: CronJob[]; alerts?: CronAlerts }>("/api/cron/jobs"),
  adminExecutionJobs: (opts: { status?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (opts.status) query.set("status", opts.status);
    if (opts.limit) query.set("limit", String(opts.limit));
    return request<{
      items: ExecutionJob[];
      counts: Record<string, number>;
      outbox: ExecutionOutboxHealth;
      workers: ExecutionWorker[];
      backlog: { count: number; oldest_created_at: string | null };
      rules: SchedulingRule[];
      as_of: string;
      execution_mode: string;
      source_refs: Array<Record<string, unknown>>;
    }>(`/api/admin/scheduling/execution-jobs${query.size ? `?${query}` : ""}`);
  },
  adminRetryExecutionJob: (id: string) =>
    request<ExecutionJob & { retried: boolean }>(`/api/admin/scheduling/execution-jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  adminSchedulingRules: () => request<SchedulingRuleGovernance>("/api/admin/scheduling/rules"),
  adminSchedulingRule: (id: string, version?: number) =>
    request<SchedulingRuleDetail>(`/api/admin/scheduling/rules/${encodeURIComponent(id)}${version ? `?version=${version}` : ""}`),
  createSchedulingRuleDraft: (body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ rule: SchedulingRule & { fingerprint?: string }; replayed: boolean }>("/api/admin/scheduling/rules/drafts", {
      method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body),
    }),
  simulateSchedulingRule: (id: string, version: number, body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ simulation_id: string; replayed: boolean; matched_count: number; tickets: Array<Record<string, unknown>>; execution_effect: string }>(
      `/api/admin/scheduling/rules/${encodeURIComponent(id)}/versions/${version}/simulate`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) },
    ),
  publishSchedulingRule: (id: string, version: number, body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ rule: SchedulingRule; replayed: boolean; execution_effect: string; manual_confirmation_only: boolean }>(
      `/api/admin/scheduling/rules/${encodeURIComponent(id)}/versions/${version}/publish`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) },
    ),
  disableSchedulingRule: (id: string, version: number, body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ rule: SchedulingRule; replayed: boolean; execution_effect: string }>(
      `/api/admin/scheduling/rules/${encodeURIComponent(id)}/versions/${version}/disable`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) },
    ),
  restoreSchedulingRuleDraft: (id: string, version: number, body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ rule: SchedulingRule; replayed: boolean; execution_effect: string; restored_from_version: number }>(
      `/api/admin/scheduling/rules/${encodeURIComponent(id)}/versions/${version}/restore-draft`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) },
    ),
  adminSchedulingRuleEvaluations: (limit = 30) =>
    request<{ items: SchedulingRuleEvaluation[]; policy: { execution_effect: string; requirement: string }; as_of: string }>(
      `/api/admin/scheduling/rule-evaluations?limit=${Math.min(Math.max(1, Math.floor(limit)), 200)}`,
    ),
  adminSchedulingRuleEffectiveness: (limit = 100) =>
    request<SchedulingRuleEffectivenessRawReport>(
      `/api/admin/scheduling/rule-effectiveness?limit=${Math.min(Math.max(1, Math.floor(limit)), 200)}`,
    ),
  confirmSchedulingRuleEvaluation: (id: string, body: { decision: "confirmed" | "dismissed"; reason: string }, idempotencyKey: string) =>
    request<{ confirmation: { evaluation_id: string; decision: string; execution_effect: string; automatic_action: string }; replayed: boolean }>(
      `/api/admin/scheduling/rule-evaluations/${encodeURIComponent(id)}/confirmation`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) },
    ),
  recordSchedulingEventEvaluation: (body: Record<string, unknown>, idempotencyKey: string) =>
    request<{
      event: Record<string, unknown>;
      evaluations: SchedulingRuleEvaluation[];
      replayed: boolean;
      execution_effect: string;
      human_confirmation_required: boolean;
    }>("/api/admin/scheduling/events/evaluate", {
      method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body),
    }),
  adminWorkReport: (opts: { date?: string; timezone?: string; owner?: string; kind?: string; team?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(opts).forEach(([key, value]) => { if (value) query.set(key, value); });
    return request<AdminWorkReport>(`/api/admin/work-report${query.size ? `?${query}` : ""}`);
  },
  adminWorkReportTickets: (view: WorkReportView, opts: { date?: string; timezone?: string; owner?: string; kind?: string; team?: string } = {}) => {
    const query = new URLSearchParams({ view });
    Object.entries(opts).forEach(([key, value]) => { if (value) query.set(key, value); });
    return request<{ view: WorkReportView; items: AdminWorkReportTicket[]; as_of: string; source_refs: Array<Record<string, unknown>> }>(`/api/admin/work-report/tickets?${query}`);
  },
  adminWorkReportTicket: (id: string) =>
    request<AdminWorkReportDetail>(`/api/admin/work-report/tickets/${encodeURIComponent(id)}`),
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
  adminAgents: () => request<AdminAgentsResponse>("/api/admin/agents"),
  adminAgentCreate: (body: { name: string; description: string }) =>
    request<AdminAgentRow>("/api/admin/agents", { method: "POST", body: JSON.stringify(body) }),
  adminAgentUpdate: (id: string, body: { name?: string; description?: string; status?: AdminAgentRow["status"]; expected_version: number }) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminAgentSkill: (id: string, skillId: string, body: { enabled: boolean; expected_version: number }) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillId)}`,
      { method: "PUT", body: JSON.stringify(body) }),
  adminAgentSkillsSave: (id: string, skills: Array<{ skill_id: string; enabled: boolean; expected_version: number }>) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}/skills`, { method: "PUT", body: JSON.stringify({ skills }) }),
  adminAgentSkillRecommendations: (id: string, candidate_skill_ids: string[]) =>
    request<AdminSkillRecommendation>(`/api/admin/agents/${encodeURIComponent(id)}/skill-recommendations`, {
      method: "POST", body: JSON.stringify({ candidate_skill_ids }),
    }),
  adminAgentKnowledge: (id: string, skillId: string, baseId: string) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}/knowledge`,
      { method: "POST", body: JSON.stringify({ skill_id: skillId, base_id: baseId }) }),
  adminAgentBind: (id: string, body: { target_type: "organization_unit" | "person"; target_id?: string; user_id?: string; reason?: string }) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}/bindings`,
      { method: "POST", body: JSON.stringify(body) }),
  adminAgentUnbind: (id: string, bindingId: string, reason: string) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}/bindings/${encodeURIComponent(bindingId)}`,
      { method: "DELETE", body: JSON.stringify({ reason }) }),
  /** 绑定/撤销预览均为无副作用试算：返回 before/after 覆盖与 added/removed 明细。 */
  adminAgentBindingsPreview: (id: string, body: { target_type: "organization_unit" | "person"; target_id?: string; user_id?: string }) =>
    request<AdminBindingPreview>(`/api/admin/agents/${encodeURIComponent(id)}/bindings/preview`,
      { method: "POST", body: JSON.stringify(body) }),
  adminAgentBindingsBulkPreview: (id: string, targets: Array<{ target_type: "organization_unit" | "person"; target_id?: string; user_id?: string }>) =>
    request<AdminBindingPreview>(`/api/admin/agents/${encodeURIComponent(id)}/bindings/bulk-preview`, { method: "POST", body: JSON.stringify({ targets }) }),
  adminAgentBindingsBulkSave: (id: string, targets: Array<{ target_type: "organization_unit" | "person"; target_id?: string; user_id?: string }>, org_version: number, reason: string) =>
    request<{ agent: AdminAgentRow; preview: AdminBindingPreview }>(`/api/admin/agents/${encodeURIComponent(id)}/bindings/bulk`, {
      method: "POST", body: JSON.stringify({ targets, org_version, reason }),
    }),
  adminAgentRevokePreview: (id: string, bindingId: string) =>
    request<AdminBindingPreview>(`/api/admin/agents/${encodeURIComponent(id)}/bindings/${encodeURIComponent(bindingId)}/revoke-preview`,
      { method: "POST", body: JSON.stringify({}) }),
  adminAgentKnowledgeDelete: (id: string, bindingId: string) =>
    request<AdminAgentRow>(`/api/admin/agents/${encodeURIComponent(id)}/knowledge/${encodeURIComponent(bindingId)}`,
      { method: "DELETE" }),
  adminAgentAudit: (id: string, limit = 50) =>
    request<AdminAgentAuditResponse>(`/api/admin/agents/${encodeURIComponent(id)}/audit?limit=${limit}`),
  adminEmployeeAgents: (userId: string) =>
    request<{ agents: AdminEmployeeAgent[] }>(
      `/api/admin/users/${encodeURIComponent(userId)}/agents`),
  adminEmployeeContext: (userId: string) =>
    request<AdminEmployeeContext>(`/api/admin/users/${encodeURIComponent(userId)}/context`),
  adminEmployeeTools: (userId: string) =>
    request<{ tools: AdminEmployeeTool[] }>(`/api/admin/users/${encodeURIComponent(userId)}/tools`),
  adminOrganizationUnits: () => request<OrganizationUnitsResponse>("/api/admin/organization-units"),
  adminOrganizationPeople: () => request<{ people: AdminOrganizationPerson[] }>("/api/admin/organization-people"),
  adminConnectors: () => request<Record<string, unknown>[]>("/api/admin/connectors"),
  runtimeConnectorConfig: (connectorId: string) =>
    request<{ config: RuntimeConnectorConfig; version: number; probe_mode?: "directory" | "mediacrawler_start" }>(
      `/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`,
    ),
  saveRuntimeConnectorConfig: (connectorId: string, body: RuntimeConnectorConfig & { expected_version: number }) =>
    request<{ config: RuntimeConnectorConfig; version: number }>(
      `/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  runtimeCredentials: () => request<RuntimeCredentialMetadata[]>("/api/admin/runtime/credentials"),
  createRuntimeCredential: (body: {
    id?: string;
    type: RuntimeCredentialMetadata["type"];
    owner_user_id?: string;
    label?: string;
    purpose?: string;
    status?: RuntimeCredentialMetadata["status"];
    secret: string;
  }) => request<RuntimeCredentialMetadata>("/api/admin/runtime/credentials", { method: "POST", body: JSON.stringify(body) }),
  updateRuntimeCredential: (id: string, body: {
    label?: string; purpose?: string; status?: RuntimeCredentialMetadata["status"]; expected_version: number;
  }) => request<RuntimeCredentialMetadata>(`/api/admin/runtime/credentials/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRuntimeCredential: (id: string, expected_version: number) =>
    request<{ ok: boolean }>(`/api/admin/runtime/credentials/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ expected_version }) }),
  runtimeConnectorDiscovery: (connectorId: string) =>
    request<{ tools: RuntimeToolDefinition[]; authorization: string }>(
      `/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/discovery`,
    ),
  runtimeConnectorPolicies: (connectorId: string) =>
    request<RuntimeToolPolicy[]>(`/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/policies`),
  probeRuntimeConnector: (connectorId: string) =>
    request<{
      connector_id: string;
      config_version: number;
      actor_id: string;
      checked_at: string;
      status: "succeeded" | "failed" | string;
      probe_kind: "mcp_tools_list" | "http_definition" | "mediacrawler_start";
      tool_count: number;
      duration_ms: number;
      error_code: string | null;
      live_verified: boolean;
      notice: string;
    }>(`/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/probe`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  runtimeConnectorActivity: (connectorId: string, limit = 30) =>
    request<{
      probes: Array<{
        id: number;
        connector_id: string;
        config_version: number;
        actor_id: string;
        checked_at: string;
        status: string;
        probe_kind: "mcp_tools_list" | "http_definition";
        tool_count: number;
        duration_ms: number;
        error_code?: string | null;
      }>;
      events: Array<{ id: number; ts: string; actor: string; event_type: string; payload: Record<string, unknown> }>;
    }>(`/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/activity?limit=${limit}`),
  saveRuntimeConnectorPolicy: (
    connectorId: string,
    toolName: string,
    body: Pick<RuntimeToolPolicy, "enabled" | "risk" | "access" | "schema_hash"> & { expected_version: number },
  ) =>
    request<RuntimeToolPolicy>(
      `/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/tools/${encodeURIComponent(toolName)}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  uploadConnectorIcon: (connectorId: string, file: File) => {
    const fd = new FormData();
    fd.append("icon", file);
    return request<{ id: string; icon_url: string }>(`/api/admin/connectors/${encodeURIComponent(connectorId)}/icon`, {
      method: "POST",
      body: fd,
    });
  },
  importMcpConnectors: (body: { json: string; dry_run?: boolean }) =>
    request<McpImportPreview | McpImportResult>("/api/admin/connectors/import-mcp", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  previewRuntimeOpenApi: (connectorId: string, document: object | string) =>
    request<OpenApiPreview>(`/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/import-openapi`, {
      method: "POST",
      body: JSON.stringify({ document }),
    }),
  runtimeSkillCoverage: (connectorId?: string) =>
    request<SkillCoverage>(
      `/api/admin/runtime/skills/coverage${connectorId ? `?connector_id=${encodeURIComponent(connectorId)}` : ""}`,
    ),
  /** 按技能定义挂载工具：只挂 SKILL.md 声明的、连接器已登记且策略启用的工具；不启用连接器。 */
  mountRuntimeConnectorDeclaredTools: (connectorId: string, body: { skill_ids?: string[] } = {}) =>
    request<DeclaredMountResult>(
      `/api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/mount-declared`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  runtimeSkillConnectors: (skillId: string) =>
    request<RuntimeSkillConnector[]>(`/api/admin/runtime/skills/${encodeURIComponent(skillId)}/connectors`),
  saveRuntimeSkillConnector: (skillId: string, connectorId: string, body: { enabled: boolean; expected_version: number }) =>
    request<RuntimeSkillConnector>(
      `/api/admin/runtime/skills/${encodeURIComponent(skillId)}/connectors/${encodeURIComponent(connectorId)}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  runtimeSkillTools: (skillId: string) =>
    request<RuntimeSkillTool[]>(`/api/admin/runtime/skills/${encodeURIComponent(skillId)}/tools`),
  saveRuntimeSkillTool: (
    skillId: string,
    connectorId: string,
    toolName: string,
    body: { enabled: boolean; expected_version: number },
  ) =>
    request<RuntimeSkillTool>(
      `/api/admin/runtime/skills/${encodeURIComponent(skillId)}/tools/${encodeURIComponent(connectorId)}/${encodeURIComponent(toolName)}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
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
  adminAudit: () => request<Record<string, unknown>[]>("/api/audit?limit=200"),
  adminAuditEvents: (opts: { limit?: number; cursor?: number; event_type?: string; actor?: string } = {}) => {
    const query = new URLSearchParams();
    if (opts.limit) query.set("limit", String(opts.limit));
    if (opts.cursor) query.set("cursor", String(opts.cursor));
    if (opts.event_type) query.set("event_type", opts.event_type);
    if (opts.actor) query.set("actor", opts.actor);
    return request<{ items: AdminAuditEvent[]; next_cursor: number | null; as_of: string; source_refs: Array<Record<string, unknown>> }>(
      `/api/admin/audit/events${query.size ? `?${query}` : ""}`,
    );
  },
  /** 成本与预算：只读汇总 + 最近事件 + 预算写入（乐观锁版本冲突 → 409）。 */
  adminCostsSummary: (month?: string) =>
    request<AdminCostsSummary>(`/api/admin/costs/summary${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  adminCostsEvents: (limit = 50) =>
    request<{ events: AdminCostEventRow[] }>(`/api/admin/costs/events?limit=${limit}`),
  adminSaveBudget: (body: AdminSaveBudgetInput) =>
    request<AdminCostBudgetRow>("/api/admin/costs/budget", { method: "PUT", body: JSON.stringify(body) }),
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
    request<Record<string, unknown>>(box ? `/api/queries/mail.box?box=${encodeURIComponent(box)}` : "/api/queries/mail.box"),
  mailConversations: (box?: string) =>
    request<{
      entry?: string;
      creates_session?: boolean;
      mailbox?: string;
      conversations?: Array<Record<string, unknown>>;
    }>(box ? `/api/queries/mail.conversations?box=${encodeURIComponent(box)}` : "/api/queries/mail.conversations"),
  mailConversation: (id: string) =>
    request<Record<string, unknown>>(`/api/queries/mail.conversation?id=${encodeURIComponent(id)}`),
  /** Read-only stage letter catalog (email_compose contract). Never creates a session. */
  mailComposeCatalog: () =>
    request<{
      entry?: string;
      creates_session?: boolean;
      creates_turn?: boolean;
      calls_model?: boolean;
      letters?: MailComposeLetter[];
    }>("/api/queries/mail.compose-catalog"),
  mailPerson: (box: string, p: string) =>
    request<Record<string, unknown>>(`/api/queries/mail.person?box=${encodeURIComponent(box)}&p=${encodeURIComponent(p)}`),
  runMailSkill: (skillId: "mail_summary" | "mail_translate", body: { box?: string; conversation_id?: string; message_id?: string }) =>
    request<{ accepted?: boolean; pending?: boolean; mailbox?: string; skill_id?: string }>(`/api/skills/${encodeURIComponent(skillId)}/execute`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
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
      job: OperationJob;
    }>("/api/jobs/mail.sync/start", { method: "POST", body: JSON.stringify(body) }),
  operationJob: (id: string) => request<{ job: OperationJob }>(`/api/jobs/${encodeURIComponent(id)}`),
  cancelOperationJob: (id: string) => request<{ job: OperationJob }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  retryOperationJob: (id: string) => request<{ job: OperationJob }>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" }),
  /** Optional endpoint: resolves null on 404/405 so callers can ignore silently. */
  markMailConversationRead: (id: string) =>
    request<{ ok?: boolean } | null>("/api/actions/mail.read", {
      method: "POST",
      body: JSON.stringify({ id }),
      optional: true,
    }).catch(() => null),
  /** Optional endpoint: resolves null on 404/405; callers fall back to local state. */
  updateMailConversation: (id: string, fields: { starred?: boolean }) =>
    request<Record<string, unknown> | null>("/api/actions/mail.star", {
      method: "POST",
      body: JSON.stringify({ ...fields, id }),
      optional: true,
    }).catch(() => null),
};
