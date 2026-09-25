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
import { mailSendAction, claimMailSend, assertDraftEditable } from "../src/host/mail-send-confirmation.js";
import { sendDraft } from "../src/gateway/send.js";
import { callStarryKolTool, executeStarryKolTask } from "../src/starrykol/service.js";
import { starry } from "../src/adapters/clients.js";
import type { Json } from "../src/types.js";

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

function confirmation() {
  return { request_id: randomUUID(), confirmation_version: mailSendAction(getDraft(draftId)).action.confirmation_version! };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-send-confirm-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "disabled";
  resetConn();
  seedAll();
  app = (await import("../src/app.js")).createApp();
  seedWorkbenchFixtures();
  const session = await request("POST", "/api/sessions", { title: "Mail confirmation test" });
  draftId = String(persistDraft(String(session.body.id), {
    skill: "email_compose", template_id: "kol.first_touch",
    from: BRAND_MAILBOXES.LT, to: "xiaomei.beauty@example.com",
    subject: "Collaboration invitation", body: "Hi, we would like to discuss a collaboration.",
    body_zh_internal: "内部译文", official_stage: "INITIAL_CONTACT", collaboration_id: "col_xiaomei", keep_stage: true,
  }).id);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("human-confirmed mail send boundary", () => {
  it("preparing a send action is read-only, including an empty recipient binding", () => {
    getConn().prepare("UPDATE collaborations SET email='' WHERE id='col_xiaomei'").run();
    const view = mailSendAction(getDraft(draftId));
    expect(view.action, JSON.stringify(view.action)).toMatchObject({ risk_level: "L3", confirmation_required: true, enabled: true });
    expect(view.snapshot.body).toContain("discuss a collaboration");
    expect(getConn().prepare("SELECT email FROM collaborations WHERE id='col_xiaomei'").get()).toMatchObject({ email: "" });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get()).toMatchObject({ n: 0 });
  });

  it("rejects a direct send without any human-confirmed version", async () => {
    expect(() => claimMailSend(draftId, {})).toThrow(/确认/);
    await expect(sendDraft(draftId)).rejects.toThrow(/确认/);
    const response = await request("POST", `/api/drafts/${draftId}/send`, {});
    expect(response.status).toBe(409);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get()).toMatchObject({ n: 0 });
  });

  it("invalidates the old confirmation on a same-length edit", () => {
    const input = confirmation();
    getConn().prepare("UPDATE drafts SET subject='Collaboration suggestion' WHERE id=?").run(draftId);
    expect(() => claimMailSend(draftId, input)).toThrow(/重新核对/);
  });

  it("invalidates the old confirmation when formal context changes", () => {
    const input = confirmation();
    getConn().prepare("UPDATE collaborations SET stage_version=stage_version+1 WHERE id='col_xiaomei'").run();
    expect(() => claimMailSend(draftId, input)).toThrow(/重新核对/);
  });

  it("records a single successful send and replays its persisted receipt", async () => {
    const input = confirmation();
    expect(claimMailSend(draftId, input)).toEqual({ replay: null });
    const result = await sendDraft(draftId, "operator", input.request_id);
    expect(result.stage_changed).toBe(false);
    expect(claimMailSend(draftId, input).replay).toEqual(result);
    expect(() => claimMailSend(draftId, { ...input, request_id: randomUUID() })).toThrow(/重复/);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get()).toMatchObject({ n: 1 });
    expect(getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_xiaomei'").get()).toMatchObject({ stage_code: "INITIAL_CONTACT" });
    expect(() => assertDraftEditable(getDraft(draftId))).toThrow(/不能修改/);
  });

  it("locks concurrent sends and edits before contacting the provider", () => {
    const input = confirmation();
    claimMailSend(draftId, input);
    expect(() => claimMailSend(draftId, input)).toThrow(/重复/);
    expect(() => assertDraftEditable(getDraft(draftId))).toThrow(/不能修改/);
  });

  it("retains unknown status on provider errors and forbids blind retries", async () => {
    vi.spyOn(starry, "sendConversation").mockImplementation(() => { throw new Error("network timeout"); });
    const input = confirmation();
    claimMailSend(draftId, input);
    await expect(sendDraft(draftId, "operator", input.request_id)).rejects.toThrow("network timeout");
    expect(getDraft(draftId).status).toBe("send_unknown");
    expect(mailSendAction(getDraft(draftId)).action).toMatchObject({ enabled: false });
    expect(() => claimMailSend(draftId, input)).toThrow(/回执/);
  });

  it("exposes the checked action and rejects edits submitted inside send", async () => {
    const view = await request("GET", `/api/drafts/${draftId}/actions`);
    expect(view.status).toBe(200);
    expect(view.body.action).toMatchObject({ action_id: "mail.draft.send", enabled: true });
    const rejected = await request("POST", `/api/drafts/${draftId}/send`, { ...confirmation(), to_addr: "someone-else@example.com" });
    expect(rejected.status).toBe(409);
    expect(getDraft(draftId).to_addr).toBe("xiaomei.beauty@example.com");
  });

  it("requires reconfirmation after PATCH, even if content is later restored", async () => {
    const input = confirmation();
    await request("PATCH", `/api/drafts/${draftId}`, { subject: "Changed" });
    await request("PATCH", `/api/drafts/${draftId}`, { subject: "Collaboration invitation" });
    const rejected = await request("POST", `/api/drafts/${draftId}/send`, input);
    expect(rejected.status).toBe(409);
    const sent = await request("POST", `/api/drafts/${draftId}/send`, confirmation());
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
});
