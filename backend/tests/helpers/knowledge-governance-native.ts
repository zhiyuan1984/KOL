import { approveKnowledgeEntry } from "./approved-knowledge.js";
import { nowIso, postgresDb } from "../../src/postgres/access.js";
import { syncUserOrganization } from "../../src/runtime/organization-tree.js";

const ACTOR = "knowledge-governance-admin";
const REVIEWER = "knowledge-governance-reviewer";
const NATIVE_ORG = "org:lt_team";

/**
 * Sets up two distinct members of the native organization fixture and publishes
 * an existing draft through the production confirmation, independent-review,
 * receipt, and executePublication path.  It never writes publication columns
 * or bypasses the database trigger.
 */
export async function publishKnowledgeThroughNativeGovernance(knowledgeId: string): Promise<{
  instanceId: string;
  publishedVersion: number;
}> {
  const now = nowIso();
  const db = postgresDb();
  for (const [id, roles] of [
    [ACTOR, '["admin","employee"]'],
    [REVIEWER, '["employee"]'],
    // API-created drafts in the disabled-auth fixture are attributed to sriphy.
    // Adding its authoritative membership makes the owner visible to the
    // reviewer workflow without treating a display name as an authorization.
    ["sriphy", '["admin","employee"]'],
  ] as const) {
    await db.execute(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
      VALUES($1,$1,$1,'test-fixture-only',$2,'["LT"]','',1,$3,$3)
      ON CONFLICT (id) DO UPDATE SET active=1,roles=EXCLUDED.roles,updated_at=EXCLUDED.updated_at`, id, roles, now);
    await syncUserOrganization(id, NATIVE_ORG);
  }
  return approveKnowledgeEntry({ knowledgeId, actor: ACTOR, reviewer: REVIEWER });
}
