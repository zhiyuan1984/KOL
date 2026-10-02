import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { skillCatalog } from "../src/host/skills-catalog.js";
import { runtimeSkillsRoot } from "../src/host/skill-sop.js";
import { clearTaskRegistryCache, taskDefinition } from "../src/tasks/registry.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

async function loginPm() {
  const auth = await request("POST", "/api/login", { username: "鄢棽", password: "123456789" });
  expect(auth.status, JSON.stringify(auth.body)).toBe(200);
}

const NEW_SKILL = {
  id: "daily_brief",
  title: "每日简报",
  description: "整理今天要跟进的达人",
  category: "管理",
  profile: "commander",
  output: "task_result",
  funnel: "reach",
  aliases: "今日简报,日报",
  body: "# 每日简报\n\n整理今天要处理的达人跟进。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-skill-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  clearTaskRegistryCache();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("published skills on the Codex harness", () => {
  it("rejects create without product manager login", async () => {
    const denied = await request("POST", "/api/admin/skills", NEW_SKILL);
    expect(denied.status).toBe(403);
  });

  it("imports a Markdown skill as an ungranted third-party draft and blocks likely secrets", async () => {
    await loginPm();
    const markdown = `---\nid: imported_brief\ntitle: 导入简报\ndescription: 从本地文件导入的技能\ncategory: 管理\nprofile: commander\noutput: task_result\nfunnel: reach\n---\n\n# 导入简报\n\n整理信息，不执行正式动作。\n`;
    const form = new FormData();
    form.append("file", new File([markdown], "SKILL.md", { type: "text/markdown" }));
    const response = await app.request("/api/admin/skills/import", { method: "POST", body: form });
    const body = await response.json() as Json;
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.id).toBe("imported_brief");
    expect(body.grants).toEqual({ org: [], team: [], user: [] });
    expect(body.import_receipt).toEqual(expect.objectContaining({ source: "third_party", status: "draft" }));
    expect(body.lifecycle).toEqual(expect.objectContaining({
      stage: "draft",
      origin: "third_party",
      tags: expect.arrayContaining(["本地导入"]),
    }));

    const unsafe = new FormData();
    unsafe.append("file", new File([markdown.replace("整理信息", "api_key=abcdefghijklmnop 整理信息")], "unsafe.md", { type: "text/markdown" }));
    const blocked = await app.request("/api/admin/skills/import", { method: "POST", body: unsafe });
    expect(blocked.status).toBe(400);
  });

  it("publishes a skill into catalog, market, extraRoots, and the next stub turn", async () => {
    await loginPm();
    const created = await request("POST", "/api/admin/skills", NEW_SKILL);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.id).toBe("daily_brief");
    expect(created.body.source).toBe("published");
    expect(created.body.in_market).toBe(true);
    expect(created.body.funnel).toBe("reach");

    expect(skillCatalog().some((row) => row.id === "daily_brief")).toBe(true);
    expect(taskDefinition("daily_brief")?.title).toBe("每日简报");

    const runtime = path.join(runtimeSkillsRoot(), "daily_brief", "SKILL.md");
    expect(fs.existsSync(runtime)).toBe(true);
    expect(fs.readFileSync(runtime, "utf8")).toContain("每日简报");
    expect(fs.readFileSync(runtime, "utf8")).toContain("禁止发送消息");

    const draft = await request("GET", "/api/admin/skills");
    const draftEntry = (draft.body.skills as Json[]).find((row) => row.id === "daily_brief");
    expect((draftEntry?.lifecycle as Json).stage).toBe("draft");
    for (const stage of ["editing", "testing", "published"]) {
      const moved = await request("POST", "/api/admin/skills/daily_brief/stage", { stage });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    }

    const mine = await request("GET", "/api/skills");
    expect(mine.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "daily_brief", granted: true })]));
    const market = await request("GET", "/api/skills/market");
    expect((market.body as unknown as Json[]).some((row) => row.id === "daily_brief" && row.granted === true)).toBe(true);

    const ses = await request("POST", "/api/sessions", { title: "brief" });
    const turn = await request("POST", `/api/sessions/${ses.body.id}/messages`, {
      text: "整理今天的达人跟进",
      act: "ask",
      intent: "daily_brief",
    });
    expect(turn.status, JSON.stringify(turn.body)).toBe(200);
    expect((turn.body.intent as Json).type).toBe("daily_brief");
    const workers = (await request("GET", "/api/workers")).body as unknown as Json[];
    const worker = workers.find((row) => row.session_id === ses.body.id);
    expect(worker?.skill).toBe("daily_brief");
    expect(worker?.box_path).toBeTruthy();
    const log = worker?.contract_log as Json[];
    expect(log.some((row) => row.method === "skills/extraRoots/set" && (row.params as Json).extraRoots)).toBe(true);
    expect(log.some((row) => row.method === "skills/config/write")).toBe(true);
    const write = log.find((row) => row.method === "skills/config/write");
    expect(String((write?.params as Json).path)).toContain(`${path.sep}skills${path.sep}daily_brief${path.sep}SKILL.md`);
    expect(fs.readFileSync(path.join(String(worker!.box_path), "SKILL.md"), "utf8")).toContain("每日简报");

    const asEmployee = await request("POST", "/api/me/persona", { persona: "employee" });
    expect(asEmployee.status).toBe(200);
    const employeeMine = await request("GET", "/api/skills");
    expect(employeeMine.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "daily_brief", granted: true, source: "published" }),
    ]));
    const employeeMarket = await request("GET", "/api/skills/market");
    expect((employeeMarket.body as unknown as Json[]).some((row) => row.id === "daily_brief" && row.granted === true)).toBe(true);

    await request("POST", "/api/me/persona", { persona: "sriphy" });
    await loginPm();
    const rewritten = await request("PATCH", "/api/admin/skills/daily_brief", {
      title: "今日达人简报",
      description: "改写后的简报摘要",
      aliases: "今日简报",
      body: "# 每日简报\n\n改写后的运行说明。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
    });
    expect(rewritten.status, JSON.stringify(rewritten.body)).toBe(200);
    // Editing a live skill records a draft; its active runtime changes only
    // after the explicit published -> testing -> published lifecycle path.
    expect(rewritten.body.title).toBe("每日简报");
    const rewrittenDraft = rewritten.body.draft as Json;
    expect(rewrittenDraft.patch as Json).toMatchObject({
      title: "今日达人简报",
      description: "改写后的简报摘要",
    });
    expect(taskDefinition("daily_brief")?.title).toBe("每日简报");
    const runtimeAfter = fs.readFileSync(path.join(runtimeSkillsRoot(), "daily_brief", "SKILL.md"), "utf8");
    expect(runtimeAfter).not.toContain("改写后的运行说明");
    const testing = await request("POST", "/api/admin/skills/daily_brief/stage", { stage: "testing", reason: "验证每日简报改写" });
    expect(testing.status, JSON.stringify(testing.body)).toBe(200);
    const published = await request("POST", "/api/admin/skills/daily_brief/stage", { stage: "published", reason: "发布每日简报改写" });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(taskDefinition("daily_brief")?.title).toBe("今日达人简报");
    const runtimePublished = fs.readFileSync(path.join(runtimeSkillsRoot(), "daily_brief", "SKILL.md"), "utf8");
    expect(runtimePublished).toContain("改写后的运行说明");
    expect(runtimePublished).toContain("今日达人简报");

    const bundledRewrite = await request("PATCH", "/api/admin/skills/email_compose", {
      title: "不该改内置包",
      body: "# no\n",
    });
    expect(bundledRewrite.status).toBe(400);

    const unlisted = await request("PATCH", "/api/admin/skills/daily_brief", { in_market: false });
    expect(unlisted.status).toBe(200);
    expect(unlisted.body.in_market).toBe(false);
    const marketAfter = await request("GET", "/api/skills/market");
    expect((marketAfter.body as unknown as Json[]).some((row) => row.id === "daily_brief")).toBe(false);

    const duplicate = await request("POST", "/api/admin/skills", NEW_SKILL);
    expect(duplicate.status).toBe(409);

    const bundled = await request("DELETE", "/api/admin/skills/email_compose");
    expect(bundled.status).toBe(400);

    const removed = await request("DELETE", "/api/admin/skills/daily_brief");
    expect(removed.status).toBe(200);
    expect(skillCatalog().some((row) => row.id === "daily_brief")).toBe(false);
  });
});

void getConn;
