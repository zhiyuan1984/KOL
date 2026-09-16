import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import {
  clearExpertCache,
  clearExpertPublishOverrides,
  expertPublished,
  findExpertManifest,
  listPublishedExperts,
  setExpertPublishOverride,
} from "../src/experts.js";

type Json = Record<string, unknown>;

const PUBLIC_KEYS = [
  "id",
  "version",
  "status",
  "display_name",
  "profession",
  "description",
  "avatar",
  "category",
  "tags",
  "mission",
  "quick_prompts",
  "entry_skill",
  "kind",
  "primary_entry",
  "skill_ids",
  "tool_ids",
];

const PUBLISHED_IDS = ["expert:kol", "expert:crawler", "expert:approver"];

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<Json | Json[]>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text: async () => text,
    json: async () => (text ? (JSON.parse(text) as Json | Json[]) : {}),
  };
}

function sideEffects(sessionId?: string) {
  const messages = sessionId
    ? (getConn().prepare("SELECT kind FROM messages WHERE session_id=?").all(sessionId) as { kind: string }[])
    : [];
  return {
    messages: messages.map((row) => row.kind),
    drafts: sessionId
      ? Number((getConn().prepare("SELECT COUNT(*) AS n FROM drafts WHERE session_id=?").get(sessionId) as { n: number }).n)
      : 0,
    sends: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get() as { n: number }).n),
    stageWrites: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get() as { n: number }).n),
    transitions: Number((getConn().prepare("SELECT COUNT(*) AS n FROM stage_transitions").get() as { n: number }).n),
  };
}

function sessionCount(expertId: string): number {
  return Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions WHERE expert_id=?").get(expertId) as { n: number }).n);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-experts-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  clearExpertCache();
  clearExpertPublishOverrides();
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  clearExpertCache();
  clearExpertPublishOverrides();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ExpertManifest loader", () => {
  it("loads the three published digital employees with platform fields", () => {
    const kol = findExpertManifest("expert:kol");
    expect(kol?.id).toBe("expert:kol");
    expect(kol?.status).toBe("published");
    expect(kol?.display_name).toBe("KOL推广");
    expect(kol?.entry_skill).toBe("stage_sop");
    expect(kol?.kind).toBe("business");
    expect(kol?.primary_entry).toBe("think");
    expect(kol?.skill_ids).toEqual(expect.arrayContaining(["stage_sop", "creator_outreach", "email_compose"]));
    expect(kol?.tool_ids).toEqual(["starrykol"]);
    expect(Array.isArray(kol?.tags)).toBe(true);
    expect(Array.isArray(kol?.quick_prompts)).toBe(true);
    expect(expertPublished(kol!)).toBe(true);

    const crawler = findExpertManifest("expert:crawler");
    expect(crawler).toMatchObject({
      id: "expert:crawler",
      display_name: "爬虫工程师",
      kind: "collector",
      primary_entry: "job_console",
      entry_skill: "creator_discovery",
      status: "published",
    });
    expect(crawler?.skill_ids).toEqual(["creator_discovery"]);
    expect(crawler?.tool_ids).toEqual(["mediacrawler"]);

    const approver = findExpertManifest("expert:approver");
    expect(approver).toMatchObject({
      id: "expert:approver",
      display_name: "审批员",
      kind: "governance",
      primary_entry: "approval_queue",
      entry_skill: "business_approval",
      status: "published",
    });
    expect(approver?.skill_ids).toEqual(["business_approval"]);
    expect(approver?.tool_ids).toEqual([]);

    const listed = listPublishedExperts();
    expect(listed).toHaveLength(3);
    expect(listed.map((row) => row.id)).toEqual(PUBLISHED_IDS);
    expect(Object.keys(listed[0]).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(listed[0]).not.toHaveProperty("counts");
  });
});

