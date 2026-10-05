import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bridge from "../src/knowledge-bridge.js";
import { tokenDigest,withScopedUser,requireAdmin,authDisabled } from "../src/auth.js";
import type { Hono } from "hono";
import { getConn, resetConn,txImmediate } from "../src/db.js";
import { randomUUID } from "node:crypto";
import { ensureOrganizationTree } from "../src/runtime/organization-tree.js";
import { reviewContextForActor } from "../src/approval/review-access.js";
import { ReviewService } from "../src/approval/review-service.js";
import { knowledgeReviewDefinition } from "../../shared/review.js";
import { bindPublication,preparePublication,guardKnowledgeReview } from "../src/knowledge/publication.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";
import { seedAll } from "../src/seed.js";
import { setPersona } from "../src/host/persona.js";
import { freshTestDatabase } from "./support/pg.js";
import { SkillExecution, runtimeAgentForSkill } from "../src/runtime/execution.js";
import { login } from "../src/host/auth.js";
import { DEMO_ADMIN } from "../src/config.js";
import { runtimeAgentScopeContext } from "../src/contract-scope.js";
import { createAgentBinding, revokeAgentBinding, canUseAgent } from "../src/runtime/organization-tree.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
  cookie = "",
): Promise<{ status: number; cookie: string; json: () => Promise<Json>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: {} };
  const headers = init.headers as Record<string, string>;
  if (cookie) headers.Cookie = cookie;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await (authDisabled() ? withScopedUser(requireAdmin(),()=>app.request(url,init)) : app.request(url,init));
  const text = await res.text();
  return {
    status: res.status,
    cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
    text: async () => text,
    json: async () => (text ? (JSON.parse(text) as Json) : {}),
  };
}

async function detailCode(res: { json: () => Promise<Json> }): Promise<string> {
  return String(((await res.json()).detail as Json | undefined)?.code || "");
}

