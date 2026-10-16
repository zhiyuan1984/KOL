import { createRequire } from "node:module";
import { nativeKnowledgePrincipal } from "./native-knowledge-admin";

const OWNED_SEEDS = {
  kb_q_pool_score: { title: "公海 · KOL评分提问模板", kind: "question_template" },
  kb_mail_kol: { title: "首封建联", kind: "mail_template" },
  kb_mail_followup: { title: "阶段跟进", kind: "mail_template" },
  kb_mail_ship: { title: "发货通知", kind: "mail_template" },
  kb_followup: { title: "跟进信模板（阶段保持）", kind: "policy" },
} as const;
type OwnedSeedId = keyof typeof OWNED_SEEDS;

/**
 * seedMissingOwnerFixture: these original-case demonstration records were
 * seeded by `system` (or retired demo `u_jeffrey`), not organization authors.
 * Re-home only explicit isolated seeds' created_by to this run's already
 * authorized normal-login user. Never alter users, memberships, status,
 * visibility, content, versions, approval fingerprints, or publication history.
 * New question drafts still use independent prepared/confirmed review + queue.
 */
export async function prepareEmployeeKnowledgeSeedOwners(ids: readonly OwnedSeedId[] = ["kb_q_pool_score"]): Promise<void> {
  if (process.env.NODE_ENV !== "test" || process.env.E2E_MODE !== "stub" || process.env.E2E_AUTH_MODE !== "enabled") {
    throw new Error("Employee seed owner fixture requires explicit native isolated test mode");
  }
  const url = process.env.DATABASE_URL;
  const prefix = String(process.env.TEST_DB_PREFIX || "");
  if (!url || !/^[a-z_][a-z0-9_]+$/.test(prefix)) throw new Error("Employee seed owner fixture requires an explicit test database prefix");
  const declaredDatabase = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!declaredDatabase.startsWith(`${prefix}_`) || !declaredDatabase.endsWith("_employee")) {
    throw new Error("Refusing employee seed owner fixture outside its owned prefixed database");
  }
  const backendRequire = createRequire(new URL("../../../backend/package.json", import.meta.url));
  const { Client } = backendRequire("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = await client.query("SELECT current_database() AS name");
    if (identity.rows[0]?.name !== declaredDatabase) throw new Error("Employee seed owner fixture database identity mismatch");
    await client.query("BEGIN");
    try {
      const authorizedOwner = await client.query(`SELECT u.id FROM users u
        JOIN organization_people p ON p.user_id=u.id AND p.status='active'
        JOIN organization_memberships m ON m.person_ref=p.person_ref AND m.status='active'
        WHERE u.id=$1 AND u.active=1 AND p.person_ref=$2 AND m.company_id=$3`, [
        nativeKnowledgePrincipal.id, nativeKnowledgePrincipal.personRef, nativeKnowledgePrincipal.company,
      ]);
      if (!authorizedOwner.rows.length) throw new Error("Employee seed owner must already be a real active company user");
      for (const id of ids) {
        const expected = OWNED_SEEDS[id];
        if (!expected) throw new Error("Employee seed owner fixture ID is outside the original-case whitelist");
        const before = (await client.query("SELECT * FROM knowledge WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!before || before.kind !== expected.kind || before.title !== expected.title) {
          throw new Error(`Employee seed fixture identity/content mismatch: ${id}`);
        }
        if (before.created_by !== nativeKnowledgePrincipal.id) {
          if (!["system", "u_jeffrey", ""].includes(String(before.created_by || ""))) {
            throw new Error("Refusing to reassign a non-legacy knowledge author");
          }
          const legacyAuthor = await client.query(`SELECT 1 FROM users u
            JOIN organization_people p ON p.user_id=u.id AND p.status='active'
            JOIN organization_memberships m ON m.person_ref=p.person_ref AND m.status='active'
            WHERE u.id=$1 AND u.active=1 AND m.company_id=$2`, [before.created_by, nativeKnowledgePrincipal.company]);
          if (legacyAuthor.rows.length) throw new Error("Refusing to replace a real authorized seed author");
          await client.query("UPDATE knowledge SET created_by=$1 WHERE id=$2 AND created_by IS NOT DISTINCT FROM $3", [
            nativeKnowledgePrincipal.id, id, before.created_by,
          ]);
        }
        const after = (await client.query("SELECT * FROM knowledge WHERE id=$1", [id])).rows[0];
        if (JSON.stringify(after) !== JSON.stringify({ ...before, created_by: nativeKnowledgePrincipal.id })) {
          throw new Error("Employee seed owner fixture must change only created_by");
        }
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

/** Read persisted write surfaces; no routes or optimistic receipts stand in for these counts. */
export async function employeeExecutionWriteSnapshot(): Promise<Record<string, number>> {
  const url = process.env.DATABASE_URL;
  const prefix = String(process.env.TEST_DB_PREFIX || "");
  if (process.env.NODE_ENV !== "test" || process.env.E2E_MODE !== "stub" || process.env.E2E_AUTH_MODE !== "enabled"
    || !url || !/^[a-z_][a-z0-9_]+$/.test(prefix)) throw new Error("Employee write snapshot requires explicit native isolated test mode");
  const declaredDatabase = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!declaredDatabase.startsWith(`${prefix}_`) || !declaredDatabase.endsWith("_employee")) throw new Error("Refusing employee write snapshot outside its owned prefixed DB");
  const backendRequire = createRequire(new URL("../../../backend/package.json", import.meta.url));
  const { Client } = backendRequire("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = await client.query("SELECT current_database() AS name");
    if (identity.rows[0]?.name !== declaredDatabase) throw new Error("Employee write snapshot database identity mismatch");
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM execution_jobs) AS execution_jobs,
      (SELECT COUNT(*)::int FROM sessions) AS sessions,
      (SELECT COUNT(*)::int FROM workers) AS workers,
      (SELECT COUNT(*)::int FROM drafts) AS drafts`);
    return result.rows[0];
  } finally {
    await client.end();
  }
}

/** Controlled current-principal mailbox for a draft-only citation acceptance.
 * This is explicit stub test data, never credential creation or a production
 * verification bypass. Existing bindings are neither reassigned nor activated.
 */
export async function prepareEmployeeKnowledgeMailbox(): Promise<string> {
  await prepareEmployeeKnowledgeSeedOwners([]); // Includes native-mode, DB identity and active membership checks.
  const url = process.env.DATABASE_URL!;
  const declaredDatabase = decodeURIComponent(new URL(url).pathname.slice(1));
  const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));
  const { Client } = backendRequire('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if ((await client.query('SELECT current_database() AS name')).rows[0]?.name !== declaredDatabase) throw new Error('Owned citation mailbox database identity mismatch');
    const existing = await client.query("SELECT mailbox_email,status FROM user_starry_bindings WHERE user_id=$1 ORDER BY is_default DESC,mailbox_email", [nativeKnowledgePrincipal.id]);
    const connected = existing.rows.find((row: { status: string }) => row.status === 'connected');
    if (connected) return String(connected.mailbox_email);
    const mailbox = 'knowledge-citation-owned@fixture.example';
    if (existing.rows.some((row: { mailbox_email: string }) => row.mailbox_email === mailbox)) throw new Error('Refusing to reactivate an existing disconnected mailbox');
    await client.query(`INSERT INTO user_starry_bindings
      (user_id,mailbox_email,owner_name,status,is_default,synced_at,updated_at)
      VALUES($1,$2,$3,'connected',$4,now(),now())`,
      [nativeKnowledgePrincipal.id, mailbox, 'Controlled native knowledge citation fixture', existing.rows.length ? 0 : 1]);
    return mailbox;
  } finally { await client.end(); }
}
