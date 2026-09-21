import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import {
  resetCollectorConnectionCache,
  setCollectorProbeClientFactory,
  setCollectorProbeFetch,
} from "../src/crawl/connection.js";
import { setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { monitorCrawlJob } from "../src/crawl/service.js";
import { HOME_ENTRY_REGISTRY } from "../src/host/entry-registry.js";
import { isStarryTimeout, lookupImportedKolUid } from "../src/gateway/import-creator.js";
import { getConn, listAudit, resetConn } from "../src/db.js";
import { DEMO_USER } from "../src/config.js";
import { seedAll } from "../src/seed.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json, Row } from "../src/types.js";

const starryCalls: Array<{ name: string; args: Json }> = [];
let tmp = "";
let app: Hono;
let creators: Json[] = [];

const BOUND_MAILBOX = "larry.zhao@amperetime.com";
const BOUND_OWNER_OPEN_ID = "273";

/** Kol name → the slug the stubbed Starry 建档 returns as kolUid. */
function kolUidFor(kolName: unknown): string {
  const slug = String(kolName || "DISC").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "DISC";
  return `KOL${slug}`;
}

function starryTools(names: string[]): Array<{ name: string; args: Json }> {
  return starryCalls.filter((row) => names.includes(row.name));
}

function addBodyOf(call: { args: Json } | undefined): Json {
  try {
    return JSON.parse(String(call?.args.requestJson || "{}")) as Json;
  } catch {
    return {};
  }
}

/** 工作台绑定：入库靠它取负责人邮箱 / mailbox_id，openId 只能再从 Starry 邮箱清单取。 */
function bindStarryMailbox(): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(DEMO_USER.id, "sriphy", "鄢棽", "x", JSON.stringify(["employee", "admin"]), "[]", "", 1, now, now);
  getConn().prepare(
    `INSERT INTO user_starry_bindings
     (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at)
     VALUES (?,?,1,?,?,?,'connected',?)`,
  ).run(DEMO_USER.id, BOUND_MAILBOX, "6", "赵良玉", "test-bearer", now);
}

function mockCrawl() {
  return {
    async callTool(name: string) {
      if (name === "start_crawl") return { task_id: "remote-ingest-gate-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-ingest-gate-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: [] };
      if (name === "get_creators") return { creators, has_more: false };
      return {};
    },
    async close() {},
  };
}

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

function sideEffects() {
  return {
    sends: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get() as { n: number }).n),
    stageWrites: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get() as { n: number }).n),
    transitions: Number((getConn().prepare("SELECT COUNT(*) AS n FROM stage_transitions").get() as { n: number }).n),
    follows: Number((getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get() as { n: number }).n),
    collabs: Number((getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get() as { n: number }).n),
  };
}

