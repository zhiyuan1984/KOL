/** Native PostgreSQL migration; invoked by the normal schema migration command. */
export const performanceSchema = `
CREATE TABLE IF NOT EXISTS performance_assets (
 id text PRIMARY KEY, company_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('template','rules')),
 name text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0), status text NOT NULL CHECK(status IN ('draft','published')),
 data jsonb NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS performance_cycles (
 id text PRIMARY KEY, company_id text NOT NULL, name text NOT NULL, month text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','active','archived')), version integer NOT NULL DEFAULT 1,
 template_id text NOT NULL REFERENCES performance_assets(id), rules_id text NOT NULL REFERENCES performance_assets(id),
 template jsonb NOT NULL, rules jsonb NOT NULL, deadlines jsonb NOT NULL DEFAULT '{}', created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS performance_records (
 id text PRIMARY KEY, cycle_id text NOT NULL REFERENCES performance_cycles(id), company_id text NOT NULL,
 employee_id text NOT NULL, manager_id text NOT NULL, department_id text NOT NULL, hr_id text NOT NULL, payroll_id text NOT NULL,
 stage text NOT NULL, version integer NOT NULL DEFAULT 1, data jsonb NOT NULL, updated_at text NOT NULL,
 UNIQUE(cycle_id,employee_id)
);
CREATE INDEX IF NOT EXISTS performance_records_scope ON performance_records(company_id,employee_id,cycle_id);
CREATE TABLE IF NOT EXISTS performance_events (
 id text PRIMARY KEY, company_id text NOT NULL, object_id text NOT NULL, actor_id text NOT NULL, action text NOT NULL,
 version integer NOT NULL, reason text NOT NULL DEFAULT '', before_data jsonb, after_data jsonb, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS performance_events_object ON performance_events(company_id,object_id,created_at);
CREATE TABLE IF NOT EXISTS performance_commands (
 company_id text NOT NULL, actor_id text NOT NULL, command_id text NOT NULL, request_hash text NOT NULL,
 receipt jsonb NOT NULL, created_at text NOT NULL, PRIMARY KEY(company_id,actor_id,command_id)
);`;

/** Additive migration for existing installations; approval uses the shared pure review engine. */
export const performanceApprovalSchema = `
ALTER TABLE performance_assets ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE performance_assets ADD COLUMN IF NOT EXISTS approval jsonb;
ALTER TABLE performance_assets DROP CONSTRAINT IF EXISTS performance_assets_status_check;
ALTER TABLE performance_assets ADD CONSTRAINT performance_assets_status_check CHECK(status IN ('draft','reviewing','rejected','approved','published'));
`;
