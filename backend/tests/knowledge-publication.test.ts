import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { ensureDemoAdmin } from "../src/auth.js";
import { ensureOrganizationTree } from "../src/runtime/organization-tree.js";
import { knowledgeReviewDefinition, type ReviewDefinition, type ReviewInstance } from "../../shared/review.js";
import type { KnowledgePublicationCommand } from "../../shared/knowledge-publication.js";
import { decideReview } from "../src/approval/review-engine.js";
import { postgresReviewContext } from "../src/approval/review-postgres-access.js";
import { reviewResolver } from "../src/approval/review-resolver.js";
import { postgresTransaction } from "../src/postgres/pool.js";
import {
  checkPublication,
  executePublication,
  preparePublication,
  publicationOptions,
  submitPublication,
} from "../src/knowledge-publication/service.js";
import { getDocumentDetail, startDocument, uploadDocument } from "../src/host/knowledge-documents.js";

const tenant = "company:amperetime";
type Template = { id: string; version: number; definition: ReviewDefinition };
type Prepared = { confirmationId: string; command: KnowledgePublicationCommand };

let tmp: string;

async function waitReady(id: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const detail = await getDocumentDetail(id);
    const document = detail.document as Record<string, unknown>;
    if (document.status === "pending_review") return document;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("pipeline timeout");
}

async function createTemplate(fields: ReviewDefinition["fields"] = []): Promise<Template> {
  const definition = knowledgeReviewDefinition();
  const review = definition.nodes.find((node) => node.type === "review");
  if (!review) throw new Error("knowledge publication definition needs a review node");
  review.assignee = { kind: "named", userIds: ["knowledge-reviewer"] };
  definition.fields.push(...fields);
  const id = `knowledge-release-${randomUUID()}`;
  const now = new Date().toISOString();
  await getConn().query(
    "INSERT INTO review_templates(tenant,id,version,published_version,definition,updated_at) VALUES($1,$2,1,1,$3,$4)",
    [tenant, id, JSON.stringify(definition), now],
  );
  await getConn().query(
    "INSERT INTO review_versions(tenant,template_id,version,definition,published_by,published_at) VALUES($1,$2,1,$3,$4,$5)",
    [tenant, id, JSON.stringify(definition), "sriphy", now],
  );
  return { id, version: 1, definition };
}

function command(template: Template, releaseNote: string, values: Record<string, unknown> = {}): KnowledgePublicationCommand {
  return {
    templateId: template.id,
    templateVersion: template.version,
    values,
    releaseNote,
  };
}

async function prepareNativeSubmission(
  id: string,
  template: Template,
  releaseNote = "发布产品规格资料",
  values: Record<string, unknown> = {},
): Promise<Prepared> {
  const nativeCommand = command(template, releaseNote, values);
  const prepared = await preparePublication("sriphy", tenant, id, nativeCommand);
  return { confirmationId: prepared.confirmationId, command: nativeCommand };
}

async function submitNativePublication(id: string, prepared: Prepared, key = randomUUID()) {
  return submitPublication("sriphy", tenant, id, prepared.command, prepared.confirmationId, key);
}

async function decide(instanceId: string, action: "approve" | "reject") {
  await postgresTransaction(async (db) => {
    const row = (await db.query(
      "SELECT payload FROM review_instances WHERE tenant=$1 AND id=$2 FOR UPDATE",
      [tenant, instanceId],
    )).rows[0] as { payload?: unknown } | undefined;
    if (!row || typeof row.payload !== "string") throw new Error("native review instance missing");
    const instance = JSON.parse(row.payload) as ReviewInstance;
    const context = await postgresReviewContext(db, "knowledge-reviewer", tenant);
    decideReview(
      instance,
      "knowledge-reviewer",
      action,
      action === "reject" ? "原件不符合发布要求" : "已核对原件",
      reviewResolver(context),
      new Date().toISOString(),
    );
    instance.version += 1;
    instance.updatedAt = new Date().toISOString();
    await db.query(
      "UPDATE review_instances SET status=$3,payload=$4,version=$5,updated_at=$6 WHERE tenant=$1 AND id=$2",
      [tenant, instanceId, instance.status, JSON.stringify(instance), instance.version, instance.updatedAt],
    );
  });
}

async function fixture(draft = false) {
  const base = `kb_${randomUUID()}`;
  const now = new Date().toISOString();
  await getConn().query(
    "INSERT INTO knowledge_bases(id,code,name,domain_id,kind,description,status,settings,version,created_at,updated_at) VALUES($1,$2,$3,'kdom_legacy','unstructured','', 'active','{}',1,$4,$4)",
    [base, base, "规格库", now],
  );
  const result = await uploadDocument(
    { name: "规格.pdf", type: "application/pdf", buf: Buffer.from("%PDF-1.4\nproduct specs\n%%EOF") },
    base,
    "sriphy",
    { draft },
  );
  const document = result.document as Record<string, unknown>;
  const id = String(document.id);
  if (!draft) await waitReady(id);
  return { id, base };
}

async function nativePublication(id: string) {
  return (await publicationOptions("sriphy", tenant, id)).publication;
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-native-publication-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "disabled";
  process.env.KNOWLEDGE_ENGINE_MODE = "stub";
  await resetConn();
  await seedAll();
  ensureDemoAdmin();
  await ensureOrganizationTree();
  const now = new Date().toISOString();
  for (const [id, roles] of [["sriphy", '["employee","admin"]'], ["knowledge-reviewer", '["employee"]']] as const) {
    await getConn().query(
      "INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
      [id, id, id, "unused", roles, "[]", "", 1, now],
    );
  }
  await getConn().query("UPDATE organization_people SET user_id=$1 WHERE person_ref='person:yan_chen'", ["sriphy"]);
  await getConn().query("UPDATE organization_people SET user_id=$1 WHERE person_ref='person:ye_guanwang'", ["knowledge-reviewer"]);
});

