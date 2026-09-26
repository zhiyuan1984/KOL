import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { bundledSkillPath } from "../src/host/skill-sop.js";
import { resolveMailTemplate } from "../src/host/knowledge.js";
import { DEMO_USER } from "../src/config.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<Json>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text: async () => text,
    json: async () => (text ? (JSON.parse(text) as Json) : {}),
  };
}

async function ask(prompt: string, extra: Json = {}, expectStatus = 200): Promise<[string, Json]> {
  const ses = await (await request("POST", "/api/sessions", { title: prompt.slice(0, 20) })).json();
  const r = await request("POST", `/api/sessions/${ses.id}/messages`, {
    text: prompt,
    content: prompt,
    act: "ask",
    ...extra,
  });
  expect(r.status, await r.text()).toBe(expectStatus);
  return [String(ses.id), await r.json()];
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kb-"));
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

describe("WikiSkill knowledge", () => {
  it("does not list uncited templates in the home composer", async () => {
    const before = await (await request("GET", "/api/knowledge/composer")).json();
    expect(Array.isArray(before) ? before : []).toEqual([]);
    await request("POST", "/api/knowledge/kb_mail_followup/cite", {});
    const after = await (await request("GET", "/api/knowledge/composer")).json() as unknown as Json[];
    expect(after.map((row) => row.id)).toContain("kb_mail_followup");
    expect(after.every((row) => row.status === "published" && row.kind === "mail_template")).toBe(true);
  });

  it("rejects unapproved knowledge in a session and does not start a worker", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "未审草稿",
      body: "secret wiki",
      kind: "mail_template",
      skill_id: "email_compose",
      subject: "Draft subject",
      body_en: "Draft body",
      status: "draft",
    })).json();
    const [, data] = await ask("给@小美妆日记 写跟进邮件", {
      intent: "email_compose",
      collaboration_id: "col_xiaomei",
      knowledge_id: created.id,
    }, 403);
    expect(JSON.stringify(data)).toMatch(/knowledge_unapproved|未审批/);
    expect(data.worker || null).toBeNull();
  });

  it("uses a cited published template for the English draft and send keeps stage", async () => {
    await request("POST", "/api/knowledge/kb_mail_followup/cite", {});
    const [sid, data] = await ask("给@小美妆日记 写阶段跟进", {
      intent: "email_compose",
      collaboration_id: "col_xiaomei",
      knowledge_id: "kb_mail_followup",
    });
    const draft = data.draft as Json;
    expect(draft.subject).toBe("Following up — LiTime collab kit");
    expect(String(draft.body_en)).toContain("LiTime collab kit");
    expect((draft.extra as Json).knowledge_id).toBe("kb_mail_followup");
    expect((draft.extra as Json).knowledge_version).toBe(1);
    expect(String(draft.body_en)).not.toContain("secret wiki");
    const cardMsg = getConn()
      .prepare("SELECT payload FROM messages WHERE session_id=? AND kind='email_card' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(sid) as { payload: string } | undefined;
    expect(cardMsg, "草稿卡消息应写入会话").toBeTruthy();
    const card = JSON.parse(String(cardMsg?.payload || "{}")) as Json;
    expect(card.draft_id).toBe(draft.id);
    expect(card.knowledge_id).toBe("kb_mail_followup");
    expect(typeof card.knowledge_version).toBe("number");
    expect(String(card.knowledge_title || "")).not.toBe("");
    const sent = await request("POST", `/api/drafts/${draft.id}/send`, {});
    expect(sent.status).toBe(200);
    const sj = await sent.json();
    expect(sj.stage_changed).toBe(false);
    expect(sj.official_stage).toBe("INITIAL_CONTACT");
    const audit = await (await request("GET", "/api/audit")).json() as unknown as Json[];
    const sendEv = audit.find((e) => e.event_type === "host.send") as Json;
    const payload = sendEv.payload as Json;
    expect(payload.knowledge_id).toBe("kb_mail_followup");
    expect(payload.knowledge_version).toBe(1);
    expect(payload.called_stage).toBe(false);
    expect(data.worker).toBeTruthy();
  });

  it("applies a cited mail template on the matching stage without locking knowledge_id", async () => {
    await request("POST", "/api/knowledge/kb_mail_followup/cite", {});
    const [, data] = await ask("给@小美妆日记 写合作邮件", {
      intent: "email_compose",
      collaboration_id: "col_xiaomei",
    });
    const draft = data.draft as Json;
    expect(draft.subject).toBe("Following up — LiTime collab kit");
    expect(String(draft.body_en || draft.body || "")).toContain("LiTime collab kit");
    expect((draft.extra as Json).knowledge_id).toBe("kb_mail_followup");
  });

  it("lets admin bind stage_codes so publish copy reaches ops", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "阶段测试模板",
      body: "wiki",
      kind: "mail_template",
      skill_id: "email_compose",
      subject: "Stage bound subject",
      body_en: "Stage bound body for @creator.",
      stage_codes: ["TESTING"],
      status: "draft",
    })).json();
    expect(created.stage_codes).toEqual(["TESTING"]);
    await request("POST", `/api/admin/knowledge/${created.id}/approve`, { expected_version: created.current_version });
    const published = await (await request("GET", `/api/knowledge/${created.id}`)).json();
    expect(published.status).toBe("published");
    expect(published.stage_codes).toEqual(["TESTING"]);
  });

  it("returns a supplement card when template placeholders stay unfilled", async () => {
    await request("POST", "/api/knowledge/kb_mail_nudge/cite", {});
    const [, data] = await ask("催大纲 [红人或合作]", {
      intent: "email_compose",
      knowledge_id: "kb_mail_nudge",
    }, 422);
    expect((data.error as Json)?.code === "nudge_incomplete" || (data.error as Json)?.code === "knowledge_incomplete").toBe(true);
    expect(data.worker || null).toBeNull();
  });

  it("keeps evolve rejection after a skill overlay rollback and never writes SKILL.md", async () => {
    const skillFile = bundledSkillPath("email_compose");
    const before = fs.readFileSync(skillFile, "utf8");
    expect((await request("POST", "/api/login", { username: "鄢棽", password: "123456789" })).status).toBe(200);
    const proposed = await (await request("POST", "/api/admin/knowledge/evolve/propose", {
      kind: "skill_patch",
      skill_id: "email_compose",
      proposed_diff: "auto rewrite production SKILL.md",
    })).json();
    expect(proposed.profile).toBe("shadow");
    await request("POST", `/api/admin/knowledge/evolve/${proposed.id}/review`, {
      action: "reject",
      reject_reason: "禁止自动改生产 SKILL.md",
    });
    await request("PUT", "/api/skills/email_compose/sop", { summary: "overlay", body: "temp overlay" });
    await request("DELETE", "/api/skills/email_compose/sop");
    expect(fs.readFileSync(skillFile, "utf8")).toBe(before);
    const rows = await (await request("GET", "/api/admin/knowledge/proposals")).json() as unknown as Json[];
    const kept = rows.find((row) => row.id === proposed.id);
    expect(kept?.status).toBe("rejected");
    expect(kept?.reject_reason).toContain("禁止自动改生产");
  });

  it("blocks brand transfer outside the From whitelist", async () => {
    const r = await request("POST", "/api/admin/knowledge/kb_mail_followup/transfer", { to_brand: "XX" });
    expect(r.status).toBe(400);
  });

  it("extracts an eml upload into a pending page without publishing", async () => {
    const fd = new FormData();
    fd.append("file", new File([
      "From: desk@example.com\nSubject: Sample outline please\n\nHi, please send the outline.\n",
    ], "sample.eml", { type: "message/rfc822" }));
    const uploaded = await (await request("POST", "/api/admin/knowledge/upload", fd)).json();
    expect(uploaded.source).toBe("upload");
    const extracted = await (await request("POST", `/api/admin/knowledge/extract/${uploaded.id}`, {})).json();
    const page = extracted.knowledge as Json;
    expect(page.status).toBe("pending_review");
    expect(page.kind).toBe("mail_template");
    const composer = await (await request("GET", "/api/knowledge/composer")).json() as unknown as Json[];
    expect(composer.map((row) => row.id)).not.toContain(page.id);
  });

  it("refuses to physically delete knowledge cited by sent mail", async () => {
    await request("POST", "/api/knowledge/kb_mail_followup/cite", {});
    const [, data] = await ask("给@小美妆日记 写阶段跟进", {
      intent: "email_compose",
      collaboration_id: "col_xiaomei",
      knowledge_id: "kb_mail_followup",
    });
    const draft = data.draft as Json;
    expect((await request("POST", `/api/drafts/${draft.id}/send`, {})).status).toBe(200);
    const archived = await request("POST", "/api/admin/knowledge/kb_mail_followup/archive", {});
    expect(archived.status).toBe(200);
    const del = await request("DELETE", "/api/admin/knowledge/kb_mail_followup");
    expect(del.status).toBe(403);
  });

  it("records quote PEP failures into Raw", async () => {
    await request("POST", "/api/knowledge/kb_mail_quote/cite", {});
    const [, data] = await ask("给@数码老张 写报价信 金额USD 200", {
      intent: "email_compose",
      collaboration_id: "col_laozhang",
      knowledge_id: "kb_mail_quote",
    });
    const draft = data.draft as Json;
    expect(draft).toBeTruthy();
    expect((draft.extra as Json).knowledge_id).toBe("kb_mail_quote");
    const fail = await request("POST", `/api/drafts/${draft.id}/send`, {});
    expect([200, 400, 403]).toContain(fail.status);
    if (fail.status >= 400) {
      const raw = await (await request("GET", "/api/admin/knowledge/raw")).json() as unknown as Json[];
      expect(raw.some((row) => String(row.source || "").includes("failed") || String(row.source || "") === "failed_session")).toBe(true);
    }
  });

  it("picks the quote template for QUOTE_PENDING instead of the first cited 催大纲", async () => {
    for (const id of ["kb_mail_kol", "kb_mail_followup", "kb_mail_quote", "kb_mail_addr", "kb_mail_nudge", "kb_mail_ship"]) {
      await request("POST", `/api/knowledge/${id}/cite`, {});
    }
    const quote = resolveMailTemplate({ skillId: "email_compose", stageCode: "QUOTE_PENDING" });
    expect(quote?.id).toBe("kb_mail_quote");
    expect(String(quote?.subject || "")).not.toMatch(/Outline check-in|family camping/);
    expect(resolveMailTemplate({ skillId: "email_compose", stageCode: "CONTENT_PLANNING" })?.id).toBe("kb_mail_nudge");
  });

  it("seeds four policies and six published KOL mail templates", async () => {
    const mine = await (await request("GET", "/api/knowledge")).json() as unknown as Json[];
    const ids = mine.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([
      "kb_followup", "kb_quote", "kb_addr", "kb_nudge",
      "kb_mail_kol", "kb_mail_followup", "kb_mail_quote", "kb_mail_addr", "kb_mail_nudge", "kb_mail_ship",
    ]));
    expect(mine.filter((row) => row.id === "kb_followup")[0].kind).toBe("policy");
    expect(mine.filter((row) => row.id === "kb_mail_nudge")[0].kind).toBe("mail_template");
    expect(mine.filter((row) => row.id === "kb_mail_followup")[0].starter).toBe("阶段跟进 [红人或合作]");
    expect(mine.filter((row) => row.id === "kb_mail_kol")[0].starter).toBe("首封建联 [发件邮箱] [收件邮箱] [主题]");
    expect(mine.every((row) => row.status === "published")).toBe(true);
    expect(DEMO_USER.id).toBe("usr_sriphy");
  });

  it("hides deprecated cited templates from the composer", async () => {
    await request("POST", "/api/knowledge/kb_mail_ship/cite", {});
    await request("POST", "/api/knowledge/kb_mail_ship/deprecate", { reason: "过时" });
    const items = await (await request("GET", "/api/knowledge/composer")).json() as unknown as Json[];
    expect(items.map((row) => row.id)).not.toContain("kb_mail_ship");
    const stats = await (await request("GET", "/api/admin/knowledge/deprecate-stats")).json();
    expect((stats.by_reason as Json).outdated).toMatchObject({ count: 1, label: "内容过时" });
    await request("DELETE", "/api/knowledge/kb_mail_ship/deprecate");
    await request("POST", "/api/knowledge/kb_mail_ship/deprecate", { reason: "发出去容易被拦" });
    const again = await (await request("GET", "/api/admin/knowledge/deprecate-stats")).json();
    expect((again.by_reason as Json).pep_risk).toMatchObject({ count: 1, label: "发出去容易被拦" });
  });
});