function crawlJobIdFor(requestId: string): string {
  const row = getConn().prepare(
    "SELECT crawl_job_id FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(requestId) as { crawl_job_id?: string } | undefined;
  return String(row?.crawl_job_id || "");
}

async function readyRun(extraCreators?: Json[]): Promise<{ runId: string; candidates: Json[]; briefVersion: number }> {
  if (extraCreators) creators = extraCreators;
  const created = await request("POST", "/api/discovery/requests", {
    keywords: ["portable power"],
    platforms: ["youtube"],
    brand: "LT",
    filters: { region: "us", directions: ["户外电源"] },
  });
  expect(created.status).toBe(201);
  const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
  expect(started.status).toBe(202);
  await monitorCrawlJob(crawlJobIdFor(String(created.body.id)));
  const results = await request("GET", `/api/discovery/requests/${created.body.id}/results`);
  const items = results.body.candidates as Json[];
  expect(items.length).toBeGreaterThan(0);
  const run = results.body.run as Json;
  return {
    runId: String(run.id),
    candidates: items,
    briefVersion: Number(run.brief_version || 1),
  };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-ingest-gate-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  delete process.env.LIVE_REMOTE_SIDE_EFFECTS;
  starryCalls.length = 0;
  creators = [{
    platform: "youtube",
    platform_creator_id: "yt-outdoor-1",
    nickname: "OutdoorPower",
    followers: 12000,
    recent_views: [1000, 2000, 1500],
    profile_url: "https://youtube.com/@outdoorpower",
    email: "business@outdoorpower.example",
  }];
  resetConn();
  seedAll();
  bindStarryMailbox();
  resetCollectorConnectionCache();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setCrawlMcpClientFactory(mockCrawl);
  setStarryKolClientFactory(() => ({
    async callTool(name: string, args: Json = {}) {
      starryCalls.push({ name, args });
      if (name === "addKolProfile") {
        const body = addBodyOf({ args });
        // 两段式第一步：真邮箱 + CRAWLER + 数字 ownerOpenId，缺一个 Starry 就拒。
        expect(String(body.contactEmail)).toMatch(/@/);
        expect(body.dataSource).toBe("CRAWLER");
        expect(String(body.ownerOpenId)).toMatch(/^\d+$/);
        expect(body.mailboxEmail).toBe(BOUND_MAILBOX);
        expect(body.ownerMailbox).toBe(BOUND_MAILBOX);
        expect(body.kolName).toBeTruthy();
        return {
          code: 200,
          message: "success",
          data: { kolUid: kolUidFor(body.kolName), version: 0, operation: "CREATE" },
        };
      }
      if (name === "importKolProfilesFromCrawler") {
        const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
        expect(csv).not.toMatch(/contactEmail|联系邮箱/i);
        // 第二步必须靠第一步的 uid 更新已建档的档案。
        expect(csv.split(/\r?\n/)[0]).toContain("红人统一ID");
        return { code: 200, data: { totalCount: 1, createdCount: 0, updatedCount: 1, failedCount: 0, skippedCount: 0 } };
      }
      if (name === "pageMailboxes") {
        return {
          pageNo: 1,
          pageSize: 20,
          total: 1,
          list: [{
            id: 6,
            mailboxEmail: BOUND_MAILBOX,
            ownerOpenId: BOUND_OWNER_OPEN_ID,
            ownerUserId: BOUND_OWNER_OPEN_ID,
            ownerUserName: "赵良玉",
          }],
        };
      }
      if (name === "pageKolProfiles") return { list: [] };
      if (name === "listAllKolProfiles") return { list: [] };
      throw new Error(`unexpected tool ${name}`);
    },
    async close() {},
  }));
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  setCrawlMcpClientFactory();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setStarryKolClientFactory();
  resetCollectorConnectionCache();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
  delete process.env.LIVE_REMOTE_SIDE_EFFECTS;
});

