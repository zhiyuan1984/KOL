import { withMailSendAuthority } from "../src/gateway/mail-authority.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import {
  describeStarryActor,
  emailMcpResultCard,
  executeEmailMcpTask,
  lastComposeFollowup,
  lastKolMailReply,
  resolveComposeSubject,
  setEmailMcpClientFactory,
} from "../src/starrykol/service.js";
import { extractTaskEntities, resolveTaskIntent, stubResolveTaskIntent } from "../src/tasks/resolver.js";
import type { Json } from "../src/types.js";
import { completeTurnItems } from "../src/worker/session-items.js";

const LARRY = "larry.zhao@amperetime.com";
const QIYOU = "qiyou1984@gmail.com";
const QQ = "100705721@qq.com";
const LABELED = `首封建联 发件箱 ${LARRY} 发给 ${QIYOU} 主题：LiTime Mini 12V — weekend van test`;
const OPERATOR = `首封建联 发件: ${LARRY} 收件: ${QQ} 主题: LiTime MCP 连通测试`;
const UNLABELED = `首封建联 发送给 ${LARRY} ${QIYOU}`;

const calls: Array<{ name: string; args: Json }> = [];

describe("first-touch Skill required_inputs: 发件 / 收件 / 主题", () => {
  it("extracts labeled 发件箱 / 发给 / 主题 and does not ask for 会话编号", () => {
    const entities = extractTaskEntities(LABELED);
    expect(entities.mailboxEmail).toBe(LARRY);
    expect(entities.to).toEqual([QIYOU]);
    expect(entities.subject).toBe("LiTime Mini 12V — weekend van test");
    expect(entities.handle).toBeUndefined();
    expect(extractTaskEntities(OPERATOR).handle).toBeUndefined();
    expect(extractTaskEntities("加一封")).toMatchObject({ another_letter: true });
    expect(stubResolveTaskIntent({ text: "加一封" }).task_type).toBe("email_compose");
    const resolved = stubResolveTaskIntent({ text: LABELED });
    expect(resolved).toMatchObject({
      task_type: "email_compose",
      needs_clarification: false,
      missing_fields: [],
    });
    expect(resolved.missing_fields).not.toContain("conversationId");
  });

  it("keeps unlabeled emails as To and asks for 发件邮箱 + 主题", () => {
    const entities = extractTaskEntities(UNLABELED);
    expect(entities.mailboxEmail).toBeUndefined();
    expect(entities.to).toEqual([LARRY, QIYOU]);
    const resolved = stubResolveTaskIntent({ text: UNLABELED });
    expect(resolved.task_type).toBe("email_compose");
    expect(resolved.needs_clarification).toBe(true);
    expect(resolved.missing_fields).toEqual(["mailboxEmail", "subject"]);
    expect(resolved.missing_fields).not.toContain("conversationId");
  });

  it("keeps two personal inboxes as To and still requires 发件箱", () => {
    const entities = extractTaskEntities(`写合作邮件 ${QIYOU} qiyouhuang@163.com`);
    expect(entities.mailboxEmail).toBeUndefined();
    expect(entities.to).toEqual([QIYOU, "qiyouhuang@163.com"]);
    expect(stubResolveTaskIntent({ text: `写合作邮件 ${QIYOU} qiyouhuang@163.com` }).missing_fields)
      .toEqual(["mailboxEmail", "subject"]);
  });

  it("extracts 发件: / 收件: / 主题: from the operator sentence", () => {
    const entities = extractTaskEntities(OPERATOR);
    expect(entities.mailboxEmail).toBe(LARRY);
    expect(entities.to).toEqual([QQ]);
    expect(entities.subject).toBe("LiTime MCP 连通测试");
    const resolved = stubResolveTaskIntent({ text: OPERATOR });
    expect(resolved).toMatchObject({
      task_type: "email_compose",
      needs_clarification: false,
      clarification_kind: "none",
      missing_fields: [],
    });
  });

  it("does not put a lone 发件箱 address into To", () => {
    const entities = extractTaskEntities(`首封建联 发件箱 ${LARRY}`);
    expect(entities.mailboxEmail).toBe(LARRY);
    expect(entities.to).toBeUndefined();
    expect(stubResolveTaskIntent({ text: `首封建联 发件箱 ${LARRY}` }).missing_fields)
      .toEqual(["to", "subject"]);
  });

  it("does not treat @写合作邮件 as a bound KOL handle", () => {
    expect(extractTaskEntities("@写合作邮件").handle).toBeUndefined();
    expect(extractTaskEntities("@写合作邮件 @小美妆日记").handle).toBe("小美妆日记");
    const resolved = stubResolveTaskIntent({ text: "@写合作邮件", task_type: "email_compose" });
    expect(resolved.task_type).toBe("email_compose");
    expect(resolved.needs_clarification).toBe(true);
    expect(resolved.missing_fields).toEqual(["mailboxEmail", "to", "subject"]);
  });
});

