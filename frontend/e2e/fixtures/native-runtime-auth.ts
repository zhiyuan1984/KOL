import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import { request, type APIRequestContext, type FullConfig } from "@playwright/test";

const agentId = "agent:kol";
const skillId = "crawler_collect";
const companyId = "company:amperetime";

export const nativeRuntimePrincipal = {
  id: "native-runtime-huang-qiyou",
  username: "native-runtime-huang-qiyou",
  password: "NativeRuntimeHuangQiyou!2026",
  personRef: "person:huang_qiyou",
} as const;

/** Deliberately unlinked ordinary account used only by the fixture negative control. */
export const nativeRuntimeUnboundPrincipal = {
  id: "native-runtime-unbound",
  username: "native-runtime-unbound",
  password: "NativeRuntimeUnbound!2026",
} as const;

export const nativeRuntimeAuth = {
  agentId,
  skillId,
  companyId,
  storageState: () => process.env.E2E_AUTH_STATE
    || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "native-runtime-auth", "huang-qiyou.json"),
} as const;

type FixtureEnvironment = {
  databaseUrl: string;
  database: string;
  prefix: string;
};

type AuthStatus = {
  authenticated: boolean;
  account: { id: string; username: string } | null;
  permissions: { admin?: boolean; demo?: boolean; skills?: string[] };
};

type Principal = typeof nativeRuntimePrincipal | typeof nativeRuntimeUnboundPrincipal;