describe("POST /api/home/discovery/ingest", () => {
  it("registers the L3 command entry and does not call claim", () => {
    const entry = HOME_ENTRY_REGISTRY.find((row) => row.id === "discovery-ingest");
    expect(entry).toMatchObject({
      kind: "command",
      creates_session: false,
      calls_model: false,
      route: "POST /api/home/discovery/ingest",
    });
    expect(entry?.route).not.toMatch(/claim/);
  });

  it("1. unconfirmed → no Starry call", async () => {
    const ready = await readyRun();
    const unconfirmed = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
    });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.status).toBe("needs_confirmation");
    expect(unconfirmed.body.creates_session).toBe(false);
    expect(starryTools(["addKolProfile", "importKolProfilesFromCrawler"])).toEqual([]);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0, follows: 0, collabs: 0 });
  });

  it("2. cancelled L3 → no Starry call", async () => {
    const ready = await readyRun();
    const cancelled = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      cancel: true,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(starryTools(["addKolProfile", "importKolProfilesFromCrawler"])).toEqual([]);
    const confirmedAfterCancel = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(confirmedAfterCancel.status).toBe(409);
    expect(confirmedAfterCancel.body.detail).toMatchObject({ code: "l3_cancelled" });
    expect(starryTools(["addKolProfile", "importKolProfilesFromCrawler"])).toEqual([]);
    expect(sideEffects().follows).toBe(0);
  });

  it("3. re-import same key → already_imported + same kolUid", async () => {
    const ready = await readyRun();
    const body = {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    };
    const first = await request("POST", "/api/home/discovery/ingest", body);
    expect(first.status).toBe(200);
    const item = (first.body.items as Json[])[0];
    expect(item.status).toBe("imported");
    expect(String(item.kol_uid)).toMatch(/^KOL/i);
    const imports = starryTools(["importKolProfilesFromCrawler"]).length;
    const adds = starryTools(["addKolProfile"]).length;
    const second = await request("POST", "/api/home/discovery/ingest", body);
    expect(second.status).toBe(200);
    expect((second.body.items as Json[])[0]).toMatchObject({
      status: "already_imported",
      already_imported: true,
      kol_uid: item.kol_uid,
    });
    // 已在库就不该再建档、再导入一次。
    expect(starryTools(["importKolProfilesFromCrawler"])).toHaveLength(imports);
    expect(starryTools(["addKolProfile"])).toHaveLength(adds);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0, follows: 0, collabs: 0 });
  });

  it("4. no existing profile → adds, then imports the platform fields with the returned uid", async () => {
    const ready = await readyRun();
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(ingested.status).toBe(200);
    const item = (ingested.body.items as Json[])[0];
    expect(item.status).toBe("imported");
    expect(item.has_contact_email).toBe(true);
    expect(item.kol_uid).toMatch(/^KOL/i);
    // 顺序：先按 handle 找回（pageKolProfiles + listAll 兜底，未命中）；未命中才取负责人
    // openId 并 add 建档拿 uid；最后 import 用同一个 uid 补平台字段。
    expect(starryCalls.map((row) => row.name)).toEqual([
      "pageKolProfiles",
      "listAllKolProfiles",
      "pageMailboxes",
      "addKolProfile",
      "importKolProfilesFromCrawler",
    ]);
    const addBody = addBodyOf(starryTools(["addKolProfile"])[0]);
    expect(addBody).toMatchObject({
      kolName: "OutdoorPower",
      contactEmail: "business@outdoorpower.example",
      dataSource: "CRAWLER",
      mailboxEmail: BOUND_MAILBOX,
      ownerMailbox: BOUND_MAILBOX,
      ownerOpenId: BOUND_OWNER_OPEN_ID,
    });
    // 联系邮箱必须是候选自己的真实邮箱，不能拿负责人邮箱顶。
    expect(addBody.contactEmail).not.toBe(addBody.ownerMailbox);
    const csv = Buffer.from(
      String(starryTools(["importKolProfilesFromCrawler"])[0]?.args.fileBase64 || ""),
      "base64",
    ).toString("utf8");
    expect(csv).not.toMatch(/contactEmail|联系邮箱|@gmail|@yahoo/i);
    expect(csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/)[0]).toBe("红人统一ID,频道链接,名称,平台,平台账号");
    expect(csv).toContain(item.kol_uid as string);
    expect(JSON.stringify(ingested.body)).not.toMatch(/EMAIL_AGENT_MCP|MEDIACRAWLER_MCP_TOKEN|password|api[_-]?key/i);
    const profile = getConn().prepare("SELECT * FROM kol_profile_index WHERE kol_uid=?").get(item.kol_uid) as Row;
    expect(profile).toMatchObject({
      pool_status: "open",
      ingest_source: "crawler",
      source_batch: ready.runId,
    });
  });

  /** 入库单个候选，返回 items[0]。 */
  async function ingestFirst(candidates: Json[], runId: string, briefVersion: number): Promise<Json> {
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: runId,
      candidate_ids: candidates.map((row) => String(row.id)),
      expected_brief_version: briefVersion,
      confirmed: true,
    });
    expect(ingested.status).toBe(200);
    return (ingested.body.items as Json[])[0];
  }

  it("4b. reuses the profile found by profileUrl in listAllKolProfiles and never adds", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "pageKolProfiles") return { list: [] };
        if (name === "listAllKolProfiles") {
          return {
            total: 1,
            list: [{
              kolUid: "KOLFOUNDBYURL",
              kolName: "OutdoorPower",
              accountHandle: "OutdoorPower",
              primaryPlatform: "YouTube",
              profileUrl: "https://youtube.com/@outdoorpower",
            }],
          };
        }
        if (name === "pageMailboxes") return { list: [{ id: 6, mailboxEmail: BOUND_MAILBOX, ownerOpenId: BOUND_OWNER_OPEN_ID }] };
        if (name === "importKolProfilesFromCrawler") {
          const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
          expect(csv).toContain("KOLFOUNDBYURL");
          return { code: 200, data: { totalCount: 1, createdCount: 0, updatedCount: 1, failedCount: 0, skippedCount: 0 } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const ready = await readyRun();
    const item = await ingestFirst(ready.candidates, ready.runId, ready.briefVersion);
    expect(item).toMatchObject({ status: "imported", kol_uid: "KOLFOUNDBYURL" });
    // 已找回 uid 就不该再建档（否则会撞「联系邮箱已被其他红人占用」）。
    expect(starryTools(["addKolProfile"])).toEqual([]);
    expect(starryCalls.map((row) => row.name)).toEqual([
      "pageKolProfiles",
      "listAllKolProfiles",
      "importKolProfilesFromCrawler",
    ]);
    const audits = listAudit("host.add_kol_profile");
    expect(audits).toHaveLength(1);
    expect(audits[0].payload as Json).toMatchObject({
      reused_existing: true,
      skipped: true,
      kol_uid: "KOLFOUNDBYURL",
    });
    // 回执 + 公海照旧。
    expect(getConn().prepare(
      "SELECT COUNT(*) AS n FROM discovery_ingest_receipts WHERE kol_uid='KOLFOUNDBYURL'",
    ).get()).toEqual({ n: 1 });
    expect(getConn().prepare("SELECT pool_status FROM kol_profile_index WHERE kol_uid='KOLFOUNDBYURL'").get())
      .toEqual({ pool_status: "open" });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0, follows: 0, collabs: 0 });
  });

  it("4c. reuses the profile found by the keyword query and skips the listAll fallback", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "pageKolProfiles") {
          return { total: 1, list: [{ kolUid: "KOLFOUNDBYKEY02", kolName: "OutdoorPower", handle: "OutdoorPower" }] };
        }
        if (name === "pageMailboxes") return { list: [{ id: 6, mailboxEmail: BOUND_MAILBOX, ownerOpenId: BOUND_OWNER_OPEN_ID }] };
        if (name === "importKolProfilesFromCrawler") {
          const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
          expect(csv).toContain("KOLFOUNDBYKEY02");
          return { code: 200, data: { totalCount: 1, createdCount: 0, updatedCount: 1, failedCount: 0, skippedCount: 0 } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const ready = await readyRun();
    const item = await ingestFirst(ready.candidates, ready.runId, ready.briefVersion);
    expect(item).toMatchObject({ status: "imported", kol_uid: "KOLFOUNDBYKEY02" });
    expect(starryTools(["addKolProfile"])).toEqual([]);
    // keyword 已经命中，不该再去拉全量。
    expect(starryTools(["listAllKolProfiles"])).toEqual([]);
    expect(getConn().prepare("SELECT pool_status FROM kol_profile_index WHERE kol_uid='KOLFOUNDBYKEY02'").get())
      .toEqual({ pool_status: "open" });
  });

  it("4d. a reused profile whose import still fails must not be counted as imported", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "pageKolProfiles") {
          return { list: [{ kolUid: "KOLORPHAN01", kolName: "OutdoorPower", handle: "OutdoorPower" }] };
        }
        if (name === "importKolProfilesFromCrawler") throw new Error("remote import rejected");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const ready = await readyRun();
    const item = await ingestFirst(ready.candidates, ready.runId, ready.briefVersion);
    expect(item.status).toBe("failed");
    expect(item.error).toMatchObject({ code: "import_creator_failed" });
    expect(item.already_imported).toBe(false);
    expect(starryTools(["addKolProfile"])).toEqual([]);
    // 孤儿不能被当成成功：没有回执、没进公海。
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM discovery_ingest_receipts").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()).toEqual({ n: 0 });
  });

  it("5. a candidate without a contact email fails honestly and never calls Starry", async () => {
    creators = [{
      platform: "youtube",
      platform_creator_id: "yt-nomail-1",
      nickname: "NoMailCreator",
      followers: 9000,
      recent_views: [500, 600],
    }];
    const ready = await readyRun(creators);
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: ready.candidates.map((row) => String(row.id)),
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(ingested.status).toBe(200);
    const item = (ingested.body.items as Json[])[0];
    expect(item.status).toBe("failed");
    expect(item.error).toMatchObject({
      code: "import_creator_no_contact_email",
      message: "该线索没有联系邮箱，未入库。",
    });
    expect(item.kol_uid).toBe(null);
    expect(starryTools(["addKolProfile", "importKolProfilesFromCrawler"])).toEqual([]);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM discovery_ingest_receipts").get()).toEqual({ n: 0 });
    expect(ingested.body.counts).toMatchObject({ imported: 0, failed: 1 });
  });

  it("5b. an unknown owner openId fails honestly and never calls addKolProfile", async () => {
    getConn().prepare("DELETE FROM user_starry_bindings").run();
    const ready = await readyRun();
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(ingested.status).toBe(200);
    const item = (ingested.body.items as Json[])[0];
    expect(item.status).toBe("failed");
    expect(item.error).toMatchObject({ code: "import_creator_no_owner_open_id" });
    expect(starryTools(["addKolProfile", "importKolProfilesFromCrawler"])).toEqual([]);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM discovery_ingest_receipts").get()).toEqual({ n: 0 });
  });

  it("5. partial failure keeps successful kolUids", async () => {
    let imports = 0;
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "addKolProfile") {
          // 两条线索都建档成功，失败的是第二步补平台字段。
          return { code: 200, data: { kolUid: "KOLPARTIALOK", version: 0, operation: "CREATE" } };
        }
        if (name === "importKolProfilesFromCrawler") {
          imports += 1;
          if (imports === 2) throw new Error("remote import rejected");
          return { code: 200, data: { totalCount: 1, createdCount: 0, updatedCount: 1, failedCount: 0, skippedCount: 0 } };
        }
        if (name === "pageMailboxes") {
          return { list: [{ id: 6, mailboxEmail: BOUND_MAILBOX, ownerOpenId: BOUND_OWNER_OPEN_ID }] };
        }
        if (name === "pageKolProfiles") return { list: [] };
        if (name === "listAllKolProfiles") return { list: [] };
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    creators = [
      {
        platform: "youtube",
        platform_creator_id: "yt-ok-1",
        nickname: "OkCreator",
        followers: 8000,
        recent_views: [100, 200],
        email: "ok.creator@mailcreators.example",
      },
      {
        platform: "youtube",
        platform_creator_id: "yt-fail-2",
        nickname: "FailCreator",
        followers: 7000,
        recent_views: [80, 90],
        email: "fail.creator@mailcreators.example",
      },
    ];
    const ready = await readyRun(creators);
    expect(ready.candidates.length).toBeGreaterThanOrEqual(2);
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: ready.candidates.map((row) => String(row.id)),
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(ingested.status).toBe(200);
    const items = ingested.body.items as Json[];
    const ok = items.find((row) => row.status === "imported");
    const failed = items.find((row) => row.status === "failed");
    expect(ok?.kol_uid).toBe("KOLPARTIALOK");
    expect(failed).toBeTruthy();
    // 失败的条目不得标成已在库：没有 receipt，也没进公海。
    expect(failed?.already_imported).toBe(false);
    expect(getConn().prepare(
      "SELECT COUNT(*) AS n FROM discovery_ingest_receipts WHERE candidate_id=?",
    ).get(failed?.candidate_id)).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index WHERE kol_uid='KOLPARTIALOK'").get()).toEqual({ n: 1 });
    expect(sideEffects().follows).toBe(0);
  });

  it("6. brief_version mismatch voids confirm", async () => {
    const ready = await readyRun();
    const pending = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
    });
    expect(pending.status).toBe(422);
    getConn().prepare("UPDATE discovery_runs SET brief_version=? WHERE id=?").run(ready.briefVersion + 1, ready.runId);
    const stale = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.detail).toMatchObject({
      code: "brief_version_mismatch",
      confirmation_void: true,
    });
    expect(starryTools(["addKolProfile", "importKolProfilesFromCrawler"])).toEqual([]);
    const voided = getConn().prepare(
      "SELECT status FROM discovery_ingest_confirms WHERE run_id=? ORDER BY created_at DESC LIMIT 1",
    ).get(ready.runId) as { status?: string };
    expect(voided.status).toBe("voided");
  });

  it("7. timeout path looks up Starry before retry and does not blind-retry import", async () => {
    let imported = 0;
    const lookups: Json[] = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "addKolProfile") {
          return { code: 200, data: { kolUid: "KOLADDED01", version: 0, operation: "CREATE" } };
        }
        if (name === "importKolProfilesFromCrawler") {
          imported += 1;
          const err = new Error("request timed out");
          err.name = "TimeoutError";
          throw err;
        }
        if (name === "pageKolProfiles") {
          lookups.push(args);
          // 第一次是入库前找回（无档案）→ 才 add；第二次是超时后的核对。
          return lookups.length === 1
            ? { list: [] }
            : { list: [{ kolUid: "KOLTIMEOUT01", kolName: "OutdoorPower", handle: "OutdoorPower" }] };
        }
        if (name === "listAllKolProfiles") return { list: [] };
        if (name === "pageMailboxes") {
          return { list: [{ id: 6, mailboxEmail: BOUND_MAILBOX, ownerOpenId: BOUND_OWNER_OPEN_ID }] };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const ready = await readyRun();
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(ingested.status).toBe(200);
    expect((ingested.body.items as Json[])[0]).toMatchObject({
      status: "imported",
      kol_uid: "KOLTIMEOUT01",
      looked_up_after_timeout: true,
      retried: false,
    });
    // 超时只 import 了一次：核对到编号后不再盲目重试。
    expect(imported).toBe(1);
    expect(starryCalls.map((row) => row.name)).toEqual([
      "pageKolProfiles",
      "listAllKolProfiles",
      "pageMailboxes",
      "addKolProfile",
      "importKolProfilesFromCrawler",
      "pageKolProfiles",
    ]);
    expect(listAudit("host.import_creator.timeout_lookup").length).toBe(1);
  });

  it("writes A.open only and records ingest facts, never claim/mail/stage", async () => {
    const ready = await readyRun();
    const ingested = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(ingested.body).toMatchObject({
      entry: "command",
      kind: "command",
      creates_session: false,
      calls_model: false,
      claimed: false,
      b_active_written: false,
      sent: false,
      stage_changed: false,
    });
    const uid = String((ingested.body.items as Json[])[0].kol_uid);
    const pool = await request("GET", "/api/home/pool");
    expect((pool.body.items as Json[]).some((row) => row.kol_uid === uid && row.pool_status === "open")).toBe(true);
    const following = await request("GET", "/api/home/following");
    expect(((following.body.kols as Json[]) || []).some((row) => row.kol_uid === uid)).toBe(false);
    const facts = getConn().prepare(
      "SELECT kind, fact_kind FROM discovery_memory_facts WHERE object_id=? ORDER BY created_at",
    ).all(ready.runId) as Array<{ kind: string; fact_kind: string }>;
    expect(facts.some((row) => row.kind === "run_create" && row.fact_kind === "fact")).toBe(true);
    expect(facts.some((row) => row.kind === "ingest_receipt" && row.fact_kind === "fact")).toBe(true);
    expect(JSON.stringify(facts)).not.toMatch(/score_details/);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0, follows: 0, collabs: 0 });
  });
});

describe("Starry timeout lookup helper", () => {
  it("classifies timeout and looks up without retrying import", async () => {
    expect(isStarryTimeout(new Error("ETIMEDOUT"))).toBe(true);
    expect(isStarryTimeout(new Error("remote import rejected"))).toBe(false);
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        starryCalls.push({ name, args: {} });
        if (name === "pageKolProfiles") return { list: [{ kolUid: "KOLLOOKUP99", handle: "OutdoorPower" }] };
        throw new Error(`unexpected ${name}`);
      },
      async close() {},
    }));
    const uid = await lookupImportedKolUid({ keyword: "OutdoorPower" });
    expect(uid).toBe("KOLLOOKUP99");
    expect(starryCalls.map((row) => row.name)).toEqual(["pageKolProfiles"]);
  });
});
