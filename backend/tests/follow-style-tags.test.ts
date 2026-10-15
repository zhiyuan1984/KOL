import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { mapUser, tokenDigest, withScopedUser, type AppUser } from "../src/auth.js";
import { drainBackgroundWork } from "../src/background-work.js";
import { saveStarryBinding } from "../src/host/starry-bind.js";
import { publishJourneyForCollaboration } from "../src/host/kol-journey.js";
import { subscribeSession } from "../src/host/session-events.js";
import { pgVisibleSkillIdsForUser } from "../src/postgres/auth-pg.js";
import { persistStarryOwnership } from "../src/postgres/kol-source-authority.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { createAgentBinding, syncUserOrganization } from "../src/runtime/organization-tree.js";
import { getAgentSkills, setAgentSkill } from "../src/runtime/store.js";
import { waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import {
  FOLLOW_STYLE_PRESETS,
  isFollowStyleTagCommand,
  mergeFollowStyleTags,
  normalizeFollowStyleTags,
  parseFollowStyleTagCommand,
  suggestFollowStyleTags,
} from "../src/follow-style-tags.js";
import { composeFactsFromContext, composePreviewPrompt } from "../src/host/compose-loop.js";
import { buildHomeBoard } from "../src/host/home-board.js";
import { resetDemoRuntimeState, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";
import { authenticatedTestApp, seedPublishedAgent } from "./fixtures/runtime-auth.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;
let app: Hono;
let actor: AppUser;
let previousAuthMode: string | undefined;
let previousCodexMode: string | undefined;
let previousData: string | undefined;
let previousDb: string | undefined;

const ACTOR_ID = "usr_follow_style_owner";
const ACTOR_TOKEN = "local-follow-style-owner-cookie";
const KOL_AGENT_ID = "agent:kol";
const OWNER_OPEN_ID = "open_follow_style_owner";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * The write is exercised as a real normal employee, not the anonymous stub
 * persona or an administrator. The fixture keeps the native Agent -> skill ->
 * person binding path explicit before its authenticated local session is used.
 */
async function seedFollowStyleOwner(): Promise<{ cookie: string; user: AppUser }> {
  const now = nowIso();
  (await getConn().query(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
    ACTOR_ID, ACTOR_ID, "Follow-style test employee", "not-a-login-password",
    JSON.stringify(["employee"]), JSON.stringify(["LT"]), "", 1, now, now,
  ]));
  const personRef = await syncUserOrganization(ACTOR_ID, "org:lt_team");
  await seedPublishedAgent(KOL_AGENT_ID, "KOL follow-style fixture Agent");
  const current = (await getAgentSkills(KOL_AGENT_ID)).find((row) => row.skill_id === "email_compose");
  if (!current) await setAgentSkill(KOL_AGENT_ID, "email_compose", true, 0);
  else if (!current.enabled) await setAgentSkill(KOL_AGENT_ID, "email_compose", true, Number(current.version));
  const binding = await createAgentBinding({
    agent_id: KOL_AGENT_ID,
    target_type: "person",
    target_id: personRef,
    company_id: "company:amperetime",
    source: "follow-style-native-test",
  });
  expect(binding).toMatchObject({ agent_id: KOL_AGENT_ID, target_id: personRef, status: "active" });
  expect(await pgVisibleSkillIdsForUser(ACTOR_ID, nowIso())).toContain("email_compose");
  const mailbox = await saveStarryBinding(ACTOR_ID, {
    mailbox_email: "kol.lt@litime.example",
    mailbox_id: "mbx_follow_style_owner",
    owner_name: "Follow-style test employee",
    owner_open_id: OWNER_OPEN_ID,
  });
  expect(mailbox).toMatchObject({ bound: true, status: "connected", owner_open_id: OWNER_OPEN_ID });
  (await getConn().query("INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)", [
    tokenDigest(ACTOR_TOKEN), ACTOR_ID, new Date(Date.now() + 60_000).toISOString(), now,
  ]));
  const row = (await getConn().query("SELECT * FROM users WHERE id=$1", [ACTOR_ID])).rows[0];
  return { cookie: `lingong_session=${ACTOR_TOKEN}`, user: await mapUser(row) };
}

async function request(method: string, url: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) as Json : {}, text };
}

/** Do not treat the session's index-first receipt as hydrated mail completion. */
async function waitForFollowedMailSync(sessionId: string): Promise<void> {
  await expect.poll(async () => {
    const current = await request("GET", `/api/sessions/${sessionId}`);
    return (current.body.journey as Json | undefined)?.mail_sync_pending;
  }).toBe(false);
  await waitForBackgroundSync();
  await drainBackgroundWork();
}

