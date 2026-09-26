import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { setPersona } from "../src/host/persona.js";
import { resolveForSkill, resolveMailTemplate } from "../src/host/knowledge.js";

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

async function auditTypes(): Promise<string[]> {
  return (await rows("/api/audit")).map((row) => String(row.event_type));
}

async function createPublished(input: Json): Promise<Json> {
  const created = await (await request("POST", "/api/admin/knowledge", input)).json();
  expect(created.status).toBe("published");
  return created;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kbgov-"));
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

describe("knowledge governance", () => {
  it("keeps published knowledge visible until a grant row narrows it", async () => {
    const before = await rows("/api/knowledge");
    expect(before.map((row) => row.id)).toContain("kb_mail_kol");

    await request("PUT", "/api/admin/knowledge/kb_mail_kol/grants", { org: ["org_litime"] });
    setPersona("employee"); // lingong: org_litime only
    const orgVisible = await rows("/api/knowledge");
    expect(orgVisible.map((row) => row.id)).toContain("kb_mail_kol");

    await request("PUT", "/api/admin/knowledge/kb_mail_kol/grants", { team: ["team_kol"] });
    const teamHidden = await rows("/api/knowledge");
    expect(teamHidden.map((row) => row.id)).not.toContain("kb_mail_kol");

    setPersona("sriphy"); // sriphy: org_litime + team_kol
    const teamVisible = await rows("/api/knowledge");
    expect(teamVisible.map((row) => row.id)).toContain("kb_mail_kol");

    const grants = await (await request("GET", "/api/admin/knowledge/kb_mail_kol/grants")).json();
    expect(grants).toMatchObject({ org: [], team: ["team_kol"], user: [] });
    const bad = await request("PUT", "/api/admin/knowledge/kb_mail_kol/grants", { org: ["org_nope"] });
    expect(bad.status).toBe(400);
  });

  it("marks a row hidden only when a personal hide record exists", async () => {
    const before = await rows("/api/knowledge");
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((row) => row.deprecated === false)).toBe(true);

    await request("POST", "/api/knowledge/kb_mail_followup/deprecate", { reason: "过时" });
    const after = (await rows("/api/knowledge")).find((row) => row.id === "kb_mail_followup");
    expect(after?.deprecated).toBe(true);
    expect(after?.deprecate_reason_label).toBe("内容过时");
  });

  it("filters the ops list by q, kind, stage, brand and paginates", async () => {
    const byQ = await rows(`/api/knowledge?q=${encodeURIComponent("阶段跟进")}`);
    expect(byQ.map((row) => row.id)).toEqual(["kb_mail_followup"]);
    expect(await rows("/api/knowledge?q=%25")).toEqual([]);

    const policies = await rows("/api/knowledge?kind=policy");
    expect(policies.length).toBe(4);
    expect(policies.every((row) => row.kind === "policy")).toBe(true);

    const stage = await rows("/api/knowledge?stage=QUOTE_PENDING");
    expect(stage.map((row) => row.id)).toContain("kb_mail_quote");
    expect(stage.map((row) => row.id)).not.toContain("kb_mail_kol");

    const brand = await rows("/api/knowledge?brand=RO");
    expect(brand.map((row) => row.id)).toContain("kb_mail_nudge");
    expect(brand.map((row) => row.id)).not.toContain("kb_mail_kol");
    expect(brand.every((row) => row.brand === "RO" || row.brand === "*")).toBe(true);

    const all = await rows("/api/knowledge");
    const first = await rows("/api/knowledge?limit=2");
    expect(first.map((row) => row.id)).toEqual(all.slice(0, 2).map((row) => row.id));
    const second = await rows("/api/knowledge?limit=2&offset=1");
    expect(second.map((row) => row.id)).toEqual(all.slice(1, 3).map((row) => row.id));
  });

  it("matches a mail template by subject and keeps the kind filter", async () => {
    // 「Sample shipped」只出现在 kb_mail_ship 的 subject（title/body/tags 都没有），
    // 用来证明关键词检索确实覆盖了 subject。
    const bySubject = await rows(`/api/knowledge?q=${encodeURIComponent("Sample shipped")}`);
    expect(bySubject.map((row) => row.id)).toEqual(["kb_mail_ship"]);
    expect(String(bySubject[0].subject || "")).toContain("Sample shipped");

    const mailed = await rows(`/api/knowledge?q=${encodeURIComponent("Sample shipped")}&kind=mail_template`);
    expect(mailed.map((row) => row.id)).toEqual(["kb_mail_ship"]);
    expect(await rows(`/api/knowledge?q=${encodeURIComponent("Sample shipped")}&kind=policy`)).toEqual([]);

    // 转义与参数个数仍对齐：字面量 % 不变成通配符。
    expect(await rows("/api/knowledge?q=%25")).toEqual([]);
  });

  it("binds approval to the reviewed version", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "审批版本对象",
      body: "v1 body",
      kind: "policy",
      status: "draft",
    })).json();

    const missing = await request("POST", `/api/admin/knowledge/${created.id}/approve`, {});
    expect(missing.status).toBe(400);

    const stale = await request("POST", `/api/admin/knowledge/${created.id}/approve`, {
      expected_version: Number(created.current_version) + 1,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()).detail as Json).code).toBe("knowledge_version_conflict");

    await request("PUT", `/api/admin/knowledge/${created.id}`, { body: "v2 body" });
    const ok = await request("POST", `/api/admin/knowledge/${created.id}/approve`, { expected_version: 2 });
    expect(ok.status).toBe(200);
    const published = await ok.json();
    expect(published.status).toBe("published");
    expect(published.current_version).toBe(2);
  });

  it("rolls a historical version into a new draft without rewriting history", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "回滚对象",
      body: "first body",
      kind: "policy",
      status: "draft",
    })).json();
    await request("PUT", `/api/admin/knowledge/${created.id}`, { body: "second body" });

    const rolled = await (await request("POST", `/api/admin/knowledge/${created.id}/rollback`, { version: 1 })).json();
    expect(rolled.body).toBe("first body");
    expect(rolled.status).toBe("draft");
    expect(rolled.current_version).toBe(3);

    const versions = await rows(`/api/knowledge/${created.id}/versions`);
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(versions.find((row) => row.version === 1)?.body).toBe("first body");
    expect(versions.find((row) => row.version === 2)?.body).toBe("second body");
    expect(String(versions.find((row) => row.version === 3)?.note || "")).toContain("rollback from v1");

    const detail = await (await request("GET", `/api/admin/knowledge/${created.id}/versions/1`)).json();
    expect(detail.body).toBe("first body");
    expect((await request("GET", `/api/admin/knowledge/${created.id}/versions/99`)).status).toBe(404);
    expect(await auditTypes()).toContain("knowledge.rollback");
  });

  it("validates binding selectors and saves, patches, deletes bindings", async () => {
    const badKey = await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { bogus: ["x"] },
    });
    expect(badKey.status).toBe(400);
    const badKind = await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { kinds: ["nope"] },
    });
    expect(badKind.status).toBe(400);
    const noSkill = await request("POST", "/api/admin/knowledge/bindings", { selector: { ids: ["kb_mail_kol"] } });
    expect(noSkill.status).toBe(400);

    const saved = await (await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: ["kb_mail_kol"], kinds: ["mail_template"] },
      note: "首封建联",
    })).json();
    expect(saved.selector).toEqual({ ids: ["kb_mail_kol"], kinds: ["mail_template"] });
    expect(Number(saved.enabled)).toBe(1);

    const listed = await rows("/api/admin/knowledge/bindings");
    expect(listed.map((row) => row.id)).toContain(saved.id);

    const patched = await (await request("PATCH", `/api/admin/knowledge/bindings/${saved.id}`, { enabled: false })).json();
    expect(Number(patched.enabled)).toBe(0);
    expect(patched.selector).toEqual({ ids: ["kb_mail_kol"], kinds: ["mail_template"] });

    const deleted = await (await request("DELETE", `/api/admin/knowledge/bindings/${saved.id}`)).json();
    expect(deleted.ok).toBe(true);
    expect((await request("PATCH", `/api/admin/knowledge/bindings/${saved.id}`, { enabled: true })).status).toBe(404);
    expect((await auditTypes()).filter((type) => type === "knowledge.binding.save").length).toBeGreaterThanOrEqual(3);
  });

  it("resolves bindings by priority with explainable skip reasons", async () => {
    setPersona("employee");
    const exact = await createPublished({
      title: "报价模板",
      body: "exact",
      kind: "mail_template",
      skill_id: "email_compose",
      brand: "LT",
      stage_codes: ["QUOTE_PENDING"],
      status: "published",
    });
    const wildcard = await createPublished({
      title: "通用模板",
      body: "wildcard",
      kind: "mail_template",
      skill_id: "email_compose",
      brand: "LT",
      status: "published",
    });
    for (const id of [exact.id, wildcard.id]) await request("POST", `/api/knowledge/${id}/cite`, {});

    const unbound = resolveForSkill("calendar_sync");
    expect(unbound).toEqual({ resolved: [], skipped: [], bound: false });

    const binding = await (await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { kinds: ["mail_template"] },
    })).json();

    const quote = resolveForSkill("email_compose", { stageCode: "QUOTE_PENDING" });
    expect(quote.bound).toBe(true);
    expect(quote.resolved.map((item) => item.id)).toEqual([exact.id, wildcard.id]);
    expect(quote.resolved[0]).toMatchObject({ id: exact.id, version: 1, kind: "mail_template" });
    expect(quote.skipped).toContainEqual(expect.objectContaining({
      knowledge_id: wildcard.id,
      reason: "shadowed_by_higher_priority",
    }));
    expect(quote.skipped).toContainEqual(expect.objectContaining({ knowledge_id: "kb_mail_kol", reason: "not_cited" }));

    const testing = resolveForSkill("email_compose", { stageCode: "TESTING" });
    expect(testing.resolved.map((item) => item.id)).toEqual([wildcard.id, exact.id]);

    await request("POST", "/api/knowledge/kb_mail_kol/cite", {});
    await request("POST", "/api/knowledge/kb_mail_kol/deprecate", { reason: "过时" });
    expect(resolveForSkill("email_compose", {}).skipped).toContainEqual(expect.objectContaining({
      knowledge_id: "kb_mail_kol",
      reason: "deprecated_by_user",
    }));

    const foreign = await createPublished({
      title: "外品牌模板",
      body: "foreign",
      kind: "mail_template",
      skill_id: "email_compose",
      brand: "ZZ",
      status: "published",
    });
    await request("POST", `/api/knowledge/${foreign.id}/cite`, {});
    expect(resolveForSkill("email_compose", {}).skipped).toContainEqual(expect.objectContaining({
      knowledge_id: foreign.id,
      reason: "scope_mismatch",
    }));

    const draft = await (await request("POST", "/api/admin/knowledge", {
      title: "未审草稿",
      body: "draft",
      kind: "policy",
      status: "draft",
    })).json();
    await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "content_nudge",
      selector: { ids: ["kb_missing", draft.id] },
    });
    const pinned = resolveForSkill("content_nudge", {});
    expect(pinned.bound).toBe(true);
    expect(pinned.skipped).toContainEqual({ knowledge_id: "kb_missing", reason: "missing" });
    expect(pinned.skipped).toContainEqual(expect.objectContaining({ knowledge_id: draft.id, reason: "not_published" }));

    const order = await (await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "report_draft",
      selector: { ids: [exact.id, wildcard.id] },
    })).json();
    expect(order.id).toBeTruthy();
    const byIds = resolveForSkill("report_draft", { stageCode: "TESTING" });
    expect(byIds.resolved.map((item) => item.id)).toEqual([exact.id, wildcard.id]);

    await request("PATCH", `/api/admin/knowledge/bindings/${binding.id}`, { enabled: false });
    const disabled = resolveForSkill("email_compose", {});
    expect(disabled.bound).toBe(false);
    expect(disabled.resolved).toEqual([]);
  });

  it("applies the personal gates to pinned selector ids", async () => {
    setPersona("employee");
    const pinnedTemplate = await createPublished({
      title: "钉住模板",
      body: "pinned",
      subject: "Pinned subject",
      body_en: "pinned body",
      kind: "mail_template",
      skill_id: "email_compose",
      status: "published",
    });
    await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: [pinnedTemplate.id] },
    });

    const uncited = resolveForSkill("email_compose", {});
    expect(uncited.bound).toBe(true);
    expect(uncited.resolved.map((item) => item.id)).not.toContain(pinnedTemplate.id);
    expect(uncited.skipped).toContainEqual(expect.objectContaining({
      knowledge_id: pinnedTemplate.id,
      reason: "not_cited",
    }));

    await request("POST", `/api/knowledge/${pinnedTemplate.id}/cite`, {});
    const cited = resolveForSkill("email_compose", {});
    expect(cited.resolved.map((item) => item.id)).toContain(pinnedTemplate.id);

    await request("POST", `/api/knowledge/${pinnedTemplate.id}/deprecate`, { reason: "过时" });
    const deprecated = resolveForSkill("email_compose", {});
    expect(deprecated.resolved.map((item) => item.id)).not.toContain(pinnedTemplate.id);
    expect(deprecated.skipped).toContainEqual(expect.objectContaining({
      knowledge_id: pinnedTemplate.id,
      reason: "deprecated_by_user",
    }));
  });

  it("maps an explicit preview user id to its grant handle", async () => {
    setPersona("employee");
    const scoped = await createPublished({
      title: "定向授权模板",
      body: "scoped",
      kind: "mail_template",
      skill_id: "email_compose",
      status: "published",
    });
    await request("POST", `/api/knowledge/${scoped.id}/cite`, {});

    setPersona("sriphy");
    await request("PUT", `/api/admin/knowledge/${scoped.id}/grants`, { user: ["lingong"] });
    await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: [scoped.id] },
    });

    const preview = await (await request("POST", "/api/admin/knowledge/resolve-preview", {
      skill_id: "email_compose",
      user_id: "usr_lingong",
    })).json();
    expect((preview.resolved as Json[]).map((row) => row.id)).toContain(scoped.id);
  });

  it("previews resolution for admins and marks disabled bindings", async () => {
    const binding = await (await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: ["kb_mail_kol"] },
    })).json();

    const assets = await rows("/api/admin/knowledge/assets");
    const asset = assets.find((row) => row.id === "kb_mail_kol");
    expect(asset?.ref_skills).toEqual(["email_compose"]);

    const gated = await (await request("POST", "/api/admin/knowledge/resolve-preview", {
      skill_id: "email_compose",
      stage_code: "INITIAL_CONTACT",
    })).json();
    expect((gated.bindings as Json[]).map((row) => row.id)).toContain(binding.id);
    expect((gated.skipped as Json[])).toContainEqual(expect.objectContaining({
      knowledge_id: "kb_mail_kol",
      reason: "not_cited",
    }));

    await request("POST", "/api/knowledge/kb_mail_kol/cite", {});
    const preview = await (await request("POST", "/api/admin/knowledge/resolve-preview", {
      skill_id: "email_compose",
      stage_code: "INITIAL_CONTACT",
    })).json();
    expect((preview.resolved as Json[]).map((row) => row.id)).toContain("kb_mail_kol");

    await request("PATCH", `/api/admin/knowledge/bindings/${binding.id}`, { enabled: false });
    const off = await (await request("POST", "/api/admin/knowledge/resolve-preview", {
      skill_id: "email_compose",
    })).json();
    expect(off.resolved).toEqual([]);
    expect((off.skipped as Json[])).toContainEqual(expect.objectContaining({
      knowledge_id: "kb_mail_kol",
      reason: "binding_disabled",
    }));
    const noSkill = await request("POST", "/api/admin/knowledge/resolve-preview", {});
    expect(noSkill.status).toBe(400);
  });

  it("prefers a binding over the legacy staged pick and keeps the legacy fallback", async () => {
    await request("POST", "/api/knowledge/kb_mail_followup/cite", {});
    const legacy = resolveMailTemplate({ skillId: "email_compose", stageCode: "INITIAL_CONTACT" });
    expect(legacy?.id).toBe("kb_mail_followup");

    const created = await createPublished({
      title: "绑定优先模板",
      body: "bound body",
      kind: "mail_template",
      skill_id: "email_compose",
      subject: "Bound subject",
      body_en: "bound body",
      status: "published",
    });
    await request("POST", `/api/knowledge/${created.id}/cite`, {});
    await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: [created.id] },
    });

    const bound = resolveMailTemplate({ skillId: "email_compose", stageCode: "INITIAL_CONTACT" });
    expect(bound?.id).toBe(created.id);
    expect(bound?.subject).toBe("Bound subject");

    const events = (await rows("/api/audit")).filter((row) => row.event_type === "knowledge.resolve");
    const sources = events.map((row) => String((row.payload as Json).source));
    expect(sources).toContain("binding");
    expect(sources).toContain("legacy");
  });

  it("handles employee feedback with an audited decision", async () => {
    setPersona("employee");
    await request("POST", "/api/knowledge/kb_mail_ship/deprecate", { reason: "过时", note: "已过季" });

    const feedback = await rows("/api/admin/knowledge/feedback");
    const entry = feedback.find((row) => row.knowledge_id === "kb_mail_ship");
    expect(entry?.user_id).toBe("usr_lingong");
    expect(entry?.title).toBe("发货通知");
    expect(entry?.handled_at).toBeFalsy();

    const handled = await request("POST", "/api/admin/knowledge/kb_mail_ship/feedback-handle", {
      user_id: "usr_lingong",
      action: "to_revision",
      note: "转修订",
    });
    expect(handled.status).toBe(200);
    const record = await handled.json();
    expect(record.handle_action).toBe("to_revision");
    expect(record.handle_note).toBe("转修订");
    expect(record.handled_by).toBeTruthy();

    const page = await (await request("GET", "/api/knowledge/kb_mail_ship")).json();
    expect(page.status).toBe("draft");
    expect(page.current_version).toBe(2);

    const again = await request("POST", "/api/admin/knowledge/kb_mail_ship/feedback-handle", {
      user_id: "usr_lingong",
      action: "ignore",
    });
    expect(again.status).toBe(409);
    const unknown = await request("POST", "/api/admin/knowledge/kb_mail_ship/feedback-handle", {
      user_id: "usr_sriphy",
      action: "ignore",
    });
    expect(unknown.status).toBe(404);
    expect(await auditTypes()).toContain("knowledge.feedback.handle");
  });

  it("records the governance audit events", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "审计对象",
      body: "audit v1",
      kind: "policy",
      status: "draft",
    })).json();
    await request("POST", `/api/admin/knowledge/${created.id}/rollback`, { version: 1 });
    await request("POST", "/api/admin/knowledge/bindings", {
      skill_id: "email_compose",
      selector: { ids: ["kb_mail_followup"] },
    });
    await request("POST", "/api/knowledge/kb_mail_followup/cite", {});
    const picked = resolveMailTemplate({ skillId: "email_compose", stageCode: "INITIAL_CONTACT" });
    expect(picked?.id).toBe("kb_mail_followup");
    await request("POST", "/api/knowledge/kb_mail_followup/deprecate", { reason: "内容过时" });
    // 反馈归属人取真实记录：usr_sriphy 已在 2d2a1bb 退役，写死字面量会静默 404。
    const [feedback] = (await rows("/api/admin/knowledge/feedback"))
      .filter((row) => row.knowledge_id === "kb_mail_followup");
    const handled = await request("POST", "/api/admin/knowledge/kb_mail_followup/feedback-handle", {
      user_id: String(feedback?.user_id || ""),
      action: "ignore",
      note: "保持现状",
    });
    expect(handled.status).toBe(200);

    const events = await auditTypes();
    expect(events).toContain("knowledge.resolve");
    expect(events).toContain("knowledge.binding.save");
    expect(events).toContain("knowledge.rollback");
    expect(events).toContain("knowledge.feedback.handle");
  });

  it("keeps admin governance behind an admin session", async () => {
    process.env.AUTH_MODE = "enabled";
    try {
      const setup = await request("POST", "/api/auth/setup", {
        username: "admin",
        name: "Admin",
        password: "admin-password",
        brands: ["LT", "RO", "PQ"],
      });
      expect(setup.status).toBe(201);
      const adminCookie = setup.cookie;
      const created = await request("POST", "/api/admin/users", {
        username: "employee",
        name: "Employee",
        password: "employee-password",
        roles: ["employee"],
        brands: ["LT"],
      }, adminCookie);
      expect(created.status).toBe(201);
      const login = await request("POST", "/api/auth/login", {
        username: "employee",
        password: "employee-password",
      });
      expect(login.status).toBe(200);

      const anonymous = await request("POST", "/api/admin/knowledge/resolve-preview", { skill_id: "email_compose" });
      expect(anonymous.status).toBe(401);
      const denied = await request(
        "POST",
        "/api/admin/knowledge/resolve-preview",
        { skill_id: "email_compose" },
        login.cookie,
      );
      expect(denied.status).toBe(403);
      expect((await request("GET", "/api/admin/knowledge/bindings", undefined, login.cookie)).status).toBe(403);
      const allowed = await request(
        "POST",
        "/api/admin/knowledge/resolve-preview",
        { skill_id: "email_compose" },
        adminCookie,
      );
      expect(allowed.status).toBe(200);
    } finally {
      process.env.AUTH_MODE = "disabled";
    }
  });
});
