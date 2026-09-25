import { withMailSendAuthority } from "../src/gateway/mail-authority.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRAND_MAILBOXES, PERSONAS } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { EMAIL_TEMPLATES, templateAllowedForStage } from "../src/email-templates.js";
import { brandOfMailbox, enforceSend, PepFail, resolveAuthorizedFrom } from "../src/host/pep.js";
import { seedAll } from "../src/seed.js";
import { MAIN_STAGES } from "../src/stages.js";
import { judgeCollaborationStage } from "../src/stage-judgment.js";
import {
  emailMcpResultCard,
  executeEmailMcpTask,
  setEmailMcpClientFactory,
} from "../src/starrykol/service.js";
import type { Json, Row } from "../src/types.js";
import {
  CONNECTIVITY_TEST_EMAILS,
  LARRY_ZHAO_MAILBOX,
  mailboxBindRows,
  larryZhaoEmailScenarios,
  portraitRows,
  starryMailboxes,
  starryProfiles,
} from "./fixtures/real-data/load.js";

const fixture = larryZhaoEmailScenarios();
const calls: Array<{ name: string; args: Json }> = [];

function allowedRecipientEmails(): Set<string> {
  const emails = new Set<string>([...CONNECTIVITY_TEST_EMAILS]);
  for (const row of portraitRows()) {
    const email = String(row["邮箱"] || "").trim().toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

function mockMcp(overrides: Partial<Record<string, (args: Json) => Json | Promise<Json>>> = {}) {
  const mailboxes = starryMailboxes();
  return {
    async callTool(name: string, args: Json = {}): Promise<Json> {
      calls.push({ name, args });
      const override = overrides[name];
      if (override) return override(args);
      if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
      if (name === "pageMailboxes") return { data: { total: mailboxes.length, list: mailboxes } };
      if (name === "listNylasAccounts") return { data: { items: [] } };
      if (name === "pageEmailConversations") return { data: { pageNo: 1, pageSize: 10, total: 0, list: [] } };
      if (name === "pageKolProfiles" || name === "listAllKolProfiles") return { data: { total: 0, list: [] } };
      if (name === "createEmailConversation") return { data: { id: 101, conversationId: 101 } };
      if (name === "previewEmailDraft") {
        return { data: { subject: String(args.requestJson || "preview"), body: "Preview only.", sent: false } };
      }
      if (name === "sendEmailNow") return { data: { sent: true, conversationId: args.conversationId || 101 } };
      if (name === "addKolProfile") return { data: { kolUid: "KOLTESTHOLLY" } };
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

describe("larry.zhao mailbox facts from the real snapshot", () => {
  it("locks the sender to MCP mailbox id 6 / 赵良玉 / RO / 已移交", () => {
    const mailbox = starryMailboxes().find((row) => row.mailboxEmail === LARRY_ZHAO_MAILBOX) as Json;
    expect(mailbox).toBeTruthy();
    expect(fixture.sender.mailboxEmail).toBe(LARRY_ZHAO_MAILBOX);
    expect(mailbox).toMatchObject({
      id: 6,
      mailboxEmail: LARRY_ZHAO_MAILBOX,
      brandCode: "RO",
      ownerUserName: "赵良玉",
      responsibleStatus: 2,
      transferToUserName: "魏银平",
      permissionSummary: "赵良玉：查看/收发/管理",
    });
    expect(mailboxBindRows().some((row) => row["邮箱地址"] === LARRY_ZHAO_MAILBOX)).toBe(false);
    expect(brandOfMailbox(LARRY_ZHAO_MAILBOX)).toBeNull();
    expect(Object.values(BRAND_MAILBOXES)).not.toContain(LARRY_ZHAO_MAILBOX);
    expect(resolveAuthorizedFrom(LARRY_ZHAO_MAILBOX, PERSONAS.sriphy, "RO")).toMatchObject({
      email: BRAND_MAILBOXES.RO,
      brand: "RO",
      matched: false,
    });
    expect(starryMailboxes()[0].mailboxEmail).toBe("henry.wei@amperetime.com");
  });

  it("only uses known recipient emails and never invents Charlie / 赵良玉-owned plaintext", () => {
    const allowed = allowedRecipientEmails();
    for (const row of fixture.recipients) {
      if (!row.email) {
        expect(["charlie", "zhao_qq01", "zhao_test1", "zhao_test_1"]).toContain(row.id);
        continue;
      }
      expect(allowed.has(row.email.toLowerCase()), row.email).toBe(true);
      if (row.emailSource === "portrait_sheet") {
        expect(JSON.stringify(starryProfiles())).not.toContain(row.email);
      }
    }
    expect(fixture.recipients.find((row) => row.id === "holly")?.inMcp220).toBe(false);
    expect(starryProfiles().some((row) => row.kolName === "Holly Yoo")).toBe(false);
    expect(fixture.recipients.find((row) => row.id === "wendell")?.kolUid).toBe("KOLA58D2B0B4445431A9655");
    expect(fixture.recipients.find((row) => row.id === "rv_life")?.email).toBe("wendellfishing@gmail.com");
    expect(fixture.recipients.find((row) => row.id === "charlie")?.email).toBe("");
  });
});

describe("inbound paste into larry.zhao covers every judgment scenario", () => {
  it("addresses every inbound case to larry.zhao and never decrypts", () => {
    for (const row of fixture.inbound) {
      if (row.expect.skip_email) {
        expect(row.from).toBe("");
        expect(row.kol_name).toBe("Charlie at RV Central");
        continue;
      }
      expect([row.from, row.to]).toContain(LARRY_ZHAO_MAILBOX);
      expect(JSON.stringify(row)).not.toContain("decryptKolContact");
    }
  });

  it("judges each inbound body with the official weight rules", () => {
    for (const row of fixture.inbound) {
      if (row.expect.skip_email) continue;
      const result = judgeCollaborationStage({
        subject: row.subject,
        body: row.body,
        attachments: row.attachments,
        fulfillment: row.fulfillment,
        current_stage: row.current_stage,
      });
      if (row.expect.suggested_stage !== undefined) {
        expect(result.suggested_stage, row.id).toBe(row.expect.suggested_stage);
      }
      if (Array.isArray(row.expect.flags)) {
        for (const flag of row.expect.flags) {
          expect(result.flags, row.id).toContain(flag);
        }
      }
      if (row.expect.auto_propose !== undefined) {
        expect(result.auto_propose, row.id).toBe(row.expect.auto_propose);
      }
      if (row.expect.confidence) {
        expect(result.confidence, row.id).toBe(row.expect.confidence);
      }
      if (row.expect.evidence_source) {
        expect(result.evidence.some((hit) => hit.source === row.expect.evidence_source), row.id).toBe(true);
      }
    }
  });

  it("covers the 14 post-contact main stages plus pause/reject/cancel and long-term flags", () => {
    const judged = new Set(
      fixture.inbound
        .map((row) => row.expect.suggested_stage)
        .filter((stage): stage is string => typeof stage === "string" && Boolean(stage)),
    );
    const mainAfterContact = MAIN_STAGES.map((stage) => stage.code).filter((code) => code !== "INITIAL_CONTACT");
    for (const code of mainAfterContact) {
      expect(judged.has(code), code).toBe(true);
    }
    expect(judged.has("PAUSED")).toBe(true);
    expect(judged.has("REJECTED")).toBe(true);
    expect(judged.has("CANCELLED")).toBe(true);
    const flags = new Set(fixture.inbound.flatMap((row) => (row.expect.flags as string[]) || []));
    for (const flag of ["thank_you_only", "please_confirm", "delay_care", "lost_contact", "revision_pending", "affiliate", "content_license", "repeat_collab", "invoice_unpaid", "paid", "later_not_reject"]) {
      expect(flags.has(flag), flag).toBe(true);
    }
  });
});

describe("MCP compose with From locked to larry.zhao", () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lz-mail-"));
    process.env.LG_DATA_DIR = tmp;
    resetConn();
    seedAll();
    calls.length = 0;
    setEmailMcpClientFactory(() => mockMcp());
  });

  afterEach(() => {
    getConn().close();
    setEmailMcpClientFactory();
  });

  it("lists the real larry.zhao mailbox", async () => {
    const { data } = await executeEmailMcpTask("email_mailbox_list", {});
    const list = data.list as Json[];
    expect(list.some((row) => row.mailboxEmail === LARRY_ZHAO_MAILBOX && row.ownerUserName === "赵良玉")).toBe(true);
    expect(calls.map((item) => item.name)).toContain("pageMailboxes");
  });

  it("explains an empty conversation list for Wendell's portrait-sheet email", async () => {
    const listed = await executeEmailMcpTask("email_conversation_list", { to: "wendellfishing@gmail.com" });
    expect(listed.data.total).toBe(0);
    const card = emailMcpResultCard("email_conversation_list", listed.data);
    expect(card.summary).toContain("wendellfishing@gmail.com");
    expect(JSON.stringify(card.sections)).toContain("不是 Gmail / 163 收件箱");
  });

  it("asks for conversationId before reading a thread", async () => {
    const read = await executeEmailMcpTask("email_conversation_read", {});
    expect(calls).toEqual([]);
    expect(read.data).toMatchObject({ needs_input: true, missing_fields: ["conversationId"] });
  });

  it("previews then sends Wendell mail through larry.zhao, never henry.wei", async () => {
    const preview = await executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-01")?.entities || {});
    expect(calls.map((item) => item.name).filter((name) => !["pageMailboxes", "pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual(["createEmailConversation", "previewEmailDraft"]);
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY_ZHAO_MAILBOX,
      recipientEmail: "wendellfishing@gmail.com",
      kolUid: "KOLA58D2B0B4445431A9655",
    });
    expect(preview.data).toMatchObject({ sent: false, conversationId: 101 });

    calls.length = 0;
    const sent = await withMailSendAuthority("adapter-LZ-OUT-MCP-02", "confirmed-LZ-OUT-MCP-02", () => executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-02")?.entities || {}));
    expect(calls.map((item) => item.name)).toEqual(["sendEmailNow"]);
    expect(sent.data).toMatchObject({ sent: true, conversationId: 101 });
    expect(JSON.stringify(calls)).not.toContain("henry.wei@amperetime.com");
  });

  it("keeps multi-to connectivity mail on larry.zhao", async () => {
    const sent = await withMailSendAuthority("adapter-LZ-OUT-MCP-04", "confirmed-LZ-OUT-MCP-04", () => executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-04")?.entities || {}));
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY_ZHAO_MAILBOX,
      recipientEmail: "qiyou1984@gmail.com",
    });
    expect(JSON.parse(String(calls.find((row) => row.name === "sendEmailNow")?.args.requestJson))).toMatchObject({
      recipientEmail: "qiyou1984@gmail.com",
      subject: "LiTime MCP 连通测试",
    });
    expect(sent.data.sent).toBe(true);
  });

  it("creates a Holly profile then retries on larry.zhao", async () => {
    let created = 0;
    setEmailMcpClientFactory(() => mockMcp({
      createEmailConversation(args) {
        created += 1;
        if (created === 1) throw new Error("红人画像不存在");
        return { data: { id: 202, conversationId: 202 } };
      },
      addKolProfile() {
        return { data: { kolUid: "KOLTESTHOLLY" } };
      },
    }));
    const preview = await executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-05")?.entities || {});
    expect(calls.map((item) => item.name).filter((name) => !["pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual([
      "pageMailboxes",
      "createEmailConversation",
      "addKolProfile",
      "createEmailConversation",
      "previewEmailDraft",
    ]);
    expect(JSON.parse(String(calls.find((row) => row.name === "addKolProfile")?.args.requestJson))).toMatchObject({
      kolName: "Holly Yoo",
      contactEmail: "heyhollyyoo@gmail.com",
      mailboxEmail: LARRY_ZHAO_MAILBOX,
      ownerMailbox: LARRY_ZHAO_MAILBOX,
      ownerUserName: "赵良玉",
    });
    const retry = calls.filter((row) => row.name === "createEmailConversation")[1];
    expect(JSON.parse(String(retry?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY_ZHAO_MAILBOX,
      recipientEmail: "heyhollyyoo@gmail.com",
    });
    expect(preview.data).toMatchObject({ sent: false, conversationId: 202 });
  });

  it("does not call MCP when Charlie / missing To / Zhao-owned profile has no email", async () => {
    for (const id of ["LZ-OUT-MCP-07", "LZ-OUT-MCP-08", "LZ-OUT-MCP-14"]) {
      calls.length = 0;
      const row = fixture.outbound_mcp.find((item) => item.id === id)!;
      const result = await executeEmailMcpTask("email_compose", row.entities || {});
      expect(calls, id).toEqual([]);
      expect(result.data.needs_input, id).toBe(true);
      expect(result.data.missing_fields, id).toContain("to");
      expect(result.data.missing_fields, id).not.toContain("conversationId");
    }
  });

  it("omitting mailboxEmail asks for 发件邮箱 instead of defaulting henry.wei", async () => {
    const preview = await executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-09")?.entities || {});
    expect(calls).toEqual([]);
    expect(preview.data).toMatchObject({
      needs_input: true,
      missing_fields: ["mailboxEmail"],
    });
    expect(String(preview.data.error)).toContain("发件邮箱");
    expect(JSON.stringify(preview.data)).not.toContain("henry.wei@amperetime.com");
    expect(fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-09")?.expect?.requiredMailboxEmail).toBe(LARRY_ZHAO_MAILBOX);
  });

  it("explains a taken contact email and a mailbox-owner gap", async () => {
    setEmailMcpClientFactory(() => mockMcp({
      createEmailConversation() { throw new Error("红人画像不存在"); },
      addKolProfile() { throw new Error("联系邮箱已被其他红人占用"); },
    }));
    const taken = await executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-12")?.entities || {});
    expect(taken.data.error).toBe("联系邮箱已被其他红人占用");
    expect(emailMcpResultCard("email_compose", taken.data).summary).toContain("已有红人画像");

    calls.length = 0;
    setEmailMcpClientFactory(() => mockMcp({
      createEmailConversation() { throw new Error("红人画像不存在"); },
      addKolProfile() { throw new Error("负责人无可用邮箱"); },
    }));
    const owner = await executeEmailMcpTask("email_compose", fixture.outbound_mcp.find((row) => row.id === "LZ-OUT-MCP-13")?.entities || {});
    expect(owner.data).toMatchObject({ needs_input: true, error: "负责人无可用邮箱", missing_fields: [] });
    expect(emailMcpResultCard("email_compose", owner.data).summary).toContain("已在授权列表中");
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson)).mailboxEmail).toBe(LARRY_ZHAO_MAILBOX);
  });
});

describe("Host PEP stage letters cannot use larry.zhao as From", () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lz-pep-"));
    process.env.LG_DATA_DIR = tmp;
    resetConn();
    seedAll();
  });

  afterEach(() => {
    getConn().close();
  });

  it("covers every official template and the nudge / quote / Chinese gates", () => {
    const templateIds = new Set(fixture.outbound_host.map((row) => row.template_id).filter(Boolean));
    for (const template of EMAIL_TEMPLATES) {
      expect(templateIds.has(template.id), template.id).toBe(true);
    }
    expect(templateAllowedForStage("content_nudge.outline", "INITIAL_CONTACT")).toBe(false);
    expect(templateAllowedForStage("content_nudge.outline", "TESTING")).toBe(true);
  });

  it("rejects larry.zhao on the Host From whitelist", () => {
    const row = fixture.outbound_host.find((item) => item.id === "LZ-OUT-HOST-00")!;
    expect(() => enforceSend({
      from_addr: row.from_requested,
      to_addr: row.to,
      subject: row.subject,
      body_en: row.body_en,
      skill: row.skill,
      template_id: row.template_id,
      official_stage: row.official_stage,
    } as Row, PERSONAS.sriphy)).toThrow(PepFail);
    try {
      enforceSend({
        from_addr: row.from_requested,
        to_addr: row.to,
        subject: row.subject,
        body_en: row.body_en,
        skill: row.skill,
        template_id: row.template_id,
        official_stage: row.official_stage,
      } as Row, PERSONAS.sriphy);
    } catch (error) {
      expect(error).toBeInstanceOf(PepFail);
      expect((error as PepFail).status).toBe("blocked_permission");
      expect((error as PepFail).http).toBe(403);
      expect((error as Error).message).toMatch(/From 必须是品牌邮箱/);
    }
  });

  it("allows a catalog first-touch letter only from the PEP LT mailbox", () => {
    const result = enforceSend({
      from_addr: BRAND_MAILBOXES.LT,
      to_addr: "wendellfishing@gmail.com",
      subject: "Collaboration Opportunity with LiTime",
      body_en: EMAIL_TEMPLATES.find((row) => row.id === "kol.first_touch")!.body_en,
      skill: "kol",
      template_id: "kol.first_touch",
      official_stage: "INITIAL_CONTACT",
      keep_stage: true,
    } as Row, PERSONAS.sriphy);
    expect(result).toMatchObject({ from_addr: BRAND_MAILBOXES.LT, brand: "LT", keep_stage: true });
  });

  it("requires internal Cc on a <$350 quote and strips Chinese", () => {
    expect(() => enforceSend({
      from_addr: BRAND_MAILBOXES.LT,
      to_addr: "wendellfishing@gmail.com",
      subject: "LiTime collaboration quote",
      body_en: EMAIL_TEMPLATES.find((row) => row.id === "quote_confirm.v1")!.body_en,
      skill: "quote_confirm",
      template_id: "quote_confirm.v1",
      official_stage: "QUOTE_PENDING",
      amount_usd: 280,
      cc: "",
    } as Row, PERSONAS.sriphy)).toThrow(/金额 <\$350 必须抄送/);

    const ok = enforceSend({
      from_addr: BRAND_MAILBOXES.LT,
      to_addr: "wendellfishing@gmail.com",
      subject: "LiTime collaboration quote",
      body_en: EMAIL_TEMPLATES.find((row) => row.id === "quote_confirm.v1")!.body_en,
      skill: "quote_confirm",
      template_id: "quote_confirm.v1",
      official_stage: "QUOTE_PENDING",
      amount_usd: 280,
      cc: "sriphy@litime.example",
    } as Row, PERSONAS.sriphy);
    expect(ok.cc).toBe("sriphy@litime.example");

    const stripped = enforceSend({
      from_addr: BRAND_MAILBOXES.LT,
      to_addr: "wendellfishing@gmail.com",
      subject: "Collaboration Opportunity with LiTime",
      body_en: "Hi, we would love to collaborate. 你好想合作",
      skill: "kol",
      template_id: "kol.first_touch",
      official_stage: "INITIAL_CONTACT",
    } as Row, PERSONAS.sriphy);
    expect(stripped.zh_stripped).toBe(true);
    expect(String(stripped.body)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(String(stripped.body)).toContain("we would love to collaborate");
  });

  it("lets MCP compose drafts use the Host From whitelist without a catalog template id", () => {
    const result = enforceSend({
      from_addr: BRAND_MAILBOXES.RO,
      to_addr: "wendellfishing@gmail.com",
      subject: "LiTime MCP 连通测试",
      body_en: "Hi, preview only.",
      skill: "email_compose",
      template_id: "email_compose.v1",
      official_stage: "INITIAL_CONTACT",
      keep_stage: true,
    } as Row, PERSONAS.sriphy);
    expect(result).toMatchObject({ from_addr: BRAND_MAILBOXES.RO, brand: "RO", keep_stage: true });
  });
});