function pdfBytes(marker = ""): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n${marker}\n%%EOF\n`, "utf8");
}

/** Node Buffer → 独立 ArrayBuffer，避开 Buffer<ArrayBufferLike> 与 BlobPart 的类型冲突。 */
function blobPart(buf: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}

async function createUnstructuredBase(code = "e2e_docs"): Promise<Json> {
  const family = (await (await request("POST", "/api/admin/knowledge/domains", {
    code: `${code}_fam`, name: "资料族", level: "family",
  })).json()).domain as Json;
  const domain = (await (await request("POST", "/api/admin/knowledge/domains", {
    code: `${code}_dom`, name: "资料域", level: "domain", parent_id: family.id,
  })).json()).domain as Json;
  const base = (await (await request("POST", "/api/admin/knowledge/bases", {
    code, name: "资料库", domain_id: domain.id, kind: "unstructured",
  })).json()).base as Json;
  return base;
}

async function upload(baseId: string, name: string, bytes: Buffer): Promise<Json> {
  const form = new FormData();
  form.append("base_id", baseId);
  form.append("file", new File([blobPart(bytes)], name, { type: "application/pdf" }));
  const res = await request("POST", "/api/admin/knowledge/documents", form);
  expect(res.status).toBe(201);
  return (await res.json()).document as Json;
}

async function docDetail(id: string): Promise<Json> {
  const res = await request("GET", `/api/admin/knowledge/documents/${id}`);
  expect(res.status).toBe(200);
  return await res.json();
}

async function waitStatus(id: string, statuses: string[], timeoutMs = 8000): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await docDetail(id);
    const doc = body.document as Json;
    if (statuses.includes(String(doc.status))) return doc;
    if (Date.now() > deadline) throw new Error(`waitStatus timeout: ${String(doc.status)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function auditCount(eventType: string): Promise<number> {
  const row = getConn().prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type=?").get(eventType) as { n: unknown };
  return Number(row.n || 0);
}

async function approveAndPublish(id:string,base:string){
  const context=(actor="sriphy")=>reviewContextForActor(getConn(),actor,"company:amperetime");
  const definition=knowledgeReviewDefinition();definition.nodes.find(n=>n.type==="review")!.assignee={kind:"named",userIds:["pdf-reviewer"]};
  const template=txImmediate(db=>new ReviewService(db,context()).saveTemplate(undefined,undefined,definition));
  txImmediate(db=>{const service=new ReviewService(db,context()),command={action:"publish" as const,templateId:template.id,expectedVersion:template.version};
    const prepare=service.prepare(command);service.execute(command,prepare.confirmationId,randomUUID());});
  await bindPublication(base,template.id,0,context());
  const prepare=await preparePublication(id,"核对原文后发布",context());await guardKnowledgeReview(prepare.command,context());
  const submit=txImmediate(db=>new ReviewService(db,context()).execute(prepare.command,prepare.confirmationId,randomUUID()));
  const instance=String(submit.resourceId),service=new ReviewService(getConn(),context("pdf-reviewer")),view=service.instance(instance);
  const command={action:"approve" as const,instanceId:instance,expectedVersion:view.version,reason:"已核对"};await guardKnowledgeReview(command,context("pdf-reviewer"));
  txImmediate(db=>{const s=new ReviewService(db,context("pdf-reviewer")),p=s.prepare(command);s.execute(command,p.confirmationId,randomUUID());});
  expect((await processExecutionJobById(`knowledge-publish:company:amperetime:${instance}`,"pdf-test"))?.outcome).toBe("processed");
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kdoc-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.KNOWLEDGE_ENGINE_MODE = "stub";
  delete process.env.KNOWLEDGE_STUB_NORMALIZE_MS;
  resetConn();
  seedAll();
  process.env.AUTH_MODE="disabled";ensureOrganizationTree();
  const db=getConn(),time=new Date().toISOString();
  for(const [id,roles] of [["sriphy",'["employee","admin"]'],["pdf-reviewer",'["employee"]']])
    db.prepare("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id,id,id,"unused",roles,'[]','',1,time,time);
  db.prepare("UPDATE organization_people SET user_id='sriphy' WHERE person_ref='person:yan_chen'").run();
  db.prepare("UPDATE organization_people SET user_id='pdf-reviewer' WHERE person_ref='person:zhang_gan'").run();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConn();
  delete process.env.KNOWLEDGE_ENGINE_MODE;
  delete process.env.KNOWLEDGE_STUB_NORMALIZE_MS;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("knowledge documents (P1 pipeline)", () => {
  it("saves a PDF draft without jobs, starts explicitly once, and keeps it unpublished", async () => {
    const base = await createUnstructuredBase();
    const form = new FormData();
    form.append("base_id", String(base.id)); form.append("draft", "true");
    form.append("file", new File([blobPart(pdfBytes())], "产品规格.pdf"));
    const response = await request("POST", "/api/admin/knowledge/documents", form);
    expect(response.status).toBe(201);
    const doc = (await response.json()).document as Json;
    expect(doc.status).toBe("draft");
    expect((await docDetail(String(doc.id))).jobs).toEqual([]);
    expect((await request("POST", `/api/admin/knowledge/documents/${doc.id}/publish`)).status).toBe(409);
    expect((await request("POST", `/api/admin/knowledge/documents/${doc.id}/start`)).status).toBe(200);
    expect((await request("POST", `/api/admin/knowledge/documents/${doc.id}/start`)).status).toBe(409);
    await waitStatus(String(doc.id), ["pending_review"]);
  });

  it("product consultation uses published bound PDFs through the runtime and rechecks user access", async () => {
    login(DEMO_ADMIN.handle, DEMO_ADMIN.password);
    const base = await createUnstructuredBase();
    const create = await request("POST", "/api/admin/skills", {
      id: "product_consultation", title: "产品咨询", body: "使用知识文档问答工具回答并保留页码。", mcp: ["knowledge.ask_documents"],
    });
    expect(create.status, await create.text()).toBe(201);
    for (const stage of ["editing", "testing", "published"]) {
      const result = await request("POST", "/api/admin/skills/product_consultation/stage", { stage });
      expect(result.status, await result.text()).toBe(200);
    }
    seedPublishedAgent("agent_product_test", "产品专家");
    const enabled = await request("PUT", "/api/admin/agents/agent_product_test/skills/product_consultation", { enabled: true, expected_version: 0 });
    expect(enabled.status).toBe(200);
    const binding = await request("POST", "/api/admin/agents/agent_product_test/knowledge", { skill_id: "product_consultation", base_id: base.id });
    expect(binding.status, await binding.text()).toBe(201);
    const db = getConn();
    db.prepare("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("product-user", "product-user", "产品测试用户", "no-login", '["employee"]', '[]', '', 1, "now", "now");
    db.prepare("UPDATE organization_people SET user_id=? WHERE person_ref=?").run("product-user", "person:ye_guanwang");
    const access = createAgentBinding({ agent_id: "agent_product_test", target_type: "person", target_id: "person:ye_guanwang", company_id: "company:amperetime", source: "test" });
    expect(canUseAgent("product-user", "agent_product_test")).toBe(true);
    expect(runtimeAgentForSkill("product_consultation", "product-user")).toBe("agent_product_test");
    expect(runtimeAgentScopeContext("agent_product_test").execution_scope).toBe("skill-resources");
    const runtime = new SkillExecution({ agentId: "agent_product_test", skillId: "product_consultation", userId: "product-user", runId: "product-test" });
    try {
      const catalog = await runtime.discover();
      expect(catalog.tools.map((tool) => tool.exposed.name)).toContain("knowledge.ask_documents");
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？", base_id: "unbound-base" })).rejects.toMatchObject({ detail: { code: "knowledge_scope_unavailable" } });
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？", include_pending: true })).rejects.toMatchObject({ detail: { code: "runtime_tool_arguments_invalid" } });
      const doc = await upload(String(base.id), "产品规格.pdf", pdfBytes());
      await waitStatus(String(doc.id), ["pending_review"]);
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？" })).rejects.toMatchObject({ detail: { code: "knowledge_no_published_documents" } });
      await approveAndPublish(String(doc.id),String(base.id));
      const result = await runtime.invoke("knowledge.ask_documents", { query: "规格？" });
      const answer = JSON.parse(String((result.content as Json[])[0].text));
      expect(answer.citations[0]).toMatchObject({ document_id: doc.id, page: 1 });
      expect(answer.citations[0].source_url).toContain("agent_id=agent_product_test");
      const invalid = vi.spyOn(bridge, "runBridge").mockResolvedValueOnce({ ok: true, answer: "untrusted", citations: [{ doc_id: "outside-scope", page: 1 }] });
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？" })).rejects.toMatchObject({ detail: { code: "knowledge_invalid_citation" } });
      invalid.mockRestore();
      db.prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
        .run(tokenDigest("product-source-test"), "product-user", new Date(Date.now() + 60000).toISOString(), new Date().toISOString());
      process.env.AUTH_MODE = "enabled";
      const sourceUrl = String(answer.citations[0].source_url).split("#")[0];
      expect((await request("GET", sourceUrl, undefined, "lingong_session=product-source-test")).status).toBe(200);
      process.env.AUTH_MODE = "disabled";
      db.prepare("UPDATE knowledge_bases SET status='archived' WHERE id=?").run(base.id);
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？" })).rejects.toMatchObject({ detail: { code: "knowledge_scope_unavailable" } });
      db.prepare("UPDATE knowledge_bases SET status='active' WHERE id=?").run(base.id);
      const originalBridge = bridge.runBridge;
      const revoked = vi.spyOn(bridge, "runBridge").mockImplementationOnce(async (call) => {
        const outcome = await originalBridge(call);
        revokeAgentBinding(access.id, { reason: "查询过程中撤权" });
        return outcome;
      });
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？" })).rejects.toMatchObject({ detail: { code: "runtime_agent_not_usable" } });
      revoked.mockRestore();
      process.env.AUTH_MODE = "enabled";
      expect((await request("GET", sourceUrl, undefined, "lingong_session=product-source-test")).status).toBe(403);
      process.env.AUTH_MODE = "disabled";
      await expect(runtime.invoke("knowledge.ask_documents", { query: "规格？" })).rejects.toMatchObject({ detail: { code: "runtime_agent_not_usable" } });
    } finally { runtime.close(); process.env.AUTH_MODE = "disabled"; }
  });
  it("accepts only PDF uploads into an active unstructured base", async () => {
    const structuredFamily = (await (await request("POST", "/api/admin/knowledge/domains", {
      code: "s_fam", name: "族", level: "family",
    })).json()).domain as Json;
    const structuredDomain = (await (await request("POST", "/api/admin/knowledge/domains", {
      code: "s_dom", name: "域", level: "domain", parent_id: structuredFamily.id,
    })).json()).domain as Json;
    const structuredBase = (await (await request("POST", "/api/admin/knowledge/bases", {
      code: "s_base", name: "结构化库", domain_id: structuredDomain.id, kind: "structured",
    })).json()).base as Json;
    const base = await createUnstructuredBase();

    const form1 = new FormData();
    form1.append("base_id", String(structuredBase.id));
    form1.append("file", new File([blobPart(pdfBytes())], "a.pdf", { type: "application/pdf" }));
    const res1 = await request("POST", "/api/admin/knowledge/documents", form1);
    expect(res1.status).toBe(400);
    expect(await detailCode(res1)).toBe("knowledge_base_not_unstructured");

    const form2 = new FormData();
    form2.append("base_id", String(base.id));
    form2.append("file", new File([blobPart(pdfBytes())], "deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
    const res2 = await request("POST", "/api/admin/knowledge/documents", form2);
    expect(res2.status).toBe(400);
    expect(await detailCode(res2)).toBe("knowledge_format_not_implemented");

    const form3 = new FormData();
    form3.append("base_id", "kbase_missing");
    form3.append("file", new File([blobPart(pdfBytes())], "a.pdf", { type: "application/pdf" }));
    const res3 = await request("POST", "/api/admin/knowledge/documents", form3);
    expect(res3.status).toBe(400);
    expect(await detailCode(res3)).toBe("knowledge_base_missing");
  });

  it("runs normalize then index with real jobs, artifacts and a base-level engine binding", async () => {
    const base = await createUnstructuredBase();
    const doc = await upload(String(base.id), "SOP 手册.pdf", pdfBytes());
    const done = await waitStatus(String(doc.id), ["pending_review"]);

    expect(done.status).toBe("pending_review");
    expect((done.latest_job as Json).kind).toBe("index");
    expect((done.latest_job as Json).status).toBe("done");
    const artifacts = done.artifacts as Json;
    expect(String((artifacts.index as Json).doc_id || "")).toContain("pi_stub_");
    expect(Number((artifacts.index as Json).pages || 0)).toBe(1);

    const body = await docDetail(String(doc.id));
    const jobs = body.jobs as Json[];
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.kind).sort()).toEqual(["index", "normalize"]);
    expect(jobs.every((job) => job.status === "done")).toBe(true);
    expect((body.text_preview as Json | null)).toBeNull();

    const bases = (await (await request("GET", "/api/admin/knowledge/bases")).json()).bases as Json[];
    const saved = bases.find((item) => item.id === base.id) as Json;
    expect(String((saved.external_ref as Json).provider)).toBe("pageindex-local");

    expect(await auditCount("knowledge.document.upload")).toBe(1);
    expect(await auditCount("knowledge.document.normalize")).toBe(1);
    expect(await auditCount("knowledge.document.index")).toBe(1);
  });

  it("publishes only after review and answers with page-level citations", async () => {
    const base = await createUnstructuredBase();
    const doc = await upload(String(base.id), "选手手册.pdf", pdfBytes());
    await waitStatus(String(doc.id), ["pending_review"]);

    await approveAndPublish(String(doc.id),String(base.id));
    const published = (await docDetail(String(doc.id))).document as Json;
    expect(published.status).toBe("published");
    expect(published.published_at).toBeTruthy();

    const answer = await (await request("POST", "/api/admin/knowledge/search", {
      query: "这份资料的要点是什么？",
      base_id: base.id,
    })).json();
    expect(String(answer.answer)).toContain("stub 试算答案");
    expect(String(answer.answer)).toContain("这份资料的要点是什么？");
    const citations = answer.citations as Json[];
    expect(citations).toHaveLength(1);
    expect(citations[0].document_id).toBe(doc.id);
    expect(citations[0].page).toBe(1);

    expect(await auditCount("knowledge.document.publish")).toBe(1);
    expect(await auditCount("knowledge.search")).toBe(1);
  });

  it("keeps unpublished documents out of the library trial; approval trial is single-document", async () => {
    const base = await createUnstructuredBase();
    const publishedDoc = await upload(String(base.id), "已发布.pdf", pdfBytes());
    await waitStatus(String(publishedDoc.id), ["pending_review"]);
    await approveAndPublish(String(publishedDoc.id),String(base.id));
    const pendingDoc = await upload(String(base.id), "未发布.pdf", pdfBytes());
    await waitStatus(String(pendingDoc.id), ["pending_review"]);

    const trial = await (await request("POST", "/api/admin/knowledge/search", {
      query: "范围？", base_id: base.id,
    })).json();
    const citations = trial.citations as Json[];
    expect(citations.map((item) => item.document_id)).toEqual([publishedDoc.id]);

    const scoped = await (await request("POST", "/api/admin/knowledge/search", {
      query: "审批前试算", base_id: base.id, include_pending: true, doc_ids: [pendingDoc.id],
    })).json();
    expect((scoped.citations as Json[]).map((item) => item.document_id)).toEqual([pendingDoc.id]);

    const tooMany = await request("POST", "/api/admin/knowledge/search", {
      query: "x", base_id: base.id, include_pending: true, doc_ids: [publishedDoc.id, pendingDoc.id],
    });
    expect(tooMany.status).toBe(400);
    expect(await detailCode(tooMany)).toBe("knowledge_pending_scope");

    const notPublished = await request("POST", "/api/admin/knowledge/search", {
      query: "x", base_id: base.id, doc_ids: [pendingDoc.id],
    });
    expect(notPublished.status).toBe(409);
    expect(await detailCode(notPublished)).toBe("knowledge_no_published_documents");
  });

  it("fails an index job honestly and retries from the failed stage", async () => {
    const base = await createUnstructuredBase();
    const doc = await upload(String(base.id), "会失败一次.pdf", pdfBytes("STUB_FAIL_INDEX_ONCE"));
    const failed = await waitStatus(String(doc.id), ["failed"]);
    expect(String(failed.error || "")).toContain("索引失败");
    const body = await docDetail(String(doc.id));
    const jobs = body.jobs as Json[];
    expect(jobs[0].kind).toBe("index");
    expect(jobs[0].status).toBe("failed");

    const retried = (await (await request("POST", `/api/admin/knowledge/documents/${doc.id}/retry`)).json()).document as Json;
    expect(Number(retried.retry_count)).toBe(1);
    const done = await waitStatus(String(doc.id), ["pending_review"]);
    expect(done.status).toBe("pending_review");
    const after = await docDetail(String(doc.id));
    const kinds = (after.jobs as Json[]).filter((job) => job.kind === "index");
    expect(kinds.map((job) => job.status).sort()).toEqual(["done", "failed"]);
  });

  it("cancels a running normalize with a real terminal state, then retry completes", async () => {
    const base = await createUnstructuredBase();
    process.env.KNOWLEDGE_STUB_NORMALIZE_MS = "400";
    const doc = await upload(String(base.id), "可取消.pdf", pdfBytes());
    await waitStatus(String(doc.id), ["normalizing"]);
    const cancelled = (await (await request("POST", `/api/admin/knowledge/documents/${doc.id}/cancel`)).json()).document as Json;
    expect(["normalizing", "cancelled"]).toContain(String(cancelled.status));
    const settled = await waitStatus(String(doc.id), ["cancelled"]);
    expect(settled.status).toBe("cancelled");

    delete process.env.KNOWLEDGE_STUB_NORMALIZE_MS;
    await request("POST", `/api/admin/knowledge/documents/${doc.id}/retry`);
    await waitStatus(String(doc.id), ["pending_review"]);
  });

  it("deletes only unpublished documents and keeps published ones archivable", async () => {
    const base = await createUnstructuredBase();
    const doc = await upload(String(base.id), "先发布.pdf", pdfBytes());
    await waitStatus(String(doc.id), ["pending_review"]);
    await approveAndPublish(String(doc.id),String(base.id));

    const blocked = await request("DELETE", `/api/admin/knowledge/documents/${doc.id}`);
    expect(blocked.status).toBe(409);
    expect(await detailCode(blocked)).toBe("knowledge_document_frozen");

    const archived = (await (await request("POST", `/api/admin/knowledge/documents/${doc.id}/archive`)).json()).document as Json;
    expect(archived.status).toBe("archived");

    const blockedAgain = await request("DELETE", `/api/admin/knowledge/documents/${doc.id}`);
    expect(blockedAgain.status).toBe(409);

    const failing = await upload(String(base.id), "失败可删.pdf", pdfBytes("STUB_FAIL_INDEX"));
    await waitStatus(String(failing.id), ["failed"]);
    const removed = await request("DELETE", `/api/admin/knowledge/documents/${failing.id}`);
    expect(removed.status).toBe(200);
    expect((await (await request("GET", `/api/admin/knowledge/documents/${failing.id}`)).json()).detail).toBeTruthy();
    expect((await request("GET", `/api/admin/knowledge/documents/${failing.id}`)).status).toBe(404);
    const dir = path.join(tmp, "knowledge", "bases", String(base.id), "documents", String(failing.id));
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("keeps document governance admin-only and reports engine health", async () => {
    const base = await createUnstructuredBase();
    const health = await (await request("GET", "/api/admin/knowledge/index-health")).json();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe("stub");

    process.env.AUTH_MODE = "enabled";
    try {
      const denied = await request("GET", "/api/admin/knowledge/documents");
      expect([401, 403]).toContain(denied.status);
      const deniedSearch = await request("POST", "/api/admin/knowledge/search", { query: "x", base_id: base.id });
      expect([401, 403]).toContain(deniedSearch.status);
    } finally {
      delete process.env.AUTH_MODE;
    }
    const allowed = await request("GET", "/api/admin/knowledge/documents");
    expect(allowed.status).toBe(200);
  });
});
