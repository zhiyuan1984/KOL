import { randomUUID } from "node:crypto";
import { DEMO_USER, PERSONAS } from "../../src/config.js";
import { postgresPool, postgresTransaction } from "../../src/postgres/pool.js";
import { knowledgeReviewDefinition, type ReviewDefinition, type ReviewInstance } from "../../../shared/review.js";
import { postgresReviewContext } from "../../src/approval/review-postgres-access.js";
import { decideReview } from "../../src/approval/review-engine.js";
import { reviewResolver } from "../../src/approval/review-resolver.js";
import { executePublication, preparePublication, submitPublication } from "../../src/knowledge-publication/service.js";

/**
 * Test-only harness for the same entry publication path used in production:
 * draft -> confirmation -> independent human decision -> durable publication.
 * It intentionally does not set publication session variables or mutate a
 * published entry directly; the native service owns that guarded transition.
 */
const TENANT = "knowledge_fixture_company";
const REVIEWER = "knowledge_fixture_reviewer";
const EMPLOYEE = PERSONAS.employee;
let provisionedUrl = "";

function definition(): ReviewDefinition {
  return {
    schema: "review.definition.v1",
    name: "知识发布测试审批",
    description: "测试中的独立人工审批",
    subjectType: "knowledge_publication",
    fields: knowledgeReviewDefinition().fields,
    nodes: [
      { id: "start", name: "开始", type: "start", next: "review" },
      { id: "review", name: "独立审批", type: "review", mode: "single", assignee: { kind: "named", userIds: [REVIEWER] }, next: "end", reject: "any_reject" },
      { id: "end", name: "结束", type: "end" },
    ],
  };
}

/** Install actual active admin/reviewer identities and a published review route. */
export async function installKnowledgePublicationFixture(): Promise<void> {
  const url = String(process.env.DATABASE_URL || "");
  if (provisionedUrl === url) return;
  const db = postgresPool();
  const now = new Date().toISOString();
  const review = definition();
  const people = [
    { id: DEMO_USER.id, username: DEMO_USER.handle, name: DEMO_USER.name, roles: ["employee", "admin"] },
    { id: EMPLOYEE.id, username: EMPLOYEE.handle, name: EMPLOYEE.name, roles: ["employee"] },
    { id: REVIEWER, username: REVIEWER, name: "知识发布审核人", roles: ["employee"] },
  ];
  for (const person of people) {
    await db.query(
      `INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
       VALUES($1,$2,$3,'test-only',$4,'[]','',1,$5,$5)
       ON CONFLICT(id) DO UPDATE SET roles=EXCLUDED.roles,active=1,updated_at=EXCLUDED.updated_at`,
      [person.id, person.username, person.name, JSON.stringify(person.roles), now],
    );
    await db.query(
      `INSERT INTO organization_people(person_ref,user_id,display_name,status,created_at,updated_at)
       VALUES($1,$2,$3,'active',$4,$4)
       ON CONFLICT(person_ref) DO UPDATE SET user_id=EXCLUDED.user_id,display_name=EXCLUDED.display_name,status='active',updated_at=EXCLUDED.updated_at`,
      [`person_${person.id}`, person.id, person.name, now],
    );
  }
  await db.query(
    `INSERT INTO organization_units(id,company_id,display_name,type,level,status,created_at,updated_at)
     VALUES($1,$1,'知识发布测试公司','company',1,'active',$2,$2)
     ON CONFLICT(id) DO UPDATE SET company_id=EXCLUDED.company_id,status='active',updated_at=EXCLUDED.updated_at`,
    [TENANT, now],
  );
  for (const { id } of people) {
    await db.query(
      `INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at)
       VALUES($1,$2,$3,$3,'primary','active',$4,$4)
       ON CONFLICT(id) DO UPDATE SET status='active',updated_at=EXCLUDED.updated_at`,
      [`membership_${id}`, `person_${id}`, TENANT, now],
    );
  }
  await db.query(
    `INSERT INTO review_templates(tenant,id,version,published_version,definition,updated_at)
     VALUES($1,'knowledge-fixture-release',1,1,$2,$3)
     ON CONFLICT(tenant,id) DO UPDATE SET version=1,published_version=1,definition=EXCLUDED.definition,updated_at=EXCLUDED.updated_at`,
    [TENANT, JSON.stringify(review), now],
  );
  await db.query(
    `INSERT INTO review_versions(tenant,template_id,version,definition,published_by,published_at)
     VALUES($1,'knowledge-fixture-release',1,$2,$3,$4)
     ON CONFLICT(tenant,template_id,version) DO UPDATE SET definition=EXCLUDED.definition,published_by=EXCLUDED.published_by,published_at=EXCLUDED.published_at`,
    [TENANT, JSON.stringify(review), DEMO_USER.id, now],
  );
  provisionedUrl = url;
}

async function approve(instanceId: string): Promise<void> {
  await postgresTransaction(async (db) => {
    const row = (await db.query("SELECT payload FROM review_instances WHERE tenant=$1 AND id=$2 FOR UPDATE", [TENANT, instanceId])).rows[0];
    if (!row) throw new Error("knowledge publication review instance was not created");
    const instance = JSON.parse(row.payload) as ReviewInstance;
    const ctx = await postgresReviewContext(db, REVIEWER, TENANT);
    decideReview(instance, REVIEWER, "approve", "测试审批通过", reviewResolver(ctx), new Date().toISOString());
    instance.version += 1;
    instance.updatedAt = new Date().toISOString();
    await db.query(
      "UPDATE review_instances SET status=$2,payload=$3,version=$4,updated_at=$5 WHERE tenant=$1 AND id=$6",
      [TENANT, instance.status, JSON.stringify(instance), instance.version, instance.updatedAt, instanceId],
    );
  });
}

/** Publish an existing, current draft entry via the native governance workflow. */
export async function publishKnowledgeEntry(id: string): Promise<void> {
  await installKnowledgePublicationFixture();
  const command = { templateId: "knowledge-fixture-release", templateVersion: 1, values: {}, releaseNote: "测试知识发布" };
  const ref = `entry:${id}`;
  const prepared = await preparePublication(DEMO_USER.id, TENANT, ref, command);
  const receipt = await submitPublication(DEMO_USER.id, TENANT, ref, command, prepared.confirmationId, randomUUID());
  await approve(receipt.instanceId);
  const outcome = await executePublication(TENANT, receipt.instanceId);
  if (outcome.status !== "published") throw new Error(`knowledge fixture publish did not complete: ${outcome.status}`);
}
