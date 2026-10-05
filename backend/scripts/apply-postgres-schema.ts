import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { reviewSchema } from "../src/approval/review-schema.js";
import { runtimeActionSchema } from "../src/runtime/action-schema.js";
import { crawlResultSchema } from "../src/crawl/result-schema.js";
import { candidateActionsSchema } from "../src/crawl/candidate-actions-schema.js";
import { runtimeActionEventSchema } from "../src/runtime/action-event-schema.js";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL schema migration");

/**
 * 空库基线：`pg_dump -s --no-owner --no-privileges` 导出的完整 PostgreSQL 结构。
 * 删除 SQLite 后，基线是「凭空新建一个库」的唯一入口（SQLite 的 initSchema 不再承担这个职责）。
 * 已存在的库不走基线（基线是非幂等的 CREATE TABLE），只走下面的增量清单。
 */
const BASELINE_ID = "20261003_pg_baseline";
/** 基线的导出时点已包含这些增量迁移的效果，必须在账本里补记，否则非幂等增量会重跑。 */
const BASELINED_IDS = [
  "20261002_scheduling_rules",
  "20261002_ticket_acceptances",
  "20261003_execution_delivery_leases",
  "20261003_organization_agent_bindings",
  "20261003_task_event_lifecycle_integrity",
];

const baselineSql = fs
  .readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", "pg-baseline.sql"), "utf8")
  // 去掉 psql 专有元命令（\restrict / \unrestrict）：node-pg 无法执行它们。
  .split(/\r?\n/)
  .filter((line) => line.charCodeAt(0) !== 92)
  // PostgreSQL 17+ 才有 transaction_timeout；基线可由更新版本 pg_dump
  // 生成，但正式运行环境仍支持 PostgreSQL 16。
  .filter((line) => !/^\s*SET\s+transaction_timeout\s*=/i.test(line))
  // pg_dump 会把 search_path 清空（psql 能容忍，node-pg 下未限定的语句会报 3F000
  // "no schema has been selected to create in"）；固定到 public。
  .map((line) => (line.includes("set_config('search_path'") ? "SELECT pg_catalog.set_config('search_path', 'public', false);" : line))
  .join("\n");

type SchemaMigration = {
  id: string;
  /** 纯 SQL 步骤（幂等）。与 run 二选一。 */
  statements?: string[];
  /** 需要 TS 常量或条件逻辑的步骤；同样必须幂等。 */
  run?: (client: Client) => Promise<void>;
};