afterEach(async () => {
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.KNOWLEDGE_ENGINE_MODE;
});

describe("knowledge publication through native PostgreSQL submission, review and execution", () => {
  it("preflights the native policy without creating a confirmation or application", async () => {
    const document = await fixture();
    const template = await createTemplate();
    const nativeCommand = command(template, "发布产品规格");
    const before = (await getConn().query("SELECT count(*)::int AS n FROM knowledge_publication_confirmations", [])).rows[0] as { n: number };
    const checked = await checkPublication("sriphy", tenant, document.id, nativeCommand);
    expect(checked.allowed).toBe(true);
    expect(checked.reviewers.length).toBeGreaterThan(0);
    expect((await getConn().query("SELECT count(*)::int AS n FROM knowledge_publication_confirmations", [])).rows[0]).toEqual(before);
    expect((await getConn().query("SELECT id FROM knowledge_publication_applications WHERE document_id=$1", [document.id])).rowCount).toBe(0);
  });

  it("requires an explicit native confirmation before creating the review instance", async () => {
    const document = await fixture();
    const template = await createTemplate();
    const nativeCommand = command(template, "发布产品规格");
    await expect(submitPublication("sriphy", tenant, document.id, nativeCommand, "missing", randomUUID())).rejects.toMatchObject({ status: 403 });
    const prepared = await prepareNativeSubmission(document.id, template);
    const receipt = await submitNativePublication(document.id, prepared);
    expect(receipt.status).toBe("submitted");
    expect((await getConn().query("SELECT id FROM review_instances WHERE tenant=$1 AND id=$2", [tenant, receipt.instanceId])).rowCount).toBe(1);
  });

  it("is idempotent for a submission key and publishes only after native approval", async () => {
    const document = await fixture();
    const template = await createTemplate();
    const prepared = await prepareNativeSubmission(document.id, template);
    const key = randomUUID();
    const first = await submitNativePublication(document.id, prepared, key);
    expect(await submitNativePublication(document.id, prepared, key)).toEqual(first);
    expect((await executePublication(tenant, first.instanceId)).status).toBe("waiting");
    await decide(first.instanceId, "approve");
    const published = await executePublication(tenant, first.instanceId);
    expect(published.status).toBe("published");
    expect((await nativePublication(document.id))?.reviewStatus).toBe("approved");
    expect((await nativePublication(document.id))?.status).toBe("published");
    const detail = await getDocumentDetail(document.id);
    expect((detail.document as Record<string, unknown>).status).toBe("published");
  });

  it("rejects a required custom review value and freezes the accepted native payload", async () => {
    const document = await fixture();
    const template = await createTemplate([{ id: "model", label: "产品型号", type: "text", required: true }]);
    await expect(prepareNativeSubmission(document.id, template, "发布规格")).rejects.toMatchObject({ status: 422 });
    const prepared = await prepareNativeSubmission(document.id, template, "发布规格", { model: "LT-100", knowledge_request: "forged" });
    const receipt = await submitNativePublication(document.id, prepared);
    const row = (await getConn().query("SELECT payload FROM review_instances WHERE tenant=$1 AND id=$2", [tenant, receipt.instanceId])).rows[0] as { payload: string };
    const instance = JSON.parse(row.payload) as ReviewInstance;
    expect(instance.values.model).toBe("LT-100");
    expect(instance.values.knowledge_request).toBe(`native:${document.id}`);
    expect(instance.values.publication_note).toBe("发布规格");
    await decide(receipt.instanceId, "approve");
    expect((await executePublication(tenant, receipt.instanceId)).status).toBe("published");
  });

  it("does not publish a rejected native application", async () => {
    const document = await fixture();
    const prepared = await prepareNativeSubmission(document.id, await createTemplate());
    const receipt = await submitNativePublication(document.id, prepared);
    await decide(receipt.instanceId, "reject");
    expect((await executePublication(tenant, receipt.instanceId)).status).toBe("rejected");
    expect((await nativePublication(document.id))?.status).toBe("rejected");
    expect(((await getDocumentDetail(document.id)).document as Record<string, unknown>).status).toBe("pending_review");
  });

  it("blocks native publication when its frozen source material changes", async () => {
    const document = await fixture();
    const prepared = await prepareNativeSubmission(document.id, await createTemplate());
    const receipt = await submitNativePublication(document.id, prepared);
    await decide(receipt.instanceId, "approve");
    const source = (await getConn().query("SELECT source_path FROM knowledge_documents WHERE id=$1", [document.id])).rows[0] as { source_path: string };
    const file = path.isAbsolute(source.source_path) ? source.source_path : path.join(tmp, source.source_path);
    const bytes = fs.readFileSync(file);
    fs.appendFileSync(file, "tampered");
    expect((await executePublication(tenant, receipt.instanceId)).status).toBe("failed");
    expect((await nativePublication(document.id))?.status).toBe("failed");
    fs.writeFileSync(file, bytes);
  });

  it("enforces the organization tenant at native prepare time", async () => {
    const document = await fixture();
    const template = await createTemplate();
    await expect(preparePublication("sriphy", "other-company", document.id, command(template, "发布"))).rejects.toMatchObject({ status: 403 });
  });

  it("keeps draft material out of native submission until indexing completes", async () => {
    const document = await fixture(true);
    const template = await createTemplate();
    await expect(prepareNativeSubmission(document.id, template)).rejects.toMatchObject({ status: 409 });
    await startDocument(document.id, "sriphy");
    await waitReady(document.id);
    const prepared = await prepareNativeSubmission(document.id, template);
    expect(prepared.confirmationId).toEqual(expect.any(String));
  });
});
