import { scryptSync } from "node:crypto";
import { createRequire } from "node:module";

type NativeKnowledgeAccount = {
  id: string;
  username: string;
  password: string;
  company: string;
  personRef: string;
  email: string;
  roles: readonly string[];
};

export const nativeKnowledgePrincipal = {
  id: "sriphy",
  username: "sriphy",
  password: "NativeKnowledgeE2E!2026",
  company: "company:amperetime",
  personRef: "person:yan_chen",
  email: "sriphy.yan@amperetime.com",
  roles: ["employee", "admin"],
  agentId: "agent:kol",
  skillId: "email_compose",
} as const;

/** A distinct, non-admin reviewer backed by an existing active company person. */
export const nativeKnowledgeReviewer = {
  id: "native-knowledge-reviewer",
  username: "native-knowledge-reviewer",
  password: "NativeKnowledgeReviewerE2E!2026",
  company: "company:amperetime",
  personRef: "person:chen_bingbing",
  email: "ivy.chen@amperetime.com",
  roles: ["employee"],
} as const;

function passwordHash(account: NativeKnowledgeAccount, database: string): string {
  const salt = Buffer.from(`native-knowledge:${database}:${account.id}`);
  return `scrypt$${salt.toString("base64")}$${scryptSync(account.password, salt, 64).toString("base64")}`;
}

async function upsertNativeUser(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  account: NativeKnowledgeAccount,
  displayName: string,
  database: string,
  stamp: string,
): Promise<void> {
  await client.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email,phone)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,'')
    ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
      roles=EXCLUDED.roles,brands=EXCLUDED.brands,active=1,email=EXCLUDED.email,updated_at=EXCLUDED.updated_at`, [
    account.id,
    account.username,
    displayName,
    passwordHash(account, database),
    JSON.stringify(account.roles),
    '["LT","RO","PQ"]',
    "",
    stamp,
    account.email,
  ]);
}

/**
 * Establish only isolated, normal-login accounts. The accounts are linked to
 * pre-existing active people and memberships; this fixture never manufactures
 * an organization member, grants a disabled persona, or changes permissions.
 */
export async function prepareNativeKnowledgeAdmin(): Promise<void> {
  const authMode = process.env.E2E_AUTH_MODE || "disabled";
  if (process.env.E2E_MODE !== "stub" || !["disabled", "enabled"].includes(authMode) || process.env.NODE_ENV !== "test") {
    throw new Error("Native knowledge fixture requires explicit isolated stub/test mode");
  }
  const url = process.env.DATABASE_URL;
  const prefix = String(process.env.TEST_DB_PREFIX || "");
  if (!url || !/^[a-z_][a-z0-9_]+$/.test(prefix)) throw new Error("Native knowledge fixture requires explicit isolated database authority");
  const declaredDatabase = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!declaredDatabase.startsWith(`${prefix}_`)) throw new Error("Refusing knowledge fixture outside the declared test prefix");
  const backendRequire = createRequire(new URL("../../../backend/package.json", import.meta.url));
  const { Client } = backendRequire("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== declaredDatabase || !String(result.rows[0]?.name).startsWith(`${prefix}_`)) {
      throw new Error("Knowledge fixture database identity mismatch");
    }
    const stamp = new Date().toISOString();
    await client.query("BEGIN");
    try {
      await upsertNativeUser(client, nativeKnowledgePrincipal, "隔离知识管理员", declaredDatabase, stamp);
      await upsertNativeUser(client, nativeKnowledgeReviewer, "隔离知识独立评审人", declaredDatabase, stamp);
      // The requester retains the established published Agent assembly. The
      // reviewer deliberately receives no administrator/Agent elevation.
      await client.query(`INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at)
        VALUES($1,$2,$3,'published',1,$4,$4)
        ON CONFLICT (id) DO UPDATE SET status='published',updated_at=EXCLUDED.updated_at`,
      [nativeKnowledgePrincipal.agentId, "KOL 智能体", "KOL 合作与跟进能力", stamp]);
      await client.query(`INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at)
        VALUES($1,$2,1,1,$3)
        ON CONFLICT (agent_id,skill_id) DO UPDATE SET enabled=1,updated_at=EXCLUDED.updated_at`,
      [nativeKnowledgePrincipal.agentId, nativeKnowledgePrincipal.skillId, stamp]);
      // Organization tree creation remains the product's post-login bootstrap.
      // Once it has populated the confirmed people/memberships, linking these
      // two accounts gives them their genuine same-company identity only.
      for (const account of [nativeKnowledgePrincipal, nativeKnowledgeReviewer]) {
        await client.query(`UPDATE organization_people
          SET user_id=$1,user_ref=$1,email=$2,status='active',updated_at=$3
          WHERE person_ref=$4 AND status='active'`, [account.id, account.email, stamp, account.personRef]);
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
