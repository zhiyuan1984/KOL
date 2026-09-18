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
import { nowIso, getConn, resetConn } from "../src/db.js";
import { sendDraft } from "../src/gateway/send.js";
import { seedAll } from "../src/seed.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

let tmp = "";
let app: Hono;
let creators: Json[] = [];

function mockCrawl() {
  return {
    async callTool(name: string) {
      if (name === "start_crawl") return { task_id: "remote-disc-ingest-1", status: "running" };
      if (name === "get_crawl_status") return { task_id: "remote-disc-ingest-1", status: "idle" };
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

function followingHas(uid: string, body: Json): boolean {
  return ((body.kols as Json[]) || []).some((row) => String(row.kol_uid || "") === uid);
}

function poolItem(uid: string, body: Json): Json | undefined {
  return ((body.items as Json[]) || []).find((row) => String(row.kol_uid || "") === uid);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-ingest-claim-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.CLAW_MODE = "mock";
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  delete process.env.LIVE_REMOTE_SIDE_EFFECTS;
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

describe("discovery ingest vs exclusive claim", () => {
  it("old /follow and new /ingest write open-pool A and stay off 我跟进", async () => {
    const candidate = await readyCandidate();
    const ingested = await request("POST", `/api/discovery/candidates/${candidate.id}/ingest`, { confirmed: true });
    expect(ingested.status).toBe(200);
    expect(ingested.body.claimed).toBe(false);
    expect(ingested.body.pool_status).toBe("open");
    expect(ingested.body.ingested).toBe(true);
    const uid = String((ingested.body.collaboration as Json).kol_uid);
    expect(uid).toMatch(/^KOL/i);

    const following = await request("GET", "/api/home/following");
    expect(following.status).toBe(200);
    expect(followingHas(uid, following.body)).toBe(false);

    const pool = await request("GET", "/api/home/pool");
    expect(pool.status).toBe(200);
    expect(poolItem(uid, pool.body)).toMatchObject({
      kol_uid: uid,
      pool_status: "open",
      platform: "youtube",
    });
    const poolAlias = await request("GET", "/api/kols/pool");
    expect(poolItem(uid, poolAlias.body)).toMatchObject({ kol_uid: uid, pool_status: "open" });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid=?").get(uid)).toEqual({ n: 0 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });

    const again = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    expect(again.status).toBe(200);
    expect(again.body.claimed).toBe(false);
    expect(again.body.pool_status).toBe("open");
    const followingAgain = await request("GET", "/api/home/following");
    expect(followingHas(uid, followingAgain.body)).toBe(false);
  });

  it("claim after ingest requires L3 confirm and then shows on 我跟进", async () => {
    const candidate = await readyCandidate();
    const ingested = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, { confirmed: true });
    const uid = String((ingested.body.collaboration as Json).kol_uid);
    const unconfirmed = await request("POST", `/api/kols/${encodeURIComponent(uid)}/claim`, {});
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.detail).toMatchObject({
      code: "l3_confirm_required",
      risk: "L3",
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid=?").get(uid)).toEqual({ n: 0 });
    expect(followingHas(uid, (await request("GET", "/api/home/following")).body)).toBe(false);

    const claimed = await request("POST", `/api/kols/${encodeURIComponent(uid)}/claim`, { confirmed: true });
    expect([200, 201]).toContain(claimed.status);
    expect(claimed.body.created).toBe(true);
    expect(getConn().prepare("SELECT pool_status FROM kol_profile_index WHERE kol_uid=?").get(uid)).toEqual({
      pool_status: "claimed",
    });

    const following = await request("GET", "/api/home/following");
    expect(followingHas(uid, following.body)).toBe(true);
    const pool = await request("GET", "/api/home/pool");
    expect(poolItem(uid, pool.body)).toBeUndefined();
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("follow with claim:true is explicit ingest-then-claim and still needs L3 confirm", async () => {
    const candidate = await readyCandidate();
    const refused = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, {
      claim: true,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatchObject({ code: "l3_confirm_required" });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get()).toEqual({ n: 0 });

    const followed = await request("POST", `/api/discovery/candidates/${candidate.id}/follow`, {
      confirmed: true,
      claim: true,
    });
    expect(followed.status).toBe(200);
    expect(followed.body.claimed).toBe(true);
    expect(followed.body.pool_status).toBe("claimed");
    const uid = String((followed.body.collaboration as Json).kol_uid);
    const following = await request("GET", "/api/home/following");
    expect(followingHas(uid, following.body)).toBe(true);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("refuses ingest without a stable external id and does not half-claim", async () => {
    const candidate = await readyCandidate();
    const row = getConn().prepare("SELECT payload, signals FROM creator_candidates WHERE id=?").get(candidate.id) as {
      payload?: string;
      signals?: string;
    };
    const strip = (raw: unknown) => {
      try {
        const parsed = JSON.parse(String(raw || "{}")) as Record<string, unknown>;
        delete parsed.platform_creator_id;
        delete parsed.platformCreatorId;
        delete parsed.creator_id;
        return JSON.stringify(parsed);
      } catch {
        return "{}";
      }
    };
    getConn().prepare(
      "UPDATE creator_candidates SET platform_creator_id='', payload=?, signals=? WHERE id=?",
    ).run(strip(row.payload), strip(row.signals), candidate.id);
    const failed = await request("POST", `/api/discovery/candidates/${candidate.id}/ingest`, { confirmed: true });
    expect(failed.status).toBe(409);
    expect(failed.body.detail).toMatchObject({
      code: "ingest_missing_external_id",
      message: "缺少稳定外部编号，无法入库公海。",
      biz: "BIZ-10",
    });
    expect(getConn().prepare("SELECT status FROM creator_candidates WHERE id=?").get(candidate.id)).toMatchObject({
      status: "suggested",
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
    const following = await request("GET", "/api/home/following");
    expect(((following.body.kols as Json[]) || []).some((row) => String(row.source) === "discovery")).toBe(false);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("claim without an official profile is refused", async () => {
    const failed = await request("POST", "/api/kols/KOLNOTINPOOL/claim", { confirmed: true });
    expect(failed.status).toBe(404);
    expect(failed.body.detail).toMatchObject({
      code: "profile_not_in_index",
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get()).toEqual({ n: 0 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("collection still only creates candidates — no A, no B, no Collaboration", async () => {
    await readyCandidate();
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE status='suggested'").get()).toEqual({ n: 1 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get()).toEqual({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM collaborations WHERE source='discovery'").get()).toEqual({ n: 0 });
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("batch ingest is partial-success and does not claim", async () => {
    creators = [
      {
        platform: "youtube",
        platform_creator_id: "yt-alpha",
        nickname: "AlphaPower",
        followers: 20000,
        recent_views: [2000, 2200],
      },
      {
        platform: "youtube",
        platform_creator_id: "yt-beta",
        nickname: "BetaCamp",
        followers: 8000,
        recent_views: [400, 350],
      },
    ];
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        if (name === "importKolProfilesFromCrawler") {
          const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
          if (csv.includes("BetaCamp")) throw new Error("remote import rejected");
          return { data: { kolUid: "KOLALPHAPOWER", imported: 1 } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() {},
    }));
    const created = await request("POST", "/api/discovery/requests", {
      keywords: ["batch"],
      platforms: ["youtube"],
      brand: "LT",
    });
    const started = await request("POST", `/api/discovery/requests/${created.body.id}/runs`, {});
    expect(started.status).toBe(202);
    await monitorCrawlJob(crawlJobIdFor(String(created.body.id)));
    const results = await request("GET", `/api/discovery/requests/${created.body.id}/results`);
    const items = results.body.candidates as Json[];
    const batch = await request("POST", "/api/discovery/candidates/ingest-batch", {
      confirmed: true,
      candidate_ids: items.map((row) => String(row.id)),
      request_id: created.body.id,
    });
    expect(batch.status).toBe(200);
    expect((batch.body.ingested as Json[]) || batch.body.followed).toHaveLength(1);
    expect((batch.body.failed as Json[])).toHaveLength(1);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_profile_index").get()).toEqual({ n: 1 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index").get()).toEqual({ n: 0 });
    const following = await request("GET", "/api/home/following");
    expect(followingHas("KOLALPHAPOWER", following.body)).toBe(false);
    expect(sideEffects()).toEqual({ sends: 0, stageWrites: 0, transitions: 0 });
  });

  it("first outreach send renews an existing follow and never creates B", async () => {
    const candidate = await readyCandidate();
    const ingested = await request("POST", `/api/discovery/candidates/${candidate.id}/ingest`, { confirmed: true });
    const uid = String((ingested.body.collaboration as Json).kol_uid);
    const colId = String((ingested.body.collaboration as Json).id);
    const now = nowIso();
    getConn().prepare(
      "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?,?,?,?)",
    ).run("ses_outreach", "outreach", now, now);
    getConn().prepare(
      `INSERT INTO drafts
       (id, session_id, collaboration_id, skill, from_addr, to_addr, cc, subject, body_en,
        body_zh_internal, lang_label, keep_stage, official_stage, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "dr_outreach",
      "ses_outreach",
      colId,
      "email_compose",
      "kol.lt@litime.example",
      "creator@example.com",
      "",
      "Hi — LiTime collab",
      "Hi, we would love to collaborate.",
      "内部译稿",
      "en",
      1,
      "INITIAL_CONTACT",
      "draft",
    );
    const sent = await sendDraft("dr_outreach");
    expect(sent.stage_changed).toBe(false);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid=?").get(uid)).toEqual({ n: 0 });
    expect(followingHas(uid, (await request("GET", "/api/home/following")).body)).toBe(false);

    const claimed = await request("POST", `/api/kols/${encodeURIComponent(uid)}/claim`, { confirmed: true });
    expect([200, 201]).toContain(claimed.status);
    getConn().prepare("UPDATE drafts SET sent_at=NULL, status='draft' WHERE id='dr_outreach'").run();
    const renewed = await sendDraft("dr_outreach");
    expect(renewed.stage_changed).toBe(false);
    const follow = getConn().prepare(
      "SELECT status, last_effective_mail_at FROM kol_follow_index WHERE kol_uid=?",
    ).get(uid) as { status?: string; last_effective_mail_at?: string };
    expect(follow.status).toBe("active");
    expect(String(follow.last_effective_mail_at || "")).toBeTruthy();
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid=?").get(uid)).toEqual({ n: 1 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get()).toEqual({ n: 0 });
  });
});
