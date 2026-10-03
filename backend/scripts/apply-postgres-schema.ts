import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "pg";

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
];

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
