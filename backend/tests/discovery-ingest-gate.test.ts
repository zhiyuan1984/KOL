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
import { seedAll } from "../src/seed.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json, Row } from "../src/types.js";

const starryCalls: Array<{ name: string; args: Json }> = [];
let tmp = "";
let app: Hono;
let creators: Json[] = [];

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
  }];
  resetConn();
  seedAll();
  resetCollectorConnectionCache();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setCrawlMcpClientFactory(mockCrawl);
  setStarryKolClientFactory(() => ({
    async callTool(name: string, args: Json = {}) {
      starryCalls.push({ name, args });
      if (name === "importKolProfilesFromCrawler") {
        const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
        expect(csv).not.toMatch(/contactEmail|联系邮箱/i);
        const line = csv.split(/\r?\n/).map((row) => row.replace(/^\uFEFF/, "")).find((row, index) => index > 0 && row.trim());
        const account = line ? line.split(",")[2]?.replace(/^"|"$/g, "") : "DISC";
        const slug = String(account || "DISC").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "DISC";
        return { data: { kolUid: `KOL${slug}`, imported: 1 } };
      }
      if (name === "pageKolProfiles") return { list: [] };
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
    expect(starryCalls.filter((row) => row.name === "importKolProfilesFromCrawler")).toEqual([]);
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
    expect(starryCalls.filter((row) => row.name === "importKolProfilesFromCrawler")).toEqual([]);
    const confirmedAfterCancel = await request("POST", "/api/home/discovery/ingest", {
      run_id: ready.runId,
      candidate_ids: [ready.candidates[0].id],
      expected_brief_version: ready.briefVersion,
      confirmed: true,
    });
    expect(confirmedAfterCancel.status).toBe(409);
    expect(confirmedAfterCancel.body.detail).toMatchObject({ code: "l3_cancelled" });
    expect(starryCalls.filter((row) => row.name === "importKolProfilesFromCrawler")).toEqual([]);
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
    const imports = starryCalls.filter((row) => row.name === "importKolProfilesFromCrawler").length;
    const second = await request("POST", "/api/home/discovery/ingest", body);
    expect(second.status).toBe(200);
    expect((second.body.items as Json[])[0]).toMatchObject({
      status: "already_imported",
      already_imported: true,
      kol_uid: item.kol_uid,
    });
    expect(starryCalls.filter((row) => row.name === "importKolProfilesFromCrawler")).toHaveLength(imports);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0, follows: 0, collabs: 0 });
  });

  it("4. missing email still imports; payload has no fabricated email", async () => {
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
    expect(item.has_contact_email).toBe(false);
    const importCall = starryCalls.find((row) => row.name === "importKolProfilesFromCrawler");
    expect(importCall).toBeTruthy();
    const csv = Buffer.from(String(importCall?.args.fileBase64 || ""), "base64").toString("utf8");
    expect(csv).not.toMatch(/contactEmail|联系邮箱|@gmail|@yahoo/i);
    expect(JSON.stringify(ingested.body)).not.toMatch(/EMAIL_AGENT_MCP|MEDIACRAWLER_MCP_TOKEN|password|api[_-]?key/i);
    const profile = getConn().prepare("SELECT * FROM kol_profile_index WHERE kol_uid=?").get(item.kol_uid) as Row;
    expect(profile).toMatchObject({
      pool_status: "open",
      ingest_source: "crawler",
      source_batch: ready.runId,
    });
  });

  it("5. partial failure keeps successful kolUids", async () => {
    let imports = 0;
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "importKolProfilesFromCrawler") {
          imports += 1;
          if (imports === 2) throw new Error("remote import rejected");
          return { data: { kolUid: "KOLPARTIALOK", imported: 1 } };
        }
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
      },
      {
        platform: "youtube",
        platform_creator_id: "yt-fail-2",
        nickname: "FailCreator",
        followers: 7000,
        recent_views: [80, 90],
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
    expect(starryCalls.filter((row) => row.name === "importKolProfilesFromCrawler")).toEqual([]);
    const voided = getConn().prepare(
      "SELECT status FROM discovery_ingest_confirms WHERE run_id=? ORDER BY created_at DESC LIMIT 1",
    ).get(ready.runId) as { status?: string };
    expect(voided.status).toBe("voided");
  });

  it("7. timeout path looks up Starry before retry and does not blind-retry import", async () => {
    let imported = 0;
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        starryCalls.push({ name, args });
        if (name === "importKolProfilesFromCrawler") {
          imported += 1;
          const err = new Error("request timed out");
          err.name = "TimeoutError";
          throw err;
        }
        if (name === "pageKolProfiles") {
          return { list: [{ kolUid: "KOLTIMEOUT01", kolName: "OutdoorPower", handle: "OutdoorPower" }] };
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
    expect(imported).toBe(1);
    expect(starryCalls.map((row) => row.name)).toEqual([
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
