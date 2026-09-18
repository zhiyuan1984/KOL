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
import {
  candidateHasContactEmail,
  evaluateFollowFilters,
  sourceBatchForFollowSet,
} from "../src/discovery-import.js";
import { getConn, listAudit, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json, Row } from "../src/types.js";

const crawlCalls: string[] = [];
let tmp = "";
let app: Hono;
let creators: Json[] = [];

const FORBIDDEN = new Set(["sendEmailNow", "changeLifecycleStage", "decryptKolContact"]);

function mockCrawl() {
  return {
    async callTool(name: string, args: Json = {}) {
      crawlCalls.push(name);
      if (name === "start_crawl") return { task_id: "remote-disc-batch-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-disc-batch-1", status: "idle" };
      if (name === "get_crawl_logs") return { logs: [] };
      if (name === "get_creators") return { creators, has_more: false };
      return args;
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
  };
}

function crawlJobIdFor(requestId: string): string {
  const row = getConn().prepare(
    "SELECT crawl_job_id FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(requestId) as { crawl_job_id?: string } | undefined;
  return String(row?.crawl_job_id || "");
}

function uidFromCsv(args: Json): string {
  const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
  const line = csv.split(/\r?\n/).map((row) => row.replace(/^\uFEFF/, "")).find((row, index) => index > 0 && row.trim());
  const cells = line ? line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()) : [];
  const account = cells[2] || cells[1] || "DISC";
  return `KOL${account.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "DISC"}`;
}

function defaultImportFactory(onCall?: (name: string, args: Json) => void) {
  return () => ({
    async callTool(name: string, args: Json = {}) {
      onCall?.(name, args);
      if (name === "importKolProfilesFromCrawler") {
        expect(String(args.fileBase64 || "")).toBeTruthy();
        const csv = Buffer.from(String(args.fileBase64), "base64").toString("utf8");
        expect(csv).not.toMatch(/contactEmail|联系邮箱/i);
        return { data: { kolUid: uidFromCsv(args), imported: 1 } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() {},
  });
}

async function readyCandidates(list: Json[] = creators): Promise<{ requestId: string; items: Json[] }> {
  creators = list;
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
  expect(items.length).toBe(list.length);
  return { requestId: String(created.body.id), items };
}

function threeCreators(): Json[] {
  return [
    {
      platform: "youtube",
      platform_creator_id: "yt-alpha",
      nickname: "AlphaPower",
      followers: 20000,
      recent_views: [2000, 2200, 1800],
    },
    {
      platform: "youtube",
      platform_creator_id: "yt-beta",
      nickname: "BetaCamp",
      followers: 8000,
      recent_views: [400, 350, 300],
    },
    {
      platform: "youtube",
      platform_creator_id: "yt-gamma",
      nickname: "GammaTrail",
      followers: 50000,
      recent_views: [9000, 8800, 9100],
    },
  ];
}

function byHandle(items: Json[]): Record<string, Json> {
  return Object.fromEntries(items.map((row) => [String(row.handle), row]));
}

function setCandidateScore(id: string, score: number): void {
  const row = getConn().prepare("SELECT payload, signals FROM creator_candidates WHERE id=?").get(id) as Row;
  const payload = JSON.parse(String(row.payload || "{}"));
  const signals = JSON.parse(String(row.signals || "{}"));
  payload.score = score;
  signals.score = score;
  getConn().prepare("UPDATE creator_candidates SET score=?, payload=?, signals=? WHERE id=?").run(
    score,
    JSON.stringify(payload),
    JSON.stringify(signals),
    id,
  );
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-follow-batch-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  delete process.env.LIVE_REMOTE_SIDE_EFFECTS;
  crawlCalls.length = 0;
  creators = threeCreators();
  resetConn();
  seedAll();
  resetCollectorConnectionCache();
  setCollectorProbeClientFactory();
  setCollectorProbeFetch();
  setCrawlMcpClientFactory(mockCrawl);
  setStarryKolClientFactory();
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

describe("ADR-022 P1 batch helpers", () => {
  it("evaluates thresholds without inventing region or email", () => {
    const candidate = {
      id: "cand_1",
      request_id: "dreq_1",
      platform: "youtube",
      platform_creator_id: "yt-1",
      followers: 12000,
      score: 6,
      payload: JSON.stringify({ recent_views: [1000, 2000, 1500] }),
      signals: JSON.stringify({ recent_views: [1000, 2000, 1500] }),
    } as Row;
    const request = { platforms: JSON.stringify(["youtube"]), filters: JSON.stringify({ region: "us" }) } as Row;
    expect(evaluateFollowFilters(candidate, request, { min_followers: 10000 }).ok).toBe(true);
    expect(evaluateFollowFilters(candidate, request, { min_followers: 50000 }).ok).toBe(false);
    expect(evaluateFollowFilters(candidate, request, { min_avg_views_10: 2000 }).ok).toBe(false);
    expect(evaluateFollowFilters(candidate, request, { min_score: 8 }).ok).toBe(false);
    expect(evaluateFollowFilters(candidate, request, { platform: "instagram" }).ok).toBe(false);
    expect(evaluateFollowFilters(candidate, request, { region: "us" }).ok).toBe(true);
    expect(candidateHasContactEmail(candidate)).toBe(false);
    expect(sourceBatchForFollowSet({
      requestId: "dreq_1",
      candidateIds: ["b", "a"],
      filter: { min_followers: 1 },
    })).toMatch(/^disc:dreq_1:batch:/);
  });
});

describe("ADR-022 P1 selected + conditional batch follow", () => {
  it("selected batch follows each candidate with a real kolUid and shared source_batch", async () => {
    const imported: string[] = [];
    setStarryKolClientFactory(defaultImportFactory((name) => imported.push(name)));
    const { requestId, items } = await readyCandidates();
    const ids = items.map((row) => String(row.id));
    const followed = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: ids,
      request_id: requestId,
    });
    expect(followed.status).toBe(200);
    expect(followed.body.confirmed).toBe(true);
    expect((followed.body.followed as Json[])).toHaveLength(3);
    expect((followed.body.failed as Json[])).toHaveLength(0);
    expect((followed.body.skipped_duplicate as Json[])).toHaveLength(0);
    expect(String(followed.body.source_batch)).toMatch(/^disc:/);
    const uids = (followed.body.followed as Json[]).map((row) => String((row.collaboration as Json).kol_uid));
    expect(uids.every((uid) => /^KOL/.test(uid) && !/^disc_/.test(uid))).toBe(true);
    expect(new Set(uids).size).toBe(3);
    expect(imported).toEqual([
      "importKolProfilesFromCrawler",
      "importKolProfilesFromCrawler",
      "importKolProfilesFromCrawler",
    ]);
    expect(imported.some((name) => FORBIDDEN.has(name))).toBe(false);
    expect(JSON.stringify(followed.body)).not.toMatch(/MediaCrawler|MCP|Codex|disc_/);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE status='followed'").get()).toEqual({ n: 3 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()).toEqual({ n: 3 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index WHERE pool_status='open'").get()).toEqual({ n: 3 });
    const following = await request("GET", "/api/home/following");
    expect(((following.body.kols as Json[]) || []).some((row) => String(row.source) === "discovery")).toBe(false);
    const audits = listAudit("discovery.candidates.follow_batch");
    expect(audits.length).toBe(1);
    expect((audits[0].payload as Json).sent).toBe(false);
    expect((audits[0].payload as Json).stage_changed).toBe(false);
  });

  it("partial success keeps failed candidates suggested and does not mark the whole batch followed", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        if (name === "importKolProfilesFromCrawler") {
          const csv = Buffer.from(String(args.fileBase64), "base64").toString("utf8");
          if (csv.includes("BetaCamp")) throw new Error("remote import rejected");
          return { data: { kolUid: uidFromCsv(args), imported: 1 } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const { requestId, items } = await readyCandidates();
    const by = byHandle(items);
    const result = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: items.map((row) => String(row.id)),
      request_id: requestId,
    });
    expect(result.status).toBe(200);
    expect((result.body.followed as Json[])).toHaveLength(2);
    expect((result.body.failed as Json[])).toHaveLength(1);
    expect(String(((result.body.failed as Json[])[0] as Json).candidate_id)).toBe(String(by.BetaCamp.id));
    expect(String(((result.body.failed as Json[])[0] as Json).message)).toContain("未加入跟进");
    expect(JSON.stringify(result.body)).not.toMatch(/MediaCrawler|MCP|Codex|remote import rejected/i);
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(by.BetaCamp.id)).toEqual({
      status: "suggested",
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE status='followed'").get()).toEqual({ n: 2 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 2 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("re-submitting the same selected set skips already followed as skipped_duplicate", async () => {
    setStarryKolClientFactory(defaultImportFactory());
    const { requestId, items } = await readyCandidates();
    const ids = items.map((row) => String(row.id));
    const first = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: ids,
      request_id: requestId,
      source_batch: "disc:test:batch:same",
    });
    expect(first.status).toBe(200);
    expect((first.body.followed as Json[])).toHaveLength(3);
    const second = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: ids,
      request_id: requestId,
      source_batch: "disc:test:batch:same",
    });
    expect(second.status).toBe(200);
    expect((second.body.followed as Json[])).toHaveLength(0);
    expect((second.body.skipped_duplicate as Json[])).toHaveLength(3);
    expect((second.body.failed as Json[])).toHaveLength(0);
    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'",
    ).get() as { n: number }).n)).toBe(3);
  });

  it("conditional batch write-time rechecks fans / avg views / score / plan chips", async () => {
    const imported: string[] = [];
    setStarryKolClientFactory(defaultImportFactory((name) => imported.push(name)));
    const { requestId, items } = await readyCandidates();
    const by = byHandle(items);
    setCandidateScore(String(by.AlphaPower.id), 7);
    setCandidateScore(String(by.BetaCamp.id), 4);
    setCandidateScore(String(by.GammaTrail.id), 9);
    const preview = await request("POST", "/api/discovery/candidates/follow-batch", {
      preview: true,
      request_id: requestId,
      filter: { min_followers: 15000, min_avg_views_10: 1500, min_score: 6 },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toBe(true);
    expect((preview.body.items as Json[]).map((row) => row.handle).sort()).toEqual(["AlphaPower", "GammaTrail"]);
    expect(imported).toEqual([]);

    const written = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      request_id: requestId,
      filter: { min_followers: 15000, min_avg_views_10: 1500, min_score: 6 },
    });
    expect(written.status).toBe(200);
    expect((written.body.followed as Json[]).map((row) => row.handle).sort()).toEqual(["AlphaPower", "GammaTrail"]);
    expect((written.body.failed as Json[]).map((row) => row.handle)).toEqual(["BetaCamp"]);
    expect(imported).toHaveLength(2);
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(by.BetaCamp.id)).toEqual({
      status: "suggested",
    });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("write-time recheck rejects a selected candidate that no longer matches", async () => {
    const imported: string[] = [];
    setStarryKolClientFactory(defaultImportFactory((name) => imported.push(name)));
    const { requestId, items } = await readyCandidates();
    const by = byHandle(items);
    const result = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: [String(by.BetaCamp.id)],
      request_id: requestId,
      filter: { min_followers: 40000 },
    });
    expect(result.status).toBe(200);
    expect((result.body.followed as Json[])).toHaveLength(0);
    expect((result.body.failed as Json[])[0]).toMatchObject({
      candidate_id: by.BetaCamp.id,
      code: "follow_filter_rejected",
    });
    expect(imported).toEqual([]);
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(by.BetaCamp.id)).toEqual({
      status: "suggested",
    });
  });

  it("missing region with a plan region is audit-warn only and still follows", async () => {
    setStarryKolClientFactory(defaultImportFactory());
    const { requestId, items } = await readyCandidates([threeCreators()[0]]);
    const result = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: [String(items[0].id)],
      request_id: requestId,
      filter: { min_followers: 1, region: "us" },
    });
    expect(result.status).toBe(200);
    expect((result.body.followed as Json[])).toHaveLength(1);
    expect(String(((result.body.followed as Json[])[0].collaboration as Json).kol_uid)).not.toMatch(/^disc_/);
    const warns = listAudit("discovery.candidate.region_unverified");
    expect(warns.length).toBe(1);
    expect((warns[0].payload as Json).plan_region).toBe("us");
    expect((warns[0].payload as Json).candidate_region).toBe("");
  });

  it("same handle + different platform_creator_id does not rewrite the other kol_uid in a batch", async () => {
    let importSeq = 0;
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "importKolProfilesFromCrawler") {
          importSeq += 1;
          return { data: { kolUid: importSeq === 1 ? "KOLSHAREDA" : "KOLSHAREDB", imported: 1 } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    getConn().prepare(
      `INSERT INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, kol_uid, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_starry_shared",
      "SharedHandle",
      "SharedHandle",
      "LT",
      "youtube",
      "50000",
      "",
      "kol.lt@litime.example",
      "lc_starry_shared",
      "conv_starry_shared",
      "INITIAL_CONTACT",
      0,
      "seeded starry same handle",
      0,
      "KOLSTARRYSHARED",
      "starry",
    );
    const { requestId, items } = await readyCandidates([
      {
        platform: "youtube",
        platform_creator_id: "yt-shared-a",
        nickname: "SharedHandle",
        followers: 12000,
        recent_views: [1000, 2000],
      },
      {
        platform: "youtube",
        platform_creator_id: "yt-shared-b",
        nickname: "SharedHandle",
        followers: 9000,
        recent_views: [800, 900],
      },
    ]);
    const result = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: items.map((row) => String(row.id)),
      request_id: requestId,
    });
    expect(result.status).toBe(200);
    expect((result.body.followed as Json[])).toHaveLength(2);
    const uids = (result.body.followed as Json[]).map((row) => String((row.collaboration as Json).kol_uid)).sort();
    expect(uids).toEqual(["KOLSHAREDA", "KOLSHAREDB"]);
    expect((result.body.followed as Json[]).map((row) => (row.collaboration as Json).id)).not.toContain("col_starry_shared");
    expect(getConn().prepare("SELECT kol_uid FROM collaborations WHERE id='col_starry_shared'").get()).toEqual({
      kol_uid: "KOLSTARRYSHARED",
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 2 });
  });

  it("requires confirm and refuses LIVE-off writes without following anyone", async () => {
    const { requestId, items } = await readyCandidates([threeCreators()[0]]);
    const unconfirmed = await request("POST", "/api/discovery/candidates/follow-batch", {
      candidate_ids: [String(items[0].id)],
      request_id: requestId,
    });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.detail).toMatchObject({
      code: "follow_not_confirmed",
      message: "请先确认后再加入跟进。",
    });
    process.env.CODEX_MODE = "real";
    process.env.LIVE_REMOTE_SIDE_EFFECTS = "0";
    const failed = await request("POST", "/api/discovery/candidates/follow-batch", {
      confirmed: true,
      candidate_ids: [String(items[0].id)],
      request_id: requestId,
    });
    expect(failed.status).toBe(200);
    expect((failed.body.followed as Json[])).toHaveLength(0);
    expect((failed.body.failed as Json[])[0]).toMatchObject({
      code: "import_creator_live_disabled",
      message: "当前未开启主档写入，无法加入跟进。",
    });
    expect(JSON.stringify(failed.body)).not.toMatch(/MCP|LIVE_REMOTE|Starry|MediaCrawler/i);
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(items[0].id)).toEqual({
      status: "suggested",
    });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});
