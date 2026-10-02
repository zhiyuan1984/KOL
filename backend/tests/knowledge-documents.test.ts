import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setPersona } from "../src/host/persona.js";

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
  const res = await app.request(url, init);
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
  form.append("file", new File([bytes], name, { type: "application/pdf" }));
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
  const row = getConn().prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type=?").get(eventType) as { n: number };
  return Number(row.n || 0);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kdoc-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.KNOWLEDGE_ENGINE_MODE = "stub";
  delete process.env.KNOWLEDGE_STUB_NORMALIZE_MS;
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  delete process.env.KNOWLEDGE_ENGINE_MODE;
  delete process.env.KNOWLEDGE_STUB_NORMALIZE_MS;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("knowledge documents (P1 pipeline)", () => {
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
    form1.append("file", new File([pdfBytes()], "a.pdf", { type: "application/pdf" }));
    const res1 = await request("POST", "/api/admin/knowledge/documents", form1);
    expect(res1.status).toBe(400);
    expect(await detailCode(res1)).toBe("knowledge_base_not_unstructured");

    const form2 = new FormData();
    form2.append("base_id", String(base.id));
    form2.append("file", new File([pdfBytes()], "deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
    const res2 = await request("POST", "/api/admin/knowledge/documents", form2);
    expect(res2.status).toBe(400);
    expect(await detailCode(res2)).toBe("knowledge_format_not_implemented");

    const form3 = new FormData();
    form3.append("base_id", "kbase_missing");
    form3.append("file", new File([pdfBytes()], "a.pdf", { type: "application/pdf" }));
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

    const published = (await (await request("POST", `/api/admin/knowledge/documents/${doc.id}/publish`)).json()).document as Json;
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
    await request("POST", `/api/admin/knowledge/documents/${publishedDoc.id}/publish`);
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
    await request("POST", `/api/admin/knowledge/documents/${doc.id}/publish`);

    const blocked = await request("DELETE", `/api/admin/knowledge/documents/${doc.id}`);
    expect(blocked.status).toBe(409);
    expect(await detailCode(blocked)).toBe("knowledge_document_published");

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
