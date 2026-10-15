import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { persistDraft, getDraft } from "../src/host/api.js";
import { mailSendAction, claimMailSend, assertDraftEditable, validateMailSend } from "../src/host/mail-send-confirmation.js";
import { mapUser, withScopedUser, type AppUser } from "../src/auth.js";
import { pgApprovalRoles, pgConnectorPermissions, pgVisibleSkillIdsForUser } from "../src/postgres/auth-pg.js";
import { seedPublishedAgent, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";
import { listAgentBindings, revokeAgentBinding } from "../src/runtime/organization-tree.js";
import { getSkillConnectors, setSkillConnector, setConnectorConfig } from "../src/runtime/store.js";
import { sendDraft } from "../src/gateway/send.js";
import { callStarryKolTool, executeStarryKolTask } from "../src/starrykol/service.js";
import { starry } from "../src/adapters/clients.js";
import type { Json, Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;
let app: Hono;
let draftId: string;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Json };
}

async function confirmation() {
  return { request_id: randomUUID(), confirmation_version: (await mailSendAction((await getDraft(draftId)))).action.confirmation_version! };
}

/** Match request middleware: derive current authority from native PG facts, never fixture-grant it. */
async function currentActor(): Promise<AppUser> {
  const actor = await mapUser((await getConn().query("SELECT * FROM users WHERE id='usr_runtime_fixture'", [])).rows[0] as Row);
  const now = new Date().toISOString();
  const [authority_skills, authority_connectors, authority_approval_roles] = await Promise.all([
    pgVisibleSkillIdsForUser(actor.id, now),
    pgConnectorPermissions(actor.id),
    pgApprovalRoles(actor.id, now),
  ]);
  return { ...actor, authority_skills, authority_connectors, authority_approval_roles };
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-send-confirm-"));

  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "disabled";
  await resetConn();
  await seedAll();
  app = (await (await import("../src/app.js")).createApp());
  await seedWorkbenchFixtures();
  const session = await request("POST", "/api/sessions", { title: "Mail confirmation test" });
  draftId = String((await persistDraft(String(session.body.id), {
    skill: "email_compose", template_id: "kol.first_touch",
    from: BRAND_MAILBOXES.LT, to: "xiaomei.beauty@example.com",
    subject: "Collaboration invitation", body: "Hi, we would like to discuss a collaboration.",
    body_zh_internal: "内部译文", official_stage: "INITIAL_CONTACT", collaboration_id: "col_xiaomei", keep_stage: true,
  })).id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("human-confirmed mail send boundary", () => {
  it("uses current Agent and skill resource bindings without a personal connector grant and rechecks revocation", async () => {
    process.env.AUTH_MODE = "enabled";
    (await seedPublishedAgent("agent:kol"));
    (await seedRuntimeTestActor(["email_compose"],true));
    (await getConn().query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('starrykol','Test mail resource',1,'configured','2026-10-05') ON CONFLICT(id) DO UPDATE SET enabled=1", []));
    const binding = (await getSkillConnectors("email_compose")).find(row => row.connector_id === "starrykol");
    const enabled = (await setSkillConnector("email_compose","starrykol",true,Number(binding?.version || 0)));
    (await setConnectorConfig("starrykol",{protocol: "mcp",url: "https://api.example.test/mcp",headers_secret_refs: {"X-MCP-API-KEY": "isolated-mail-secret"}},0));
    const actor = await currentActor();
    (await getConn().query("DELETE FROM user_connector_grants WHERE user_id=$1", [actor.id]));
    expect(actor.authority_skills).toContain("email_compose");
    expect(actor.authority_connectors?.starrykol).toBeUndefined();
    await withScopedUser(actor, async () => expect((async () => (await validateMailSend((await getDraft(draftId)))))()).resolves.not.toBeInstanceOf(Error));
    const actorBinding = (await listAgentBindings("agent:kol")).find(row => row.source === "test");
    expect(actorBinding).toBeTruthy();
    (await revokeAgentBinding(actorBinding!.id));
    const revokedActor = await currentActor();
    expect(revokedActor.authority_skills).not.toContain("email_compose");
    await withScopedUser(revokedActor, async () => expect((async () => (await validateMailSend((await getDraft(draftId)))))()).rejects.toThrow(/agent_not_usable|runtime_agent_not_usable/));
  });
  it("rejects administrator send when the current skill resource binding is revoked", async () => {
    process.env.AUTH_MODE = "enabled";
    (await seedPublishedAgent("agent:kol"));
    (await seedRuntimeTestActor(["email_compose"],true));
    (await getConn().query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('starrykol','Test mail resource',1,'configured','2026-10-05') ON CONFLICT(id) DO UPDATE SET enabled=1", []));
    const binding = (await getSkillConnectors("email_compose")).find(row => row.connector_id === "starrykol");
    const enabled = (await setSkillConnector("email_compose","starrykol",true,Number(binding?.version || 0)));
    (await setConnectorConfig("starrykol",{protocol: "mcp",url: "https://api.example.test/mcp",headers_secret_refs: {"X-MCP-API-KEY": "isolated-mail-secret"}},0));
    const actor = await currentActor();
    await withScopedUser(actor, async () => expect((async () => (await validateMailSend((await getDraft(draftId)))))()).resolves.not.toBeInstanceOf(Error));
    (await setSkillConnector("email_compose","starrykol",false,Number(enabled.version)));
    await withScopedUser(actor, async () => expect((async () => (await validateMailSend((await getDraft(draftId)))))()).rejects.toThrow(/runtime_connector_unbound/));
  });
  it("preparing a send action is read-only, including an empty recipient binding", async () => {
    (await getConn().query("UPDATE collaborations SET email='' WHERE id='col_xiaomei'", []));
    const view = (await mailSendAction((await getDraft(draftId))));
    expect(view.action, JSON.stringify(view.action)).toMatchObject({ risk_level: "L3", confirmation_required: true, enabled: true });
    expect(view.snapshot.body).toContain("discuss a collaboration");
    expect((await getConn().query("SELECT email FROM collaborations WHERE id='col_xiaomei'", [])).rows[0]).toMatchObject({ email: "" });
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM starry_sends", [])).rows[0] as { n: unknown }).n)).toBe(0);
  });

  it("hard-rejects an old TB draft before claim/provider even when its LT From and extra brand are forged", async () => {
    // The disabled-mode actor is already authorized for LT/RO/PQ.  The collaboration
    // row, not the stale draft.extra value, is the server-side brand authority.
    (await getConn().query("UPDATE collaborations SET brand='TB', mailbox_from=$1 WHERE id='col_xiaomei'", [BRAND_MAILBOXES.LT]));
    (await getConn().query("UPDATE drafts SET extra=$1 WHERE id=$2", [JSON.stringify({ brand: "LT" }), draftId]));
    const provider = vi.spyOn(starry, "sendConversation");
    const draft = await getDraft(draftId);

    await expect(validateMailSend(draft)).rejects.toMatchObject({ status: "tb_remote_binding_required", http: 403 });
    expect((await mailSendAction(draft)).action).toMatchObject({ enabled: false });
    await expect(claimMailSend(draftId, { request_id: randomUUID(), confirmation_version: "blocked-tb-current-snapshot" })).rejects.toMatchObject({ status: "tb_remote_binding_required", http: 403 });
    expect(provider).not.toHaveBeenCalled();
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM mail_send_attempts", [])).rows[0] as { n: unknown }).n)).toBe(0);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM starry_sends", [])).rows[0] as { n: unknown }).n)).toBe(0);
  });

  it("hard-rejects cross-brand delegation for a multi-brand actor before claim/provider", async () => {
    // The default test actor has LT/RO/PQ scope; broad scope cannot authorize LT to
    // send for a current RO collaboration.
    (await getConn().query("UPDATE collaborations SET brand='RO' WHERE id='col_xiaomei'", []));
    (await getConn().query("UPDATE drafts SET extra=$1 WHERE id=$2", [JSON.stringify({ brand: "RO" }), draftId]));
    const provider = vi.spyOn(starry, "sendConversation");
    const draft = await getDraft(draftId);

    await expect(validateMailSend(draft)).rejects.toMatchObject({ status: "cross_brand_sender_forbidden", http: 403 });
    await expect(claimMailSend(draftId, { request_id: randomUUID(), confirmation_version: "blocked-cross-brand-current-snapshot" })).rejects.toMatchObject({ status: "cross_brand_sender_forbidden", http: 403 });
    expect(provider).not.toHaveBeenCalled();
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM mail_send_attempts", [])).rows[0] as { n: unknown }).n)).toBe(0);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM starry_sends", [])).rows[0] as { n: unknown }).n)).toBe(0);
  });

  it("rejects a direct send without any human-confirmed version", async () => {
    await expect(claimMailSend(draftId, {})).rejects.toThrow(/确认/);
    await expect(sendDraft(draftId)).rejects.toThrow(/确认/);
    const response = await request("POST", "/api/actions/mail.send", { draft_id: draftId,});
    expect(response.status).toBe(409);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM starry_sends", [])).rows[0] as { n: unknown }).n)).toBe(0);
  });

  it("invalidates the old confirmation on a same-length edit", async () => {
    const input = (await confirmation());
    (await getConn().query("UPDATE drafts SET subject='Collaboration suggestion' WHERE id=$1", [draftId]));
    await expect(claimMailSend(draftId, input)).rejects.toThrow(/重新核对/);
  });

  it("invalidates the old confirmation when formal context changes", async () => {
    const input = (await confirmation());
    (await getConn().query("UPDATE collaborations SET stage_version=stage_version+1 WHERE id='col_xiaomei'", []));
    await expect(claimMailSend(draftId, input)).rejects.toThrow(/重新核对/);
  });

  it("records a single successful send and replays its persisted receipt", async () => {
    const input = (await confirmation());
    expect(await claimMailSend(draftId, input)).toEqual({ replay: null });
    const result = await sendDraft(draftId, "operator", input.request_id);
    expect(result.stage_changed).toBe(false);
    expect((await claimMailSend(draftId, input)).replay).toEqual(result);
    await expect(claimMailSend(draftId, { ...input, request_id: randomUUID() })).rejects.toThrow(/重复/);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM starry_sends", [])).rows[0] as { n: unknown }).n)).toBe(1);
    expect((await getConn().query("SELECT stage_code FROM collaborations WHERE id='col_xiaomei'", [])).rows[0]).toMatchObject({ stage_code: "INITIAL_CONTACT" });
    await expect((async () => (assertDraftEditable((await getDraft(draftId)))))()).rejects.toThrow(/不能修改/);
  });

  it("locks concurrent sends and edits before contacting the provider", async () => {
    const input = (await confirmation());
    await claimMailSend(draftId, input);
    await expect(claimMailSend(draftId, input)).rejects.toThrow(/重复/);
    await expect((async () => (assertDraftEditable((await getDraft(draftId)))))()).rejects.toThrow(/不能修改/);
  });

  it("retains unknown status on provider errors and forbids blind retries", async () => {
    vi.spyOn(starry, "sendConversation").mockImplementation(() => { throw new Error("network timeout"); });
    const input = (await confirmation());
    await claimMailSend(draftId, input);
    await expect(sendDraft(draftId, "operator", input.request_id)).rejects.toThrow("network timeout");
    expect((await getDraft(draftId)).status).toBe("send_unknown");
    expect((await mailSendAction((await getDraft(draftId)))).action).toMatchObject({ enabled: false });
    await expect(claimMailSend(draftId, input)).rejects.toThrow(/回执/);
  });

  it("exposes the checked action and rejects edits submitted inside send", async () => {
    const view = await request("GET", `/api/queries/mail.draft-actions?draft_id=${draftId}`);
    expect(view.status).toBe(200);
    expect(view.body.action).toMatchObject({ action_id: "mail.draft.send", enabled: true });
    const rejected = await request("POST", "/api/actions/mail.send", { draft_id: draftId, ...(await confirmation()), to_addr: "someone-else@example.com" });
    expect(rejected.status).toBe(409);
    expect((await getDraft(draftId)).to_addr).toBe("xiaomei.beauty@example.com");
  });

  it("requires reconfirmation after PATCH, even if content is later restored", async () => {
    const input = (await confirmation());
    await request("PATCH", `/api/drafts/${draftId}`, { subject: "Changed" });
    await request("PATCH", `/api/drafts/${draftId}`, { subject: "Collaboration invitation" });
    const rejected = await request("POST", "/api/actions/mail.send", { ...input, draft_id: draftId });
    expect(rejected.status).toBe(409);
    const sent = await request("POST", "/api/actions/mail.send", { ...(await confirmation()), draft_id: draftId });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("sent");
    expect((await request("PATCH", `/api/drafts/${draftId}`, { body_en: "Too late" })).status).toBe(409);
  });

  it("does not allow a model confirm_send field or direct MCP invocation to send", async () => {
    await expect(callStarryKolTool("sendEmailNow", { conversationId: 101, requestJson: "{}" })).rejects.toThrow(/mail_send_requires_gateway/);
    await expect(executeStarryKolTask("email_compose", {
      mailboxEmail: BRAND_MAILBOXES.LT, to: ["xiaomei.beauty@example.com"],
      subject: "Test", body: "Test", confirm_send: true,
    })).rejects.toThrow(/mail_send_requires_gateway/);
  });
  it("exports the authorized draft through a query without sending", async () => {
    const response = await app.request(`/api/queries/mail.export?draft_id=${encodeURIComponent(draftId)}&format=eml`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("message/rfc822");
    expect(await response.text()).toContain("Collaboration invitation");
    expect((await getDraft(draftId)).sent_at).toBeFalsy();
    expect((await app.request(`/api/drafts/${draftId}/export`)).status).toBe(404);
  });

});
