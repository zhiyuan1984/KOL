import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { buildHomeBoard } from "../src/host/home-board.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<Json>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text: async () => text,
    json: async () => (text ? (JSON.parse(text) as Json) : {}),
  };
}

function insertCollab(id: string, handle: string, stageCode: string, extra: Record<string, string> = {}): void {
  getConn().prepare(
    `INSERT OR REPLACE INTO collaborations
     (id, handle, display_name, brand, platform, followers, email, mailbox_from,
      lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
      stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    handle,
    handle,
    extra.brand || "LT",
    extra.platform || "YouTube",
    extra.followers || "8万",
    extra.email || `${id}@litime.example`,
    BRAND_MAILBOXES.LT,
    `lc_${id}`,
    `conv_${id}`,
    stageCode,
    3,
    extra.notes || "",
    0,
    0,
    extra.recipient_name || "",
    extra.phone || "",
    extra.address_line || "",
    extra.country || "美国",
    extra.postal || "",
    extra.sku || "LT-MINI-12",
    extra.qty || "1",
    0,
  );
  if (extra.kol_uid) {
    getConn().prepare("UPDATE collaborations SET kol_uid=? WHERE id=?").run(extra.kol_uid, id);
  }
}

function stageOf(id: string): string {
  const row = getConn().prepare("SELECT stage_code FROM collaborations WHERE id=?").get(id) as { stage_code: string };
  return row.stage_code;
}

async function messages(sid: string): Promise<Json[]> {
  const listed = await (await request("GET", `/api/sessions/${sid}`)).json();
  return (listed.messages as Json[]) || [];
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-journey-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  setStarryKolClientFactory(() => ({
    async callTool() {
      return { data: { list: [] } };
    },
    async close() { /* noop */ },
  }));
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  setStarryKolClientFactory();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KOL persistent session and fact-advance", () => {
  it("opens the same session for the same collaboration", async () => {
    const first = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(first.status).toBe(200);
    const a = await first.json();
    const second = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    const b = await second.json();
    expect(a.id).toBe(b.id);
    expect(a.collaboration_id).toBe("col_xiaomei");
    expect((a.journey as Json).stage_code).toBe("INITIAL_CONTACT");
    expect((a.journey as Json).handle).toBe("小美妆日记");
    expect((a.journey as Json).phases).toHaveLength(8);
    expect((a.journey as Json).sop).toMatchObject({
      phase_label: "建联",
      stage_code: "INITIAL_CONTACT",
      exception: false,
    });
    const openedMsgs = await messages(String(a.id));
    expect(String((openedMsgs[0]?.payload as Json | undefined)?.text || "")).toContain("当前阶段：初步接触（建联）");
    const recs = ((a.journey as Json).recommended_actions as Json[]) || [];
    expect(recs).toHaveLength(3);
    expect(recs.map((row) => row.intent)).toEqual(["email_compose", "confirm_stage", "stage_sop"]);
    expect((a.journey as Json).portrait).toMatchObject({ handle: "小美妆日记", email: "" });
    expect(Array.isArray((a.journey as Json).mail_history)).toBe(true);
    const disputed = await request("POST", "/api/collaborations/col_trip/session", {});
    const trip = await disputed.json();
    expect((trip.journey as Json).exception).toBe(true);
    expect((trip.journey as Json).sop).toMatchObject({
      stage_code: "DISPUTED",
      exception: true,
      exception_kind: "bypass",
    });
    expect(((trip.journey as Json).actions as Json[]).some((row) => row.intent === "risk_scan")).toBe(true);

    const asked = await request("POST", `/api/sessions/${a.id}/messages`, {
      text: "提出阶段变更",
      intent: "confirm_stage",
    });
    expect(asked.status, await asked.text()).toBe(200);
    const askedMsgs = await messages(String(a.id));
    expect(askedMsgs.some((m) => m.kind === "confirm_stage_card")).toBe(true);
    expect(askedMsgs.some((m) =>
      m.kind === "supplement_card" && String((m.payload as Json).message || "").includes("需要指定红人或合作"),
    )).toBe(false);
    const rate = await request("POST", "/api/collaborations/col_trip/ingest-mail", {
      subject: "rate card",
      body: "Please send the rate card.",
      from: "trip.power@example.com",
    });
    expect(rate.status, await rate.text()).toBe(200);
    expect((await rate.json()).advanced).toBeNull();
    expect(stageOf("col_trip")).toBe("DISPUTED");
    const viaCreate = await request("POST", "/api/sessions", { title: "ignored", collaboration_id: "col_xiaomei" });
    expect((await viaCreate.json()).id).toBe(a.id);
  });

  it("ingests a thank-you letter without leaving 初步接触", async () => {
    const listed = await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Thank you for your email.",
      from: "xiaomei.beauty@example.com",
    });
    expect(listed.status, await listed.text()).toBe(200);
    const body = await listed.json();
    expect(body.duplicate).not.toBe(true);
    expect((body.judgment as Json).flags).toContain("thank_you_only");
    expect((body.judgment as Json).suggested_stage).toBeNull();
    expect(body.advanced).toBeNull();
    expect(stageOf("col_xiaomei")).toBe("INITIAL_CONTACT");
    const cards = (await messages(String(body.session_id))).filter((m) => m.kind === "kol_mail_card");
    expect(cards).toHaveLength(1);
    expect(((cards[0].payload as Json).judgment as Json).flags).toContain("thank_you_only");
    expect((cards[0].payload as Json).auto_advanced).toBeNull();
    expect((await messages(String(body.session_id))).some((m) => m.kind === "confirm_stage_card")).toBe(false);

    const again = await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Thank you for your email.",
      from: "xiaomei.beauty@example.com",
    });
    expect((await again.json()).duplicate).toBe(true);
    expect((await messages(String(body.session_id))).filter((m) => m.kind === "kol_mail_card")).toHaveLength(1);
  });

  it("suggests INTERESTED from a clear reply but does not auto-write it", async () => {
    const listed = await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate. Tell me more.",
      from: "xiaomei.beauty@example.com",
    });
    const body = await listed.json();
    expect((body.judgment as Json).suggested_stage).toBe("INTERESTED");
    expect((body.judgment as Json).auto_propose).toBe(true);
    expect(body.advanced).toBeNull();
    expect(stageOf("col_xiaomei")).toBe("INITIAL_CONTACT");
    const card = (await messages(String(body.session_id))).find((m) => m.kind === "kol_mail_card")!;
    expect((card.payload as Json).auto_advanced).toBeNull();
    expect((card.payload as Json).expected_version).toBe(0);
    expect((card.payload as Json).current_stage).toBe("INITIAL_CONTACT");
    expect(((card.payload as Json).targets as Json[]).some((row) => row.code === "INTERESTED" && row.suggested === true)).toBe(true);
    const stageCard = (await messages(String(body.session_id))).find((m) => m.kind === "confirm_stage_card");
    expect(stageCard).toBeTruthy();
    expect((stageCard?.payload as Json).proposed_stage).toBe("INTERESTED");
    expect((stageCard?.payload as Json).proposed_label).toBe("已回复-有兴趣");
    expect((stageCard?.payload as Json).expected_version).toBe(0);

    const confirm = await request("POST", `/api/sessions/${body.session_id}/confirm-stage`, {
      stage_code: "INTERESTED",
      collaboration_id: "col_xiaomei",
      expected_version: (card.payload as Json).expected_version,
      reason: "来信正文",
      reason_code: "REPLY_EVIDENCE",
    });
    expect(confirm.status, await confirm.text()).toBe(200);
    expect(stageOf("col_xiaomei")).toBe("INTERESTED");
    const afterWrite = await (await request("GET", `/api/sessions/${body.session_id}`)).json();
    const intro = (afterWrite.messages as Json[]).find((m) => String((m.payload as Json).text || "").includes("的合作会话"));
    expect(String((intro?.payload as Json | undefined)?.text || "")).toContain("当前阶段：已回复-有兴趣（意向）");
    expect(String(afterWrite.title)).toContain("已回复-有兴趣");
    expect((afterWrite.journey as Json).stage_code).toBe("INTERESTED");
    expect(((afterWrite.journey as Json).sop as Json).phase_label).toBe("意向");
    expect(((afterWrite.journey as Json).recommended_actions as Json[]).map((row) => row.intent)).toEqual([
      "email_compose",
      "confirm_stage",
      "stage_sop",
    ]);
    expect(((afterWrite.journey as Json).mail_history as Json[])[0]).toMatchObject({
      direction: "inbound",
      unread: true,
    });
    expect(String(((afterWrite.journey as Json).mail_history as Json[])[0].subject)).toMatch(/Collaboration Opportunity/);
    const mailDigest = ((afterWrite.journey as Json).mail_digest as Json) || {};
    expect(String(mailDigest.text || "")).toMatch(/would love to collaborate|有兴趣|合作意愿|往来/);
    expect(String(mailDigest.text || "")).not.toBe("Re: Collaboration Opportunity with LiTime");
    expect(String(mailDigest.text || "")).not.toMatch(/^Hi, I am interested/);
    const mailSummaries = ((afterWrite.journey as Json).mail_summaries as Json[]) || [];
    expect(mailSummaries).toHaveLength(1);
    expect(String(mailSummaries[0]?.summary || "")).toBe(String(mailDigest.text || ""));
    const receipts = (afterWrite.messages as Json[]).filter((m) => String((m.payload as Json).text || "").includes("正式阶段已按你的确认更新"));
    expect(receipts).toHaveLength(1);

    const again = await request("POST", `/api/sessions/${body.session_id}/confirm-stage`, {
      stage_code: "INTERESTED",
      collaboration_id: "col_xiaomei",
      expected_version: 1,
      reason: "重复确认",
    });
    expect(again.status, await again.text()).toBe(200);
    const againBody = await again.json();
    expect(againBody.already_there).toBe(true);
    expect(againBody.stage_changed).toBe(false);
    expect(againBody.message).toBeNull();
    expect(stageOf("col_xiaomei")).toBe("INTERESTED");
    const afterAgain = await messages(String(body.session_id));
    expect(afterAgain.filter((m) => String((m.payload as Json).text || "").includes("正式阶段已按你的确认更新"))).toHaveLength(1);
  });

  it("auto-advances SAMPLE_PENDING to SHIPPED from logistics facts, not from send", async () => {
    insertCollab("col_ship", "Wendell Fishing", "SAMPLE_PENDING", { kol_uid: "KOLA58D2B0B4445431A9655" });
    const listed = await request("POST", "/api/collaborations/col_ship/ingest-mail", {
      subject: "Your LiTime Product Has Shipped",
      body: "The sample shipped via UPS. Tracking number 1Z999AA10123456784.",
      from: "ops@litime.example",
    });
    const body = await listed.json();
    expect((body.judgment as Json).suggested_stage).toBe("SHIPPED");
    expect((body.advanced as Json).advanced).toBe(true);
    expect(stageOf("col_ship")).toBe("SHIPPED");
    const card = (await messages(String(body.session_id))).find((m) => m.kind === "kol_mail_card")!;
    expect((card.payload as Json).auto_advanced).toMatchObject({ to_stage: "SHIPPED" });

    const ses = await request("POST", "/api/sessions", { title: "follow" });
    const sid = String((await ses.json()).id);
    const draftAsk = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "写合作邮件 @Wendell Fishing",
      content: "写合作邮件 @Wendell Fishing",
      act: "ask",
      intent: "email_compose",
      collaboration_id: "col_ship",
    });
    expect(draftAsk.status, await draftAsk.text()).toBe(200);
    const { persistDraft } = await import("../src/host/api.js");
    const draft = persistDraft(sid, {
      skill: "email_compose",
      template_id: "ship_notice.v1",
      from: BRAND_MAILBOXES.LT,
      to: "col_ship@litime.example",
      subject: "Your LiTime Product Has Shipped",
      body: "Hi,\n\nYour LiTime product has shipped.\n",
      keep_stage: true,
      official_stage: "SHIPPED",
      collaboration_id: "col_ship",
    });
    const sent = await request("POST", `/api/drafts/${draft.id}/send`, {});
    expect([200, 400, 403]).toContain(sent.status);
    const sj = await sent.json();
    const detail = (sj.detail && typeof sj.detail === "object" ? sj.detail : sj) as Json;
    expect(detail.stage_changed).toBe(false);
    expect(stageOf("col_ship")).toBe("SHIPPED");
  });

  it("exposes stage-driven actions for any collaboration, not only demo handles", async () => {
    insertCollab("col_wendell", "Wendell Fishing", "INITIAL_CONTACT", { kol_uid: "KOLA58D2B0B4445431A9655" });
    const pipe = await (await request("GET", "/api/pipeline")).json();
    const card = Object.values(pipe.groups as Record<string, Json[]>)
      .flat()
      .find((row) => row.handle === "Wendell Fishing")!;
    const labels = ((card.actions as Json[]) || []).map((row) => row.label);
    expect(labels).toEqual(expect.arrayContaining(["写合作邮件", "记状态", "阶段SOP"]));
    expect(labels).not.toEqual(expect.arrayContaining(["回复分析", "达人画像", "生命周期看板"]));
    expect((card.actions as Json[]).every((row) => row.collaboration_id === "col_wendell")).toBe(true);
  });

  it("demo reset drops the persistent KOL thread so stage and chat stay aligned", async () => {
    const opened = await (await request("POST", "/api/collaborations/col_xiaomei/session", {})).json();
    await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Re: Hi",
      body: "Thank you for your email.",
    });
    const reset = await request("POST", "/api/demo/reset", { workbench: true });
    expect(reset.status).toBe(200);
    const again = await (await request("POST", "/api/collaborations/col_xiaomei/session", {})).json();
    expect(again.id).not.toBe(opened.id);
    const kinds = (await messages(String(again.id))).map((m) => m.kind);
    expect(kinds).not.toContain("kol_mail_card");
    expect(stageOf("col_xiaomei")).toBe("INITIAL_CONTACT");
  });

  it("writes session_id onto the home board after the KOL thread is opened", async () => {
    insertCollab("col_wendell", "Wendell Fishing", "INITIAL_CONTACT", { kol_uid: "KOLA58D2B0B4445431A9655" });
    const opened = await (await request("POST", "/api/collaborations/col_wendell/session", {})).json();
    const board = buildHomeBoard();
    const card = ((board.kols as Json[]) || []).find((row) => row.id === "col_wendell");
    expect(card?.session_id).toBe(opened.id);
  });

  it("keeps outbound and inbound cards, and does not use the LT placeholder as 收件", async () => {
    insertCollab("col_qiyou", "灵工连通测试-qiyou1984", "INITIAL_CONTACT", {
      email: "qiyou1984@gmail.com",
      kol_uid: "KOLQIYOU1984",
    });
    expect(getConn().prepare("SELECT mailbox_from FROM collaborations WHERE id='col_qiyou'").get())
      .toMatchObject({ mailbox_from: BRAND_MAILBOXES.LT });
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        if (name === "pageEmailConversations") {
          return {
            data: {
              list: [
                {
                  id: 320,
                  subject: "",
                  from: "黄启友 <qiyou1984@gmail.com>",
                  recipientEmail: "larry.zhao@amperetime.com",
                  mailboxEmail: "larry.zhao@amperetime.com",
                  direction: "inbound",
                  lastMessageAt: "2026-09-07T10:18:00.000Z",
                },
                {
                  id: 327,
                  subject: "LiTime MCP 连通测试",
                  recipientEmail: "qiyou1984@gmail.com",
                  direction: "outbound",
                  lastMessageAt: "2026-09-06T09:00:00.000Z",
                },
              ],
            },
          };
        }
        if (name === "getEmailConversationSubjectGroups") {
          return { data: { conversationId: args.conversationId || 320, list: [{ subject: "KOL合作", count: 1 }] } };
        }
        if (name === "getEmailConversation") {
          const id = String(args.conversationId || "");
          if (id === "327") {
            return {
              data: {
                id: 327,
                subject: "LiTime MCP 连通测试",
                messages: [{
                  id: "m327",
                  direction: "outbound",
                  from: "larry.zhao@amperetime.com",
                  body: "LiTime MCP 连通测试",
                  sentAt: "2026-09-06T09:00:00.000Z",
                }],
              },
            };
          }
          return {
            data: {
              id: 320,
              subject: "",
              messages: [{
                id: "m320",
                direction: "inbound",
                from: "黄启友 <qiyou1984@gmail.com>",
                fromName: "黄启友",
                to: "larry.zhao@amperetime.com",
                body: "这是一封测试邮件，请查收，我现在想和贵品牌litime合作",
                sentAt: "2026-09-07T10:18:00.000Z",
              }],
            },
          };
        }
        if (name === "previewEmailDraft") {
          return {
            data: {
              subject: "Re: KOL合作",
              body: "Hi Qiyou, thanks for reaching out — preview only.",
              to: ["qiyou1984@gmail.com"],
            },
          };
        }
        if (name === "sendEmailNow") {
          return {
            data: {
              id: 1210,
              state: "SENT",
              operation: "SYNC_SENT",
              messageId: "<d9fc15boienegtkbjsl24ovt1.DL9HYQ0FEX1F@amperetime.com>",
            },
          };
        }
        return { data: { list: [] } };
      },
      async close() { /* noop */ },
    }));
    const opened = await request("POST", "/api/collaborations/col_qiyou/session", {});
    expect(opened.status, await opened.text()).toBe(200);
    const sid = String((await opened.json()).id);
    let cards = (await messages(sid)).filter((m) => m.kind === "kol_mail_card");
    for (let i = 0; i < 20 && cards.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      cards = (await messages(sid)).filter((m) => m.kind === "kol_mail_card");
    }
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => (card.payload as Json).conversation_id)).toEqual(["327", "320"]);
    expect(cards.map((card) => (card.payload as Json).occurred_at)).toEqual([
      "2026-09-06T09:00:00.000Z",
      "2026-09-07T10:18:00.000Z",
    ]);
    const outbound = cards.find((card) => (card.payload as Json).conversation_id === "327")?.payload as Json;
    const inbound = cards.find((card) => (card.payload as Json).conversation_id === "320")?.payload as Json;
    expect(outbound).toMatchObject({
      direction: "outbound",
      subject: "LiTime MCP 连通测试",
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      mailbox: "larry.zhao@amperetime.com",
      occurred_at: "2026-09-06T09:00:00.000Z",
    });
    expect((outbound.judgment as Json).suggested_stage).toBeNull();
    expect(inbound).toMatchObject({
      direction: "inbound",
      conversation_id: "320",
      subject: "KOL合作",
      from: "qiyou1984@gmail.com",
      from_name: "黄启友",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      occurred_at: "2026-09-07T10:18:00.000Z",
    });
    expect(String(inbound.body)).toMatch(/想和贵品牌litime合作/);
    expect((inbound.judgment as Json).suggested_stage).toBe("INTERESTED");
    expect(inbound.auto_advanced).toBeNull();
    expect(JSON.stringify(cards)).not.toMatch(/kol\.lt@litime\.example/);
    expect(stageOf("col_qiyou")).toBe("INITIAL_CONTACT");

    const followup = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "给@灵工连通测试-qiyou1984 写跟进邮件",
      collaboration_id: "col_qiyou",
    });
    expect(followup.status, await followup.text()).toBe(200);
    const followupMsgs = await messages(sid);
    const followupDraft = followupMsgs.find((m) => m.kind === "email_card")!;
    expect(followupDraft.payload).toMatchObject({
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      subject: "Re: KOL合作",
    });
    expect(JSON.stringify(followupMsgs.filter((m) => m.kind === "sys_msg"))).not.toMatch(/黄条无确认按钮|正式阶段建议保持/);
    expect(stageOf("col_qiyou")).toBe("INITIAL_CONTACT");

    const replied = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "回复会话 320 发件: larry.zhao@amperetime.com 收件: qiyou1984@gmail.com 主题: Re: KOL合作",
      intent: "email_compose",
      collaboration_id: "col_qiyou",
      entities: {
        conversationId: 320,
        mailboxEmail: "larry.zhao@amperetime.com",
        to: ["qiyou1984@gmail.com"],
        subject: "Re: KOL合作",
        suggested_stage: "INTERESTED",
      },
    });
    expect(replied.status, await replied.text()).toBe(200);
    const after = await messages(sid);
    const result = [...after].reverse().find((m) => m.kind === "task_result_card")!;
    const draft = [...after].reverse().find((m) => m.kind === "email_card")!;
    expect(result).toBeTruthy();
    expect((result.payload as Json).reply_workbench).toBeUndefined();
    expect((result.payload as Json).recommended_actions).toEqual(expect.arrayContaining([
      "核对预览后回复「确认发送」",
    ]));
    expect(JSON.stringify((result.payload as Json).recommended_actions || [])).not.toMatch(/记状态/);
    expect(((result.payload as Json).sections as Json[]).map((row) => String(row.title)).join(" ")).not.toMatch(/SOP|生命周期|八个阶段/);
    expect(draft.payload).toMatchObject({
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      subject: "Re: KOL合作",
    });
    expect(stageOf("col_qiyou")).toBe("INITIAL_CONTACT");

    const sent = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "确认发送",
      collaboration_id: "col_qiyou",
    });
    expect(sent.status, await sent.text()).toBe(200);
    const afterSend = await messages(sid);
    const sentResult = [...afterSend].reverse().find((m) => m.kind === "task_result_card")!;
    expect(sentResult.payload).toMatchObject({ title: "邮件已发送" });
    expect(JSON.stringify((sentResult.payload as Json).sections)).not.toMatch(/还需要补充|这项信息|SYNC_SENT|摘要数据/);
    const outboundReply = afterSend
      .filter((m) => m.kind === "kol_mail_card")
      .map((m) => m.payload as Json)
      .find((payload) => payload.direction === "outbound" && payload.subject === "Re: KOL合作");
    expect(outboundReply).toMatchObject({
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
      mailbox: "larry.zhao@amperetime.com",
      conversation_id: "320",
    });
    expect(String(outboundReply?.occurred_at || "")).not.toBe("");
    expect(String(outboundReply?.body)).toMatch(/preview only/);
    expect(stageOf("col_qiyou")).toBe("INITIAL_CONTACT");
  });

  it("lets a person skip 寄样测评 and correct a wrong stage, while fact auto stays adjacent", async () => {
    insertCollab("col_skip_sample", "不寄样达人", "CONTRACTING", { kol_uid: "KOLSKIP001" });
    const opened = await request("POST", "/api/collaborations/col_skip_sample/session", {});
    const sid = String((await opened.json()).id);
    const skip = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "CONTENT_PLANNING",
      collaboration_id: "col_skip_sample",
      expected_version: 0,
      reason: "这次不寄样，直接内容策划",
    });
    expect(skip.status, await skip.text()).toBe(200);
    expect(stageOf("col_skip_sample")).toBe("CONTENT_PLANNING");
    const skipRow = getConn().prepare(
      "SELECT last_skip_kind, last_skip_reason, last_skipped_stages FROM collaborations WHERE id='col_skip_sample'",
    ).get() as { last_skip_kind?: string; last_skip_reason?: string; last_skipped_stages?: string };
    expect(skipRow.last_skip_kind).toBe("skip");
    expect(skipRow.last_skip_reason).toBe("这次不寄样，直接内容策划");
    expect(JSON.parse(String(skipRow.last_skipped_stages))).toEqual(["SAMPLE_PENDING", "SHIPPED", "TESTING"]);

    const missingReason = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "TESTING",
      collaboration_id: "col_skip_sample",
      expected_version: 1,
    });
    expect(missingReason.status).toBe(400);
    expect(await missingReason.text()).toMatch(/必须填写原因/);

    const correct = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "INTERESTED",
      collaboration_id: "col_skip_sample",
      expected_version: 1,
      reason: "前面把阶段记错了，回到意向",
    });
    expect(correct.status, await correct.text()).toBe(200);
    expect(stageOf("col_skip_sample")).toBe("INTERESTED");

    insertCollab("col_fact_adj", "物流达人", "SAMPLE_PENDING", { kol_uid: "KOLFACT001" });
    const fact = await request("POST", "/api/collaborations/col_fact_adj/ingest-mail", {
      subject: "Your LiTime Product Has Shipped",
      body: "The sample shipped via UPS. Tracking number 1Z999AA10123456784.",
      from: "ops@litime.example",
    });
    expect((await fact.json()).advanced).toMatchObject({ advanced: true, target: "SHIPPED" });
    expect(stageOf("col_fact_adj")).toBe("SHIPPED");
  });
});