describe("GET /api/experts", () => {
  it("returns all three published experts with stable FE fields", async () => {
    const listed = await request("GET", "/api/experts");
    expect(listed.status).toBe(200);
    const rows = await listed.json() as Json[];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.id)).toEqual(PUBLISHED_IDS);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...PUBLIC_KEYS].sort());
      expect(row.status).toBe("published");
      expect(row).not.toHaveProperty("organization_scope");
      expect(row).not.toHaveProperty("permissions");
      expect(row).not.toHaveProperty("available_agents");
      expect(row).not.toHaveProperty("counts");
    }
    expect(rows[0]).toMatchObject({
      id: "expert:kol",
      status: "published",
      display_name: "KOL推广",
      kind: "business",
      primary_entry: "think",
      entry_skill: "stage_sop",
      tool_ids: ["starrykol"],
    });
    expect(rows[1]).toMatchObject({
      id: "expert:crawler",
      display_name: "爬虫工程师",
      kind: "collector",
      primary_entry: "job_console",
      tool_ids: ["mediacrawler"],
    });
    expect(rows[2]).toMatchObject({
      id: "expert:approver",
      display_name: "审批员",
      kind: "governance",
      primary_entry: "approval_queue",
      tool_ids: [],
    });
    setExpertPublishOverride("expert:kol", false);
    const remaining = await request("GET", "/api/experts");
    expect(remaining.status).toBe(200);
    expect(((await remaining.json()) as Json[]).map((row) => row.id)).toEqual(["expert:crawler", "expert:approver"]);
  });
});

describe("ADR-016 employee expert surface", () => {
  it("does not expose 专家团 or engine catalog APIs", async () => {
    for (const url of [
      "/api/expert-teams",
      "/api/experts/teams",
      "/api/experts/expert:kol/members",
      "/api/experts/expert:kol/team",
      "/api/experts/expert:kol/squad",
    ]) {
      const res = await request("GET", url);
      expect(res.status, url).toBe(404);
    }
    const body = await (await request("GET", "/api/experts/expert:kol")).json() as Json;
    for (const leaked of ["harness", "mcp", "mcp_servers", "profiles", "profileIds", "connectors", "skill_catalog", "teams", "members", "codex"]) {
      expect(body).not.toHaveProperty(leaked);
    }
  });
});

describe("GET /api/experts/:id", () => {
  it("returns the locked projection and 404s unknown or unpublished", async () => {
    const found = await request("GET", "/api/experts/expert:kol");
    expect(found.status).toBe(200);
    const body = await found.json() as Json;
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(body).toMatchObject({
      id: "expert:kol",
      version: "0.1.0",
      status: "published",
      display_name: "KOL推广",
      category: "KOL推广",
      entry_skill: "stage_sop",
      kind: "business",
      primary_entry: "think",
      tool_ids: ["starrykol"],
    });
    expect(body.tags).toEqual(expect.arrayContaining(["建联", "跟进", "阶段建议"]));
    expect(body.quick_prompts).toEqual(expect.arrayContaining(["准备一封建联邮件"]));
    expect(body.skill_ids).toEqual(expect.arrayContaining(["stage_sop", "email_compose", "confirm_stage"]));

    const crawler = await request("GET", "/api/experts/expert:crawler");
    expect(crawler.status).toBe(200);
    expect(await crawler.json()).toMatchObject({
      id: "expert:crawler",
      kind: "collector",
      primary_entry: "job_console",
      skill_ids: ["creator_discovery"],
      tool_ids: ["mediacrawler"],
    });

    const approver = await request("GET", "/api/experts/expert:approver");
    expect(approver.status).toBe(200);
    expect(await approver.json()).toMatchObject({
      id: "expert:approver",
      kind: "governance",
      primary_entry: "approval_queue",
      skill_ids: ["business_approval"],
      tool_ids: [],
    });

    expect((await request("GET", "/api/experts/expert:nope")).status).toBe(404);
    setExpertPublishOverride("expert:kol", false);
    const hidden = await request("GET", "/api/experts/expert:kol");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ detail: { code: "expert_not_found" } });
  });

  it("serves published avatars", async () => {
    for (const id of PUBLISHED_IDS) {
      const res = await request("GET", `/api/experts/${id}/avatar`);
      expect(res.status, id).toBe(200);
      expect(await res.text()).toContain("<svg");
    }
  });
});