const migrations: SchemaMigration[] = [
  { id: "20261005_public_pool_read_indexes", statements: [fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", "023_public_pool_read_indexes.sql"), "utf8")] },
  { id: "20261004_generic_reviews", statements: reviewSchema },
  { id: "20261004_review_operations", statements: reviewSchema },
  { id: "20261004_review_lifecycle", statements: reviewSchema },
  { id: "20261004_review_attachments", statements: reviewSchema },
  { id: "20261005_knowledge_publication", statements: [fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", "024_knowledge_publication.sql"), "utf8").replace(/\r\n/g, "\n")] },
  { id: "20261005_knowledge_publication_applications", statements: [fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", "025_knowledge_publication_applications.sql"), "utf8")] },
  { id: "20261004_runtime_actions", statements: [runtimeActionSchema] },
  { id: "20261004_discovery_results", statements: [crawlResultSchema] },
  { id: "20261005_discovery_candidate_actions", statements: [candidateActionsSchema] },
  { id: "20261005_runtime_action_events", statements: [runtimeActionEventSchema] },
  {
    id: "20261003_managed_agents",
    statements: [
      `CREATE TABLE IF NOT EXISTS managed_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('draft','published','disabled')),
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    // Phase 2：审批类型（四件套）
    id: "20261003_approval_types",
    statements: [
      `CREATE TABLE IF NOT EXISTS approval_types (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        grp TEXT NOT NULL DEFAULT '',
        owner TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'all',
        form_schema TEXT NOT NULL DEFAULT '[]',
        flow TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    // 方案3.2：审批角色授权支持有效期，到期自动回收
    id: "20261003_approval_role_validity",
    statements: [
      "ALTER TABLE approval_role_bindings ADD COLUMN IF NOT EXISTS valid_from TEXT",
      "ALTER TABLE approval_role_bindings ADD COLUMN IF NOT EXISTS valid_to TEXT",
    ],
  },
  {
    // 已确认决策①：审批角色数据模型区分职位角色/指定自然人
    id: "20261003_approval_role_kind",
    statements: [
      "ALTER TABLE approval_role_bindings ADD COLUMN IF NOT EXISTS role_kind TEXT NOT NULL DEFAULT 'position'",
      "UPDATE approval_role_bindings SET role_kind='named' WHERE approval_role='zhang' AND role_kind='position'",
    ],
  },
  {
    // 与 SQLite initSchema 的 knowledge_taxonomy_v1 种子对齐：pg-baseline.sql 是
    // 纯结构 dump，全新 PG 库没有 knowledge_bases 行，启动时 seedKnowledge 会因
    // defaultStructuredBaseId() 找不到 active structured 库而抛 knowledge_base_required。
    id: "20261003_knowledge_taxonomy_seed",
    statements: [
      `INSERT INTO knowledge_domains (id,code,name,level,parent_id,sort,status,created_at,updated_at)
       VALUES ('kdom_uncategorized','uncategorized','未分类','family',NULL,999,'active',NOW()::text,NOW()::text)
       ON CONFLICT (id) DO NOTHING`,
      `INSERT INTO knowledge_domains (id,code,name,level,parent_id,sort,status,created_at,updated_at)
       VALUES ('kdom_legacy','legacy','未分类','domain','kdom_uncategorized',999,'active',NOW()::text,NOW()::text)
       ON CONFLICT (id) DO NOTHING`,
      `INSERT INTO knowledge_bases (id,code,name,domain_id,kind,description,status,settings,version,created_at,updated_at)
       VALUES ('kbase_legacy','legacy','历史知识','kdom_legacy','structured','2026-10-01 分层迁移前的历史条目','active','{}',1,NOW()::text,NOW()::text)
       ON CONFLICT (id) DO NOTHING`,
      `UPDATE knowledge SET base_id='kbase_legacy' WHERE base_id IS NULL OR base_id=''`,
    ],
  },
  {
    // A fresh PostgreSQL authority must not depend on a historical SQLite
    // snapshot merely to create the formal ticket and execution backbone.
    id: "20261001_postgres_ticket_execution_bootstrap",
    statements: [
      `CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, task_type TEXT NOT NULL, title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'normal',
        skill TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT '', project_id TEXT, collaboration_id TEXT, session_id TEXT,
        due_at TEXT, last_acted_at TEXT, acknowledged_at TEXT, promoted_at TEXT, dismissed_at TEXT, started_at TEXT, completed_at TEXT,
        input JSONB NOT NULL DEFAULT '{}'::jsonb, entities JSONB NOT NULL DEFAULT '{}'::jsonb, data_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'general', channel TEXT NOT NULL DEFAULT 'human',
        requester_type TEXT NOT NULL DEFAULT 'human', requester_id TEXT, object_type TEXT, object_id TEXT, kind_version INTEGER NOT NULL DEFAULT 1
      )`,
      "CREATE INDEX IF NOT EXISTS tickets_owner_updated_idx ON tickets(owner_user_id,updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS tickets_status_updated_idx ON tickets(status,updated_at DESC)",
      `CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, session_id TEXT, thread_id TEXT, turn_id TEXT,
        worker_id TEXT, status TEXT NOT NULL DEFAULT 'pending', input JSONB NOT NULL DEFAULT '{}'::jsonb, entities JSONB NOT NULL DEFAULT '{}'::jsonb,
        error JSONB, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS task_runs_ticket_created_idx ON task_runs(work_item_id,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, run_id TEXT REFERENCES task_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL, event_type TEXT NOT NULL, event_class TEXT NOT NULL DEFAULT 'run_trace', label TEXT NOT NULL, status TEXT NOT NULL,
        safe_summary TEXT, time TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(work_item_id,sequence)
      )`,
      "CREATE INDEX IF NOT EXISTS task_events_ticket_sequence_idx ON task_events(work_item_id,sequence)",
      `CREATE TABLE IF NOT EXISTS execution_jobs (
        id TEXT PRIMARY KEY, job_type TEXT NOT NULL, tenant_ref TEXT NOT NULL, actor_ref TEXT NOT NULL,
        object_ref_json JSONB NOT NULL DEFAULT '{}'::jsonb, ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, trigger_event_id TEXT, rule_id TEXT, rule_version TEXT,
        risk_level TEXT NOT NULL DEFAULT 'low', idempotency_key TEXT NOT NULL UNIQUE, scope_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        priority_class TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 1, lease_until TEXT, lease_owner TEXT, next_attempt_at TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, receipt_json JSONB, error_code TEXT, error_summary TEXT,
        created_at TEXT NOT NULL, started_at TEXT, terminal_at TEXT, updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS execution_jobs_ready ON execution_jobs(status,next_attempt_at,created_at)",
      `CREATE TABLE IF NOT EXISTS execution_outbox (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE, event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL, published_at TEXT, publisher_id TEXT, publisher_lease_until TEXT, last_error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS execution_outbox_ready ON execution_outbox(status,available_at,created_at)",
    ],
  },
  {
    id: "20261002_ticket_acceptances",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_acceptances (
        ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        acceptance_event_id TEXT,
        accepted_at TEXT NOT NULL,
        owner_user_id_at_acceptance TEXT NOT NULL,
        accepted_by_user_id TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        rules_version TEXT NOT NULL DEFAULT 'ticket-acceptance.v1',
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_acceptances_accepted_at ON ticket_acceptances(accepted_at DESC, ticket_id)",
      "CREATE INDEX IF NOT EXISTS ticket_acceptances_owner_accepted_at ON ticket_acceptances(owner_user_id_at_acceptance, accepted_at DESC)",
    ],
  },
  {
    id: "20261002_scheduling_rules",
    statements: [
      `CREATE TABLE IF NOT EXISTS scheduling_rules (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        rule_type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','published','disabled','superseded')),
        scope_json TEXT NOT NULL DEFAULT '{}',
        definition_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL,
        published_by TEXT,
        created_at TEXT NOT NULL,
        published_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(id, version)
      )`,
      "CREATE INDEX IF NOT EXISTS scheduling_rules_status ON scheduling_rules(status, rule_type, updated_at)",
    ],
  },
  {
    id: "20261003_organization_agent_bindings",
    statements: [
      `CREATE TABLE IF NOT EXISTS organization_units (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_id TEXT,
        level INTEGER NOT NULL CHECK (level >= 1),
        head_person_ref TEXT,
        head_display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        org_version INTEGER NOT NULL DEFAULT 1 CHECK (org_version >= 1),
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS organization_units_parent_idx ON organization_units(company_id, parent_id, level)",
      `CREATE TABLE IF NOT EXISTS organization_people (
        person_ref TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        user_ref TEXT,
        user_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY,
        person_ref TEXT NOT NULL,
        company_id TEXT NOT NULL,
        org_unit_id TEXT NOT NULL,
        relation TEXT NOT NULL DEFAULT 'primary' CHECK (relation IN ('primary','collaborative')),
        position TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
        effective_from TEXT,
        effective_to TEXT,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_active_uniq ON organization_memberships(person_ref, org_unit_id, relation) WHERE status = 'active'",
      `CREATE TABLE IF NOT EXISTS scope_memberships (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('person','organization_unit')),
        subject_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        brand_id TEXT,
        region_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
        effective_from TEXT,
        effective_to TEXT,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS scope_memberships_subject_idx ON scope_memberships(subject_type, subject_id, status)",
      `CREATE TABLE IF NOT EXISTS agent_bindings (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('organization_unit','person')),
        target_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
        binding_version INTEGER NOT NULL DEFAULT 1 CHECK (binding_version >= 1),
        org_version INTEGER NOT NULL CHECK (org_version >= 1),
        created_by TEXT,
        reason TEXT,
        effective_from TEXT,
        effective_to TEXT,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS agent_bindings_active_uniq ON agent_bindings(agent_id, target_type, target_id) WHERE status = 'active'",
      `CREATE TABLE IF NOT EXISTS org_versions (
        company_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        effective_at TEXT NOT NULL,
        note TEXT,
        source TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (company_id, version)
      )`,
    ],
  },

  {
    id: "20261003_task_event_lifecycle_integrity",
    statements: [
      "ALTER TABLE task_events ADD COLUMN IF NOT EXISTS event_class TEXT NOT NULL DEFAULT 'run_trace'",
      `UPDATE task_events SET event_class=CASE
        WHEN event_type IN ('task.completed','task.failed') THEN 'legacy'
        WHEN event_type LIKE 'task.%' THEN 'lifecycle'
        ELSE 'run_trace'
      END`,
      "ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_event_class_check",
      "ALTER TABLE task_events ADD CONSTRAINT task_events_event_class_check CHECK (event_class IN ('lifecycle','run_trace','legacy'))",
      `CREATE OR REPLACE FUNCTION prevent_lifecycle_task_event_mutation()
       RETURNS trigger AS $$
       BEGIN
         IF OLD.event_class = 'lifecycle' THEN
           RAISE EXCEPTION 'lifecycle task event is immutable';
         END IF;
         IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS task_events_lifecycle_no_mutation ON task_events",
      `CREATE TRIGGER task_events_lifecycle_no_mutation
       BEFORE UPDATE OR DELETE ON task_events
       FOR EACH ROW EXECUTE FUNCTION prevent_lifecycle_task_event_mutation()`,
    ],
  },
  {
    id: "20261003_execution_delivery_leases",
    statements: [
      "ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT",
      "CREATE INDEX IF NOT EXISTS execution_jobs_running_lease ON execution_jobs(status, lease_until)",
      "ALTER TABLE execution_outbox ADD COLUMN IF NOT EXISTS publisher_id TEXT",
      "ALTER TABLE execution_outbox ADD COLUMN IF NOT EXISTS publisher_lease_until TEXT",
      "CREATE INDEX IF NOT EXISTS execution_outbox_publishing_lease ON execution_outbox(status, publisher_lease_until)",
    ],
  },
  {
    id: "20261003_ticket_domain_core",
    statements: [
      "CREATE EXTENSION IF NOT EXISTS pgcrypto",
      "ALTER TABLE organization_people ADD COLUMN IF NOT EXISTS starry_open_id TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS goal TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS next_action TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS business_category TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS stage_group TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS stage_code TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS no_due_reason TEXT",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb",
      "CREATE INDEX IF NOT EXISTS tickets_business_stage_open_idx ON tickets(business_category,stage_code,updated_at DESC) WHERE status NOT IN ('completed','cancelled')",
      `CREATE TABLE IF NOT EXISTS ticket_org_scopes (
        ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        center_unit_id TEXT,
        department_unit_id TEXT,
        assignee_unit_id TEXT NOT NULL,
        org_version INTEGER NOT NULL CHECK (org_version >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_org_scopes_assignee_unit_idx ON ticket_org_scopes(company_id,assignee_unit_id)",
      `CREATE TABLE IF NOT EXISTS ticket_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        assignee_person_ref TEXT,
        assignee_user_id TEXT,
        org_unit_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('primary','collaborator')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','ended')),
        cross_group_reason TEXT,
        assigned_by_user_id TEXT,
        assignment_version INTEGER NOT NULL DEFAULT 1 CHECK (assignment_version >= 1),
        effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
        effective_to TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS ticket_assignments_one_active_primary ON ticket_assignments(ticket_id) WHERE status='active' AND role='primary'",
      "CREATE INDEX IF NOT EXISTS ticket_assignments_active_assignee_idx ON ticket_assignments(assignee_user_id,status,effective_from DESC)",
      `CREATE TABLE IF NOT EXISTS ticket_watchers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        watcher_person_ref TEXT,
        watcher_user_id TEXT,
        reason TEXT NOT NULL CHECK (reason IN ('creator_supervisor','explicit','rule_escalation')),
        automatic BOOLEAN NOT NULL DEFAULT true,
        org_version INTEGER NOT NULL CHECK (org_version >= 1),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        removed_at TIMESTAMPTZ
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS ticket_watchers_active_uniq ON ticket_watchers(ticket_id,watcher_person_ref,reason) WHERE status='active'",
      "CREATE INDEX IF NOT EXISTS ticket_watchers_visible_idx ON ticket_watchers(watcher_user_id,status,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS ticket_basis_refs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version TEXT,
        occurred_at TIMESTAMPTZ,
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(ticket_id,source_type,source_id,source_version)
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_basis_refs_source_idx ON ticket_basis_refs(source_type,source_id,occurred_at DESC)",
      `CREATE TABLE IF NOT EXISTS ticket_rule_evaluations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_event_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        business_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        outcome TEXT NOT NULL CHECK (outcome IN ('matched','created','updated','skipped','missing_fields','failed','simulated')),
        ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key TEXT NOT NULL UNIQUE,
        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        evaluated_by TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_rule_evaluations_rule_idx ON ticket_rule_evaluations(rule_id,rule_version,evaluated_at DESC)",
      "CREATE INDEX IF NOT EXISTS ticket_rule_evaluations_event_idx ON ticket_rule_evaluations(source_event_id,evaluated_at DESC)",
      `CREATE TABLE IF NOT EXISTS ticket_create_receipts (
        idempotency_key TEXT PRIMARY KEY,
        requester_user_id TEXT NOT NULL,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        response_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS ticket_audit_events (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        actor_user_id TEXT NOT NULL,
        command TEXT NOT NULL,
        request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_audit_events_ticket_created_idx ON ticket_audit_events(ticket_id,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS ticket_org_seed_state (
        seed_key TEXT PRIMARY KEY,
        registry_revision TEXT NOT NULL,
        seeded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        seeded_by TEXT NOT NULL DEFAULT 'system'
      )`,
    ],
  },
  {
    id: "20261003_ticket_command_receipts_native",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_command_receipts (
        idempotency_key TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        result_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_command_receipts_ticket_idx ON ticket_command_receipts(ticket_id,created_at DESC)",
    ],
  },
  {
    id: "20261003_cron_native_scheduler",
    statements: [
      `CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        job_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        owner_account_id TEXT,
        execute_as TEXT NOT NULL,
        capability_expert_id TEXT NOT NULL,
        handler_key TEXT NOT NULL,
        scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        condition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        cron_expr TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        status TEXT NOT NULL CHECK (status IN ('draft','published','paused','disabled')),
        retry_policy_json JSONB NOT NULL DEFAULT '{"max_attempts":1,"backoff_sec":0}'::jsonb,
        takeover_policy_json JSONB NOT NULL DEFAULT '{"after_minutes":30,"action":"needs_takeover"}'::jsonb,
        published_rev INTEGER NOT NULL DEFAULT 1 CHECK (published_rev >= 1),
        next_run_at TIMESTAMPTZ,
        last_run_at TIMESTAMPTZ,
        last_terminal_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS cron_jobs_due_idx ON cron_jobs(status,next_run_at) WHERE next_run_at IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS cron_jobs_owner_idx ON cron_jobs(owner_account_id,updated_at DESC)",
      `CREATE TABLE IF NOT EXISTS cron_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL CHECK (trigger IN ('schedule','manual','retry','recovery')),
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped','needs_takeover')),
        scheduled_for TEXT NOT NULL,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        error_code TEXT,
        error_summary TEXT,
        receipt_json JSONB,
        artifact_refs JSONB,
        session_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(job_id,scheduled_for)
      )`,
      "CREATE INDEX IF NOT EXISTS cron_runs_job_created_idx ON cron_runs(job_id,created_at DESC)",
      "CREATE INDEX IF NOT EXISTS cron_runs_status_created_idx ON cron_runs(status,created_at)",
      `CREATE TABLE IF NOT EXISTS execution_worker_heartbeats (
        worker_id TEXT PRIMARY KEY,
        worker_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        stopped_at TIMESTAMPTZ
      )`,
      "CREATE INDEX IF NOT EXISTS execution_worker_heartbeats_recent_idx ON execution_worker_heartbeats(heartbeat_at DESC)",
    ],
  },
  {
    // These writers still require domain repositories that have not yet been
    // migrated from the historical compatibility layer. Disable them rather
    // than allowing a PostgreSQL Cron worker to invoke SQLite-shaped effects.
    id: "20261003_disable_unmigrated_cron_writers",
    statements: [
      `UPDATE cron_jobs
          SET status='disabled', next_run_at=NULL, updated_at=now()
        WHERE owner_account_id IS NULL
          AND handler_key IN ('ownership-release','mail-memory-increment')
          AND status <> 'disabled'`,
    ],
  },
  {
    // `ticket_acceptances` remains a current-state projection. Every formal
    // acceptance is preserved here so reopening can clear the projection
    // without deleting the historical acceptance fact.
    id: "20261003_ticket_acceptance_history",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_acceptance_history (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        acceptance_event_id TEXT NOT NULL,
        acceptance_version INTEGER NOT NULL CHECK (acceptance_version >= 1),
        accepted_at TIMESTAMPTZ NOT NULL,
        owner_user_id_at_acceptance TEXT NOT NULL,
        accepted_by_user_id TEXT NOT NULL,
        evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        rules_version TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(ticket_id,acceptance_version),
        UNIQUE(acceptance_event_id)
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_acceptance_history_ticket_idx ON ticket_acceptance_history(ticket_id,accepted_at DESC)",
      `INSERT INTO ticket_acceptance_history
       (id,ticket_id,acceptance_event_id,acceptance_version,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
       SELECT 'legacy-current:' || ticket_id,ticket_id,COALESCE(acceptance_event_id,'legacy-current:' || ticket_id),1,
              accepted_at::timestamptz,owner_user_id_at_acceptance,accepted_by_user_id,
              CASE WHEN jsonb_typeof(evidence_json::jsonb) IS NULL THEN '{}'::jsonb ELSE evidence_json::jsonb END,
              rules_version,created_at::timestamptz
         FROM ticket_acceptances
       ON CONFLICT DO NOTHING`,
    ],
  },
  {
    // Formal ticket identity is intentionally separate from the historical
    // application `users` table. PostgreSQL-only deployments start from new,
    // explicit accounts and never import a SQLite login or session.
    id: "20261003_ticket_identity_native",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT,
        roles JSONB NOT NULL DEFAULT '["employee"]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS ticket_accounts_username_ci_uniq ON ticket_accounts(lower(username))",
      "CREATE INDEX IF NOT EXISTS ticket_accounts_active_idx ON ticket_accounts(active,updated_at DESC)",
      `CREATE TABLE IF NOT EXISTS ticket_auth_sessions (
        token_digest TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_auth_sessions_account_idx ON ticket_auth_sessions(account_id,expires_at DESC)",
    ],
  },
  {
    // A one-row lock serializes first-account setup without attempting to lock
    // an aggregate result (which PostgreSQL deliberately rejects).
    id: "20261003_ticket_identity_setup_lock",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_identity_setup_lock (
        lock_key TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ],
  },
  {
    // Explicit enrollment is the only way an account without a controlled
    // registry username becomes a formal-ticket creator, assignee or watcher.
    id: "20261003_ticket_account_organization_bindings",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_account_organization_bindings (
        id TEXT PRIMARY KEY,
        person_ref TEXT NOT NULL REFERENCES organization_people(person_ref) ON DELETE RESTRICT,
        account_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        prior_account_id TEXT,
        actor_account_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_account_organization_bindings_person_idx ON ticket_account_organization_bindings(person_ref,created_at DESC)",
      "CREATE INDEX IF NOT EXISTS ticket_account_organization_bindings_account_idx ON ticket_account_organization_bindings(account_id,created_at DESC)",
      `CREATE OR REPLACE FUNCTION prevent_ticket_account_binding_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ticket account organization bindings are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS ticket_account_organization_bindings_no_mutation ON ticket_account_organization_bindings",
      `CREATE TRIGGER ticket_account_organization_bindings_no_mutation
       BEFORE UPDATE OR DELETE ON ticket_account_organization_bindings
      FOR EACH ROW EXECUTE FUNCTION prevent_ticket_account_binding_mutation()`,
    ],
  },
  {
    // Rule versions may be published only after a recorded, no-side-effect
    // simulation. These audit/receipt tables are additive because the original
    // scheduling_rules migration can already exist in deployed databases.
    id: "20261003_scheduling_rule_governance",
    statements: [
      `CREATE TABLE IF NOT EXISTS scheduling_rule_simulations (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        rule_fingerprint TEXT NOT NULL,
        input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
        matched_count INTEGER NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
        data_as_of TIMESTAMPTZ NOT NULL,
        evaluated_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (rule_id,rule_version) REFERENCES scheduling_rules(id,version) ON DELETE RESTRICT
      )`,
      "CREATE INDEX IF NOT EXISTS scheduling_rule_simulations_rule_idx ON scheduling_rule_simulations(rule_id,rule_version,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS scheduling_rule_audit_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        action TEXT NOT NULL CHECK (action IN ('draft_created','draft_superseded','published_superseded','simulated','published','disabled')),
        actor_account_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        reason TEXT,
        request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (rule_id,rule_version) REFERENCES scheduling_rules(id,version) ON DELETE RESTRICT
      )`,
      "CREATE INDEX IF NOT EXISTS scheduling_rule_audit_events_rule_idx ON scheduling_rule_audit_events(rule_id,rule_version,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS scheduling_rule_command_receipts (
        idempotency_key TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        action TEXT NOT NULL CHECK (action IN ('create_draft','simulate','publish','disable')),
        actor_account_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (rule_id,rule_version) REFERENCES scheduling_rules(id,version) ON DELETE RESTRICT
      )`,
      "CREATE INDEX IF NOT EXISTS scheduling_rule_command_receipts_rule_idx ON scheduling_rule_command_receipts(rule_id,rule_version,created_at DESC)",
    ],
  },
  {
    // Formal event intake is deliberately separate from the historical
    // SQLite-shaped business_events table. A verified event can only produce
    // auditable, manual-confirmation rule suggestions in this phase.
    id: "20261003_ticket_business_events_native",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_business_events (
        id TEXT PRIMARY KEY,
        source_system TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        source_version TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL CHECK (event_type IN (
          'mail.reply_verified','mail.commitment_verified',
          'deadline.quote','deadline.contract','deadline.sample','deadline.content',
          'risk.detected','approval_or_material.missing'
        )),
        company_id TEXT NOT NULL,
        brand_id TEXT,
        region_id TEXT,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE RESTRICT,
        occurred_at TIMESTAMPTZ NOT NULL,
        summary TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        verified_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(source_system,source_event_id,source_version)
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_business_events_scope_idx ON ticket_business_events(company_id,event_type,occurred_at DESC)",
      "CREATE INDEX IF NOT EXISTS ticket_business_events_ticket_idx ON ticket_business_events(ticket_id,occurred_at DESC) WHERE ticket_id IS NOT NULL",
      `CREATE OR REPLACE FUNCTION prevent_ticket_business_event_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ticket business events are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS ticket_business_events_no_mutation ON ticket_business_events",
      `CREATE TRIGGER ticket_business_events_no_mutation
       BEFORE UPDATE OR DELETE ON ticket_business_events
      FOR EACH ROW EXECUTE FUNCTION prevent_ticket_business_event_mutation()`,
    ],
  },
  {
    // A human decision closes review of one matched suggestion. It is
    // immutable and intentionally does not invoke an execution side effect.
    id: "20261003_ticket_rule_confirmation_decisions",
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_rule_confirmation_decisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        evaluation_id UUID NOT NULL UNIQUE REFERENCES ticket_rule_evaluations(id) ON DELETE RESTRICT,
        decision TEXT NOT NULL CHECK (decision IN ('confirmed','dismissed')),
        reason TEXT NOT NULL,
        decided_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL UNIQUE,
        decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS ticket_rule_confirmation_decisions_actor_idx ON ticket_rule_confirmation_decisions(decided_by,decided_at DESC)",
      `CREATE OR REPLACE FUNCTION prevent_ticket_rule_confirmation_decision_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ticket rule confirmation decisions are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS ticket_rule_confirmation_decisions_no_mutation ON ticket_rule_confirmation_decisions",
      `CREATE TRIGGER ticket_rule_confirmation_decisions_no_mutation
       BEFORE UPDATE OR DELETE ON ticket_rule_confirmation_decisions
       FOR EACH ROW EXECUTE FUNCTION prevent_ticket_rule_confirmation_decision_mutation()`,
    ],
  },
  {
    // 正式工单不再建立第二套账号或密码。现有工作台会话是唯一认证入口；
    // PostgreSQL 仅保存该已认证主体的可审计授权映射和快照，供工单、规则与
    // 调度事实引用。历史 ticket-auth 账号保留为审计历史，但不会再用于登录。
    id: "20261004_workbench_principal_bindings",
    statements: [
      "ALTER TABLE ticket_accounts ADD COLUMN IF NOT EXISTS identity_provider TEXT NOT NULL DEFAULT 'retired_ticket_login'",
      "ALTER TABLE ticket_accounts DROP CONSTRAINT IF EXISTS ticket_accounts_identity_provider_check",
      "ALTER TABLE ticket_accounts ADD CONSTRAINT ticket_accounts_identity_provider_check CHECK (identity_provider IN ('workbench_session','retired_ticket_login'))",
      "CREATE INDEX IF NOT EXISTS ticket_accounts_identity_provider_idx ON ticket_accounts(identity_provider,active,updated_at DESC)",
      `CREATE TABLE IF NOT EXISTS workbench_principal_bindings (
        workbench_user_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL UNIQUE REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        username_snapshot TEXT NOT NULL,
        name_snapshot TEXT NOT NULL,
        email_snapshot TEXT,
        roles_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT true,
        source TEXT NOT NULL DEFAULT 'workbench_session',
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS workbench_principal_bindings_active_idx ON workbench_principal_bindings(active,last_seen_at DESC)",
      `CREATE TABLE IF NOT EXISTS workbench_principal_binding_events (
        id TEXT PRIMARY KEY,
        workbench_user_id TEXT NOT NULL REFERENCES workbench_principal_bindings(workbench_user_id) ON DELETE RESTRICT,
        principal_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        event_type TEXT NOT NULL CHECK (event_type IN ('bound','claims_refreshed','deactivated')),
        claims_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS workbench_principal_binding_events_principal_idx ON workbench_principal_binding_events(principal_id,occurred_at DESC)",
      `CREATE OR REPLACE FUNCTION prevent_workbench_principal_binding_event_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'workbench principal binding events are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS workbench_principal_binding_events_no_mutation ON workbench_principal_binding_events",
      `CREATE TRIGGER workbench_principal_binding_events_no_mutation
       BEFORE UPDATE OR DELETE ON workbench_principal_binding_events
       FOR EACH ROW EXECUTE FUNCTION prevent_workbench_principal_binding_event_mutation()`,
    ],
  },
  {
    // 任务是业务目标根；AI 工单是其标准化、可分派且可验收的子动作。新
    // work_orders 绝不复制任务，也不把一次执行或模型判断等同为任务完成。
    id: "20261004_task_work_order_native_model",
    statements: [
      `CREATE TABLE IF NOT EXISTS work_order_templates (
        id TEXT PRIMARY KEY,
        template_code TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('draft','published','disabled','retired')),
        automation_level TEXT NOT NULL CHECK (automation_level IN ('A0','A1','A2','A3','L3')),
        business_category TEXT,
        trigger_event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        input_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        fill_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        acceptance_criteria_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        routing_policy_code TEXT,
        stage_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        published_by TEXT REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(template_code,version)
      )`,
      "CREATE INDEX IF NOT EXISTS work_order_templates_lookup_idx ON work_order_templates(status,template_code,version DESC)",
      `CREATE TABLE IF NOT EXISTS work_orders (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
        template_id TEXT NOT NULL REFERENCES work_order_templates(id) ON DELETE RESTRICT,
        template_code TEXT NOT NULL,
        template_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed','pending_assignment','assigned','accepted','in_progress','waiting_external','waiting_approval','ready_for_acceptance','completed','cancelled','needs_review')),
        priority TEXT NOT NULL DEFAULT 'normal',
        stage_code TEXT,
        title TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        due_at TIMESTAMPTZ,
        no_due_reason TEXT,
        automation_level TEXT NOT NULL CHECK (automation_level IN ('A0','A1','A2','A3','L3')),
        automation_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        latest_decision_id UUID,
        data_version INTEGER NOT NULL DEFAULT 1 CHECK (data_version > 0),
        created_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        UNIQUE(task_id,template_code,template_version,id)
      )`,
      "CREATE INDEX IF NOT EXISTS work_orders_task_status_idx ON work_orders(task_id,status,updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS work_orders_template_idx ON work_orders(template_code,template_version,status)",
      `CREATE TABLE IF NOT EXISTS work_order_assignments (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
        principal_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        person_ref TEXT,
        org_unit_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('primary','collaborator','watcher')),
        status TEXT NOT NULL CHECK (status IN ('active','superseded','removed')),
        routing_policy_code TEXT,
        routing_trace_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        assigned_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
        effective_to TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS work_order_assignments_one_primary_idx ON work_order_assignments(work_order_id) WHERE role='primary' AND status='active'",
      "CREATE UNIQUE INDEX IF NOT EXISTS work_order_assignments_active_principal_idx ON work_order_assignments(work_order_id,principal_id,role) WHERE status='active'",
      "CREATE INDEX IF NOT EXISTS work_order_assignments_principal_idx ON work_order_assignments(principal_id,status,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS work_order_basis_refs (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version TEXT,
        source_hash TEXT,
        occurred_at TIMESTAMPTZ,
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(work_order_id,source_type,source_id,source_version)
      )`,
      `CREATE TABLE IF NOT EXISTS work_order_decisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
        work_order_id TEXT REFERENCES work_orders(id) ON DELETE RESTRICT,
        source_event_id TEXT,
        rule_id TEXT,
        rule_version INTEGER,
        template_code TEXT,
        template_version INTEGER,
        routing_policy_code TEXT,
        decision_mode TEXT NOT NULL CHECK (decision_mode IN ('shadow','manual','automatic')),
        outcome TEXT NOT NULL CHECK (outcome IN ('no_action','needs_review','create','merge_open_order','update_next_step','advance_stage','rejected')),
        status TEXT NOT NULL CHECK (status IN ('recorded','executed','superseded','failed')),
        input_hash TEXT NOT NULL,
        input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        judgment_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        gate_results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        jev_model TEXT,
        prompt_version TEXT,
        confidence NUMERIC(5,4),
        reason TEXT,
        actor_ref TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS work_order_decisions_task_idx ON work_order_decisions(task_id,created_at DESC)",
      "CREATE INDEX IF NOT EXISTS work_order_decisions_event_idx ON work_order_decisions(source_event_id,rule_id,rule_version)",
      `CREATE TABLE IF NOT EXISTS work_order_stage_events (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        from_status TEXT,
        to_status TEXT NOT NULL,
        from_stage_code TEXT,
        to_stage_code TEXT,
        actor_ref TEXT NOT NULL,
        decision_id UUID REFERENCES work_order_decisions(id) ON DELETE RESTRICT,
        evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(work_order_id,sequence)
      )`,
      `CREATE TABLE IF NOT EXISTS work_order_command_receipts (
        idempotency_key TEXT PRIMARY KEY,
        work_order_id TEXT REFERENCES work_orders(id) ON DELETE RESTRICT,
        task_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
        actor_ref TEXT NOT NULL,
        command TEXT NOT NULL,
        response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE OR REPLACE FUNCTION prevent_work_order_decision_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'work order decisions are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS work_order_decisions_no_mutation ON work_order_decisions",
      `CREATE TRIGGER work_order_decisions_no_mutation
       BEFORE UPDATE OR DELETE ON work_order_decisions
       FOR EACH ROW EXECUTE FUNCTION prevent_work_order_decision_mutation()`,
      `CREATE OR REPLACE FUNCTION prevent_work_order_stage_event_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'work order stage events are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS work_order_stage_events_no_mutation ON work_order_stage_events",
      `CREATE TRIGGER work_order_stage_events_no_mutation
       BEFORE UPDATE OR DELETE ON work_order_stage_events
       FOR EACH ROW EXECUTE FUNCTION prevent_work_order_stage_event_mutation()`,
    ],
  },
  {
    // Task 根创建也必须抗重放；不能依赖历史 tickets.input 的 TEXT/JSONB
    // 物理表示来查找幂等键。
    id: "20261004_task_root_command_receipts",
    statements: [
      `CREATE TABLE IF NOT EXISTS task_root_command_receipts (
        idempotency_key TEXT PRIMARY KEY,
        requester_user_id TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        task_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
        response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ],
  },
  {
    // 模板发布是自动化的前置治理动作；命令回执独立于具体 Task / Work
    // Order，确保浏览器重试不会生成第二个模板版本或重复退役已发布版本。
    id: "20261004_work_order_template_command_receipts",
    statements: [
      `CREATE TABLE IF NOT EXISTS work_order_template_command_receipts (
        idempotency_key TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES work_order_templates(id) ON DELETE RESTRICT,
        actor_ref TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        command TEXT NOT NULL,
        response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ],
  },
  {
    // 发布模板本身不足以产生副作用。每个模板版本还需要独立的 A1/A2
    // execution release，且所有执行尝试、创建结果和后续通知 outbox 都
    // 保留在 PostgreSQL 的同一事务内。
    id: "20261004_work_order_execution_releases",
    statements: [
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS decision_id UUID REFERENCES work_order_decisions(id) ON DELETE RESTRICT`,
      "CREATE UNIQUE INDEX IF NOT EXISTS work_orders_decision_unique_idx ON work_orders(decision_id) WHERE decision_id IS NOT NULL",
      `CREATE TABLE IF NOT EXISTS work_order_automation_releases (
        template_id TEXT PRIMARY KEY REFERENCES work_order_templates(id) ON DELETE RESTRICT,
        automation_level TEXT NOT NULL CHECK (automation_level IN ('A1','A2')),
        status TEXT NOT NULL CHECK (status IN ('enabled','disabled')),
        minimum_confidence NUMERIC(5,4) NOT NULL DEFAULT 0.9000 CHECK (minimum_confidence >= 0 AND minimum_confidence <= 1),
        routing_policy_code TEXT,
        enabled_by TEXT REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        enabled_at TIMESTAMPTZ,
        disabled_by TEXT REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        disabled_at TIMESTAMPTZ,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS work_order_execution_attempts (
        id TEXT PRIMARY KEY,
        decision_id UUID NOT NULL REFERENCES work_order_decisions(id) ON DELETE RESTRICT,
        work_order_id TEXT REFERENCES work_orders(id) ON DELETE RESTRICT,
        actor_ref TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('automatic','operator_replay')),
        status TEXT NOT NULL CHECK (status IN ('created','skipped','failed')),
        reason_code TEXT,
        receipt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS work_order_execution_attempts_decision_idx ON work_order_execution_attempts(decision_id,created_at DESC)",
      `CREATE TABLE IF NOT EXISTS work_order_outbox (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
        decision_id UUID NOT NULL REFERENCES work_order_decisions(id) ON DELETE RESTRICT,
        event_type TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        last_error TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS work_order_outbox_ready_idx ON work_order_outbox(status,created_at)",
    ],
  },
  {
    id: "20261004_work_order_automation_release_events",
    statements: [
      `CREATE TABLE IF NOT EXISTS work_order_automation_release_events (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES work_order_templates(id) ON DELETE RESTRICT,
        action TEXT NOT NULL CHECK (action IN ('enabled','disabled')),
        prior_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        current_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor_ref TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        reason TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE OR REPLACE FUNCTION prevent_work_order_release_event_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'work order automation release events are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS work_order_release_events_no_mutation ON work_order_automation_release_events",
      `CREATE TRIGGER work_order_release_events_no_mutation
       BEFORE UPDATE OR DELETE ON work_order_automation_release_events
       FOR EACH ROW EXECUTE FUNCTION prevent_work_order_release_event_mutation()`,
    ],
  },
  {
    id: "20261004_work_order_verified_events",
    statements: [
      `CREATE TABLE IF NOT EXISTS work_order_verified_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
        source_system TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        source_version TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        summary TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        verified_by TEXT NOT NULL REFERENCES ticket_accounts(id) ON DELETE RESTRICT,
        verified_at TIMESTAMPTZ NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(task_id,source_system,source_event_id,source_version)
      )`,
      "CREATE INDEX IF NOT EXISTS work_order_verified_events_task_idx ON work_order_verified_events(task_id,occurred_at DESC,id DESC)",
      `CREATE OR REPLACE FUNCTION prevent_work_order_verified_event_mutation()
       RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'work order verified events are immutable'; END; $$ LANGUAGE plpgsql`,
      "DROP TRIGGER IF EXISTS work_order_verified_events_no_mutation ON work_order_verified_events",
      `CREATE TRIGGER work_order_verified_events_no_mutation
       BEFORE UPDATE OR DELETE ON work_order_verified_events
       FOR EACH ROW EXECUTE FUNCTION prevent_work_order_verified_event_mutation()`,
    ],
  },
  {
    // A3 与 A1/A2 一样必须经过模板版本级的显式 release；A3 仅用于
    // 已发布策略指定、证据可复核的阶段写入，绝不放宽 L3 的人工边界。
    id: "20261004_work_order_a3_stage_releases",
    statements: [
      "ALTER TABLE work_order_automation_releases DROP CONSTRAINT IF EXISTS work_order_automation_releases_automation_level_check",
      `ALTER TABLE work_order_automation_releases
       ADD CONSTRAINT work_order_automation_releases_automation_level_check
       CHECK (automation_level IN ('A1','A2','A3'))`,
    ],
  },
];

const onlyMigration = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
if (onlyMigration && !migrations.some((migration) => migration.id === onlyMigration)) throw new Error("Unknown migration selection");
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  // 空库判定必须在建账本之前：基线（pg_dump）本身就会创建 app_schema_migrations。
  const empty = Number(
    (await client.query<{ n: string }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'app_schema_migrations'",
    )).rows[0]?.n || 0,
  ) === 0;
  if (empty && onlyMigration) throw new Error("Selective migration requires an initialized database");
  if (empty) await client.query(baselineSql);
  await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by TEXT NOT NULL DEFAULT 'schema-runner'
  )`);
  const applied = new Set((await client.query<{ id: string }>("SELECT id FROM app_schema_migrations")).rows.map((row) => row.id));
  const completed: string[] = [];
  // 基线已包含这些增量的效果，补记账本，否则非幂等增量会在已有对象上重跑。
  if (empty) {
    const stamp = new Date().toISOString();
    for (const id of [BASELINE_ID, ...BASELINED_IDS]) {
      await client.query("INSERT INTO app_schema_migrations (id,applied_at) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, stamp]);
      applied.add(id);
    }
    completed.push(BASELINE_ID);
  }
  for (const migration of migrations) {
    if (onlyMigration && migration.id !== onlyMigration) continue;
    // DDL is idempotent even if a prior deploy created the table before this
    // ledger existed. Recording it prevents future release restarts from
    // executing non-idempotent migrations accidentally.
    const checksum = createHash("sha256").update(migration.statements.join("\n-- statement --\n")).digest("hex");
    const recorded = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE id=$1", [migration.id]);
    if (recorded.rows[0] && recorded.rows[0].checksum !== checksum) {
      throw new Error(`schema migration checksum mismatch: ${migration.id}`);
    }
    if (applied.has(migration.id)) {
      if (!recorded.rows[0]) {
        await client.query("INSERT INTO schema_migrations (id,checksum,applied_by) VALUES ($1,$2,'legacy-ledger-backfill')", [migration.id, checksum]);
      }
      continue;
    }
    for (const statement of migration.statements) await client.query(statement);
    const appliedAt = new Date().toISOString();
    await client.query("INSERT INTO app_schema_migrations (id,applied_at) VALUES ($1,$2)", [migration.id, appliedAt]);
    await client.query("INSERT INTO schema_migrations (id,checksum,applied_at) VALUES ($1,$2,$3)", [migration.id, checksum, appliedAt]);
    completed.push(migration.id);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ applied: completed, database: "postgres" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