type PgClient = {
  connect: () => Promise<void>;
  end: () => Promise<void>;
  query: <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

function requireFixtureEnvironment(config: FullConfig): FixtureEnvironment {
  // server-e2e's parent process uses disabled auth for its default partition;
  // this partition explicitly starts its own native-auth server. Verify the
  // actual server contract, never infer identity from the parent demo setting.
  const serverEnvironment = config.webServer?.env;
  if (serverEnvironment?.NODE_ENV !== "test" || serverEnvironment?.E2E_MODE !== "stub" || serverEnvironment?.E2E_AUTH_MODE !== "enabled") {
    throw new Error("Native runtime fixture requires explicit E2E_MODE=stub, E2E_AUTH_MODE=enabled, and NODE_ENV=test");
  }
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const prefix = String(process.env.TEST_DB_PREFIX || "").trim();
  if (serverEnvironment.DATABASE_URL !== databaseUrl || serverEnvironment.TEST_DB_PREFIX !== prefix) {
    throw new Error("Native runtime fixture requires matching server and setup database authority");
  }
  if (!databaseUrl || !/^[a-z_][a-z0-9_]+$/.test(prefix)) {
    throw new Error("Native runtime fixture requires explicit DATABASE_URL and TEST_DB_PREFIX");
  }
  let database = "";
  try {
    database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error("Native runtime fixture requires a PostgreSQL DATABASE_URL");
  }
  if (!database || !database.startsWith(`${prefix}_`)) {
    throw new Error("Native runtime fixture refuses a database outside TEST_DB_PREFIX");
  }
  return { databaseUrl, database, prefix };
}

function passwordHash(principal: Principal, database: string): string {
  const salt = Buffer.from(`native-runtime:${database}:${principal.id}`);
  return `scrypt$${salt.toString("base64")}$${scryptSync(principal.password, salt, 64).toString("base64")}`;
}

function pgClient(url: string): PgClient {
  const backendRequire = createRequire(new URL("../../../backend/package.json", import.meta.url));
  const { Client } = backendRequire("pg") as { Client: new (options: { connectionString: string }) => PgClient };
  return new Client({ connectionString: url });
}

async function assertDatabaseIdentity(client: PgClient, environment: FixtureEnvironment): Promise<void> {
  const result = await client.query<{ name: string }>("SELECT current_database() AS name");
  if (result.rows[0]?.name !== environment.database || !environment.database.startsWith(`${environment.prefix}_`)) {
    throw new Error("Native runtime fixture database identity mismatch");
  }
}

/** Creates only normal isolated login accounts; it intentionally creates no Agent, skill, or person binding. */
async function prepareNormalAccounts(environment: FixtureEnvironment): Promise<void> {
  const client = pgClient(environment.databaseUrl);
  await client.connect();
  try {
    await assertDatabaseIdentity(client, environment);
    const stamp = new Date().toISOString();
    await client.query("BEGIN");
    try {
      for (const principal of [nativeRuntimePrincipal, nativeRuntimeUnboundPrincipal]) {
        await client.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email,phone)
          VALUES($1,$2,$3,$4,$5,$6,'',1,$7,$7,$8,'')
          ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
            roles=EXCLUDED.roles,brands=EXCLUDED.brands,active=1,email=EXCLUDED.email,updated_at=EXCLUDED.updated_at`, [
          principal.id,
          principal.username,
          principal === nativeRuntimePrincipal ? "隔离运行时授权员工" : "隔离未绑定运行时员工",
          passwordHash(principal, environment.database),
          '["employee"]',
          '["LT","RO","PQ"]',
          stamp,
          `${principal.username}@fixture.invalid`,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

/**
 * Links the ordinary fixture account to exactly one pre-existing registry person
 * after native login has caused the product organization bootstrap. No registry,
 * Agent, skill, or use binding is manufactured or modified here.
 */
async function linkOnlyExistingRegistryPerson(environment: FixtureEnvironment): Promise<void> {
  const client = pgClient(environment.databaseUrl);
  await client.connect();
  try {
    await assertDatabaseIdentity(client, environment);
    await client.query("BEGIN");
    try {
      const person = await client.query<{ person_ref: string; status: string; user_id: string | null }>(
        "SELECT person_ref,status,user_id FROM organization_people WHERE person_ref=$1 FOR UPDATE",
        [nativeRuntimePrincipal.personRef],
      );
      const row = person.rows[0];
      if (!row || row.status !== "active") throw new Error("Native runtime principal is not an active pre-existing registry person");
      if (row.user_id && row.user_id !== nativeRuntimePrincipal.id) {
        throw new Error("Native runtime fixture refuses to replace an existing registry-person account link");
      }
      const membership = await client.query<{ company_id: string }>(`SELECT company_id FROM organization_memberships
        WHERE person_ref=$1 AND company_id=$2 AND status='active'`, [nativeRuntimePrincipal.personRef, companyId]);
      if (!membership.rows.length) throw new Error("Native runtime principal lacks an active pre-existing company membership");
      const binding = await client.query<{ agent_id: string }>(`SELECT agent_id FROM agent_bindings
        WHERE agent_id=$1 AND target_type='person' AND target_id=$2 AND company_id=$3 AND status='active'`,
      [agentId, nativeRuntimePrincipal.personRef, companyId]);
      if (!binding.rows.length) throw new Error("Native runtime principal lacks the pre-existing registry Agent binding");
      const stamp = new Date().toISOString();
      const update = await client.query(`UPDATE organization_people SET user_id=$1,user_ref=$1,updated_at=$2
        WHERE person_ref=$3 AND status='active' AND (user_id IS NULL OR user_id='' OR user_id=$1)`,
      [nativeRuntimePrincipal.id, stamp, nativeRuntimePrincipal.personRef]);
      if (update.rowCount !== 1) throw new Error("Native runtime fixture could not link only its isolated user to the registry person");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function login(context: APIRequestContext, principal: Principal, phase: string): Promise<void> {
  const response = await context.post("/api/auth/login", { data: { username: principal.username, password: principal.password } });
  if (!response.ok()) throw new Error(`Native runtime ${phase} login failed: ${response.status()} ${await response.text()}`);
}

async function authStatus(context: APIRequestContext, action: string): Promise<AuthStatus> {
  const response = await context.get("/api/auth/status");
  if (!response.ok()) throw new Error(`Native runtime ${action} status failed: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<AuthStatus>;
}

async function assertNormalIdentity(context: APIRequestContext): Promise<void> {
  const status = await authStatus(context, "normal-login");
  if (!status.authenticated || status.account?.id !== nativeRuntimePrincipal.id || status.account.username !== nativeRuntimePrincipal.username) {
    throw new Error("Native runtime login did not establish the isolated normal account");
  }
  if (status.permissions.demo || status.permissions.admin) {
    throw new Error("Native runtime fixture requires a non-demo, non-admin normal account");
  }
}

function workspaceBody(requestId: string): Record<string, unknown> {
  return {
    request_id: requestId,
    text: "隔离运行时权限校验：发现北美露营候选",
    brief: {
      platforms: ["youtube"],
      region: "na",
      directions: [],
      keywords: ["camping"],
      min_followers: 100,
      max_followers: 20_000,
      min_avg_plays_10: 100,
      expect_count: 10,
    },
  };
}

async function assertNormalRuntimeAuthority(context: APIRequestContext, environment: FixtureEnvironment): Promise<void> {
  const response = await context.post("/api/home/discovery/workspace", {
    data: workspaceBody(`native-runtime-setup-${Date.now()}`),
  });
  if (response.status() !== 201) throw new Error(`Native runtime authority API failed: ${response.status()} ${await response.text()}`);
  const status = await authStatus(context, "post-authority");
  if (status.permissions.demo || status.permissions.admin || !status.permissions.skills?.includes(skillId)) {
    throw new Error("Native runtime normal account did not receive the persisted Agent skill authority");
  }

  const client = pgClient(environment.databaseUrl);
  await client.connect();
  try {
    await assertDatabaseIdentity(client, environment);
    const [person, agent, skill, binding] = await Promise.all([
      client.query<{ user_id: string; status: string }>("SELECT user_id,status FROM organization_people WHERE person_ref=$1", [nativeRuntimePrincipal.personRef]),
      client.query<{ status: string }>("SELECT status FROM managed_agents WHERE id=$1", [agentId]),
      client.query<{ enabled: boolean | number }>("SELECT enabled FROM runtime_agent_skills WHERE agent_id=$1 AND skill_id=$2", [agentId, skillId]),
      client.query<{ status: string }>(`SELECT status FROM agent_bindings
        WHERE agent_id=$1 AND target_type='person' AND target_id=$2 AND company_id=$3`, [agentId, nativeRuntimePrincipal.personRef, companyId]),
    ]);
    if (person.rows[0]?.user_id !== nativeRuntimePrincipal.id || person.rows[0]?.status !== "active") {
      throw new Error("Native runtime principal is not persistently linked to the selected active registry person");
    }
    if (agent.rows[0]?.status !== "published" || !skill.rows[0]?.enabled || binding.rows[0]?.status !== "active") {
      throw new Error("Native runtime authority is not backed by published Agent, enabled skill, and active pre-existing binding facts");
    }
  } finally {
    await client.end();
  }
}

/**
 * Strict native authority setup for runtime gate tests. It never reads .env,
 * never uses a demo fallback, and never publishes/enables an Agent or creates
 * a broad Agent binding. The only organization write is the isolated account's
 * link to the existing person:huang_qiyou record after product bootstrap.
 */
export default async function nativeRuntimeGlobalSetup(config: FullConfig): Promise<void> {
  const environment = requireFixtureEnvironment(config);
  const baseURL = String(config.projects[0]?.use?.baseURL || process.env.E2E_BASE || "http://127.0.0.1:8877");
  const statePath = nativeRuntimeAuth.storageState();
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  await prepareNormalAccounts(environment);
  const context = await request.newContext({ baseURL });
  try {
    // First normal login invokes the product's organization bootstrap. Only then
    // may this fixture map its isolated user to the authoritative registry person.
    await login(context, nativeRuntimePrincipal, "initial");
    await linkOnlyExistingRegistryPerson(environment);
    await login(context, nativeRuntimePrincipal, "post-organization");
    await assertNormalIdentity(context);
    await assertNormalRuntimeAuthority(context, environment);
    await context.storageState({ path: statePath });
  } finally {
    await context.dispose();
  }
}
