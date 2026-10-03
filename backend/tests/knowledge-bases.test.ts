import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { setPersona } from "../src/host/persona.js";
import { assertUsableKnowledge, resolveForSkill } from "../src/host/knowledge.js";
import type { Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

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

async function rows(url: string): Promise<Json[]> {
  return (await (await request("GET", url)).json()) as unknown as Json[];
}

async function detailCode(res: { json: () => Promise<Json> }): Promise<string> {
  return String(((await res.json()).detail as Json | undefined)?.code || "");
}

async function createFamily(code: string, name = "族"): Promise<Json> {
  const body = (await (await request("POST", "/api/admin/knowledge/domains", { code, name, level: "family" })).json()) as {
    domain: Json;
  };
  return body.domain;
}

async function createDomain(parentId: string, code: string, name = "域"): Promise<Json> {
  const body = (await (await request("POST", "/api/admin/knowledge/domains", {
    code,
    name,
    level: "domain",
    parent_id: parentId,
  })).json()) as { domain: Json };
  return body.domain;
}

async function createBase(input: {
  code: string;
  name: string;
  domain_id: string;
  kind: string;
  external_ref?: unknown;
}): Promise<Json> {
  const body = (await (await request("POST", "/api/admin/knowledge/bases", input)).json()) as { base: Json };
  return body.base;
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kbbase-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("knowledge domains and bases (P2)", () => {
  it("creates families and domains with parent/child rules and code conflicts", async () => {
    const fam = await createFamily("content", "内容");
    expect(fam.level).toBe("family");
    expect(fam.parent_id).toBeNull();

    const dom = await createDomain(fam.id as string, "templates", "模板域");
    expect(dom.parent_id).toBe(fam.id);
    expect(dom.level).toBe("domain");

    // family 不得带 parent_id
    expect((await request("POST", "/api/admin/knowledge/domains", {
      code: "f2", name: "f2", level: "family", parent_id: fam.id,
    })).status).toBe(400);
    // domain 必须带 parent_id
    expect((await request("POST", "/api/admin/knowledge/domains", {
      code: "orphan", name: "orphan", level: "domain",
    })).status).toBe(400);
    // domain 的父级必须是 family
    expect((await request("POST", "/api/admin/knowledge/domains", {
      code: "nested", name: "nested", level: "domain", parent_id: dom.id,
    })).status).toBe(400);
    // 非法 level / code
    expect((await request("POST", "/api/admin/knowledge/domains", {
      code: "w", name: "w", level: "section",
    })).status).toBe(400);
    expect((await request("POST", "/api/admin/knowledge/domains", {
      code: "Bad-Code", name: "w", level: "family",
    })).status).toBe(400);

    // 同父下 code 唯一
    const dup = await request("POST", "/api/admin/knowledge/domains", {
      code: "templates", name: "dup", level: "domain", parent_id: fam.id,
    });
    expect(dup.status).toBe(409);
    expect(await detailCode(dup)).toBe("knowledge_domain_code_conflict");

    // 不同父下同 code 允许
    const fam2 = await createFamily("support", "支持");
    expect((await createDomain(fam2.id as string, "templates", "模板域2")).code).toBe("templates");

    // 族在前
    const list = (await (await request("GET", "/api/admin/knowledge/domains")).json()) as { domains: Json[] };
    expect(list.domains[0].level).toBe("family");

    const edited = (await (await request("PUT", `/api/admin/knowledge/domains/${dom.id}`, {
      name: "模板域（改）", sort: 5,
    })).json()) as { domain: Json };
    expect(edited.domain.name).toBe("模板域（改）");
    // 不允许改 code/level/parent_id（PUT 只接受 name/sort/status/note）
    expect(edited.domain.code).toBe("templates");

    // 归档仍有子域的族 → 409
    const archFamily = await request("PUT", `/api/admin/knowledge/domains/${fam.id}`, { status: "archived" });
    expect(archFamily.status).toBe(409);
    expect(await detailCode(archFamily)).toBe("knowledge_domain_in_use");

    // 归档仍有库的域 → 409
    await createBase({ code: "tmpl", name: "模板库", domain_id: dom.id as string, kind: "structured" });
    const archDomain = await request("PUT", `/api/admin/knowledge/domains/${dom.id}`, { status: "archived" });
    expect(archDomain.status).toBe(409);
    expect(await detailCode(archDomain)).toBe("knowledge_domain_in_use");

    const events = (await rows("/api/audit")).map((row) => String(row.event_type));
    expect(events).toContain("knowledge.domain.save");
  });

  it("creates bases with kind/domain validation, code uniqueness and optimistic version", async () => {
    const fam = await createFamily("content");
    const dom = await createDomain(fam.id as string, "templates");
    const base = await createBase({ code: "tmpl", name: "模板库", domain_id: dom.id as string, kind: "structured" });
    expect(base.kind).toBe("structured");
    expect(Number(base.entries)).toBe(0);

    expect((await request("POST", "/api/admin/knowledge/bases", {
      code: "b2", name: "x", domain_id: dom.id, kind: "weird",
    })).status).toBe(400);
    // 必须挂在 level=domain 下
    expect((await request("POST", "/api/admin/knowledge/bases", {
      code: "b3", name: "x", domain_id: fam.id, kind: "structured",
    })).status).toBe(400);
    expect((await request("POST", "/api/admin/knowledge/bases", {
      code: "b4", name: "x", domain_id: "nope", kind: "structured",
    })).status).toBe(400);
    // structured 禁止 external_ref
    expect((await request("POST", "/api/admin/knowledge/bases", {
      code: "b5", name: "x", domain_id: dom.id, kind: "structured", external_ref: { kb: "w" },
    })).status).toBe(400);
    const un = await createBase({
      code: "un", name: "文档库", domain_id: dom.id as string, kind: "unstructured", external_ref: { kb: "w" },
    });
    expect(un.kind).toBe("unstructured");
    expect(un.external_ref).toEqual({ kb: "w" });
    expect(Number(un.version)).toBe(1);

    // code 全局唯一
    const dup = await request("POST", "/api/admin/knowledge/bases", {
      code: "tmpl", name: "dup", domain_id: dom.id, kind: "structured",
    });
    expect(dup.status).toBe(409);
    expect(await detailCode(dup)).toBe("knowledge_base_code_conflict");

    // 过滤
    const byDomain = (await (await request("GET", `/api/admin/knowledge/bases?domain_id=${dom.id}`)).json()) as { bases: Json[] };
    expect(byDomain.bases.map((row) => row.id)).toEqual(expect.arrayContaining([base.id, un.id]));
    const structuredOnly = (await (await request("GET", "/api/admin/knowledge/bases?kind=structured")).json()) as { bases: Json[] };
    expect(structuredOnly.bases.length).toBeGreaterThan(0);
    expect(structuredOnly.bases.every((row) => row.kind === "structured")).toBe(true);

    // expected_version 必填；过期 409；成功后 +1
    expect((await request("PUT", `/api/admin/knowledge/bases/${base.id}`, { name: "x" })).status).toBe(400);
    const stale = await request("PUT", `/api/admin/knowledge/bases/${base.id}`, { name: "x", expected_version: 99 });
    expect(stale.status).toBe(409);
    expect(await detailCode(stale)).toBe("knowledge_base_version_conflict");
    const updated = (await (await request("PUT", `/api/admin/knowledge/bases/${base.id}`, {
      name: "模板库（改）", expected_version: 1,
    })).json()) as { base: Json };
    expect(updated.base.name).toBe("模板库（改）");
    expect(Number(updated.base.version)).toBe(2);
    // 同值 domain_id 允许（不改动）；改 kind 拒绝
    expect((await request("PUT", `/api/admin/knowledge/bases/${base.id}`, {
      domain_id: dom.id, expected_version: 2,
    })).status).toBe(200);
    expect((await request("PUT", `/api/admin/knowledge/bases/${base.id}`, {
      kind: "unstructured", expected_version: 3,
    })).status).toBe(400);

    const events = (await rows("/api/audit")).map((row) => String(row.event_type));
    expect(events).toContain("knowledge.base.save");
  });

  it("validates entries against their base: required base_id, structured fields, kind×base", async () => {
    const fam = await createFamily("content");
    const dom = await createDomain(fam.id as string, "templates");
    const structured = await createBase({ code: "s", name: "结构化库", domain_id: dom.id as string, kind: "structured" });
    const unstructured = await createBase({ code: "u", name: "非结构化库", domain_id: dom.id as string, kind: "unstructured" });

    // 新建必填 base_id
    const noBase = await request("POST", "/api/admin/knowledge", { title: "x", body: "y", kind: "prompt" });
    expect(noBase.status).toBe(400);
    expect(await detailCode(noBase)).toBe("knowledge_base_required");

    // 结构化字段非法 → 400 + errors
    const badStructured = await request("POST", "/api/admin/knowledge", {
      title: "x", body: "y", kind: "prompt", base_id: structured.id, structured: { variables: [] },
    });
    expect(badStructured.status).toBe(400);
    const badDetail = (await badStructured.json()).detail as Json;
    expect(badDetail.code).toBe("knowledge_structured_invalid");
    expect((badDetail.errors as string[]).length).toBeGreaterThan(0);

    // kind × 库类型不匹配
    const mismatch = await request("POST", "/api/admin/knowledge", {
      title: "x", body: "y", kind: "prompt", base_id: unstructured.id,
    });
    expect(mismatch.status).toBe(400);
    expect(await detailCode(mismatch)).toBe("knowledge_kind_base_mismatch");

    // policy 两类库都允许
    const policy = await (await request("POST", "/api/admin/knowledge", {
      title: "制度", body: "正文", kind: "policy", base_id: unstructured.id, status: "draft",
    })).json();
    expect(policy.base_id).toBe(unstructured.id);

    // structured 解析为对象；source_body 默认取 body
    const prompt = await (await request("POST", "/api/admin/knowledge", {
      title: "提示词", body: "正文", kind: "prompt", base_id: structured.id,
      structured: { body: "写一封信", variables: ["kol"] },
    })).json();
    expect(prompt.structured).toEqual({ body: "写一封信", variables: ["kol"] });
    const stored = getConn().prepare("SELECT source_body FROM knowledge WHERE id=?").get(String(prompt.id)) as Row;
    expect(String(stored.source_body)).toBe("正文");

    // 归档库拒绝写入
    await request("PUT", `/api/admin/knowledge/bases/${unstructured.id}`, { status: "archived", expected_version: 1 });
    const archived = await request("POST", "/api/admin/knowledge", {
      title: "x", body: "y", kind: "policy", base_id: unstructured.id,
    });
    expect(archived.status).toBe(400);
    expect(await detailCode(archived)).toBe("knowledge_base_archived");

    // 编辑可换到同 kind 兼容的库
    const moved = await (await request("PUT", `/api/admin/knowledge/${policy.id}`, {
      base_id: structured.id,
    })).json();
    expect(moved.base_id).toBe(structured.id);
  });

  it("filters entries by base/domain/family in SQL and exposes taxonomy on reads", async () => {
    const fam = await createFamily("content");
    const dom = await createDomain(fam.id as string, "templates");
    const base = await createBase({ code: "tmpl", name: "模板库", domain_id: dom.id as string, kind: "structured" });
    const other = await createBase({ code: "other", name: "其它库", domain_id: dom.id as string, kind: "structured" });

    const inBase = await (await request("POST", "/api/admin/knowledge", {
      title: "库内", body: "x", kind: "policy", base_id: base.id, status: "published",
    })).json();
    const otherEntry = await (await request("POST", "/api/admin/knowledge", {
      title: "库外", body: "x", kind: "policy", base_id: other.id, status: "published",
    })).json();

    const byBase = await rows(`/api/admin/knowledge?base=${base.id}`);
    expect(byBase.map((row) => row.id)).toContain(inBase.id);
    expect(byBase.map((row) => row.id)).not.toContain(otherEntry.id);
    expect(byBase[0].base_code).toBe("tmpl");
    expect(byBase[0].domain_id).toBe(dom.id);
    expect(byBase[0].family_id).toBe(fam.id);

    // 接受 code
    expect((await rows("/api/admin/knowledge?base=tmpl")).map((row) => row.id)).toEqual([inBase.id]);
    const both = [inBase.id, otherEntry.id].sort();
    expect((await rows("/api/admin/knowledge?domain=templates")).map((row) => row.id).sort()).toEqual(both);
    expect((await rows("/api/admin/knowledge?family=content")).map((row) => row.id).sort()).toEqual(both);

    // 员工面同样按 SQL 过滤并暴露分类
    setPersona("employee");
    const employee = await rows("/api/knowledge?base=tmpl");
    expect(employee.map((row) => row.id)).toEqual([inBase.id]);
    expect(employee[0].base_id).toBe(base.id);
    expect(employee[0].family_name).toBe("族");
  });

  it("skips entries in a non-structured base with the wrong_base_type reason", async () => {
    const fam = await createFamily("content");
    const dom = await createDomain(fam.id as string, "templates");
    const un = await createBase({ code: "u", name: "非结构化库", domain_id: dom.id as string, kind: "unstructured" });
    const entry = await (await request("POST", "/api/admin/knowledge", {
      title: "非结构化制度", body: "x", kind: "policy", base_id: un.id, status: "published", skill_id: "email_compose",
    })).json();

    await request("POST", `/api/knowledge/${entry.id}/cite`, {});
    // 注入闸门直接拒绝
    expect(() => assertUsableKnowledge(String(entry.id))).toThrowError(/结构化/);

    await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: [entry.id] },
    });
    const result = resolveForSkill("email_compose", {});
    expect(result.bound).toBe(true);
    expect(result.resolved.map((item) => item.id)).not.toContain(entry.id);
    expect(result.skipped).toContainEqual(expect.objectContaining({ knowledge_id: entry.id, reason: "wrong_base_type" }));

    const preview = await (await request("POST", "/api/admin/knowledge/resolve-preview", {
      skill_id: "email_compose",
    })).json();
    expect(preview.skipped).toContainEqual(expect.objectContaining({ knowledge_id: entry.id, reason: "wrong_base_type" }));
  });

  it("snapshots tags/in_market/effective_at/expires_at on edit and keeps them on rollback", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "带时效的制度",
      body: "v1 body",
      kind: "policy",
      base_id: "kbase_legacy",
      tags: "snap-a",
      in_market: 1,
      effective_at: "2026-01-01",
      expires_at: "2026-06-30",
      status: "draft",
    })).json();
    expect(created.tags).toBe("snap-a");
    expect(created.effective_at).toBe("2026-01-01");
    expect(created.expires_at).toBe("2026-06-30");

    await request("PUT", `/api/admin/knowledge/${created.id}`, {
      body: "v2 body",
      in_market: 0,
      effective_at: "2026-02-02",
      expires_at: "2026-07-07",
    });
    const v2 = (await rows(`/api/knowledge/${created.id}/versions`)).find((row) => Number(row.version) === 2) as Json;
    expect(v2).toBeTruthy();
    expect(Number(v2.in_market)).toBe(0);
    expect(String(v2.effective_at)).toBe("2026-02-02");
    expect(String(v2.expires_at)).toBe("2026-07-07");
    expect(String(v2.tags)).toBe("snap-a");

    const rolled = await (await request("POST", `/api/admin/knowledge/${created.id}/rollback`, { version: 1 })).json();
    expect(rolled.in_market).toBe(1);
    expect(rolled.effective_at).toBe("2026-01-01");
    expect(rolled.expires_at).toBe("2026-06-30");
    expect(rolled.tags).toBe("snap-a");
    expect(rolled.current_version).toBe(3);

    const v3 = (await rows(`/api/knowledge/${created.id}/versions`)).find((row) => Number(row.version) === 3) as Json;
    expect(Number(v3.in_market)).toBe(1);
    expect(String(v3.effective_at)).toBe("2026-01-01");
    expect(String(v3.tags)).toBe("snap-a");
  });
});
