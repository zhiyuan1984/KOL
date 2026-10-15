import { randomUUID } from "node:crypto";
import { mapUser, tokenDigest, withScopedUser } from "../../src/auth.js";
import { nowIso, getConn } from "../../src/db.js";
import { decideReview } from "../../src/approval/review-engine.js";
import { postgresReviewContext } from "../../src/approval/review-postgres-access.js";
import { reviewResolver } from "../../src/approval/review-resolver.js";
import { knowledgeReviewDefinition, type ReviewDefinition, type ReviewInstance } from "../../../shared/review.js";
import type { KnowledgePublicationCommand } from "../../../shared/knowledge-publication.js";
import { executePublication, preparePublication, submitPublication } from "../../src/knowledge-publication/service.js";
import { postgresTransaction } from "../../src/postgres/pool.js";
import { getAgentSkills, setAgentSkill } from "../../src/runtime/store.js";
import { createAgentBinding, ensureOrganizationTree, syncUserOrganization } from "../../src/runtime/organization-tree.js";
import { seedPublishedAgent } from "../fixtures/runtime-auth.js";

export const NATIVE_KNOWLEDGE_TENANT = "company:amperetime";
export const NATIVE_KNOWLEDGE_AGENT_ID = "agent_native_knowledge_fixture";
const AGENT_ID = NATIVE_KNOWLEDGE_AGENT_ID;

type Principal = {
  id: string;
  username: string;
  cookie: string;
  headers: Record<string, string>;
};

export type NativeKnowledgeFixture = {
  tenant: string;
  admin: Principal;
  employee: Principal;
  reviewer: Principal;
  outsider: Principal;
};

type PublicationTemplate = { id: string; version: number; definition: ReviewDefinition };

async function session(principal: Omit<Principal, "cookie" | "headers">): Promise<Principal> {
  const token = `native-knowledge-${principal.id}-${randomUUID()}`;
  const now = nowIso();
  await getConn().query(
    "INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)",
    [tokenDigest(token), principal.id, new Date(Date.now() + 5 * 60_000).toISOString(), now],
  );
  const cookie = `lingong_session=${token}`;
  return { ...principal, cookie, headers: { Cookie: cookie, "X-Review-Company": NATIVE_KNOWLEDGE_TENANT } };
}

/**
 * Establishes the same facts production authorization reads: authenticated
 * account, current organization membership, a published managed Agent, and an
 * enabled Skill.  Tests must not rely on the retired persona/global-auth path.
 */
export async function setupNativeKnowledgeFixture(skills = ["email_compose"]): Promise<NativeKnowledgeFixture> {
  process.env.AUTH_MODE = "enabled";
  await ensureOrganizationTree();
  const now = nowIso();
  const users: Array<[string, string, string, string]> = [
    ["sriphy", "sriphy", "知识管理员", '["employee","admin"]'],
    ["usr_lingong", "lingong", "知识员工", '["employee"]'],
    ["knowledge-reviewer", "knowledge-reviewer", "知识审核人", '["employee"]'],
    ["knowledge-outsider", "knowledge-outsider", "无关员工", '["employee"]'],
  ];
  for (const [id, username, name, roles] of users) {
    await getConn().query(
      `INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
       ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,roles=EXCLUDED.roles,active=1,updated_at=EXCLUDED.updated_at`,
      [id, username, name, "native-fixture-no-login-password", roles, id === "sriphy" ? '["LT","RO","PQ"]' : '["LT"]', "", now],
    );
  }
  // Session authorization reads the actual connector-grant table.  These are
  // disposable test rows for the configured stub connector, not a bypass of
  // runtime policy; every request still hydrates its authority from PostgreSQL.
  await getConn().query(
    "INSERT INTO connectors(id,label,enabled,status,credential_ref,updated_at) VALUES($1,$2,1,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET enabled=1,status=EXCLUDED.status,credential_ref=EXCLUDED.credential_ref,updated_at=EXCLUDED.updated_at",
    ["starrykol", "StarryKOL 测试连接器", "configured", "test://native-knowledge", now],
  );
  await getConn().query(
    "INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id,connector_id) DO UPDATE SET access=EXCLUDED.access,created_at=EXCLUDED.created_at",
    ["sriphy", "starrykol", "write", now],
  );
  // Current review organization facts—not a persona mapping—authorize the
  // management actor and named reviewer for the approval instance.
  await getConn().query("UPDATE organization_people SET user_id=$1 WHERE person_ref='person:yan_chen'", ["sriphy"]);
  await getConn().query("UPDATE organization_people SET user_id=$1 WHERE person_ref='person:ye_guanwang'", ["knowledge-reviewer"]);
  await getConn().query("UPDATE organization_people SET user_id=$1 WHERE person_ref='person:yue_jialin'", ["knowledge-outsider"]);

  await seedPublishedAgent(AGENT_ID, "知识测试受控 Agent");
  for (const skill of skills) {
    const current = (await getAgentSkills(AGENT_ID)).find((row) => row.skill_id === skill);
    if (!current) await setAgentSkill(AGENT_ID, skill, true, 0);
    else if (!current.enabled) await setAgentSkill(AGENT_ID, skill, true, Number(current.version));
  }
  // Both actor types used by the legacy suites receive an explicit active
  // person binding.  This is the production Agent → Skill eligibility chain.
  for (const id of ["sriphy", "usr_lingong"]) {
    const personRef = await syncUserOrganization(id, "org:lt_team");
    await createAgentBinding({
      agent_id: AGENT_ID,
      target_type: "person",
      target_id: personRef,
      company_id: NATIVE_KNOWLEDGE_TENANT,
      source: "test",
    });
  }
  // Knowledge visibility has a legacy resource scope projection keyed by
  // handle.  The employee owns organization scope only; it must not inherit a
  // team grant from any test bootstrap residue.
  await getConn().query("DELETE FROM memberships WHERE user_handle='lingong' AND scope='team'");
  await getConn().query(
    "INSERT INTO memberships(id,user_handle,scope,scope_id) VALUES($1,'lingong','org','org_litime') ON CONFLICT DO NOTHING",
    ["mem_native_lingong_org"],
  );

  return {
    tenant: NATIVE_KNOWLEDGE_TENANT,
    admin: await session({ id: "sriphy", username: "sriphy" }),
    employee: await session({ id: "usr_lingong", username: "lingong" }),
    reviewer: await session({ id: "knowledge-reviewer", username: "knowledge-reviewer" }),
    outsider: await session({ id: "knowledge-outsider", username: "knowledge-outsider" }),
  };
}

