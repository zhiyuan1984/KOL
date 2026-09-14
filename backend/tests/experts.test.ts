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
];

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
  it("loads only the locked first-phase fields for published expert:kol", () => {
    const manifest = findExpertManifest("expert:kol");
    expect(manifest?.id).toBe("expert:kol");
    expect(manifest?.status).toBe("published");
    expect(manifest?.display_name).toBe("KOL 合作专员");
    expect(manifest?.entry_skill).toBe("stage_sop");
    expect(Array.isArray(manifest?.tags)).toBe(true);
    expect(Array.isArray(manifest?.quick_prompts)).toBe(true);
    expect(expertPublished(manifest!)).toBe(true);
    const listed = listPublishedExperts();
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]).sort()).toEqual([...PUBLIC_KEYS].sort());
  });
});

describe("GET /api/experts", () => {
  it("returns only status=published experts with stable FE fields", async () => {
    const listed = await request("GET", "/api/experts");
    expect(listed.status).toBe(200);
    const rows = await listed.json() as Json[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(rows[0]).toMatchObject({
      id: "expert:kol",
      status: "published",
      display_name: "KOL 合作专员",
      profession: "达人合作",
      entry_skill: "stage_sop",
    });
    expect(rows[0]).not.toHaveProperty("organization_scope");
    expect(rows[0]).not.toHaveProperty("permissions");
    expect(rows[0]).not.toHaveProperty("available_agents");
    setExpertPublishOverride("expert:kol", false);
    const empty = await request("GET", "/api/experts");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
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
      display_name: "KOL 合作专员",
      category: "达人合作",
      entry_skill: "stage_sop",
    });
    expect(body.tags).toEqual(["建联", "跟进", "阶段建议"]);
    expect(body.quick_prompts).toEqual(expect.arrayContaining(["准备一封建联邮件"]));
    expect((await request("GET", "/api/experts/expert:nope")).status).toBe(404);
    setExpertPublishOverride("expert:kol", false);
    const hidden = await request("GET", "/api/experts/expert:kol");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ detail: { code: "expert_not_found" } });
  });
});

describe("POST /api/experts/:id/summon", () => {
  it("creates a session traceable to the expert without LIVE side effects", async () => {
    const summoned = await request("POST", "/api/experts/expert:kol/summon", {});
    expect(summoned.status, await summoned.text()).toBe(200);
    const body = await summoned.json() as Json;
    expect(Object.keys(body).sort()).toEqual(["expert_id", "expert_version", "intro", "session_id"]);
    expect(body).toMatchObject({
      expert_id: "expert:kol",
      expert_version: "0.1.0",
    });
    expect(String(body.session_id)).toMatch(/^ses_/);
    expect(String(body.intro)).toContain("KOL 合作专员");
    expect(String(body.intro)).not.toMatch(/MCP|Codex|LIVE/i);
    const row = getConn().prepare("SELECT expert_id, expert_version, title FROM sessions WHERE id=?").get(body.session_id) as {
      expert_id?: string;
      expert_version?: string;
      title?: string;
    };
    expect(row.expert_id).toBe("expert:kol");
    expect(row.expert_version).toBe("0.1.0");
    expect(row.title).toBe("KOL 合作专员");
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

  it("returns 404 for unknown and 409 for unpublished experts", async () => {
    const missing = await request("POST", "/api/experts/expert:nope/summon", {});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ detail: { code: "expert_not_found" } });
    setExpertPublishOverride("expert:kol", false);
    const blocked = await request("POST", "/api/experts/expert:kol/summon", {});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ detail: { code: "expert_not_published" } });
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions WHERE expert_id=?").get("expert:kol") as { n: number }).n)).toBe(0);
    expect(sideEffects().sends).toBe(0);
    expect(sideEffects().stageWrites).toBe(0);
  });
});

describe("validate:contracts expert gate", () => {
  it("accepts the published expert:kol manifest", () => {
    const raw = execFileSync(process.execPath, ["scripts/validate-contracts.mjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
    });
    const result = JSON.parse(raw) as { status: string; expert: string; expertCount: number; errors: string[] };
    expect(result.status).toBe("valid");
    expect(result.expert).toBe("expert:kol");
    expect(result.expertCount).toBe(1);
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
