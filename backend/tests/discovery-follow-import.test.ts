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
  avgViews10,
  buildCrawlerImportFile,
  crawlerFileContainsContactEmail,
  CRAWLER_CSV_HEADERS,
  followersToWan,
  isPlaceholderKolUid,
  isRealKolUid,
  mapCandidateToCrawlerRow,
  parseImportedKolUid,
  platformDictCode,
  sourceBatchFor,
} from "../src/discovery-import.js";
import { getConn, listAudit, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json, Row } from "../src/types.js";

const crawlCalls: string[] = [];
const starryCalls: Array<{ name: string; args: Json }> = [];
let tmp = "";
let app: Hono;
let creators: Json[] = [];

function mockCrawl() {
  return {
    async callTool(name: string, args: Json = {}) {
      crawlCalls.push(name);
      if (name === "start_crawl") return { task_id: "remote-disc-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-disc-1", status: "idle" };
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

async function readyCandidate(): Promise<Json> {
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
  return items[0];
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-follow-import-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  delete process.env.LIVE_REMOTE_SIDE_EFFECTS;
  crawlCalls.length = 0;
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

describe("candidate to crawler row mapper", () => {
  it("maps platform dict, wan followers, avg views, and never invents email", () => {
    expect(avgViews10({ recent_views: [1000, 2000, 1500] })).toBe(1500);
    expect(avgViews10({ recent_views: [10, 20] })).toBe(15);
    expect(followersToWan(12000)).toBe("1.2");
    expect(platformDictCode("youtube")).toBe("YOUTUBE");
    const row = mapCandidateToCrawlerRow({
      id: "cand_1",
      request_id: "dreq_1",
      platform: "youtube",
      platform_creator_id: "yt-outdoor-1",
      handle: "OutdoorPower",
      nickname: "OutdoorPower",
      followers: 12000,
      score: 8,
      payload: JSON.stringify({
        recent_views: [1000, 2000, 1500],
        profile_url: "https://youtube.com/@outdoorpower",
      }),
      signals: JSON.stringify({ recent_views: [1000, 2000, 1500] }),
    } as Row);
    expect(row).toEqual({
      platform_dict: "YOUTUBE",
      kol_name: "OutdoorPower",
      account: "OutdoorPower",
      followers_wan: "1.2",
      avg_views_10: "1500",
      profile_url: "https://youtube.com/@outdoorpower",
    });
    const file = buildCrawlerImportFile([row], "discovery-follow-p0.csv");
    expect(file.fileName).toBe("discovery-follow-p0.csv");
    expect(file.fileBase64).toBeTruthy();
    expect(file.csv).toContain(CRAWLER_CSV_HEADERS.join(","));
    expect(crawlerFileContainsContactEmail(file)).toBe(false);
    expect(file.csv).not.toMatch(/@gmail|contactEmail|联系邮箱/i);
    expect(isPlaceholderKolUid("disc_youtube_yt-outdoor-1")).toBe(true);
    expect(isRealKolUid("KOLOUTDOORPOWER")).toBe(true);
    expect(isRealKolUid("disc_youtube_x")).toBe(false);
    expect(sourceBatchFor({ request_id: "dreq_1", platform: "youtube", platform_creator_id: "yt-1" } as Row))
      .toBe("disc:dreq_1:youtube:yt-1");
  });
});

describe("ADR-022 P0 follow import", () => {
  it("crawl still only creates candidates and does not write Starry", async () => {
    await readyCandidate();
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE status='suggested'").get()).toEqual({ n: 1 });
    expect(starryCalls).toEqual([]);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("confirm follow imports via stub, backfills real kolUid, then marks followed", async () => {
    const tracked: Array<{ name: string; args: Json }> = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        tracked.push({ name, args });
        if (name === "importKolProfilesFromCrawler") {
          expect(args.fileName).toMatch(/\.csv$/);
          expect(String(args.fileBase64 || "")).toBeTruthy();
          const csv = Buffer.from(String(args.fileBase64), "base64").toString("utf8");
          expect(csv).toContain("YOUTUBE");
          expect(csv).toContain("OutdoorPower");
          expect(csv).toContain("1.2");
          expect(csv).toContain("1500");
          expect(csv).not.toMatch(/contactEmail|联系邮箱/i);
          return { data: { kolUid: "KOLOUTDOORPOWER", imported: 1 } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const candidate = await readyCandidate();
    const followed = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(followed.status).toBe(200);
    expect(followed.body.status).toBe("followed");
    expect(followed.body.created).toBe(true);
    expect((followed.body.collaboration as Json).kol_uid).toBe("KOLOUTDOORPOWER");
    expect(String((followed.body.collaboration as Json).kol_uid)).not.toMatch(/^disc_/);
    expect(tracked.map((row) => row.name)).toEqual(["importKolProfilesFromCrawler"]);
    expect(tracked.some((row) => FORBIDDEN.has(row.name))).toBe(false);
    expect(JSON.stringify(followed.body)).not.toMatch(/MediaCrawler|MCP|Codex|disc_/);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
    const audits = listAudit("host.import_creator");
    expect(audits.length).toBe(1);
    expect((audits[0].payload as Json).kol_uid).toBe("KOLOUTDOORPOWER");
    expect((audits[0].payload as Json).sent).toBe(false);
    expect((audits[0].payload as Json).stage_changed).toBe(false);
    const regionWarns = listAudit("discovery.candidate.region_unverified");
    expect(regionWarns.length).toBe(1);
    expect((regionWarns[0].payload as Json).plan_region).toBe("us");
    expect((regionWarns[0].payload as Json).candidate_region).toBe("");
    const row = getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(candidate.id) as Row;
    expect(row.status).toBe("followed");
  });

  it("same display handle + different platform_creator_id does not rewrite the other kol_uid", async () => {
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
    creators = [
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
    ];
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
    getConn().prepare(
      `INSERT INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, kol_uid, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_disc_other",
      "SharedHandle",
      "SharedHandle",
      "LT",
      "youtube",
      "1000",
      "",
      "kol.lt@litime.example",
      "lc_disc_other",
      "conv_disc_other",
      "INITIAL_CONTACT",
      0,
      "leftover disc placeholder other creator",
      0,
      "disc_youtube_yt-other",
      "discovery",
    );

    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["shared handle"],
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
    expect(items).toHaveLength(2);
    const byCreator = Object.fromEntries(
      (getConn().prepare(
        "SELECT id, platform_creator_id FROM creator_candidates WHERE request_id=?",
      ).all(created.body.id) as Row[]).map((row) => [String(row.platform_creator_id), String(row.id)]),
    );
    const candA = byCreator["yt-shared-a"];
    const candB = byCreator["yt-shared-b"];
    expect(candA && candB).toBeTruthy();

    const followA = await request("POST", `/api/discovery/candidates/${candA}/follow`, { confirmed: true });
    expect(followA.status).toBe(200);
    expect(followA.body.created).toBe(true);
    expect((followA.body.collaboration as Json).kol_uid).toBe("KOLSHAREDA");
    expect((followA.body.collaboration as Json).id).not.toBe("col_starry_shared");
    expect((followA.body.collaboration as Json).id).not.toBe("col_disc_other");

    const followB = await request("POST", `/api/discovery/candidates/${candB}/follow`, { confirmed: true });
    expect(followB.status).toBe(200);
    expect(followB.body.created).toBe(true);
    expect((followB.body.collaboration as Json).kol_uid).toBe("KOLSHAREDB");
    expect((followB.body.collaboration as Json).id).not.toBe((followA.body.collaboration as Json).id);
    expect((followB.body.collaboration as Json).id).not.toBe("col_starry_shared");
    expect((followB.body.collaboration as Json).id).not.toBe("col_disc_other");

    expect(getConn().prepare("SELECT kol_uid FROM collaborations WHERE id='col_starry_shared'").get()).toEqual({
      kol_uid: "KOLSTARRYSHARED",
    });
    expect(getConn().prepare("SELECT kol_uid FROM collaborations WHERE id='col_disc_other'").get()).toEqual({
      kol_uid: "disc_youtube_yt-other",
    });
    expect(getConn().prepare("SELECT kol_uid FROM collaborations WHERE id=?").get((followA.body.collaboration as Json).id))
      .toEqual({ kol_uid: "KOLSHAREDA" });
    expect(getConn().prepare("SELECT kol_uid FROM collaborations WHERE id=?").get((followB.body.collaboration as Json).id))
      .toEqual({ kol_uid: "KOLSHAREDB" });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("handle match may backfill only this creator's leftover discovery disc_* row", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "importKolProfilesFromCrawler") return { data: { kolUid: "KOLOUTDOORPOWER", imported: 1 } };
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const candidate = await readyCandidate();
    getConn().prepare(
      `INSERT INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, kol_uid, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_disc_same",
      "OutdoorPower",
      "OutdoorPower",
      "LT",
      "youtube",
      "12000",
      "",
      "kol.lt@litime.example",
      "lc_disc_same",
      "conv_disc_same",
      "INITIAL_CONTACT",
      0,
      "leftover placeholder this creator",
      0,
      "disc_youtube_yt-outdoor-1",
      "discovery",
    );
    const followed = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(followed.status).toBe(200);
    expect(followed.body.created).toBe(false);
    expect((followed.body.collaboration as Json).id).toBe("col_disc_same");
    expect((followed.body.collaboration as Json).kol_uid).toBe("KOLOUTDOORPOWER");
    expect(getConn().prepare("SELECT kol_uid FROM collaborations WHERE id='col_disc_same'").get()).toEqual({
      kol_uid: "KOLOUTDOORPOWER",
    });
  });

  it("import failure keeps candidate suggested and does not create Collaboration", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "importKolProfilesFromCrawler") throw new Error("remote import rejected");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const candidate = await readyCandidate();
    const failed = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(failed.status).toBe(502);
    expect(failed.body.detail).toMatchObject({
      code: "import_creator_failed",
      message: "写入红人档案失败，未加入跟进。请稍后重试。",
    });
    expect(JSON.stringify(failed.body)).not.toMatch(/MediaCrawler|MCP|Codex|remote import rejected/i);
    expect(getConn().prepare("SELECT status, collaboration_id FROM creator_candidates WHERE id=?").get(candidate.id)).toMatchObject({
      status: "suggested",
      collaboration_id: null,
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("missing kolUid is an honest failure and does not half-follow", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "importKolProfilesFromCrawler") return { imported: 1, list: [] };
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const candidate = await readyCandidate();
    const failed = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(failed.status).toBe(502);
    expect(failed.body.detail).toMatchObject({
      code: "import_creator_no_kol_uid",
      message: "档案未回传红人编号，未加入跟进。",
    });
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(candidate.id)).toMatchObject({
      status: "suggested",
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
  });

  it("re-follow of an imported profile links the existing collab and does not double-add", async () => {
    const candidate = await readyCandidate();
    const first = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(first.status).toBe(200);
    const uid = String((first.body.collaboration as Json).kol_uid);
    expect(uid).toMatch(/^KOL/i);
    const second = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect((second.body.collaboration as Json).id).toBe((first.body.collaboration as Json).id);
    expect((second.body.collaboration as Json).kol_uid).toBe(uid);
    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'",
    ).get() as { n: number }).n)).toBe(1);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("write-time thresholds reject without importing; omit thresholds still follows", async () => {
    const imported: string[] = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        imported.push(name);
        if (name === "importKolProfilesFromCrawler") {
          return { kolUid: parseImportedKolUid({ kolUid: "KOLTHRESH01" }) || "KOLTHRESH01", args };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const candidate = await readyCandidate();
    const rejected = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, {
      confirmed: true,
      thresholds: { min_followers: 50000, min_avg_views_10: 8000, min_score: 9 },
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.detail).toMatchObject({ code: "follow_filter_rejected" });
    expect(String((rejected.body.detail as Json).message)).toContain("未加入跟进");
    expect(imported).toEqual([]);
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(candidate.id)).toMatchObject({
      status: "suggested",
    });

    const ok = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("followed");
    expect(imported).toEqual(["importKolProfilesFromCrawler"]);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("real mode without LIVE refuses write and leaves the candidate suggested", async () => {
    process.env.CODEX_MODE = "real";
    process.env.LIVE_REMOTE_SIDE_EFFECTS = "0";
    const candidate = await readyCandidate();
    const failed = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(failed.status).toBe(409);
    expect(failed.body.detail).toMatchObject({
      code: "import_creator_live_disabled",
      message: "当前未开启主档写入，无法加入跟进。",
    });
    expect(JSON.stringify(failed.body)).not.toMatch(/MCP|LIVE_REMOTE|Starry/i);
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(candidate.id)).toMatchObject({
      status: "suggested",
    });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });
});

const FORBIDDEN = new Set(["sendEmailNow", "changeLifecycleStage", "decryptKolContact"]);
