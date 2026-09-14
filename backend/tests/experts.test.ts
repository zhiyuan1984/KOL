import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import {
  clearExpertCache,
  clearExpertPublishOverrides,
  expertPublished,
  findExpertManifest,
  listPublishedExperts,
  setExpertPublishOverride,
} from "../src/experts.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: () => Promise<Json | Json[]>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json", ...headers } };
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
  const drafts = sessionId
    ? Number((getConn().prepare("SELECT COUNT(*) AS n FROM drafts WHERE session_id=?").get(sessionId) as { n: number }).n)
    : 0;
  return {
    messages: messages.map((row) => row.kind),
    drafts,
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
  seedWorkbenchFixtures();
});

afterEach(() => {
  clearExpertCache();
  clearExpertPublishOverrides();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ExpertManifest loader", () => {
  it("loads the published DigitalEmployee asset for expert:kol only", () => {
    const manifest = findExpertManifest("expert:kol");
    expect(manifest?.id).toBe("expert:kol");
    expect(manifest?.title).toBe("KOL 专家");
    expect(manifest?.available_agents).toEqual(["agent:kol"]);
    expect(manifest?.domain_object).toBe("DigitalEmployee");
    expect(manifest?.knowledge_scope).toEqual([]);
    expect(manifest?.missing_fields).toContain("knowledge_scope");
    expect(manifest?.missing_fields).toContain("live_health");
    expect(expertPublished(manifest!)).toBe(true);
    expect(listPublishedExperts()).toEqual([
      expect.objectContaining({ id: "expert:kol", title: "KOL 专家", publish_gate: { state: "published" } }),
    ]);
  });
});

describe("GET /api/experts", () => {
  it("lists published summaries and hides unpublished", async () => {
    const listed = await request("GET", "/api/experts");
    expect(listed.status).toBe(200);
    const rows = await listed.json() as Json[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "expert:kol",
      title: "KOL 专家",
      role: "KOL 建联与合作推进岗位",
      publish_gate: { state: "published" },
    });
    expect(rows[0]).not.toHaveProperty("live_health");
    setExpertPublishOverride("expert:kol", false);
    const empty = await request("GET", "/api/experts");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
  });
});

describe("GET /api/experts/:id", () => {
  it("returns the full published projection and 404s unknown or unpublished", async () => {
    const found = await request("GET", "/api/experts/expert:kol");
    expect(found.status).toBe(200);
    const body = await found.json() as Json;
    expect(body).toMatchObject({
      id: "expert:kol",
      title: "KOL 专家",
      domain_object: "DigitalEmployee",
      available_agents: ["agent:kol"],
      knowledge_scope: [],
      publish_gate: { state: "published" },
      organization_scope: ["org:lt_team", "org:pq_ro_tb_team"],
      permissions: { declaration: "read-only", policy_refs: ["send_email", "change_stage", "import_creator"] },
    });
    expect(body).not.toHaveProperty("live_health");
    expect(body).not.toHaveProperty("owner_ref");
    expect(body.missing_fields).toEqual(expect.arrayContaining([
      "knowledge_scope",
      "knowledge_manifest",
      "owner_ref",
      "live_health",
      "runtime_projection",
    ]));
    expect((await request("GET", "/api/experts/expert:nope")).status).toBe(404);
    setExpertPublishOverride("expert:kol", false);
    const hidden = await request("GET", "/api/experts/expert:kol");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ detail: { code: "expert_not_found" } });
  });
});

describe("POST /api/experts/:id/summon", () => {
  it("creates an owned session bound to the expert without LIVE side effects", async () => {
    const summoned = await request("POST", "/api/experts/expert:kol/summon", { title: "跟 KOL 专家开一单" });
    expect(summoned.status, await summoned.text()).toBe(200);
    const body = await summoned.json() as Json;
    expect(body).toMatchObject({
      expert_id: "expert:kol",
      title: "跟 KOL 专家开一单",
      created: true,
    });
    expect(body.session_id).toMatch(/^ses_/);
    const row = getConn().prepare("SELECT * FROM sessions WHERE id=?").get(body.session_id) as {
      expert_id?: string;
      owner_user_id?: string | null;
      title?: string;
    };
    expect(row.expert_id).toBe("expert:kol");
    expect(row.title).toBe("跟 KOL 专家开一单");
    const listed = await request("GET", `/api/sessions/${body.session_id}`);
    expect((await listed.json() as Json).expert_id).toBe("expert:kol");
    expect(sideEffects(String(body.session_id))).toEqual({
      messages: [],
      drafts: 0,
      sends: 0,
      stageWrites: 0,
      transitions: 0,
    });
  });

  it("follows openKolSession when collaboration_id is present and still only binds the expert", async () => {
    const before = getConn().prepare("SELECT stage_code, stage_version FROM collaborations WHERE id=?").get("col_xiaomei") as {
      stage_code: string;
      stage_version: number;
    };
    const summoned = await request("POST", "/api/experts/expert:kol/summon", { collaboration_id: "col_xiaomei" });
    expect(summoned.status, await summoned.text()).toBe(200);
    const body = await summoned.json() as Json;
    expect(body).toMatchObject({
      expert_id: "expert:kol",
      collaboration_id: "col_xiaomei",
      created: true,
    });
    const row = getConn().prepare("SELECT expert_id, collaboration_id FROM sessions WHERE id=?").get(body.session_id) as {
      expert_id?: string;
      collaboration_id?: string;
    };
    expect(row.expert_id).toBe("expert:kol");
    expect(row.collaboration_id).toBe("col_xiaomei");
    const after = getConn().prepare("SELECT stage_code, stage_version FROM collaborations WHERE id=?").get("col_xiaomei") as {
      stage_code: string;
      stage_version: number;
    };
    expect(after.stage_code).toBe(before.stage_code);
    expect(after.stage_version).toBe(before.stage_version);
    const effects = sideEffects(String(body.session_id));
    expect(effects.sends).toBe(0);
    expect(effects.stageWrites).toBe(0);
    expect(effects.transitions).toBe(0);
    expect(effects.drafts).toBe(0);
    expect(effects.messages.every((kind) => kind !== "confirm_stage_card")).toBe(true);
    const again = await request("POST", "/api/experts/expert:kol/summon", { collaboration_id: "col_xiaomei" });
    const reused = await again.json() as Json;
    expect(reused.session_id).toBe(body.session_id);
    expect(reused.created).toBe(false);
    expect(reused.expert_id).toBe("expert:kol");
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