describe("compose never asks first-touch for a conversation id", () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ft-mail-"));
    process.env.LINGONG_DATA = tmp;
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LG_DATA_DIR = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    seedAll();
    calls.length = 0;
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          return { data: { id: 303, conversationId: 303 } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime Mini 12V — weekend van test", body: "Preview", to: [QIYOU] } };
        }
        if (name === "sendEmailNow") {
          return { data: { ok: true, sent: true, conversationId: args.conversationId || 303 } };
        }
        if (name === "pageKolProfiles" || name === "listAllKolProfiles" || name === "pageEmailConversations") {
          return { data: { total: 0, list: [] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱不能与邮箱权限管理中的负责人邮箱重复");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
  });

  afterEach(() => {
    getConn().close();
    setEmailMcpClientFactory();
  });

  it("previews labeled 首封建联 through the mailbox the operator named", async () => {
    const entities = extractTaskEntities(LABELED);
    const preview = await executeEmailMcpTask("email_compose", { ...entities, prompt: LABELED, raw: LABELED });
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QIYOU,
    });
    expect(preview.data).toMatchObject({ sent: false, mailboxEmail: LARRY, to: [QIYOU] });
    expect(preview.data.needs_input).not.toBe(true);
    const card = emailMcpResultCard("email_compose", preview.data);
    expect(JSON.stringify(card.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card.sections)).toContain(`收件邮箱：${QIYOU}`);
    expect(String(card.summary)).not.toMatch(/MCP/i);
    expect(JSON.stringify(card.sections)).not.toMatch(/MCP/i);
    expect(JSON.stringify(card.recommended_actions)).not.toMatch(/MCP/i);
    expect(String(card.summary)).toContain("确认发送");
    expect(JSON.stringify(card.sections)).toContain("预览正文");
    expect(JSON.stringify(card.sections)).not.toContain("这项信息");
  });

  it("translates owner-mailbox-as-To and names that mailbox, without asking for 邮件会话", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "addKolProfile") throw new Error("联系邮箱不能与邮箱权限管理中的负责人邮箱重复");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      to: LARRY,
      mailboxEmail: "henry.wei@amperetime.com",
      subject: "LiTime Mini 12V — weekend van test",
      prompt: `首封建联 发件箱 henry.wei@amperetime.com 发给 ${LARRY} 主题：LiTime Mini 12V — weekend van test`,
    });
    expect(compose.data.needs_input).toBe(true);
    expect(compose.data.missing_fields).toEqual(["to"]);
    expect(compose.data.missing_fields).not.toContain("conversationId");
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(String(card.summary)).toContain(LARRY);
    expect(String(card.summary)).toContain("不能当作红人收件邮箱");
    expect(String(card.summary)).not.toMatch(/MCP/i);
    expect(JSON.stringify(card.sections)).toContain("发件邮箱");
    expect(JSON.stringify(card.sections)).toContain("收件邮箱");
    expect(JSON.stringify(card.sections)).not.toContain("邮件会话");
    expect(JSON.stringify(card.recommended_actions)).not.toMatch(/MCP/i);
  });

  it("names the mailbox that has no send permission", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "addKolProfile") throw new Error("负责人无可用邮箱");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      to: QIYOU,
      mailboxEmail: LARRY,
      subject: "LiTime Mini 12V — weekend van test",
      prompt: LABELED,
    });
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(compose.data.missing_fields).toEqual(["mailboxEmail"]);
    expect(String(card.summary)).toContain(LARRY);
    expect(String(card.summary)).toContain("未授权给当前账号");
    expect(String(card.summary)).not.toMatch(/MCP/i);
    expect(JSON.stringify(card.recommended_actions)).not.toMatch(/MCP/i);
  });

  it("names the 灵工 login and Starry identity when the portrait is out of scope", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles" || name === "listAllKolProfiles") return { data: { total: 0, list: [] } };
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    const card = emailMcpResultCard("email_compose", compose.data);
    const actor = describeStarryActor();
    expect(String(actor.label)).toContain("灵工登录");
    expect(String(actor.label)).toContain("Starry 身份");
    expect(String(card.summary)).toContain("灵工登录");
    expect(String(card.summary)).toContain("Starry 身份");
    expect(String(card.summary)).toContain("不要换收件邮箱");
    expect(compose.data.missing_fields).toEqual([]);
  });

  it("creates the conversation with the host Starry identity when only the gateway can see the QQ portrait", async () => {
    let allCalls = 0;
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 707, conversationId: 707 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") return { data: { total: 0, list: [] } };
        if (name === "listAllKolProfiles") {
          allCalls += 1;
          if (allCalls === 1) return { data: { total: 0, list: [] } };
          return { data: { total: 1, list: [{
            kolUid: "KOL9D62420657814F6BAEC8",
            kolName: "测试网红-qq-01",
            contactEmail: QQ,
            ownerUserName: "赵良玉",
          }] } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(compose.data).toMatchObject({ sent: false, conversationId: 707, mailboxEmail: LARRY, to: [QQ] });
    expect(compose.data.needs_input).not.toBe(true);
    expect(emailMcpResultCard("email_compose", compose.data).summary).not.toContain("看不见");
  });

  it("reuses the existing QQ profile when addKolProfile says the email is taken", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 606, conversationId: 606 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          return { data: { total: 1, list: [{
            kolUid: "KOL9D62420657814F6BAEC8",
            kolName: "测试网红-qq-01",
            contactEmail: QQ,
            ownerUserName: "赵良玉",
          }] } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(calls.some((row) => row.name === "pageKolProfiles")).toBe(true);
    const retry = calls.filter((row) => row.name === "createEmailConversation").at(-1);
    expect(JSON.parse(String(retry?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
      kolUid: "KOL9D62420657814F6BAEC8",
    });
    expect(compose.data).toMatchObject({ sent: false, conversationId: 606, mailboxEmail: LARRY, to: [QQ] });
    expect(compose.data.needs_input).not.toBe(true);
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(String(card.summary)).not.toContain("不在当前账号可见范围内");
    expect(String(card.summary)).not.toContain("请换一个可见的收件邮箱");
  });

  it("previews when keyword page returns the followed QQ portrait without contactEmail", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 808, conversationId: 808 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          return { data: { total: 1, list: [{
            kolUid: "KOL9D62420657814F6BAEC8",
            kolName: "测试网红-qq-01",
            ownerUserName: "赵良玉",
            ownerMailbox: LARRY,
          }] } };
        }
        if (name === "listAllKolProfiles" || name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(calls.some((row) => row.name === "decryptKolContact")).toBe(false);
    expect(JSON.parse(String(calls.filter((row) => row.name === "createEmailConversation").at(-1)?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
      kolUid: "KOL9D62420657814F6BAEC8",
    });
    expect(compose.data).toMatchObject({ sent: false, conversationId: 808, mailboxEmail: LARRY, to: [QQ] });
    expect(emailMcpResultCard("email_compose", compose.data).summary).not.toContain("看不见");
  });

  it("retries create with the host Starry identity when the bound JWT can list but not create", async () => {
    let uidCreates = 0;
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            uidCreates += 1;
            if (uidCreates === 1) throw new Error("红人画像不存在");
            return { data: { id: 813, conversationId: 813 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          let keyword = "";
          try {
            keyword = String(JSON.parse(String(args.requestJson || "{}")).keyword || "");
          } catch {
            keyword = "";
          }
          if (keyword === "100705721") {
            return { data: { total: 1, list: [{
              kolUid: "KOL9D62420657814F6BAEC8",
              kolName: "测试网红-qq-01",
              ownerUserName: "赵良玉",
              ownerMailbox: LARRY,
            }] } };
          }
          return { data: { total: 0, list: [] } };
        }
        if (name === "listAllKolProfiles" || name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(uidCreates).toBe(2);
    expect(calls.filter((row) => row.name === "createEmailConversation")).toHaveLength(2);
    expect(compose.data).toMatchObject({ sent: false, conversationId: 813, mailboxEmail: LARRY, to: [QQ] });
    expect(compose.data.needs_input).not.toBe(true);
    expect(String(emailMcpResultCard("email_compose", compose.data).summary)).not.toContain("还没有红人画像");
    expect(String(emailMcpResultCard("email_compose", compose.data).summary)).not.toContain("看不见");
  });

  it("writes the operator To onto the followed portrait when create still misses", async () => {
    let bound = false;
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8" && bound) {
            return { data: { id: 814, conversationId: 814 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "updateKolProfile") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          expect(body).toMatchObject({
            kolUid: "KOL9D62420657814F6BAEC8",
            contactEmail: QQ,
          });
          bound = true;
          return { data: { ok: true, kolUid: "KOL9D62420657814F6BAEC8" } };
        }
        if (name === "pageKolProfiles") {
          let keyword = "";
          try {
            keyword = String(JSON.parse(String(args.requestJson || "{}")).keyword || "");
          } catch {
            keyword = "";
          }
          if (keyword === "100705721") {
            return { data: { total: 1, list: [{
              kolUid: "KOL9D62420657814F6BAEC8",
              kolName: "测试网红-qq-01",
              ownerUserName: "赵良玉",
              ownerMailbox: LARRY,
            }] } };
          }
          return { data: { total: 0, list: [] } };
        }
        if (name === "listAllKolProfiles" || name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(bound).toBe(true);
    expect(calls.some((row) => row.name === "updateKolProfile")).toBe(true);
    expect(calls.some((row) => row.name === "decryptKolContact")).toBe(false);
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
    });
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson)).mailboxId).toBeUndefined();
    expect(compose.data).toMatchObject({ sent: false, conversationId: 814, mailboxEmail: LARRY, to: [QQ] });
    expect(compose.data.needs_input).not.toBe(true);
    expect(String(emailMcpResultCard("email_compose", compose.data).summary)).not.toContain("还没有红人画像");
  });

  it("creates the QQ thread with Starry kolId when kolUid create is rejected", async () => {
    const QQ_UID = "KOL51DA646D8D8A4544BB93";
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (Number(body.kolId) === 390 && String(body.mailboxEmail) === LARRY && String(body.recipientEmail) === QQ) {
            return { data: { id: 326, conversationId: 326, mailboxEmail: LARRY } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          let keyword = "";
          try {
            keyword = String(JSON.parse(String(args.requestJson || "{}")).keyword || "");
          } catch {
            keyword = "";
          }
          if (keyword === QQ) return { data: { total: 0, list: [] } };
          if (keyword === "100705721") {
            return { data: { total: 1, list: [{
              kolUid: QQ_UID,
              kolId: 390,
              kolName: "100705721",
              contactEmailMasked: "1***@qq.com",
              ownerName: "赵良玉",
              ownerOpenId: "273",
            }] } };
          }
          return { data: { total: 0, list: [] } };
        }
        if (name === "listAllKolProfiles" || name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    const created = calls.filter((row) => row.name === "createEmailConversation").at(-1);
    expect(JSON.parse(String(created?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
      kolId: 390,
      subject: "LiTime MCP 连通测试",
    });
    expect(JSON.parse(String(created?.args.requestJson)).kolUid).toBeUndefined();
    expect(compose.data).toMatchObject({ sent: false, conversationId: 326, mailboxEmail: LARRY, to: [QQ] });
    expect(compose.data.needs_input).not.toBe(true);
    expect(String(emailMcpResultCard("email_compose", compose.data).summary)).not.toContain("没对上跟进编号");
  });

  it("reuses lastConversationId when that thread is already on larry.zhao", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "pageKolProfiles") {
          return { data: { total: 1, list: [{
            kolUid: "KOL51DA646D8D8A4544BB93",
            kolId: 390,
            lastConversationId: 324,
            contactEmailMasked: "1***@qq.com",
            ownerName: "赵良玉",
          }] } };
        }
        if (name === "getEmailConversation") {
          return { data: { id: 324, mailboxEmail: LARRY, operatorMailboxEmail: LARRY, kolEmail: QQ } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(calls.some((row) => row.name === "createEmailConversation")).toBe(false);
    expect(calls.some((row) => row.name === "getEmailConversation")).toBe(true);
    expect(compose.data).toMatchObject({ sent: false, conversationId: 324, mailboxEmail: LARRY, to: [QQ] });
  });

  it("prefers Starry kolId over a local fixture kolUid for the same QQ", async () => {
    getConn().prepare(
      `INSERT OR REPLACE INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
        stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_qq_fixture",
      "测试网红-qq-01",
      "测试网红-qq-01",
      "LT",
      "",
      "",
      QQ,
      LARRY,
      "lc_qq_fixture",
      "conv_qq_fixture",
      "INITIAL_CONTACT",
      1,
      "",
      0,
      0,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      0,
    );
    getConn().prepare(
      "UPDATE collaborations SET owner_name=?, owner_mailbox=?, kol_uid=? WHERE id=?",
    ).run("赵良玉", LARRY, "KOL9D62420657814F6BAEC8", "col_qq_fixture");
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (Number(body.kolId) === 390) {
            return { data: { id: 327, conversationId: 327, mailboxEmail: LARRY } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          return { data: { total: 1, list: [{
            kolUid: "KOL51DA646D8D8A4544BB93",
            kolId: 390,
            kolName: "100705721",
            contactEmailMasked: "1***@qq.com",
            ownerName: "赵良玉",
          }] } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    const created = calls.filter((row) => row.name === "createEmailConversation").at(-1);
    expect(JSON.parse(String(created?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
      kolId: 390,
    });
    expect(JSON.parse(String(created?.args.requestJson)).kolUid).toBeUndefined();
    expect(compose.data).toMatchObject({ sent: false, conversationId: 327, mailboxEmail: LARRY, to: [QQ] });
  });

  it("previews from a local followed collaboration when Starry lists omit the email", async () => {
    getConn().prepare(
      `INSERT OR REPLACE INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
        stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_qq01",
      "测试网红-qq-01",
      "测试网红-qq-01",
      "LT",
      "",
      "",
      QQ,
      LARRY,
      "lc_qq01",
      "conv_qq01",
      "INITIAL_CONTACT",
      1,
      "",
      0,
      0,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      0,
    );
    getConn().prepare(
      "UPDATE collaborations SET owner_name=?, owner_mailbox=?, kol_uid=? WHERE id=?",
    ).run("赵良玉", LARRY, "KOL9D62420657814F6BAEC8", "col_qq01");
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 809, conversationId: 809 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          return { data: { total: 20, list: Array.from({ length: 20 }, (_, i) => ({
            kolUid: `KOLOTHER${i}`,
            kolName: `其他跟进${i}`,
            ownerUserName: "赵良玉",
            ownerMailbox: LARRY,
          })) } };
        }
        if (name === "listAllKolProfiles" || name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(calls.some((row) => row.name === "decryptKolContact")).toBe(false);
    expect(compose.data).toMatchObject({ sent: false, conversationId: 809, mailboxEmail: LARRY, to: [QQ] });
    expect(emailMcpResultCard("email_compose", compose.data).summary).not.toContain("看不见");
  });

  it("previews when a unique masked contact email matches the followed QQ", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 810, conversationId: 810 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles") {
          return { data: { total: 2, list: [
            {
              kolUid: "KOL9D62420657814F6BAEC8",
              kolName: "测试网红-qq-01",
              contactEmailMasked: "1***@qq.com",
              ownerUserName: "赵良玉",
              ownerMailbox: LARRY,
            },
            {
              kolUid: "KOLOTHERMASK",
              kolName: "其他红人",
              contactEmailMasked: "q***@gmail.com",
              ownerUserName: "魏银平",
            },
          ] } };
        }
        if (name === "listAllKolProfiles" || name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(JSON.parse(String(calls.filter((row) => row.name === "createEmailConversation").at(-1)?.args.requestJson))).toMatchObject({
      kolUid: "KOL9D62420657814F6BAEC8",
      recipientEmail: QQ,
      mailboxEmail: LARRY,
    });
    expect(compose.data).toMatchObject({ sent: false, conversationId: 810, to: [QQ] });
    expect(emailMcpResultCard("email_compose", compose.data).summary).not.toContain("看不见");
  });

  it("does not pick a random followed portrait from a large list without an email match", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles" || name === "listAllKolProfiles") {
          return { data: { total: 20, list: Array.from({ length: 20 }, (_, i) => ({
            kolUid: i === 0 ? "KOL9D62420657814F6BAEC8" : `KOLOTHER${i}`,
            kolName: i === 0 ? "测试网红-qq-01" : `其他跟进${i}`,
            ownerUserName: "赵良玉",
            ownerMailbox: LARRY,
          })) } };
        }
        if (name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    const created = calls.filter((row) => row.name === "createEmailConversation");
    expect(created.every((row) => !JSON.parse(String(row.args.requestJson || "{}")).kolUid)).toBe(true);
    expect(calls.some((row) => row.name === "decryptKolContact")).toBe(false);
    expect(compose.data.needs_input).toBe(true);
    expect(String(emailMcpResultCard("email_compose", compose.data).summary)).toContain("不要换收件邮箱");
  });

  it("previews after getKolProfileDetail unmasks a followed QQ portrait", async () => {
    const followed = [
      { kolUid: "KOL9D62420657814F6BAEC8", kolName: "测试网红-qq-01", ownerUserName: "赵良玉", ownerMailbox: LARRY },
      { kolUid: "KOL2B64916C7B1F4014B14A", kolName: "测试1号", ownerUserName: "赵良玉", ownerMailbox: LARRY },
      { kolUid: "KOL95A26C996BC74D3AA07E", kolName: "test-1", ownerUserName: "赵良玉", ownerMailbox: LARRY },
    ];
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 811, conversationId: 811 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        if (name === "pageKolProfiles" || name === "listAllKolProfiles") {
          return { data: { total: followed.length, list: followed } };
        }
        if (name === "pageEmailConversations") return { data: { total: 0, list: [] } };
        if (name === "getKolProfileDetail") {
          const uid = String(args.kolUid || "");
          if (uid === "KOL9D62420657814F6BAEC8") {
            return { data: { kolUid: uid, contactEmailMasked: "1***@qq.com", ownerUserName: "赵良玉", ownerMailbox: LARRY } };
          }
          return { data: { kolUid: uid, contactEmailMasked: "t***@gmail.com", ownerUserName: "赵良玉", ownerMailbox: LARRY } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        if (name === "decryptKolContact") throw new Error("decryptKolContact must not run");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(calls.some((row) => row.name === "getKolProfileDetail")).toBe(true);
    expect(calls.some((row) => row.name === "decryptKolContact")).toBe(false);
    expect(JSON.parse(String(calls.filter((row) => row.name === "createEmailConversation").at(-1)?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
      kolUid: "KOL9D62420657814F6BAEC8",
    });
    expect(compose.data).toMatchObject({ sent: false, conversationId: 811, mailboxEmail: LARRY, to: [QQ] });
    expect(emailMcpResultCard("email_compose", compose.data).summary).not.toContain("看不见");
    expect(emailMcpResultCard("email_compose", compose.data).summary).not.toContain("粘贴 JWT");
  });

  it("reuses the kolUid returned when addKolProfile says the QQ is taken", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          const body = JSON.parse(String(args.requestJson || "{}")) as Json;
          if (String(body.kolUid || "") === "KOL9D62420657814F6BAEC8") {
            return { data: { id: 812, conversationId: 812 } };
          }
          throw new Error("红人画像不存在");
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") {
          return { data: { error: "联系邮箱已被其他红人占用", kolUid: "KOL9D62420657814F6BAEC8" } };
        }
        if (name === "pageKolProfiles" || name === "listAllKolProfiles" || name === "pageEmailConversations") {
          return { data: { total: 0, list: [] } };
        }
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(JSON.parse(String(calls.filter((row) => row.name === "createEmailConversation").at(-1)?.args.requestJson))).toMatchObject({
      mailboxEmail: LARRY,
      recipientEmail: QQ,
      kolUid: "KOL9D62420657814F6BAEC8",
    });
    expect(compose.data).toMatchObject({ sent: false, conversationId: 812, to: [QQ] });
  });

  it("creates a profile when Starry returns 红人画像不存在 without throwing", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          if (!calls.some((row) => row.name === "addKolProfile")) {
            return { data: { error: "红人画像不存在", needs_input: true } };
          }
          return { data: { id: 505, conversationId: 505 } };
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") return { data: { kolUid: "KOLQQ002" } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    expect(calls.map((row) => row.name).filter((name) => !["pageMailboxes", "pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual([
      "createEmailConversation",
      "addKolProfile",
      "createEmailConversation",
      "previewEmailDraft",
    ]);
    expect(compose.data).toMatchObject({ sent: false, conversationId: 505, mailboxEmail: LARRY, to: [QQ] });
    expect(compose.data.needs_input).not.toBe(true);
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(String(card.summary)).not.toContain("还没有红人画像");
    expect(JSON.stringify(card.sections)).not.toContain("这项信息");
    expect(JSON.stringify(card.sections)).not.toContain("待补充字段");
  });

  it("creates a QQ first-touch profile on the listed larry.zhao mailbox", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          if (!calls.some((row) => row.name === "addKolProfile")) throw new Error("红人画像不存在");
          return { data: { id: 404, conversationId: 404 } };
        }
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{
            id: 6,
            mailboxEmail: LARRY,
            ownerUserName: "赵良玉",
            ownerOpenId: "273",
          }] } };
        }
        if (name === "addKolProfile") return { data: { kolUid: "KOLQQ001" } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime MCP 连通测试", body: "Preview", to: [QQ] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    const added = calls.find((row) => row.name === "addKolProfile");
    expect(JSON.parse(String(added?.args.requestJson))).toMatchObject({
      contactEmail: QQ,
      mailboxEmail: LARRY,
      ownerMailbox: LARRY,
      ownerUserName: "赵良玉",
    });
    expect(compose.data).toMatchObject({
      sent: false,
      mailboxEmail: LARRY,
      to: [QQ],
      conversationId: 404,
    });
    expect(compose.data.needs_input).not.toBe(true);
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(String(card.summary)).not.toContain("未授权给当前账号");
    expect(JSON.stringify(card.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card.sections)).toContain(`收件邮箱：${QQ}`);
  });

  it("does not ask to change From when larry.zhao is already listed", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "pageMailboxes") {
          return { data: { total: 1, list: [{ id: 6, mailboxEmail: LARRY, ownerUserName: "赵良玉" }] } };
        }
        if (name === "addKolProfile") throw new Error("负责人无可用邮箱");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      to: QQ,
      mailboxEmail: LARRY,
      subject: "LiTime MCP 连通测试",
      prompt: OPERATOR,
    });
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(compose.data.missing_fields).toEqual([]);
    expect(String(card.summary)).toContain("已在授权列表中");
    expect(String(card.summary)).not.toContain("未授权给当前账号");
    expect(String(card.summary)).not.toContain("请改用已授权的发件邮箱");
  });

  it("asks for From/To/subject, not a conversation, when compose has no addresses", async () => {
    const compose = await executeEmailMcpTask("email_compose", { prompt: "首封建联" });
    expect(calls).toEqual([]);
    expect(compose.data).toMatchObject({
      needs_input: true,
      missing_fields: ["mailboxEmail", "to", "subject"],
    });
    expect(compose.data.missing_fields).not.toContain("conversationId");
    expect(String(compose.data.error)).toContain("不用先填会话编号");
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(String(card.summary)).not.toContain("邮件会话");
    expect(String(card.summary)).toContain("发件邮箱");
    expect(compose.data.fields).toBeUndefined();
  });

  it("fills 写跟进 from the latest inbound letter and skips LT placeholders", () => {
    expect(lastKolMailReply([
      {
        kind: "kol_mail_card",
        payload: {
          direction: "outbound",
          from: LARRY,
          to: QIYOU,
          mailbox: LARRY,
          subject: "LiTime MCP 连通测试",
          conversation_id: "327",
        },
      },
      {
        kind: "kol_mail_card",
        payload: {
          direction: "inbound",
          from: QIYOU,
          to: "kol.lt@litime.example",
          mailbox: "kol.lt@litime.example",
          subject: "KOL合作",
          conversation_id: "320",
          judgment: { suggested_stage: "INTERESTED" },
        },
      },
    ])).toEqual({
      conversationId: 320,
      to: [QIYOU],
      subject: "Re: KOL合作",
      suggested_stage: "INTERESTED",
    });
    expect(lastKolMailReply([
      {
        kind: "kol_mail_card",
        payload: {
          direction: "inbound",
          from: QIYOU,
          to: LARRY,
          mailbox: LARRY,
          subject: "KOL合作",
          conversation_id: "320",
        },
      },
    ])).toEqual({
      conversationId: 320,
      mailboxEmail: LARRY,
      from: LARRY,
      to: [QIYOU],
      subject: "Re: KOL合作",
    });
    expect(resolveComposeSubject({
      raw: "写合作邮件 @灵工连通测试-qiyou1984",
      prior: { subject: "Re: KOL合作" },
      extracted: {},
      entities: { subject: "发货通知" },
    })).toBe("Re: KOL合作");
    expect(resolveComposeSubject({
      raw: "主题:发货通知",
      prior: { subject: "Re: KOL合作" },
      extracted: { subject: "发货通知" },
      entities: {},
    })).toBe("发货通知");
    expect(lastKolMailReply([{
      kind: "kol_mail_card",
      payload: { direction: "inbound", subject: "KOL合作", conversation_id: "320" },
    }])).toEqual({
      conversationId: 320,
      subject: "Re: KOL合作",
    });
  });

  it("drops a leftover 发货通知 subject when the thread is an interest reply", async () => {
    const previewCalls: Json[] = [];
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        if (name === "previewEmailDraft") {
          previewCalls.push(args);
          return {
            data: {
              subject: JSON.parse(String(args.requestJson || "{}")).subject,
              body: "Hi, thrilled to hear about your interest.",
              to: [QIYOU],
            },
          };
        }
        if (name === "getEmailConversation") {
          return { data: { id: 320, conversationId: 320, mailboxEmail: LARRY } };
        }
        return { data: {} };
      },
      async close() { /* noop */ },
    }));
    const items = await completeTurnItems("email_compose", {
      raw: "写合作邮件 @灵工连通测试-qiyou1984",
      handle: "灵工连通测试-qiyou1984",
      entities: {
        subject: "发货通知",
        mailboxEmail: LARRY,
        to: [QIYOU],
      },
      prior_compose: {
        conversationId: 320,
        mailboxEmail: LARRY,
        to: [QIYOU],
        subject: "Re: KOL合作",
      },
    }, [], []);
    expect(JSON.parse(String(previewCalls[0]?.requestJson || "{}")).subject).toBe("Re: KOL合作");
    expect(JSON.stringify(items)).toContain("Re: KOL合作");
    expect(JSON.stringify(items)).not.toContain("发货通知");
    expect(JSON.stringify(items)).toContain("thrilled to hear about your interest");
  });

  it("rebuilds a stale Codex card into a ready draft instead of an empty result", async () => {
    const items = await completeTurnItems("email_compose", {}, [{
      type: "task_result",
      title: "邮件草稿",
      summary: "还需要补充：必要字段。当前识别：发件邮箱 larry.zhao@amperetime.com，收件邮箱 qiyou1984@gmail.com。",
      starrykol_data: {
        needs_input: true,
        missing_fields: ["mailboxEmail", "to", "subject"],
        error: "还需要补充：必要字段。当前识别：发件邮箱 larry.zhao@amperetime.com，收件邮箱 qiyou1984@gmail.com。",
        mailboxEmail: LARRY,
        to: [QIYOU],
        subject: "Re: KOL合作",
        body: "Hi Qiyou, following up on the LiTime collaboration.",
      },
    }], []);
    expect(items.some((item) => item.type === "create_draft")).toBe(true);
    const draft = items.find((item) => item.type === "create_draft");
    expect(String(draft?.from)).toBe(LARRY);
    expect(String(draft?.body_zh_internal)).toMatch(/[\u4e00-\u9fff]/);
    expect(String(draft?.body_zh_internal)).not.toContain("following up on the LiTime collaboration");
    expect(String(draft?.body_zh_internal)).toMatch(/跟进|合作/);
    const card = items.find((item) => item.type === "task_result");
    expect(card?.title).toBe("邮件草稿");
    expect(String(card?.summary)).toContain("确认发送");
    expect(String(card?.summary)).not.toContain("还需要补充");
    expect(String(card?.summary)).not.toBe("");
    expect(JSON.stringify(card?.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card?.sections)).toContain(`收件邮箱：${QIYOU}`);
    expect(JSON.stringify(card?.sections)).toContain("Re: KOL合作");
    expect(JSON.stringify(card?.sections)).not.toContain("待补充字段");
    expect(card?.recommended_actions).toEqual(["核对预览后回复「确认发送」"]);
  });

  it("ignores a stale 必要字段 error when From, To and subject are already known", () => {
    const card = emailMcpResultCard("email_compose", {
      needs_input: true,
      missing_fields: ["mailboxEmail", "to", "subject"],
      error: "还需要补充：必要字段。当前识别：发件邮箱 larry.zhao@amperetime.com，收件邮箱 qiyou1984@gmail.com。",
      mailboxEmail: LARRY,
      to: [QIYOU],
      subject: "Re: KOL合作",
      body: "Hi Qiyou, following up on the LiTime collaboration.",
    });
    expect(card.title).toBe("邮件草稿");
    expect(String(card.summary)).toContain("确认发送");
    expect(String(card.summary)).not.toContain("还需要补充");
    expect(String(card.summary)).not.toContain("当前识别");
    expect(JSON.stringify(card.sections)).not.toContain("还需要补充");
    expect(JSON.stringify(card.sections)).not.toContain("待补充字段");
    expect(JSON.stringify(card.sections)).toContain("Re: KOL合作");
    expect(card.recommended_actions).toEqual(["核对预览后回复「确认发送」"]);
  });

  it("does not say 还需要补充 when From and To are already known", () => {
    const card = emailMcpResultCard("email_compose", {
      needs_input: true,
      missing_fields: ["mailboxEmail", "to", "subject"],
      error: "首封必填发件邮箱、收件邮箱和邮件主题。",
      mailboxEmail: LARRY,
      to: [QIYOU],
      subject: "Re: KOL合作",
      conversationId: 327,
    });
    expect(String(card.summary)).toContain("确认发送");
    expect(String(card.summary)).not.toContain("还需要补充");
    expect(String(card.summary)).not.toContain("当前识别");
    expect(JSON.stringify(card.sections)).not.toContain("还需要补充");
    expect(JSON.stringify(card.sections)).not.toContain("待补充字段");
    expect(card.recommended_actions).toContain("核对预览后回复「确认发送」");
  });

  it("names only the compose field that is still empty", () => {
    const card = emailMcpResultCard("email_compose", {
      needs_input: true,
      missing_fields: ["mailboxEmail", "to", "subject"],
      mailboxEmail: LARRY,
      to: [QIYOU],
    });
    expect(String(card.summary)).toBe("还需要补充：邮件主题。");
    expect(String(card.summary)).not.toContain("当前识别");
    const extra = ((card.sections as Json[]) || []).find((row) => row.title === "待补充字段");
    expect(extra?.items).toEqual(["邮件主题"]);
  });

  it("does not paint a SENT receipt as an incomplete draft", () => {
    const card = emailMcpResultCard("email_compose", {
      sent: true,
      needs_input: true,
      missing_fields: ["subject"],
      error: "还需要补充：必要字段。当前识别：发件邮箱 larry.zhao@amperetime.com，收件邮箱 qiyou1984@gmail.com。",
      recommended_actions: ["补全发件邮箱、收件邮箱和邮件主题后再执行"],
      mailboxEmail: LARRY,
      to: [QIYOU],
      subject: "Re: KOL合作",
      body: "Hi Qiyou",
      id: 1210,
      state: "SENT",
      operation: "SYNC_SENT",
      messageId: "<d9fc15boienegtkbjsl24ovt1.DL9HYQ0FEX1F@amperetime.com>",
    });
    expect(card.title).toBe("邮件已发送");
    expect(String(card.summary)).toContain("已提交发送");
    expect(JSON.stringify(card.sections)).toContain("已发正文");
    expect(JSON.stringify(card.sections)).toContain(`收件邮箱：${QIYOU}`);
    expect(JSON.stringify(card.sections)).not.toContain("还需要补充");
    expect(JSON.stringify(card.sections)).not.toContain("待补充字段");
    expect(JSON.stringify(card.sections)).not.toContain("这项信息");
    expect(JSON.stringify(card.sections)).not.toContain("SYNC_SENT");
    expect(JSON.stringify(card.sections)).not.toContain("摘要数据");
    expect(card.recommended_actions).toEqual(["再写一封", "查看邮件会话"]);
  });

  it("rebuilds a Codex 摘要数据 send receipt into 邮件已发送", async () => {
    const items = await completeTurnItems("email_compose", {}, [{
      type: "task_result",
      title: "邮件草稿",
      summary: "供应商已返回发送回执",
      recommended_actions: ["补全发件邮箱、收件邮箱和邮件主题后再执行"],
      sections: [{
        title: "摘要数据",
        items: [
          "这项信息：1210",
          "这项信息：<d9fc15boienegtkbjsl24ovt1.DL9HYQ0FEX1F@amperetime.com>",
          "state：SENT",
          "operation：SYNC_SENT",
          "这项信息：unknown",
          "这项信息：1210",
          `发件邮箱：${LARRY}`,
          `收件邮箱：${QIYOU}`,
          "邮件主题：Re: KOL合作",
          "正文：Hi 灵工连通测试-qiyou1984, I hope you're having a great day!",
        ],
      }],
    }], []);
    expect(items.some((item) => item.type === "create_draft")).toBe(false);
    const card = items.find((item) => item.type === "task_result");
    expect(card?.title).toBe("邮件已发送");
    expect(String(card?.summary)).toContain("已提交发送");
    expect(String(card?.summary)).toContain("发送邮件不会修改阶段");
    expect(JSON.stringify(card?.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card?.sections)).toContain(`收件邮箱：${QIYOU}`);
    expect(JSON.stringify(card?.sections)).toContain("Re: KOL合作");
    expect(JSON.stringify(card?.sections)).toContain("已发正文");
    expect(JSON.stringify(card?.sections)).not.toMatch(/这项信息|SYNC_SENT|摘要数据|1210|unknown/);
    expect(card?.recommended_actions).toEqual(["再写一封", "查看邮件会话"]);
  });

  it("sends the last preview only inside the confirmed gateway authority", async () => {
    const preview = await executeEmailMcpTask("email_compose", {
      ...extractTaskEntities(OPERATOR),
      prompt: OPERATOR,
    });
    const card = emailMcpResultCard("email_compose", preview.data);
    const followup = lastComposeFollowup([{ kind: "task_result_card", payload: card }]);
    expect(followup).toMatchObject({
      conversationId: 303,
      mailboxEmail: LARRY,
      to: [QQ],
      subject: "LiTime MCP 连通测试",
    });
    expect(String(followup.body || "")).toContain("Preview");
    calls.length = 0;
    const sent = await withMailSendAuthority("adapter-first-touch", "adapter-confirmed-first-touch", () => executeEmailMcpTask("email_compose", {
      ...extractTaskEntities("确认发送"),
      ...followup,
    }));
    expect(calls.map((row) => row.name)).toEqual(["sendEmailNow"]);
    expect(JSON.parse(String(calls[0].args.requestJson))).toMatchObject({
      recipientEmail: QQ,
      subject: "LiTime MCP 连通测试",
      content: followup.body,
    });
    expect(sent.data).toMatchObject({ sent: true, conversationId: 303, mailboxEmail: LARRY, to: [QQ] });
    const sentCard = emailMcpResultCard("email_compose", sent.data);
    expect(String(sentCard.summary)).toContain("已提交发送");
    expect(sentCard.recommended_actions).toContain("再写一封");

    calls.length = 0;
    const another = {
      ...lastComposeFollowup([{ kind: "task_result_card", payload: sentCard }], { body: false }),
      another_letter: true,
      subject: "Re: LiTime MCP 连通测试",
      prompt: "加一封",
    };
    const previewed = await executeEmailMcpTask("email_compose", another);
    expect(calls.map((row) => row.name)).toEqual(["previewEmailDraft"]);
    expect(previewed.data).toMatchObject({
      sent: false,
      conversationId: 303,
      mailboxEmail: LARRY,
      to: [QQ],
      subject: "Re: LiTime MCP 连通测试",
    });
    expect(previewed.data.needs_input).not.toBe(true);
  });
});
