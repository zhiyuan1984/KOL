import fs from "node:fs";
import os from "node:os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { DEMO_USER } from "../src/config.js";
import {
  applyFollowRelease,
  applyKolAnalyzeAction,
  claimFollow,
  deleteProfilesWithoutHomepage,
  followClock,
  ingestFormalProfile,
  isEffectiveCorrespondence,
  previewProfilesWithoutHomepage,
  recordEffectiveCorrespondence,
  recordFollowedMailMemory,
} from "../src/host/kol-memory.js";
import { enrichMissingPublicAvatars, setAvatarCrawlerFetch } from "../src/host/kol-avatar-enrichment.js";
import { assessPublicKolsWithJev, setKolJevFetch } from "../src/host/kol-jev-assessment.js";
import { runStub } from "../src/worker/stub.js";
import { HttpFail } from "../src/host/errors.js";
import { evaluateOwnershipRelease, releaseFollowOwnershipIfEligible } from "../src/gateway/ownership-release.js";
import { callMemoryStarryTool } from "../src/host/starry-connectors.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import * as recognize from "../src/tasks/recognize.js";
import * as scoringCriteria from "../src/host/kol-scoring-criteria.js";
import { taskDefinition, taskDefinitions } from "../src/tasks/registry.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

const avatarDns = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...importOriginal<typeof import("node:dns/promises")>(),
  lookup: avatarDns,
}));

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

type JevAssessmentReceipt = { status?: unknown; message?: unknown };

