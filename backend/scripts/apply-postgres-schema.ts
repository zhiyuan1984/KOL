import { Client } from "pg";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL schema migration");

const migrations: Array<{ id: string; statements: string[] }> = [
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