beforeEach(async () => {
  await freshTestDatabase({ reclaimPrevious: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-follow-style-"));
  previousAuthMode = process.env.AUTH_MODE;
  previousCodexMode = process.env.CODEX_MODE;
  previousData = process.env.LINGONG_DATA;
  previousDb = process.env.LINGONG_DB;
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.AUTH_MODE = "enabled";
  process.env.CODEX_MODE = "stub";
  (await resetConn());
  (await seedAll());
  (await seedWorkbenchFixtures());
  const identity = await seedFollowStyleOwner();
  actor = identity.user;
  const { createApp } = await import("../src/app.js");
  app = authenticatedTestApp((await createApp()), identity.cookie);
});

afterEach(async () => {
  await waitForBackgroundSync();
  await drainBackgroundWork();
  await closePostgresPool();
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
  restoreEnv("AUTH_MODE", previousAuthMode);
  restoreEnv("CODEX_MODE", previousCodexMode);
  restoreEnv("LINGONG_DATA", previousData);
  restoreEnv("LINGONG_DB", previousDb);
});

describe("follow-style tags", () => {
  it("normalizes presets, mutex, and custom words", () => {
    expect(FOLLOW_STYLE_PRESETS.map((tag) => tag.label)).toContain("犹豫谨慎");
    const tags = normalizeFollowStyleTags(["犹豫谨慎", "决策快", "很挑剔"]);
    expect(tags.map((tag) => tag.label)).toEqual(["决策快", "很挑剔"]);
    expect(mergeFollowStyleTags(
      [{ id: "cautious", label: "犹豫谨慎" }],
      ["回复慢"],
      "add",
    ).map((tag) => tag.id)).toEqual(["cautious", "slow_reply"]);
  });

  it("suggests cautious from hesitant copy and skips already applied tags", () => {
    const suggested = suggestFollowStyleTags("我再考虑一下，还不太确定能不能接。");
    expect(suggested.map((tag) => tag.id)).toEqual(["cautious"]);
    expect(suggestFollowStyleTags("Thanks, I am interested. Please send the rate card.")).toEqual([]);
    expect(suggestFollowStyleTags("我再考虑一下。", [{ id: "cautious", label: "犹豫谨慎" }])).toEqual([]);
  });

  it("parses 打标签 commands without locking a skill", () => {
    expect(isFollowStyleTagCommand("给 @小美妆日记 打标签 犹豫谨慎")).toBe(true);
    expect(isFollowStyleTagCommand("写跟进邮件，这个红人比较犹豫谨慎请打标签")).toBe(false);
    expect(parseFollowStyleTagCommand("给 @小美妆日记 打标签 犹豫谨慎、回复慢")).toEqual({
      handle: "小美妆日记",
      labels: ["犹豫谨慎", "回复慢"],
    });
  });

  it("saves tags on the collaboration, shows them on the home card, and injects them into compose", async () => {
    const saved = await request("PUT", "/api/collaborations/col_xiaomei/follow-style-tags", {
      tags: ["犹豫谨慎"],
    });
    expect(saved.status).toBe(200);
    expect((saved.body.follow_style_tags as Json[])[0]).toMatchObject({ id: "cautious", label: "犹豫谨慎" });

    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(((opened.body.journey as Json).follow_style_tags as Json[])[0]).toMatchObject({ label: "犹豫谨慎" });
    expect((await getConn().query("SELECT owner_user_id FROM sessions WHERE id=$1", [opened.body.id])).rows[0])
      .toMatchObject({ owner_user_id: ACTOR_ID });

    (await getConn().query("UPDATE collaborations SET kol_uid='KOLXIAOMEI' WHERE id='col_xiaomei'",[]));
    await persistStarryOwnership([{
      kolUid: "KOLXIAOMEI",
      ownerOpenId: OWNER_OPEN_ID,
      ownerMailbox: "kol.lt@litime.example",
      brandCode: "LT",
    }], "company:amperetime", nowIso(), true);
    await waitForFollowedMailSync(String(opened.body.id));
    const board = await withScopedUser(actor, () => buildHomeBoard());
    const card = ((board.kols as Json[]) || []).find((row) => row.handle === "小美妆日记");
    expect(card).toBeTruthy();
    expect((card?.follow_style_tags as Json[]).some((tag) => tag.label === "犹豫谨慎")).toBe(true);

    const facts = composeFactsFromContext({
      stage: "INITIAL_CONTACT",
      raw: "写跟进邮件",
      style_tags: saved.body.follow_style_tags as { id: string; label: string }[],
    });
    expect(facts.items.join(" ")).toContain("犹豫谨慎");
    const prompt = composePreviewPrompt("写跟进邮件", "", facts);
    expect(prompt).toContain("跟进不要催");
    const audit = (await getConn().query("SELECT actor,event_type,payload FROM audit_events WHERE event_type=$1 ORDER BY id DESC LIMIT 1", ["follow_style_tags.update"])).rows[0] as {
      actor: string;
      event_type: string;
      payload: string;
    };
    expect(audit).toMatchObject({ actor: ACTOR_ID, event_type: "follow_style_tags.update" });
    expect(audit.payload).toContain("犹豫谨慎");
    (await resetDemoRuntimeState());
    const cleared = (await getConn().query("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'",[])).rows[0] as {
      follow_style_tags: string | null;
    };
    expect(cleared.follow_style_tags).toBeNull();
  });

  it("applies a chat 打标签 command without starting a worker", async () => {
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    const sid = String(opened.body.id);
    const asked = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "给 @小美妆日记 打标签 犹豫谨慎",
    });
    expect(asked.status, asked.text).toBe(200);
    expect(asked.body.worker).toBeNull();
    const msgs = asked.body.messages as Json[];
    expect(msgs.some((row) => row.kind === "task_result_card" && String((row.payload as Json).summary || "").includes("犹豫谨慎"))).toBe(true);
    const row = (await getConn().query("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'",[])).rows[0] as { follow_style_tags: string };
    expect(row.follow_style_tags).toContain("cautious");
    await waitForFollowedMailSync(sid);
  });

  it("rejects another brand's direct tag write and session open without mutation", async () => {
    await getConn().query("UPDATE collaborations SET brand='RO' WHERE id='col_xiaomei'");
    const before = (await getConn().query("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'")).rows[0];
    const sessions = (await getConn().query("SELECT count(*)::int AS n FROM sessions")).rows[0].n;
    const saved = await request("PUT", "/api/collaborations/col_xiaomei/follow-style-tags", { tags: ["犹豫谨慎"] });
    expect([403, 404]).toContain(saved.status);
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect([403, 404]).toContain(opened.status);
    expect((await getConn().query("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'")).rows[0]).toEqual(before);
    expect((await getConn().query("SELECT count(*)::int AS n FROM sessions")).rows[0].n).toBe(sessions);
    expect((await getConn().query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='follow_style_tags.update'")).rows[0].n).toBe(0);
  });

  it("rejects another brand's handle in a chat tag command", async () => {
    await getConn().query("UPDATE collaborations SET brand='RO' WHERE id='col_xiaomei'");
    const before = (await getConn().query("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'")).rows[0];
    const opened = await request("POST", "/api/sessions", { title: "个人标签请求" });
    expect(opened.status).toBe(200);
    const asked = await request("POST", `/api/sessions/${opened.body.id}/messages`, {
      text: "给 @小美妆日记 打标签 犹豫谨慎",
    });
    expect([403, 404]).toContain(asked.status);
    expect((await getConn().query("SELECT follow_style_tags FROM collaborations WHERE id='col_xiaomei'")).rows[0]).toEqual(before);
    expect((await getConn().query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='follow_style_tags.update'")).rows[0].n).toBe(0);
  });

  it("does not reuse another employee's private session or mail cards in the same brand", async () => {
    const now = nowIso();
    await getConn().query("INSERT INTO users(id,username,name,password_hash,created_at,updated_at) VALUES('private-other','private-other','Other employee','test-only',$1,$1)", [now]);
    await getConn().query("INSERT INTO sessions(id,title,created_at,updated_at,owner_user_id,collaboration_id) VALUES('private-session','Private',$1,$1,'private-other','col_xiaomei')", [now]);
    await getConn().query("INSERT INTO messages(id,session_id,role,kind,payload,created_at) VALUES('private-message','private-session','assistant','kol_mail_card',$1,$2)", [JSON.stringify({ body: "private-other-employee-body", collaboration_id: "col_xiaomei" }), now]);
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(opened.status, opened.text).toBe(200);
    expect(opened.body.id).not.toBe("private-session");
    expect(opened.text).not.toContain("private-other-employee-body");
    expect((await getConn().query("SELECT owner_user_id FROM sessions WHERE id=$1", [opened.body.id])).rows[0].owner_user_id).toBe(ACTOR_ID);
    expect((await getConn().query("SELECT payload FROM messages WHERE id='private-message'")).rows[0].payload).toContain("private-other-employee-body");
    await waitForFollowedMailSync(String(opened.body.id));
    const privateEvents: unknown[] = [];
    const ownEvents: unknown[] = [];
    const stopPrivate = subscribeSession("private-session", event => privateEvents.push(event));
    const stopOwn = subscribeSession(String(opened.body.id), event => ownEvents.push(event));
    try {
      await withScopedUser(actor, () => publishJourneyForCollaboration("col_xiaomei"));
      expect(privateEvents).toEqual([]);
      expect(ownEvents).toHaveLength(1);
      expect(JSON.stringify(ownEvents)).not.toContain("private-other-employee-body");
    } finally {
      stopPrivate();
      stopOwn();
    }
  });
});