describe("POST /api/experts/:id/summon", () => {
  it("creates a session traceable to expert:kol without LIVE side effects", async () => {
    const summoned = await request("POST", "/api/experts/expert:kol/summon", {});
    expect(summoned.status, await summoned.text()).toBe(200);
    const body = await summoned.json() as Json;
    expect(Object.keys(body).sort()).toEqual(["expert_id", "expert_version", "intro", "session_id"]);
    expect(body).toMatchObject({
      expert_id: "expert:kol",
      expert_version: "0.1.0",
    });
    expect(String(body.session_id)).toMatch(/^ses_/);
    expect(String(body.intro)).toContain("KOL推广");
    expect(String(body.intro)).not.toMatch(/MCP|Codex|LIVE/i);
    const row = getConn().prepare("SELECT expert_id, expert_version, title FROM sessions WHERE id=?").get(body.session_id) as {
      expert_id?: string;
      expert_version?: string;
      title?: string;
    };
    expect(row.expert_id).toBe("expert:kol");
    expect(row.expert_version).toBe("0.1.0");
    expect(row.title).toBe("KOL推广");
    const session = await request("GET", `/api/sessions/${body.session_id}`);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      expert_id: "expert:kol",
      expert_version: "0.1.0",
    });
    expect(sideEffects(String(body.session_id))).toEqual({
      messages: [],
      drafts: 0,
      sends: 0,
      stageWrites: 0,
      transitions: 0,
    });
  });

  it("rejects crawler and approver summon without creating a session", async () => {
    const crawler = await request("POST", "/api/experts/expert:crawler/summon", {});
    expect(crawler.status).toBe(409);
    const crawlerBody = await crawler.json() as Json;
    const crawlerDetail = crawlerBody.detail as Json;
    expect(crawlerDetail).toMatchObject({
      code: "expert_summon_not_allowed",
      primary_entry: "job_console",
      next_action: "open_job_console",
    });
    expect(String(crawlerDetail.message)).toContain("任务控制台");

    const approver = await request("POST", "/api/experts/expert:approver/summon", {});
    expect(approver.status).toBe(409);
    const approverDetail = (await approver.json() as Json).detail as Json;
    expect(approverDetail).toMatchObject({
      code: "expert_summon_not_allowed",
      primary_entry: "approval_queue",
      next_action: "open_approval_queue",
    });
    expect(String(approverDetail.message)).toContain("审批队列");

    expect(sessionCount("expert:crawler")).toBe(0);
    expect(sessionCount("expert:approver")).toBe(0);
    expect(sideEffects().sends).toBe(0);
    expect(sideEffects().stageWrites).toBe(0);
  });

  it("returns 404 for unknown and 409 for unpublished experts", async () => {
    const missing = await request("POST", "/api/experts/expert:nope/summon", {});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ detail: { code: "expert_not_found" } });
    setExpertPublishOverride("expert:kol", false);
    const blocked = await request("POST", "/api/experts/expert:kol/summon", {});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ detail: { code: "expert_not_published" } });
    expect(sessionCount("expert:kol")).toBe(0);
    expect(sideEffects().sends).toBe(0);
    expect(sideEffects().stageWrites).toBe(0);
  });
});

describe("validate:contracts expert gate", () => {
  it("accepts the three published digital-employee manifests", () => {
    const raw = execFileSync(process.execPath, ["scripts/validate-contracts.mjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
    });
    const result = JSON.parse(raw) as { status: string; expert: string; expertCount: number; errors: string[] };
    expect(result.status).toBe("valid");
    expect(result.expert).toBe("expert:kol");
    expect(result.expertCount).toBe(3);
    expect(result.errors).toEqual([]);
  });
});

describe("experts auth", () => {
  it("requires authentication when AUTH_MODE is enabled", async () => {
    process.env.AUTH_MODE = "enabled";
    process.env.CODEX_MODE = "real";
    resetConn();
    const { createApp } = await import("../src/app.js");
    app = createApp();
    try {
      expect((await request("GET", "/api/experts")).status).toBe(401);
      expect((await request("GET", "/api/experts/expert:kol")).status).toBe(401);
      expect((await request("POST", "/api/experts/expert:kol/summon", {})).status).toBe(401);
    } finally {
      delete process.env.AUTH_MODE;
      process.env.CODEX_MODE = "stub";
    }
  });
});