async function createPublicationTemplate(fixture: NativeKnowledgeFixture): Promise<PublicationTemplate> {
  const definition = knowledgeReviewDefinition();
  const review = definition.nodes.find((node) => node.type === "review");
  if (!review) throw new Error("knowledge publication definition needs a human review node");
  review.assignee = { kind: "named", userIds: [fixture.reviewer.id] };
  const id = `knowledge-entry-release-${randomUUID()}`;
  const now = nowIso();
  await getConn().query(
    "INSERT INTO review_templates(tenant,id,version,published_version,definition,updated_at) VALUES($1,$2,1,1,$3,$4)",
    [fixture.tenant, id, JSON.stringify(definition), now],
  );
  await getConn().query(
    "INSERT INTO review_versions(tenant,template_id,version,definition,published_by,published_at) VALUES($1,$2,1,$3,$4,$5)",
    [fixture.tenant, id, JSON.stringify(definition), fixture.admin.id, now],
  );
  return { id, version: 1, definition };
}

async function decideNativePublication(fixture: NativeKnowledgeFixture, instanceId: string): Promise<void> {
  await postgresTransaction(async (db) => {
    const row = (await db.query(
      "SELECT payload FROM review_instances WHERE tenant=$1 AND id=$2 FOR UPDATE",
      [fixture.tenant, instanceId],
    )).rows[0] as { payload?: unknown } | undefined;
    if (!row?.payload) throw new Error("native knowledge review instance missing");
    const instance = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as ReviewInstance;
    const context = await postgresReviewContext(db, fixture.reviewer.id, fixture.tenant);
    decideReview(instance, fixture.reviewer.id, "approve", "已核对当前冻结版本", reviewResolver(context), nowIso());
    instance.version += 1;
    instance.updatedAt = nowIso();
    await db.query(
      "UPDATE review_instances SET status=$3,payload=$4,version=$5,updated_at=$6 WHERE tenant=$1 AND id=$2",
      [fixture.tenant, instanceId, instance.status, JSON.stringify(instance), instance.version, instance.updatedAt],
    );
  });
}

/** Publishes a structured entry through confirmation, human review, and native execution. */
export async function publishKnowledgeEntry(fixture: NativeKnowledgeFixture, knowledgeId: string, releaseNote = "知识条目发布"): Promise<{ instanceId: string; status: string }> {
  const template = await createPublicationTemplate(fixture);
  const command: KnowledgePublicationCommand = {
    templateId: template.id,
    templateVersion: template.version,
    values: {},
    releaseNote,
  };
  const asset = `entry:${knowledgeId}`;
  const prepared = await preparePublication(fixture.admin.id, fixture.tenant, asset, command);
  const submitted = await submitPublication(
    fixture.admin.id,
    fixture.tenant,
    asset,
    command,
    prepared.confirmationId,
    randomUUID(),
  );
  await decideNativePublication(fixture, submitted.instanceId);
  const executed = await executePublication(fixture.tenant, submitted.instanceId);
  if (executed.status !== "published") throw new Error(`native entry publication failed: ${JSON.stringify(executed)}`);
  return { instanceId: submitted.instanceId, status: executed.status };
}

/** Use an authenticated native user when a host service is invoked directly in a test. */
export async function withNativeKnowledgePrincipal<T>(userId: string, action: () => Promise<T> | T): Promise<T> {
  const row = (await getConn().query("SELECT * FROM users WHERE id=$1 AND active=1", [userId])).rows[0];
  if (!row) throw new Error(`native knowledge principal missing: ${userId}`);
  return withScopedUser(await mapUser(row), action);
}
