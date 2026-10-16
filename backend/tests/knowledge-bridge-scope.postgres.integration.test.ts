import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { scopeHash } from "../src/knowledge/scope-contract.js";

const state = vi.hoisted(() => ({ pool: null as any, modelCalls: 0 }));
vi.mock("../src/postgres/pool.js", () => ({ postgresTransaction: async (callback: any) => {
  const client = await state.pool.connect();
  await client.query("BEGIN");
  try { const result = await callback(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
} }));
vi.mock("../src/knowledge-publication/service.js", () => ({ adminDocument: async () => ({ tenant: "company" }) }));
vi.mock("../src/approval/review-postgres-access.js", () => ({ postgresReviewCompanies: async () => [] }));
vi.mock("../src/execution-jobs/postgres-store.js", () => ({ pgEnqueueExecutionJob: vi.fn() }));
vi.mock("../src/worker/structured-background.js", () => ({ structuredBackground: async (prompt: string) => {
  state.modelCalls++;
  const payload = JSON.parse(prompt.slice(prompt.indexOf("数据：") + 3));
  return {
    summary: "仅覆盖上传资料中的规格",
    entities: [],
    topics: [{ label: "额定容量", evidence_ids: [payload.evidence[0].id] }],
    question_types: ["parameter_lookup"],
    limitations: ["仅覆盖收录资料"],
    unverified_notes: [],
  };
} }));
import { runBridge } from "../src/knowledge-bridge.js";
import { generateScope } from "../src/knowledge/scopes.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
(enabled ? describe : describe.skip)("knowledge bridge stub pages through scope validation", () => {
  const database = `bridge_scope_${randomUUID().replaceAll("-", "")}`;
  const previousMode = process.env.KNOWLEDGE_ENGINE_MODE;
  let maintenance: Pool, temporary: string, doc: any, job: any;

  beforeAll(async () => {
    process.env.KNOWLEDGE_ENGINE_MODE = "stub";
    maintenance = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await maintenance.query(`CREATE DATABASE "${database}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${database}`;
    state.pool = new Pool({ connectionString: url.toString() });
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kol-bridge-scope-"));
    const document = path.join(temporary, "uploaded");
    const library = path.join(temporary, "library");
    const source = path.join(document, "source.pdf");
    const normalized = path.join(document, "normalized.pdf");
    await fs.mkdir(document, { recursive: true });
    await fs.writeFile(source, "%PDF-1.4\noriginal uploaded material\n%%EOF\n");
    await fs.writeFile(normalized, "%PDF-1.4\nnormalized uploaded material\n%%EOF\n");
    await fs.writeFile(path.join(document, "extracted.md"), "## 第 1 页\n\n额定容量为 100Ah。\n\n## 第 2 页\n\n适用温度为 0-45°C。\n");
    const indexed = await runBridge({ cmd: "index", args: ["--input", normalized, "--library", library] });
    if (!indexed.ok || !indexed.doc_id) throw new Error("stub index fixture did not generate canonical page evidence");
    doc = {
      id: "doc", status: "pending_review", source_path: source,
      artifacts: { index: { library, doc_id: String(indexed.doc_id) }, normalize: { mode: "stub", pages: 2 } },
    };
    const sourceFingerprint = scopeHash({
      source: scopeHash((await fs.readFile(source)).toString("base64")), artifacts: doc.artifacts, explanation: "确认上传规格范围",
    });
    job = {
      id: "job", attempts: 1, worker_id: "worker-1", actor_ref: "actor", tenant_ref: "company",
      payload_json: JSON.stringify({ document_id: doc.id, explanation: "确认上传规格范围", source_fingerprint: sourceFingerprint }),
    };
    await state.pool.query(`
      CREATE TABLE knowledge_documents(id TEXT PRIMARY KEY,status TEXT,source_path TEXT,artifacts JSONB,updated_at TEXT);
      CREATE TABLE execution_jobs(id TEXT PRIMARY KEY,status TEXT,attempts INTEGER,lease_owner TEXT);
      CREATE TABLE knowledge_publications(document_id TEXT);
      CREATE TABLE knowledge_publication_applications(document_id TEXT,status TEXT);
      CREATE TABLE knowledge_publication_requests(document_id TEXT,instance_id TEXT);
      CREATE TABLE knowledge_document_scopes(document_id TEXT PRIMARY KEY,tenant TEXT,revision INTEGER DEFAULT 1,explanation TEXT,state TEXT DEFAULT 'empty',scope JSONB,fingerprint TEXT,source_fingerprint TEXT,job_id TEXT,updated_at TEXT,checked_by TEXT,checked_at TEXT);
    `);
    await state.pool.query(await fs.readFile(new URL("../migrations/043_20261015_knowledge_scope_async.sql", import.meta.url), "utf8"));
    await state.pool.query("INSERT INTO knowledge_documents VALUES($1,$2,$3,$4,$5)", [doc.id, doc.status, doc.source_path, doc.artifacts, "initial"]);
    await state.pool.query("INSERT INTO execution_jobs VALUES('job','running',1,'worker-1')");
    await state.pool.query("INSERT INTO knowledge_document_scopes(document_id,tenant,explanation,fingerprint,job_id) VALUES('doc','company','确认上传规格范围','initial','job')");
  }, 60000);

  afterAll(async () => {
    await state.pool?.end();
    if (maintenance) { await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await maintenance.end(); }
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    if (previousMode === undefined) delete process.env.KNOWLEDGE_ENGINE_MODE;
    else process.env.KNOWLEDGE_ENGINE_MODE = previousMode;
  });

  it("uses canonical source-backed stub pages and preserves scope evidence validation", async () => {
    const result = await generateScope(job, async () => {});
    expect(result).toMatchObject({ status: "candidate", progress: { done: 1, total: 1, unit: "batches" } });
    expect(state.modelCalls).toBe(1);
    const stored = (await state.pool.query("SELECT state,scope FROM knowledge_document_scopes WHERE document_id='doc'")).rows[0];
    expect(stored.state).toBe("candidate");
    expect(stored.scope.evidence).toEqual([
      expect.objectContaining({ original_pages: [1], text: "额定容量为 100Ah。" }),
      expect.objectContaining({ original_pages: [2], text: "适用温度为 0-45°C。" }),
    ]);
    expect(stored.scope.topics).toEqual([{ label: "额定容量", evidence_ids: ["doc:p1:0"] }]);
  });
});
