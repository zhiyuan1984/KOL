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
