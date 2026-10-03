import { Client } from "pg";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL schema migration");

const migrations: Array<{ id: string; statements: string[] }> = [
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
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set((await client.query<{ id: string }>("SELECT id FROM app_schema_migrations")).rows.map((row) => row.id));
  const completed: string[] = [];
  for (const migration of migrations) {
    // DDL is idempotent even if a prior deploy created the table before this
    // ledger existed. Recording it prevents future release restarts from
    // executing non-idempotent migrations accidentally.
    if (applied.has(migration.id)) continue;
    for (const statement of migration.statements) await client.query(statement);
    await client.query("INSERT INTO app_schema_migrations (id,applied_at) VALUES ($1,$2)", [migration.id, new Date().toISOString()]);
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
