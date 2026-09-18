import fs from "node:fs";
import os from "node:os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { DEMO_USER } from "../src/config.js";
import {
  claimFollow,
  followClock,
  ingestFormalProfile,
  isEffectiveCorrespondence,
  recordEffectiveCorrespondence,
} from "../src/host/kol-memory.js";
import { evaluateOwnershipRelease, releaseFollowOwnershipIfEligible } from "../src/gateway/ownership-release.js";
import { callMemoryStarryTool } from "../src/host/starry-connectors.js";
import * as recognize from "../src/tasks/recognize.js";
import { taskDefinition, taskDefinitions } from "../src/tasks/registry.js";
import type { Json } from "../src/types.js";

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

function seedProfile(kolUid: string, extra: Record<string, string> = {}) {
  return ingestFormalProfile({
    kol_uid: kolUid,
    handle: extra.handle || kolUid,
    display_name: extra.display_name || kolUid,
    platform: extra.platform || "YouTube",
    homepage_url: extra.homepage_url || `https://youtube.com/@${kolUid}`,
    followers: extra.followers || "12万",
    avg_plays: extra.avg_plays || "8000",
    engagement: extra.engagement || "0.04",
    direction: extra.direction || "户外",
    region: extra.region || "US",
    style: extra.style || "测评",
    public_stage: extra.public_stage || "INITIAL_CONTACT",
    ingest_source: "test",
  });
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kol-mem-"));
  process.env.LINGONG_DB = path.join(tmp, "mem.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
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
    seedProfile("KOL_A");
    claimFollow({
      kolUid: "KOL_A",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: "usr_other", name: "他人", brands: ["LT"] },
    });
    const res = await request("POST", "/api/kols/KOL_A/claim", { confirm: true, scope_brand: "LT" });
    expect(res.status).toBe(409);
    expect((res.body.detail as Json)?.code || res.body.code).toBe("follow_conflict");
  });

  it("no effective correspondence → no release", () => {
    seedProfile("KOL_GAP");
    const claimed = claimFollow({
      kolUid: "KOL_GAP",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    });
    const followId = String((claimed.follow as Json).follow_id);
    const row = getConn().prepare("SELECT * FROM kol_follow_index WHERE id=?").get(followId) as {
      last_effective_mail_at: string | null;
      employee_id: string;
      id: string;
    };
    expect(row.last_effective_mail_at).toBeNull();
    expect(followClock(row.last_effective_mail_at).countdown).toBe(false);
    const decision = evaluateOwnershipRelease(row as never, row.last_effective_mail_at);
    expect(decision).toMatchObject({ action: "skip", reason: "correspondence_incomplete" });
    const released = releaseFollowOwnershipIfEligible({
      db: getConn(),
      followId,
      expectedOwner: DEMO_USER.id,
      expectedLastAt: "",
      actor: "system",
    });
    expect(released.action).toBe("skip");
    expect((getConn().prepare("SELECT status FROM kol_follow_index WHERE id=?").get(followId) as { status: string }).status).toBe("active");
  });

  it("bounce / auto-reply / delivery-fail do not renew the 14-day clock", () => {
    seedProfile("KOL_B");
    const claimed = claimFollow({
      kolUid: "KOL_B",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    });
    const followId = String((claimed.follow as Json).follow_id);
    expect(isEffectiveCorrespondence({
      gatewaySuccess: true,
      direction: "inbound",
      subject: "Mail Delivery Failed: bounced",
      from: "mailer-daemon@google.com",
    })).toBe(false);
    const bounce = recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "inbound",
      gatewaySuccess: true,
      kind: "bounce",
      subject: "Undeliverable: your message",
      occurredAt: new Date().toISOString(),
    });
    expect(bounce.renewed).toBe(false);
    expect(bounce.effective).toBe(false);
    const auto = recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "inbound",
      gatewaySuccess: true,
      subject: "Automatic reply: out of office",
      occurredAt: new Date().toISOString(),
    });
    expect(auto.renewed).toBe(false);
    const fail = recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "outbound",
      gatewaySuccess: false,
      kind: "human",
      subject: "Hi",
      occurredAt: new Date().toISOString(),
    });
    expect(fail.renewed).toBe(false);
    const human = recordEffectiveCorrespondence({
      followId,
      kolUid: "KOL_B",
      direction: "outbound",
      gatewaySuccess: true,
      kind: "human",
      subject: "Hi, collaboration?",
      occurredAt: new Date().toISOString(),
    });
    expect(human.renewed).toBe(true);
    const row = getConn().prepare("SELECT last_effective_mail_at FROM kol_follow_index WHERE id=?").get(followId) as {
      last_effective_mail_at: string | null;
    };
    expect(row.last_effective_mail_at).toBeTruthy();
  });

  it("enqueue does not call recognizeTaskIntent", async () => {
    const spy = vi.spyOn(recognize, "recognizeTaskIntent");
    seedProfile("KOL_C");
    const res = await request("POST", "/api/home/kol-analyze/enqueue", {
      kol_uids: ["KOL_C"],
    });
    expect(res.status).toBe(201);
    expect(res.body.task_type).toBe("kol_analyze");
    expect(res.body.recognizeTaskIntent).toBe(false);
    expect(res.body.creates_session).toBe(false);
    expect(res.body.calls_model).toBe(false);
    expect(res.body.artifact_type).toBe("kol_analyze_brief");
    expect(spy).not.toHaveBeenCalled();
    const tooMany = await request("POST", "/api/home/kol-analyze/enqueue", {
      kol_uids: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    });
    expect(tooMany.status).toBe(400);
    expect((tooMany.body.detail as Json)?.code || tooMany.body.code).toBe("too_many_people");
    expect(spy).not.toHaveBeenCalled();
  });

  it("following does not leak others’ follows", async () => {
    seedProfile("KOL_MINE");
    seedProfile("KOL_THEIRS");
    claimFollow({
      kolUid: "KOL_MINE",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: DEMO_USER.id, name: DEMO_USER.name, brands: ["LT"] },
    });
    claimFollow({
      kolUid: "KOL_THEIRS",
      scopeBrand: "LT",
      confirm: true,
      actor: { id: "usr_other", name: "他人", brands: ["LT"] },
    });
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
    seedProfile("KOL_SEA");
    const res = await request("GET", "/api/home/pool");
    expect(res.status).toBe(200);
    expect(res.body.entry).toBe("memory");
    expect(res.body.creates_session).toBe(false);
    const sea = (res.body.items as Json[]).find((row) => row.kol_uid === "KOL_SEA");
    expect(sea).toMatchObject({
      kol_uid: "KOL_SEA",
      homepage_url: "https://youtube.com/@KOL_SEA",
      followers: "12万",
      pool_status: "open",
    });
    expect(sea).not.toHaveProperty("email");
    expect(sea).not.toHaveProperty("notes");
  });

  it("claim is L3, does not start the 14-day clock, dual-writes owner_name", async () => {
    seedProfile("KOL_CLAIM");
    getConn().prepare(
      `INSERT INTO collaborations
       (id,handle,display_name,brand,platform,followers,email,mailbox_from,lifecycle_id,conversation_id,
        stage_code,days_in_stage,notes,overdue,kol_uid)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_claim", "KOL_CLAIM", "KOL_CLAIM", "LT", "YouTube", "1", "secret@example.com", "from@example.com",
      "lc_claim", "conv_claim", "INITIAL_CONTACT", 2, "private notes", 0, "KOL_CLAIM",
    );
    const denied = await request("POST", "/api/kols/KOL_CLAIM/claim", { scope_brand: "LT" });
    expect(denied.status).toBe(422);
    const ok = await request("POST", "/api/kols/KOL_CLAIM/claim", { confirm: true, scope_brand: "LT" });
    expect([200, 201]).toContain(ok.status);
    const follow = ok.body.follow as Json;
    expect(follow.last_effective_mail_at).toBeNull();
    expect(follow.countdown).toBe(false);
    const owner = getConn().prepare("SELECT owner_name, stage_code FROM collaborations WHERE id='col_claim'").get() as {
      owner_name: string;
      stage_code: string;
    };
    expect(owner.owner_name).toBe(DEMO_USER.name);
    expect(owner.stage_code).toBe("INITIAL_CONTACT");
    const pool = await request("GET", "/api/home/pool");
    expect((pool.body.items as Json[]).some((row) => row.kol_uid === "KOL_CLAIM")).toBe(false);
  });

  it("manual release returns to sea without changing stage", async () => {
    seedProfile("KOL_REL");
    getConn().prepare(
      `INSERT INTO collaborations
       (id,handle,display_name,brand,platform,followers,email,mailbox_from,lifecycle_id,conversation_id,
        stage_code,days_in_stage,notes,overdue,kol_uid)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_rel", "KOL_REL", "KOL_REL", "LT", "YouTube", "1", "a@example.com", "from@example.com",
      "lc_rel", "conv_rel", "INTERESTED", 4, "", 0, "KOL_REL",
    );
    const claimed = await request("POST", "/api/kols/KOL_REL/claim", { confirm: true, scope_brand: "LT" });
    const followId = String((claimed.body.follow as Json).follow_id);
    const released = await request("POST", `/api/follows/${followId}/release`, { confirm: true });
    expect(released.status).toBe(200);
    expect(released.body.stage_unchanged).toBe("INTERESTED");
    const stage = getConn().prepare("SELECT owner_name, stage_code FROM collaborations WHERE id='col_rel'").get() as {
      owner_name: string | null;
      stage_code: string;
    };
    expect(stage.owner_name).toBeNull();
    expect(stage.stage_code).toBe("INTERESTED");
    const pool = await request("GET", "/api/home/pool");
    expect((pool.body.items as Json[]).some((row) => row.kol_uid === "KOL_REL")).toBe(true);
  });

  it("first outbound mail renews clock but does not create a follow", () => {
    seedProfile("KOL_MAIL");
    const before = recordEffectiveCorrespondence({
      kolUid: "KOL_MAIL",
      direction: "outbound",
      gatewaySuccess: true,
      kind: "human",
      subject: "hello",
    });
    expect(before.renewed).toBe(false);
    expect(before.reason).toBe("no_active_follow");
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM kol_follow_index WHERE kol_uid='KOL_MAIL' AND status='active'").get() as { n: number }).n).toBe(0);
  });

  it("registers kol_analyze skill with verb whitelist and forbids decrypt connector", async () => {
    const def = taskDefinition("kol_analyze");
    expect(def?.output).toBe("kol_analyze_brief");
    expect(def?.actions).toEqual([
      "claim_follow", "compose_draft", "confirm_send", "confirm_stage",
      "open_thread", "release_follow", "handoff", "retry_sync", "none",
    ]);
    expect(def?.mcp).not.toContain("starrykol.decryptKolContact");
    expect(taskDefinitions().some((row) => row.id === "kol_analyze")).toBe(true);
    await expect(callMemoryStarryTool("decryptKolContact", { kolUid: "x" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("hard-caps running+queued kol_analyze at 3", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) {
      getConn().prepare(
        `INSERT INTO work_items
         (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        `tsk_ana_${i}`, DEMO_USER.id, "kol_analyze", "分析", "test", i === 0 ? "running" : "queued",
        "normal", "kol_analyze", "lead", "{}", "{}", 1, now, now,
      );
    }
    const res = await request("POST", "/api/home/kol-analyze/enqueue", { kol_uids: ["KOL_X"] });
    expect(res.status).toBe(409);
    expect((res.body.detail as Json)?.code || res.body.code).toBe("analyze_cap");
  });
});