/** Await the owned asynchronous assessment to a real terminal receipt. */
async function waitForJevAssessmentReceipt(): Promise<{ status: number; body: Json }> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const receipt = await request("GET", "/api/home/pool/jev-assess");
    const body = receipt.body as JevAssessmentReceipt;
    if (body.status === "succeeded") return receipt;
    if (body.status === "failed") {
      throw new Error(`Jev assessment failed: ${String(body.message || "未提供失败详情")}`);
    }
    if (body.status !== "running") {
      throw new Error(`Jev assessment returned unexpected status: ${String(body.status)}`);
    }
    if (Date.now() >= deadline) {
      throw new Error("Jev assessment did not reach a terminal state within 10000ms");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

async function seedProfile(kolUid: string, extra: Record<string, string> = {}) {
  return (await ingestFormalProfile({
    kol_uid: kolUid,
    handle: extra.handle || kolUid,
    display_name: extra.display_name || kolUid,
    platform: extra.platform || "YouTube",
    homepage_url: extra.homepage_url || `https://youtube.com/@${kolUid}`,
    avatar_url: extra.avatar_url || "",
    followers: extra.followers || "12万",
    avg_plays: extra.avg_plays || "8000",
    engagement: extra.engagement || "0.04",
    direction: extra.direction || "户外",
    region: extra.region || "US",
    style: extra.style || "测评",
    public_stage: extra.public_stage || "INITIAL_CONTACT",
    ingest_source: "test",
  }));
}

beforeEach(async () => {
  // Public-page fetches are fixtures; DNS must be equally deterministic.
  avatarDns.mockReset();
  avatarDns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  await freshTestDatabase({ reclaimPrevious: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kol-mem-"));
  process.env.LINGONG_DB = path.join(tmp, "mem.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  (await resetConn());
  (await seedAll());
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
});

afterEach(async () => {
  setStarryKolClientFactory();
  setAvatarCrawlerFetch();
  setKolJevFetch();
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("kol follow/pool memory P0", () => {
  it("claim rejects not-in-index", async () => {
    const res = await request("POST", "/api/kols/KOL_MISSING/claim", { confirm: true, scope_brand: "LT" });
    expect(res.status).toBe(404);
    expect((res.body.detail as Json)?.code || res.body.code).toBe("profile_not_in_index");
  });

  it("claim conflict when another employee already holds the exclusive follow", async () => {
    (await seedProfile("KOL_A"));
    (await claimFollow({
      kolUid: "KOL_A",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: "usr_other", name: "他人", brands: ["LT"] },
    }));
    const res = await request("POST", "/api/kols/KOL_A/claim", { confirm: true, scope_brand: "LT" });
    expect(res.status).toBe(409);
    expect((res.body.detail as Json)?.code || res.body.code).toBe("follow_conflict");
  });

  it("concurrent duplicate confirmed claims reuse one active follow and one creation receipt", async () => {
    (await seedProfile("KOL_DENSITY_DOUBLE"));
    const attempts = await Promise.all([
      (await request("POST", "/api/kols/KOL_DENSITY_DOUBLE/claim", { confirm: true, scope_brand: "LT" })),
      (await request("POST", "/api/kols/KOL_DENSITY_DOUBLE/claim", { confirm: true, scope_brand: "LT" })),
    ]);
    expect(attempts.every((result) => [200, 201].includes(result.status))).toBe(true);
    // The same HTTP client must receive a real result for both the winning
    // command and its idempotent retry, not infer ownership from later reads.
    expect(attempts.every((result) => result.body.ok === true)).toBe(true);
    expect(new Set(attempts.map((result) => (result.body.follow as Json).follow_id)).size).toBe(1);
    expect(attempts.filter((result) => result.body.created === true)).toHaveLength(1);
    expect(attempts.filter((result) => result.body.reused === true)).toHaveLength(1);
    const active = (await getConn().query("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid=$1 AND status='active'",["KOL_DENSITY_DOUBLE"])).rows[0] as { n: unknown };
    expect(Number(active.n)).toBe(1);
  });

  it("release still requires explicit confirmation and a duplicate release cannot mutate the released receipt", async () => {
    (await seedProfile("KOL_DENSITY_RELEASE"));
    const claim = await request("POST", "/api/kols/KOL_DENSITY_RELEASE/claim", { confirm: true, scope_brand: "LT" });
    const followId = String((claim.body.follow as Json).follow_id);
    expect((await request("POST", `/api/follows/${followId}/release`, {})).status).toBe(422);
    const released = await request("POST", `/api/follows/${followId}/release`, { confirm: true });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ ok: true, action: "release", follow_id: followId });
    const before = (await getConn().query("SELECT status, data_version, released_at FROM kol_follow_index WHERE id=$1",[followId])).rows[0];
    expect((await request("POST", `/api/follows/${followId}/release`, { confirm: true })).status).toBe(404);
    expect((await getConn().query("SELECT status, data_version, released_at FROM kol_follow_index WHERE id=$1",[followId])).rows[0]).toEqual(before);
  });

  it("no effective correspondence → no release", async () => {
    (await seedProfile("KOL_GAP"));
    const claimed = (await claimFollow({
      kolUid: "KOL_GAP",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    }));
    const followId = String((claimed.follow as Json).follow_id);
    const row = (await getConn().query("SELECT * FROM kol_follow_index WHERE id=$1",[followId])).rows[0] as {
      last_effective_mail_at: string | null;
      employee_id: string;
      id: string;
    };
    expect(row.last_effective_mail_at).toBeNull();
    expect(followClock(row.last_effective_mail_at).countdown).toBe(false);
    const decision = evaluateOwnershipRelease(row as never, row.last_effective_mail_at);
    expect(decision).toMatchObject({ action: "skip", reason: "correspondence_incomplete" });
    const released = (await releaseFollowOwnershipIfEligible({
      db: getConn(),
      followId,
      expectedOwner: DEMO_USER.id,
      expectedLastAt: "",
      actor: "system",
    }));
    expect(released.action).toBe("skip");
    expect(((await getConn().query("SELECT status FROM kol_follow_index WHERE id=$1",[followId])).rows[0] as { status: string }).status).toBe("active");
  });

  it("bounce / auto-reply / delivery-fail do not renew the 14-day clock", async () => {
    (await seedProfile("KOL_B"));
    const claimed = (await claimFollow({
      kolUid: "KOL_B",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    }));
    const followId = String((claimed.follow as Json).follow_id);
    expect(isEffectiveCorrespondence({
      gatewaySuccess: true,
      direction: "inbound",
      subject: "Mail Delivery Failed: bounced",
      from: "mailer-daemon@google.com",
    })).toBe(false);
    const bounce = (await recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "inbound",
      gatewaySuccess: true,
      kind: "bounce",
      subject: "Undeliverable: your message",
      occurredAt: new Date().toISOString(),
    }));
    expect(bounce.renewed).toBe(false);
    expect(bounce.effective).toBe(false);
    const auto = (await recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "inbound",
      gatewaySuccess: true,
      subject: "Automatic reply: out of office",
      occurredAt: new Date().toISOString(),
    }));
    expect(auto.renewed).toBe(false);
    const fail = (await recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "outbound",
      gatewaySuccess: false,
      kind: "human",
      subject: "Hi",
      occurredAt: new Date().toISOString(),
    }));
    expect(fail.renewed).toBe(false);
    const human = (await recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "outbound",
      gatewaySuccess: true,
      kind: "human",
      subject: "Hi, collaboration?",
      occurredAt: new Date().toISOString(),
    }));
    expect(human.renewed).toBe(true);
    const row = (await getConn().query("SELECT last_effective_mail_at FROM kol_follow_index WHERE id=$1",[followId])).rows[0] as {
      last_effective_mail_at: string | null;
    };
    expect(row.last_effective_mail_at).toBeTruthy();
  });

  it("enqueue does not call recognizeTaskIntent", async () => {
    const spy = vi.spyOn(recognize, "recognizeTaskIntent");
    (await seedProfile("KOL_C"));
    const res = await request("POST", "/api/home/kol-analyze/enqueue", {
      kol_uids: ["KOL_C"],
    });
    expect(res.status).toBe(201);
    expect(res.body.task_type).toBe("kol_analyze");
    expect(res.body.recognizeTaskIntent).toBe(false);
    expect(res.body.kind).toBe("command");
    expect(res.body.creates_session).toBe(false);
    expect(res.body.calls_model).toBe(false);
    expect(res.body.artifact_type).toBe("kol_analyze_brief");
    expect(spy).not.toHaveBeenCalled();
    const fullSelection = await request("POST", "/api/home/kol-analyze/enqueue", {
      kol_uids: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    });
    expect(fullSelection.status).toBe(201);
    expect(fullSelection.body.people).toHaveLength(9);
    expect(spy).not.toHaveBeenCalled();
  });

  it("following does not leak others’ follows", async () => {
    (await seedProfile("KOL_MINE"));
    (await seedProfile("KOL_THEIRS"));
    (await claimFollow({
      kolUid: "KOL_MINE",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    }));
    (await claimFollow({
      kolUid: "KOL_THEIRS",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: "usr_other", name: "他人", brands: ["LT"] },
    }));
    const res = await request("GET", "/api/home/following");
    expect(res.status).toBe(200);
    expect(res.body.creates_session).toBe(false);
    expect(res.body.calls_model).toBe(false);
    const kols = res.body.kols as Json[];
    const uids = kols.map((row) => String(row.kol_uid));
    expect(uids).toContain("KOL_MINE");
    expect(uids).not.toContain("KOL_THEIRS");
    expect(kols.every((row) => row.employee_id === DEMO_USER.id)).toBe(true);
    expect(JSON.stringify(kols)).not.toMatch(/email|quote|contract|notes/);
  });

  it("GET pool is memory, public fields only, hides private", async () => {
    (await seedProfile("KOL_SEA", { avatar_url: "https://yt3.ggpht.com/kol-sea.jpg" }));
    const res = await request("GET", "/api/home/pool");
    expect(res.status).toBe(200);
    expect(res.body.entry).toBe("memory");
    expect(res.body.creates_session).toBe(false);
    const sea = (res.body.items as Json[]).find((row) => row.kol_uid === "KOL_SEA");
    expect(sea).toMatchObject({
      kol_uid: "KOL_SEA",
      homepage_url: "https://youtube.com/@KOL_SEA",
      avatar_url: "https://yt3.ggpht.com/kol-sea.jpg",
      followers: "12万",
      pool_status: "open",
    });
    expect(sea).not.toHaveProperty("email");
    expect(sea).not.toHaveProperty("notes");
  });

  it("explicit pool sync projects allow-listed Starry profiles into the public index", async () => {
    const calls: string[] = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args?: Json) {
        calls.push(name);
        if (name === "pageKolProfiles") {
          return {
            list: [{
              kolUid: "KOL_SYNCED",
              kolName: "同步后的红人",
              platform: "YouTube",
              followers: 240000,
              avgVideoViews10: 50000,
              engagementRate: "4.8%",
              countryName: "US",
              nicheTagsText: "Outdoor",
            }, {
              // 远端契约的写法：粉丝只给「万」、地区只有 audienceGeo 对象、互动只有帖子口径、
              // 句柄在 accountHandle 而不是 kolName。
              kolUid: "KOL_CONTRACT",
              kolName: "@DailyTested",
              accountHandle: "DailyTested",
              platform: "YouTube",
              followerCountTenThousands: 82,
              avgVideoViews10: 1871,
              avgPostEngagementRate10: "3.1%",
              audienceGeo: { US: "45%", CN: "30%" },
              nicheTagsText: "Outdoor",
            }, {
              // 远端只有句柄、没有别的字段：句柄兜底 + 计入「缺公开指标」。
              kolUid: "KOL_HANDLE_ONLY",
              accountHandle: "handle_only",
            }],
            total: 3,
          };
        }
        if (name === "getKolProfileDetail") {
          const uid = String((args as Record<string, unknown> | undefined)?.kolUid || "KOL_SYNCED");
          return uid === "KOL_SYNCED"
            ? { kolUid: uid, homepageUrl: "https://youtube.com/@synced" }
            : { kolUid: uid, homepageUrl: "https://youtube.com/@dailytested" };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));

    const accepted = await request("POST", "/api/home/pool/sync", {});
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({
      entry: "command",
      kind: "command",
      creates_session: false,
      creates_turn: false,
      calls_model: false,
      accepted: true,
      status: "running",
    });
    await expect.poll(async () => (await request("GET", "/api/home/pool/sync")).body.status).toBe("succeeded");
    const response = await request("GET", "/api/home/pool/sync");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, status: "succeeded", count: 3, tool: "pageKolProfiles" });
    // 体检：三条里只有 KOL_HANDLE_ONLY 缺公开指标（其余两条粉丝/均播/互动/方向都齐）。
    expect(response.body.missing_metrics).toBe(1);
    expect(String(response.body.message)).toContain("缺公开指标");
    const profile = (response.body.items as Json[]).find((row) => row.kol_uid === "KOL_SYNCED");
    expect(profile).toMatchObject({
      kol_uid: "KOL_SYNCED",
      display_name: "同步后的红人",
      homepage_url: "https://youtube.com/@synced",
      pool_status: "open",
    });
    expect(profile).not.toHaveProperty("email");
    // 远端契约键必须落成可读口径：万单位、audienceGeo 对象取主要地区、帖子互动兜底、accountHandle 当句柄。
    const contract = (response.body.items as Json[]).find((row) => row.kol_uid === "KOL_CONTRACT");
    expect(contract).toMatchObject({
      kol_uid: "KOL_CONTRACT",
      handle: "@DailyTested",
      followers: "82万",
      avg_plays: "1871",
      engagement: "3.1%",
      region: "US",
      direction: "Outdoor",
      homepage_url: "https://youtube.com/@dailytested",
    });
    // 评分状态要如实分类（这条同步来的档案从未评过）。
    expect(contract?.assessment_state).toBe("unscored");
    // 远端只给 accountHandle 时，句柄兜底要生效；缺指标的档案照样进公海，但状态如实。
    const handleOnly = (response.body.items as Json[]).find((row) => row.kol_uid === "KOL_HANDLE_ONLY");
    expect(handleOnly).toMatchObject({ handle: "handle_only", display_name: "handle_only", assessment_state: "unscored" });
    expect(calls).toEqual([
      "pageKolProfiles", "getKolProfileDetail", "getKolProfileDetail", "getKolProfileDetail",
    ]);
  });

  it("enriches a missing avatar from public homepage metadata without reading private profile fields", async () => {
    (await seedProfile("KOL_AVATAR", {
      homepage_url: "https://example.com/creator",
      avatar_url: "",
    }));
    let requested = "";
    setAvatarCrawlerFetch(async (input) => {
      requested = String(input);
      return new Response('<html><head><meta property="og:image" content="/avatar.jpg"></head></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const result = await enrichMissingPublicAvatars({ limit: 1 });
    expect(result).toMatchObject({ checked: 1, updated: 1, failed: 0 });
    expect(requested).toBe("https://example.com/creator");
    const row = (await getConn().query("SELECT avatar_url, avatar_checked_at, avatar_error FROM kol_profile_index WHERE kol_uid=$1",["KOL_AVATAR"])).rows[0] as {
      avatar_url: string; avatar_checked_at: string; avatar_error: string;
    };
    expect(row.avatar_url).toBe("https://example.com/avatar.jpg");
    expect(row.avatar_checked_at).toBeTruthy();
    expect(row.avatar_error).toBe("");
  });

  it("accepts a bounded multi-megabyte public channel page when its avatar metadata appears late", async () => {
    (await seedProfile("KOL_AVATAR_LATE", {
      homepage_url: "https://example.com/late-channel",
      avatar_url: "",
    }));
    setAvatarCrawlerFetch(async () => new Response('<meta property="og:image" content="https://example.com/late-avatar.jpg">', {
      status: 200,
      headers: { "content-type": "text/html", "content-length": "2500000" },
    }));
    const result = await enrichMissingPublicAvatars({ limit: 1 });
    expect(result).toMatchObject({ checked: 1, updated: 1, failed: 0 });
    expect((await getConn().query("SELECT avatar_url FROM kol_profile_index WHERE kol_uid=$1",["KOL_AVATAR_LATE"])).rows[0]).toMatchObject({
      avatar_url: "https://example.com/late-avatar.jpg",
    });
  });

  it("rejects a public-looking avatar homepage that resolves to a private address before fetching", async () => {
    (await seedProfile("KOL_AVATAR_PRIVATE", { homepage_url: "https://example.com/private" }));
    avatarDns.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);
    const fetcher = vi.fn();
    setAvatarCrawlerFetch(fetcher);
    const result = await enrichMissingPublicAvatars({ limit: 1 });
    expect(result).toMatchObject({ checked: 1, updated: 0, failed: 1 });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await getConn().query("SELECT avatar_url, avatar_error FROM kol_profile_index WHERE kol_uid=$1",["KOL_AVATAR_PRIVATE"])).rows[0])
      .toMatchObject({ avatar_url: "", avatar_error: "主页地址未解析为公开网络" });
  });

  it("keeps active follows out of local missing-homepage cleanup and locks the preview count", async () => {
    (await seedProfile("KOL_DELETE"));
    (await seedProfile("KOL_KEEP"));
    (await getConn().query("UPDATE kol_profile_index SET homepage_url='' WHERE kol_uid IN ($1,$2)",["KOL_DELETE","KOL_KEEP"]));
    (await claimFollow({
      kolUid: "KOL_KEEP",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    }));
    expect((await previewProfilesWithoutHomepage())).toMatchObject({
      scope: "public_pool_only",
      candidate_count: 1,
      protected_active_follows: 1,
    });
    (await expect((async () => (deleteProfilesWithoutHomepage({ expectedCount: 1, confirm: false })))()).rejects.toThrow(/确认/));
    (await expect((async () => (deleteProfilesWithoutHomepage({ expectedCount: 2, confirm: true })))()).rejects.toThrow(/数量已变化/));
    expect((await deleteProfilesWithoutHomepage({ expectedCount: 1, confirm: true }))).toMatchObject({ ok: true, deleted: 1 });
    expect((await getConn().query("SELECT kol_uid FROM kol_profile_index WHERE kol_uid=$1",["KOL_DELETE"])).rows[0]).toBeUndefined();
    expect((await getConn().query("SELECT kol_uid FROM kol_profile_index WHERE kol_uid=$1",["KOL_KEEP"])).rows[0]).toBeTruthy();
  });

  it("records bounded Jev potential and risk scores as advisory public index metadata", async () => {
    (await seedProfile("KOL_JEV", { homepage_url: "https://example.com/jev", followers: "240000", avg_plays: "50000" }));
    const priorKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    let state = "";
    setKolJevFetch(async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { state?: { public_profile?: string } } : {};
      state = String(body.state?.public_profile || "");
      return new Response(JSON.stringify({
        model: "typesafe/jev-1.13",
        answers: {
          potential: { type: "choice", choice: "high_potential", confidence: 0.91 },
          risk: { type: "choice", choice: "high_risk", confidence: 0.83 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const result = await assessPublicKolsWithJev({ limit: 1 });
      expect(result).toMatchObject({ assessed: 1, high_potential: 1, high_risk: 1, failed: 0 });
      expect(state).toContain("KOL_JEV");
      expect(state).not.toMatch(/email|quote|contract|notes/i);
      const row = (await getConn().query("SELECT potential_score, potential_confidence, risk_score, risk_confidence, assessment_model FROM kol_profile_index WHERE kol_uid=$1",["KOL_JEV"])).rows[0] as { potential_score: unknown; potential_confidence: unknown; risk_score: unknown; risk_confidence: unknown; assessment_model: string };
      // PostgreSQL 桥接把数值列以字符串返回（同 34bd84a 口径），按数值归一后比较。
      expect(Number(row.potential_score)).toBe(85);
      expect(Number(row.risk_score)).toBe(85);
      expect(row.assessment_model).toBe("jev-1.13");
      expect(Number(row.potential_confidence)).toBeCloseTo(0.91);
      expect(Number(row.risk_confidence)).toBeCloseTo(0.83);
    } finally {
      if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = priorKey;
    }
  });

  it("Jev 评分把 AI 发现条件作为评分口径提交给模型并如实回执", async () => {
    (await seedProfile("KOL_CRIT", { followers: "240000", avg_plays: "50000" }));
    const priorKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    let seen = "";
    setKolJevFetch(async (_input, init) => {
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { state?: { public_profile?: string; target_criteria?: string } }
        : {};
      seen = `${body.state?.public_profile || ""}
${body.state?.target_criteria || ""}`;
      return new Response(JSON.stringify({
        model: "typesafe/jev-1.13",
        answers: {
          potential: { type: "choice", choice: "high_potential", confidence: 0.9 },
          risk: { type: "choice", choice: "normal", confidence: 0.9 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const accepted = await request("POST", "/api/home/pool/jev-assess", {
        kol_uids: ["KOL_CRIT"],
        criteria: {
          platforms: ["youtube"],
          region: "global_en",
          directions: ["户外露营", "户外能源"],
          keywords: ["camping", "portable power station"],
          min_followers: 10000,
          max_followers: 2000000,
          min_avg_plays_10: 5000,
          expect_count: 30,
          // 超限与非法值要在服务端被收紧，不能原样进模型。
          directionsExtra: "ignored",
        },
      });
      expect(accepted.status).toBe(202);
      expect(String(accepted.body.criteria_summary)).toContain("关键词 camping, portable power station");
      const receipt = await waitForJevAssessmentReceipt();
      expect(receipt.body).toMatchObject({
        ok: true,
        status: "succeeded",
        result: { eligible: 1, assessed: 1, high_potential: 1, high_risk: 0, failed: 0 },
      });
      // 回执必须写明口径，否则不同条件下的分看起来一样。
      expect(String(receipt.body.message)).toContain("评分口径：");
      expect(String(receipt.body.message)).toContain("近10条均播 ≥5000");
      // 模型侧：条件与公开资料一起提交。
      expect(seen).toContain("target_criteria");
      expect(seen).toContain("portable power station");
      expect(seen).toContain("2000000");
      expect(seen).toContain("全球英文".length ? "global_en" : "");
      const row = (await getConn().query("SELECT assessment_criteria, potential_score FROM kol_profile_index WHERE kol_uid=$1",["KOL_CRIT"])).rows[0] as { assessment_criteria: string; potential_score: unknown };
      expect(Number(row.potential_score)).toBe(85);
      expect(row.assessment_criteria).toContain("平台 youtube");
    } finally {
      if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = priorKey;
    }
  });

  it("explicit null scoring criteria never inherit an older discovery scope", async () => {
    (await seedProfile("KOL_NO_CRITERIA"));
    const latest = vi.spyOn(scoringCriteria, "latestDiscoveryCriteria").mockResolvedValue(
      scoringCriteria.normalizeScoringCriteria({ platforms: ["youtube"], keywords: ["old scope"] }),
    );
    const priorKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    let seen = "";
    setKolJevFetch(async (_input, init) => {
      seen = String(init?.body || "");
      return new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {
        potential: { type: "choice", choice: "high_potential", confidence: 0.9 },
        risk: { type: "choice", choice: "normal", confidence: 0.9 },
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const accepted = await request("POST", "/api/home/pool/jev-assess", { kol_uids: ["KOL_NO_CRITERIA"], criteria: null });
      expect(accepted.status).toBe(202);
      expect(accepted.body.criteria_summary).toBe("");
      const receipt = await waitForJevAssessmentReceipt();
      expect(receipt.body).toMatchObject({
        ok: true,
        status: "succeeded",
        result: { eligible: 1, assessed: 1, failed: 0, criteria_summary: "" },
      });
      expect(latest).not.toHaveBeenCalled();
      const submitted = JSON.parse(seen) as { state?: { target_criteria?: unknown } };
      expect(submitted.state?.target_criteria).toBeUndefined();
      expect(seen).not.toContain("old scope");
    } finally {
      if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = priorKey;
    }
  });

  it("scores only the requested kol_uids and still writes the KOL memory columns", async () => {
    (await seedProfile("KOL_TARGET"));
    (await seedProfile("KOL_OTHER"));
    const priorKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const seen: string[] = [];
    setKolJevFetch(async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { state?: { public_profile?: string } } : {};
      seen.push(String(body.state?.public_profile || ""));
      return new Response(JSON.stringify({
        model: "typesafe/jev-1.13",
        answers: {
          potential: { type: "choice", choice: "watch", confidence: 0.9 },
          risk: { type: "choice", choice: "normal", confidence: 0.9 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const result = await assessPublicKolsWithJev({ kol_uids: ["KOL_TARGET", "KOL_TARGET", ""] });
      expect(result).toMatchObject({ eligible: 1, assessed: 1, failed: 0 });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain("KOL_TARGET");
      const scored = (await getConn().query("SELECT assessed_at FROM kol_profile_index WHERE kol_uid=$1",["KOL_TARGET"])).rows[0] as { assessed_at: string | null };
      expect(scored.assessed_at).toBeTruthy();
      const untouched = (await getConn().query("SELECT assessed_at FROM kol_profile_index WHERE kol_uid=$1",["KOL_OTHER"])).rows[0] as { assessed_at: string | null };
      expect(untouched.assessed_at ?? null).toBeNull();
    } finally {
      if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = priorKey;
    }
  });

  it("claim is L3, does not start the 14-day clock, dual-writes owner_name", async () => {
    (await seedProfile("KOL_CLAIM"));
    (await getConn().query("INSERT INTO collaborations\n       (id,handle,display_name,brand,platform,followers,email,mailbox_from,lifecycle_id,conversation_id,\n        stage_code,days_in_stage,notes,overdue,kol_uid)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",["col_claim","KOL_CLAIM","KOL_CLAIM","LT","YouTube","1","secret@example.com","from@example.com","lc_claim","conv_claim","INITIAL_CONTACT",2,"private notes",0,"KOL_CLAIM"]));
    const denied = await request("POST", "/api/kols/KOL_CLAIM/claim", { scope_brand: "LT" });
    expect(denied.status).toBe(422);
    const ok = await request("POST", "/api/kols/KOL_CLAIM/claim", { confirm: true, scope_brand: "LT" });
    expect([200, 201]).toContain(ok.status);
    const follow = ok.body.follow as Json;
    expect(follow.last_effective_mail_at).toBeNull();
    expect(follow.countdown).toBe(false);
    const owner = (await getConn().query("SELECT owner_name, stage_code FROM collaborations WHERE id='col_claim'",[])).rows[0] as {
      owner_name: string;
      stage_code: string;
    };
    expect(owner.owner_name).toBe(DEMO_USER.name);
    expect(owner.stage_code).toBe("INITIAL_CONTACT");
    const pool = await request("GET", "/api/home/pool");
    expect((pool.body.items as Json[]).some((row) => row.kol_uid === "KOL_CLAIM")).toBe(false);
  });

  it("manual release returns to sea without changing stage", async () => {
    (await seedProfile("KOL_REL"));
    (await getConn().query("INSERT INTO collaborations\n       (id,handle,display_name,brand,platform,followers,email,mailbox_from,lifecycle_id,conversation_id,\n        stage_code,days_in_stage,notes,overdue,kol_uid)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",["col_rel","KOL_REL","KOL_REL","LT","YouTube","1","a@example.com","from@example.com","lc_rel","conv_rel","INTERESTED",4,"",0,"KOL_REL"]));
    const claimed = await request("POST", "/api/kols/KOL_REL/claim", { confirm: true, scope_brand: "LT" });
    const followId = String((claimed.body.follow as Json).follow_id);
    const released = await request("POST", `/api/follows/${followId}/release`, { confirm: true });
    expect(released.status).toBe(200);
    expect(released.body.stage_unchanged).toBe("INTERESTED");
    const stage = (await getConn().query("SELECT owner_name, stage_code FROM collaborations WHERE id='col_rel'",[])).rows[0] as {
      owner_name: string | null;
      stage_code: string;
    };
    expect(stage.owner_name).toBeNull();
    expect(stage.stage_code).toBe("INTERESTED");
    const pool = await request("GET", "/api/home/pool");
    expect((pool.body.items as Json[]).some((row) => row.kol_uid === "KOL_REL")).toBe(true);
    expect((pool.body.items as Json[]).find((row) => row.kol_uid === "KOL_REL")?.public_stage).toBe("INITIAL_CONTACT");
  });

  it("automatic 14-day release exposes only the public pool status", async () => {
    (await seedProfile("KOL_OVERDUE"));
    const claimed = (await claimFollow({
      kolUid: "KOL_OVERDUE",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    }));
    const followId = String((claimed.follow as Json).follow_id);
    const follow = (await getConn().query("SELECT * FROM kol_follow_index WHERE id=$1",[followId])).rows[0] as Record<string, unknown>;
    (await applyFollowRelease(getConn(), follow, "cron", "ownership-release"));

    const pool = await request("GET", "/api/home/pool");
    expect(pool.status).toBe(200);
    const row = (pool.body.items as Json[]).find((item) => item.kol_uid === "KOL_OVERDUE");
    expect(row?.public_stage).toBe("14天无回复");
    expect(row).not.toHaveProperty("release_reason");
    expect(row).not.toHaveProperty("latest_release_reason");
    expect(row).not.toHaveProperty("last_effective_mail_at");
  });

  it("first outbound mail renews clock but does not create a follow", async () => {
    (await seedProfile("KOL_MAIL"));
    const before = (await recordEffectiveCorrespondence({
      kolUid: "KOL_MAIL",
      direction: "outbound",
      gatewaySuccess: true,
      kind: "human",
      subject: "hello",
    }));
    expect(before.renewed).toBe(false);
    expect(before.reason).toBe("no_active_follow");
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid='KOL_MAIL' AND status='active'",[])).rows[0] as { n: unknown }).n)).toBe(0);
  });

  it("following projects local history and refreshes it incrementally without a session", async () => {
    (await seedProfile("KOL_HISTORY", { handle: "HistoryCreator", public_stage: "INITIAL_CONTACT" }));
    const claimed = (await claimFollow({
      kolUid: "KOL_HISTORY",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    }));
    const followId = String((claimed.follow as Json).follow_id);
    const occurredAt = "2026-09-24T08:00:00.000Z";

    const first = (await recordFollowedMailMemory({
      followId,
      kolUid: "KOL_HISTORY",
      conversationId: "conv-history",
      subject: "Re: LiTime partnership",
      summary: "I am interested in the collaboration. Please share the next steps.",
      direction: "inbound",
      occurredAt,
      gatewaySuccess: true,
      sourceVersion: "test:one",
    }));
    expect(first).toMatchObject({ recorded: true, effective: true, follow_id: followId });
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM kol_thread_summary WHERE follow_id=$1",[followId])).rows[0] as { n: unknown }).n)).toBe(1);

    const firstRead = await request("GET", "/api/home/following");
    expect(firstRead.status).toBe(200);
    expect(firstRead.body.creates_session).toBe(false);
    const firstRow = (firstRead.body.kols as Json[]).find((row) => row.kol_uid === "KOL_HISTORY") as Json;
    expect(firstRow).toMatchObject({
      follow_id: followId,
      latest_correspondence: { thread_id: "conv-history", valid: true },
      clock_14d: { countdown: false },
    });
    expect(((firstRow.mail_threads as Json[]) || [])[0]).toMatchObject({
      conversation_id: "conv-history",
      last_snippet: expect.stringContaining("interested"),
    });

    (await recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_HISTORY",
      direction: "inbound",
      occurredAt,
      gatewaySuccess: true,
      subject: "Re: LiTime partnership",
    }));
    (await recordFollowedMailMemory({
      followId,
      kolUid: "KOL_HISTORY",
      conversationId: "conv-history",
      subject: "Re: LiTime partnership",
      summary: "I can send my rate card this week.",
      direction: "inbound",
      occurredAt: "2026-09-25T08:00:00.000Z",
      gatewaySuccess: true,
      sourceVersion: "test:two",
    }));

    const incrementalRead = await request("GET", "/api/home/following");
    const incrementalRow = (incrementalRead.body.kols as Json[]).find((row) => row.kol_uid === "KOL_HISTORY") as Json;
    expect(incrementalRow).toMatchObject({
      clock_14d: { countdown: true, last_effective_mail_at: occurredAt },
      latest_correspondence: { summary: expect.stringContaining("rate card") },
    });
    expect(JSON.stringify(incrementalRow)).not.toMatch(/email|quote|contract|notes/);
  });

  it("batches each follow's own thread memory without crossing rows", async () => {
    // 名单读取改成按批取线程记忆后，最容易犯的错是分组串行：把别人的线程挂到这一行上。
    const seeded = (await Promise.all([
      { uid: "KOL_BATCH_A", conversation: "conv-batch-a", summary: "我只想聊 A 的方案" },
      { uid: "KOL_BATCH_B", conversation: "conv-batch-b", summary: "我只想聊 B 的方案" },
      { uid: "KOL_BATCH_C", conversation: "conv-batch-c", summary: "我只想聊 C 的方案" },
    ].map(async (row, index) => {
      (await seedProfile(row.uid, { handle: `Batch${row.uid.slice(-1)}`, public_stage: "INITIAL_CONTACT" }));
      const claimed = (await claimFollow({
        kolUid: row.uid,
        scopeBrand: "LT",
        confirm: true,
        actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
      }));
      const followId = String((claimed.follow as Json).follow_id);
      (await recordFollowedMailMemory({
        followId,
        kolUid: row.uid,
        conversationId: row.conversation,
        subject: `Re: ${row.uid}`,
        summary: row.summary,
        direction: "inbound",
        occurredAt: `2026-09-2${index + 2}T08:00:00.000Z`,
        gatewaySuccess: true,
        sourceVersion: `test:batch:${index}`,
      }));
      return { ...row, followId };
    })));

    const read = await request("GET", "/api/home/following");
    expect(read.status).toBe(200);
    for (const row of seeded) {
      const payload = (read.body.kols as Json[]).find((item) => item.kol_uid === row.uid) as Json;
      expect(payload.follow_id).toBe(row.followId);
      expect(payload.latest_correspondence).toMatchObject({ thread_id: row.conversation });
      expect(String((payload.latest_correspondence as Json).summary)).toContain(row.summary.slice(-1));
      const threads = (payload.mail_threads as Json[]) || [];
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({ conversation_id: row.conversation, subject: `Re: ${row.uid}` });
    }
  });

  it("registers kol_analyze skill with verb whitelist and forbids decrypt connector", async () => {
    const def = (await taskDefinition("kol_analyze"));
    expect(def?.output).toBe("kol_analyze_brief");
    expect(def?.actions).toEqual([
      "claim_follow", "compose_draft", "confirm_send", "confirm_stage",
      "open_thread", "release_follow", "handoff", "retry_sync", "none",
    ]);
    expect(def?.mcp).not.toContain("starrykol.decryptKolContact");
    expect((await taskDefinitions()).some((row) => row.id === "kol_analyze")).toBe(true);
    await expect(callMemoryStarryTool("decryptKolContact", { kolUid: "x" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("hard-caps running+queued kol_analyze at 3", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) {
      (await getConn().query("INSERT INTO tickets\n         (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)\n         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[`tsk_ana_${i}`,DEMO_USER.id,"kol_analyze","分析","test",i === 0 ? "running" : "queued","normal","kol_analyze","lead","{}","{}",1,now,now]));
    }
    const res = await request("POST", "/api/home/kol-analyze/enqueue", { kol_uids: ["KOL_X"] });
    expect(res.status).toBe(409);
    expect((res.body.detail as Json)?.code || res.body.code).toBe("analyze_cap");
  });

  it("illegal kol_analyze verb fails the task at runtime and is not applied", async () => {
    (await seedProfile("KOL_VERB"));
    const now = new Date().toISOString();
    const insertItem = async (id: string, status = "queued") => {
      (await getConn().query("INSERT INTO tickets\n         (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)\n         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[id,DEMO_USER.id,"kol_analyze","分析","test",status,"normal","kol_analyze","lead","{}","{}",1,now,now]));
    };
    (await insertItem("tsk_verb_illegal", "running"));
    (await getConn().query("INSERT INTO task_runs (id,work_item_id,status,input,entities,created_at)\n       VALUES ($1,$2,$3,$4,$5,$6)",["run_verb_illegal","tsk_verb_illegal","running","{}","{}",now]));

    const draftsBefore = Number(((await getConn().query("SELECT COUNT(*) AS n FROM drafts",[])).rows[0] as { n: number }).n);
    const followsBefore = Number(((await getConn().query("SELECT COUNT(*) AS n FROM kol_follow_index",[])).rows[0] as { n: number }).n);

    const res = await request("POST", "/api/tasks/tsk_verb_illegal/actions", {
      verb: "decrypt_contact",
      artifact: { type: "kol_analyze_brief", recommended_actions: ["decrypt_contact"] },
    });
    expect(res.status).toBe(422);
    const detail = ((res.body.detail as Json) || res.body) as Json;
    expect(detail.code).toBe("illegal_kol_analyze_verb");
    expect(detail.applied).toBe(false);
    expect(detail.failed).toBe(true);

    const item = (await getConn().query("SELECT status FROM tickets WHERE id='tsk_verb_illegal'",[])).rows[0] as { status: string };
    expect(item.status).toBe("failed");
    const run = (await getConn().query("SELECT status, error FROM task_runs WHERE id='run_verb_illegal'",[])).rows[0] as {
      status: string;
      error: string;
    };
    expect(run.status).toBe("failed");
    expect(String(run.error)).toContain("illegal_kol_analyze_verb");
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM drafts",[])).rows[0] as { n: number }).n)).toBe(draftsBefore);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM kol_follow_index",[])).rows[0] as { n: number }).n)).toBe(followsBefore);

    (await insertItem("tsk_verb_worker", "running"));
    await expect(runStub("ses_verb", "kol_analyze", "分析", {
      work_item_id: "tsk_verb_worker",
      actions: ["send_mail"],
    })).rejects.toBeInstanceOf(HttpFail);
    expect(
      ((await getConn().query("SELECT status FROM tickets WHERE id='tsk_verb_worker'",[])).rows[0] as { status: string }).status,
    ).toBe("failed");

    (await insertItem("tsk_verb_legal", "waiting"));
    const legal = await request("POST", "/api/home/kol-analyze/actions", {
      work_item_id: "tsk_verb_legal",
      verb: "claim_follow",
    });
    expect(legal.status).toBe(200);
    expect(legal.body.applied).toBe(false);
    expect(legal.body.failed).toBe(false);
    expect(
      ((await getConn().query("SELECT status FROM tickets WHERE id='tsk_verb_legal'",[])).rows[0] as { status: string }).status,
    ).toBe("waiting");
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM kol_follow_index",[])).rows[0] as { n: number }).n)).toBe(followsBefore);

    (await expect((async () => (applyKolAnalyzeAction({
      workItemId: "tsk_verb_legal",
      verb: "starry_stage",
      artifact: { type: "kol_analyze_brief", actions: ["starry_stage"] },
    })))()).rejects.toThrow(HttpFail));
    expect(
      ((await getConn().query("SELECT status FROM tickets WHERE id='tsk_verb_legal'",[])).rows[0] as { status: string }).status,
    ).toBe("failed");
  });
});
