import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { parseStarryKolMcpConfig as parseEmailMcpConfig, starryKolMcpHeaders } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import {
  STARRY_KOL_TASKS as EMAIL_MCP_TASKS,
  emailMcpResultCard,
  executeEmailMcpTask,
  normalizeEmailMcpResult,
  setEmailMcpClientFactory,
} from "../src/starrykol/service.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";

let tmp = "";
let app: Hono;
const calls: Array<{ name: string; args: Json }> = [];

function mockClient() {
  return {
    async callTool(name: string, args: Json = {}): Promise<Json> {
      calls.push({ name, args });
      if (name === "pageMailboxes") {
        return { code: 0, data: { pageNo: 1, pageSize: 20, total: 1, list: [{
          id: 14,
          mailboxEmail: "henry.wei@amperetime.com",
          brandCode: "LT",
          brandName: "LT品牌",
        }], statistics: { mailboxCount: 1 } } };
      }
      if (name === "getMailboxDetail") {
        return { data: { id: args.id || 14, mailboxEmail: "henry.wei@amperetime.com" } };
      }
      if (name === "listNylasAccounts") {
        return { data: { items: [{ id: 4, mailboxEmail: "henry.wei@amperetime.com", grantStatus: "VALID" }] } };
      }
      if (name === "pageEmailConversations") {
        return { data: { pageNo: 1, pageSize: 10, total: 1, list: [{
          id: 101,
          subject: "LiTime 合作沟通",
          recipientEmail: String(args.keyword || "qiyou1984@gmail.com"),
          status: "draft",
        }] } };
      }
      if (name === "getEmailConversation") {
        return { data: {
          id: args.conversationId || 101,
          subject: "LiTime 合作沟通",
          recipientEmail: "qiyou1984@gmail.com",
          kolUid: "KOLTEST001",
          messages: [{
            id: 1,
            direction: "inbound",
            body: "Thanks, I am interested in the collaboration. Please send the rate card.",
          }],
        } };
      }
      if (name === "getEmailConversationSubjectGroups") {
        return { data: { conversationId: args.conversationId || 101, list: [{ subject: "LiTime 合作沟通", count: 1 }] } };
      }
      if (name === "translateEmailToChinese") {
        return { data: { text: "谢谢，我对这次合作有兴趣。请发报价单。" } };
      }
      if (name === "getStageRiskMatrix") {
        return { data: { list: [
          { code: "DELAY", name: "延期" },
          { code: "CONTENT", name: "内容风险" },
          { code: "LOST_CONTACT", name: "失联" },
        ] } };
      }
      if (name === "createEmailConversation") {
        return { data: { id: 101, conversationId: 101, subject: "LiTime MCP 连通测试" } };
      }
      if (name === "addKolProfile") {
        return { data: { kolUid: "KOLTEST001" } };
      }
      if (name === "pageKolProfiles") {
        let body: Json = {};
        try {
          body = JSON.parse(String(args.requestJson || "{}")) as Json;
        } catch {
          body = {};
        }
        const keyword = String(body.keyword || "").trim();
        if (keyword && /新(测试)?达人/.test(keyword)) {
          return { data: { pageNo: 1, pageSize: 20, total: 0, list: [] } };
        }
        return { data: { pageNo: 1, pageSize: 20, total: 1, list: [{
          kolUid: "KOLTEST001",
          kolName: "户外电源达人",
          nickname: "户外电源达人",
          followers: 85000,
          cooperationStageCode: "INITIAL_CONTACT",
          cooperationStageName: "初步接触",
          primaryPlatform: "YouTube",
          contactEmailMasked: "q***@gmail.com",
          ownerUserId: "u_chen",
          ownerUserName: "陈组长",
        }] } };
      }
      if (name === "getKolProfileDetail") {
        return { data: {
          kolUid: args.kolUid || "KOLTEST001",
          kolName: "户外电源达人",
          cooperationStageCode: "INITIAL_CONTACT",
          cooperationStageName: "初步接触",
          primaryPlatform: "YouTube",
          followers: 85000,
          contactEmailMasked: "q***@gmail.com",
          bio: "户外电源内容创作者",
          ownerUserId: "u_chen",
          ownerUserName: "陈组长",
        } };
      }
      if (name === "updateKolProfile") {
        let body: Json = {};
        try { body = JSON.parse(String(args.requestJson || "{}")) as Json; } catch { body = {}; }
        return { data: { ok: true, updated: true, kolUid: body.kolUid || "KOLTEST001", ...body } };
      }
      if (name === "listAllKolProfiles") {
        return { data: { total: 1, list: [{ kolUid: "KOLTEST001", kolName: "户外电源达人", ownerUserName: "陈组长" }] } };
      }
      if (name === "decryptKolContact") {
        return { data: { kolUid: "KOLTEST001", contactEmail: "qiyou1984@gmail.com", decrypted: true } };
      }
      if (name === "pageLifecycleKanban") {
        return { data: { total: 1, list: [{ kolUid: "KOLTEST001", kolName: "户外电源达人", cooperationStageName: "初步接触" }] } };
      }
      if (name === "pageRiskConversations") {
        return { data: { total: 1, list: [{ id: 201, kolUid: "KOLRISK001", subject: "风险跟进", riskTag: "DELAY" }] } };
      }
      if (name === "summarizeRiskConversations") {
        return { data: { total: 1, summary: "1 条风险会话待处理。" } };
      }
      if (name === "listDictionaryOptions") {
        return { data: { parentKey: args.parentKey, list: [{ code: "youtube", name: "YouTube" }, { code: "energy-storage", name: "储能" }] } };
      }
      if (name === "listCooperationStageOptions") {
        return { data: { list: [{ code: "INITIAL_CONTACT", name: "初步接触" }, { code: "INTERESTED", name: "已回复-有兴趣" }] } };
      }
      if (name === "listRiskTagOptions") {
        return { data: { list: [{ code: "DELAY", name: "延期" }, { code: "CONTENT", name: "内容风险" }, { code: "LOST_CONTACT", name: "失联" }] } };
      }
      if (name === "pageAppEmailConversations") {
        return { data: { total: 1, list: [{ id: 301, subject: "应用侧合作沟通", kolUid: "KOLTEST001" }] } };
      }
      if (name === "listKolPlatformData") {
        return { data: { list: [{ platform: "YouTube", account: "@outdoor-power", followers: 85000, stableViews: 120000 }] } };
      }
      if (name === "getKolProfileSidebarMetrics") {
        return { data: { creatorCount: 12, stageCount: 6, riskConversationCount: 2 } };
      }
      if (name === "previewEmailDraft") {
        return { data: { subject: "LiTime collaboration", body: "Hi, this is a preview only.", to: ["qiyou1984@gmail.com"] } };
      }
      if (name === "sendEmailNow") {
        return { data: { ok: true, sent: true, conversationId: args.conversationId || 101 } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-emailmcp-"));
  process.env.LINGONG_DB = path.join(tmp, "emailmcp.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  calls.length = 0;
  setEmailMcpClientFactory(mockClient);
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  setEmailMcpClientFactory();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Starry KOL MCP connector", () => {
  it("exposes starrykol and hides the legacy emailmcp connector", async () => {
    const listed = await request("GET", "/api/connectors");
    expect(listed.status).toBe(200);
    const rows = listed.body as unknown as Array<{ id: string; label: string }>;
    expect(rows.map((row) => row.id)).toContain("starrykol");
    expect(rows.find((row) => row.id === "starrykol")?.label).toBe("Starry KOL MCP");
    expect(rows.map((row) => row.id)).not.toContain("emailmcp");
  });
});

describe("Email MCP config", () => {
  it("parses Cursor mcpServers JSON with X-MCP-API-KEY", () => {
    expect(parseEmailMcpConfig(`{
      "mcpServers": {
        "starry-kol-mcp": {
          "type": "streamableHttp",
          "url": "http://47.251.65.112:9091/mcp",
          "headers": { "X-MCP-API-KEY": "email-agent-mcp-dev" }
        }
      }
    }`)).toEqual({
      url: "http://47.251.65.112:9091/mcp",
      apiKey: "email-agent-mcp-dev",
      token: "email-agent-mcp-dev",
    });
  });

  it("falls back to the legacy email-mcp server name", () => {
    expect(parseEmailMcpConfig(`{
      "mcpServers": {
        "email-mcp": {
          "type": "streamableHttp",
          "url": "http://47.251.65.112:9091/mcp",
          "headers": { "X-MCP-API-KEY": "email-agent-mcp-dev" }
        }
      }
    }`)).toEqual({
      url: "http://47.251.65.112:9091/mcp",
      apiKey: "email-agent-mcp-dev",
      token: "email-agent-mcp-dev",
    });
  });

  it("keeps X-MCP-API-KEY and Authorization Bearer as separate fields", () => {
    expect(parseEmailMcpConfig(`{
      "mcpServers": {
        "email-mcp": {
          "type": "streamableHttp",
          "url": "https://dev-api.askstarry.com/starry/email-agent/mcp",
          "headers": {
            "X-MCP-API-KEY": "email-agent-mcp-dev",
            "Authorization": "Bearer user-jwt-290"
          }
        }
      }
    }`)).toEqual({
      url: "https://dev-api.askstarry.com/starry/email-agent/mcp",
      apiKey: "email-agent-mcp-dev",
      token: "email-agent-mcp-dev",
      bearer: "user-jwt-290",
    });
  });

  it("does not treat the user JWT as the MCP API key", () => {
    expect(parseEmailMcpConfig(`{
      "mcpServers": {
        "email-mcp": {
          "url": "https://dev-api.askstarry.com/starry/email-agent/mcp",
          "headers": { "Authorization": "Bearer user-jwt-290" }
        }
      }
    }`)).toEqual({
      url: "https://dev-api.askstarry.com/starry/email-agent/mcp",
      bearer: "user-jwt-290",
    });
  });

  it("sends both MCP API key and user JWT headers", () => {
    const prevKey = process.env.STARRY_KOL_MCP_API_KEY;
    const prevBearer = process.env.STARRY_KOL_MCP_BEARER;
    process.env.STARRY_KOL_MCP_API_KEY = "email-agent-mcp-dev";
    process.env.STARRY_KOL_MCP_BEARER = "user-jwt-290";
    expect(starryKolMcpHeaders()).toEqual({
      "X-MCP-API-KEY": "email-agent-mcp-dev",
      Authorization: "Bearer user-jwt-290",
    });
    if (prevKey === undefined) delete process.env.STARRY_KOL_MCP_API_KEY;
    else process.env.STARRY_KOL_MCP_API_KEY = prevKey;
    if (prevBearer === undefined) delete process.env.STARRY_KOL_MCP_BEARER;
    else process.env.STARRY_KOL_MCP_BEARER = prevBearer;
  });

  it("ignores placeholder keys in markdown docs", () => {
    expect(parseEmailMcpConfig(`
      \`\`\`json
      { "mcpServers": { "email-agent": {
        "url": "http://47.251.65.112:9091/mcp",
        "headers": { "X-MCP-API-KEY": "<EMAIL_AGENT_MCP_API_KEY>" }
      } } }
      \`\`\`
    `)).toEqual({ url: "http://47.251.65.112:9091/mcp" });
  });
});

describe("Email MCP result normalization", () => {
  it("unwraps { data } and JSON result strings", () => {
    expect(normalizeEmailMcpResult({ data: { total: 2, list: [] } })).toEqual({ total: 2, list: [] });
    expect(normalizeEmailMcpResult({ result: "{\"ok\":true}" })).toEqual({ ok: true });
  });
});

describe("Email MCP Host orchestration", () => {
  it("lists mailboxes and Nylas accounts", async () => {
    const { data, operations } = await executeEmailMcpTask("email_mailbox_list", {});
    expect(calls.map((item) => item.name)).toEqual(["pageMailboxes", "listNylasAccounts"]);
    expect(data).toMatchObject({ total: 1, nylas: [{ grantStatus: "VALID" }] });
    expect(Array.isArray(data.mailbox_owners)).toBe(true);
    expect((data.mailbox_owners as Json[]).some((row) => row.email === "kol.lt@litime.example" && row.owner_name === "钟槿年")).toBe(true);
    expect(operations[0]).toMatchObject({ name: "starrykol.pageMailboxes", status: "done" });
    expect(emailMcpResultCard("email_mailbox_list", data).title).toBe("邮箱列表");
  });

  it("lists conversations and reads a conversation id", async () => {
    const listed = await executeEmailMcpTask("email_conversation_list", { to: "qiyou1984@gmail.com" });
    const read = await executeEmailMcpTask("email_conversation_read", { conversationId: 101 });
    expect(calls.map((item) => item.name)).toEqual(["pageEmailConversations", "getEmailConversation"]);
    expect(listed.data).toMatchObject({ total: 1, keyword: "qiyou1984@gmail.com", recipient: "qiyou1984@gmail.com" });
    expect(read.data).toMatchObject({ id: 101 });
  });

  it("explains an empty conversation list instead of saying the task finished", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "pageEmailConversations") {
          return { data: { pageNo: 1, pageSize: 10, total: 0, list: [] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const listed = await executeEmailMcpTask("email_conversation_list", { to: "qiyou1984@gmail.com" });
    expect(listed.data).toMatchObject({
      total: 0,
      list: [],
      keyword: "qiyou1984@gmail.com",
      recipient: "qiyou1984@gmail.com",
    });
    const card = emailMcpResultCard("email_conversation_list", listed.data);
    expect(card.summary).toBe("未找到与 qiyou1984@gmail.com 相关的邮件会话。");
    expect(JSON.stringify(card.sections)).toContain("不是 Gmail / 163 收件箱");
    expect(card.recommended_actions).toEqual([
      "写合作邮件 qiyou1984@gmail.com",
      "品牌邮箱列表",
    ]);
  });

  it("does not call MCP when conversation id is missing", async () => {
    const read = await executeEmailMcpTask("email_conversation_read", {});
    expect(calls).toEqual([]);
    expect(read.data).toMatchObject({ needs_input: true, missing_fields: ["conversationId"] });
  });

  it("previews a draft by default and sends only after confirm_send", async () => {
    const preview = await executeEmailMcpTask("email_compose", {
      to: "qiyou1984@gmail.com,qiyouhuang@163.com",
      mailboxEmail: "henry.wei@amperetime.com",
      subject: "LiTime MCP 连通测试",
    });
    expect(calls.map((item) => item.name).filter((name) => !["pageMailboxes", "pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual(["createEmailConversation", "previewEmailDraft"]);
    expect(JSON.parse(String(calls.find((row) => row.name === "createEmailConversation")?.args.requestJson))).toMatchObject({
      mailboxEmail: "henry.wei@amperetime.com",
      recipientEmail: "qiyou1984@gmail.com",
    });
    expect(preview.data).toMatchObject({ sent: false, conversationId: 101 });
    expect(emailMcpResultCard("email_compose", preview.data).recommended_actions).toContain("核对预览后回复「确认发送」");

    calls.length = 0;
    const sent = await executeEmailMcpTask("email_compose", {
      conversationId: 101,
      to: "qiyou1984@gmail.com",
      confirm_send: true,
    });
    expect(calls.map((item) => item.name)).toEqual(["previewEmailDraft", "sendEmailNow"]);
    expect(sent.data).toMatchObject({ sent: true, conversationId: 101 });
    const audits = getConn().prepare("SELECT event_type, payload FROM audit_events WHERE event_type=?").all("starrykol.email_compose") as Array<{ payload: string }>;
    expect(JSON.parse(audits.at(-1)?.payload || "{}")).toMatchObject({ sent: true });
  });

  it("creates a KOL profile then retries conversation create", async () => {
    let created = 0;
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") {
          created += 1;
          if (created === 1) throw new Error("红人画像不存在");
          return { data: { id: 202, conversationId: 202 } };
        }
        if (name === "addKolProfile") return { data: { kolUid: "KOLTEST001" } };
        if (name === "previewEmailDraft") {
          return { data: { subject: "LiTime collaboration", body: "Preview after profile create.", to: ["qiyou1984@gmail.com"] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const preview = await executeEmailMcpTask("email_compose", {
      to: "qiyou1984@gmail.com",
      mailboxEmail: "henry.wei@amperetime.com",
      subject: "LiTime MCP 连通测试",
    });
    expect(calls.map((item) => item.name).filter((name) => !["pageMailboxes", "pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual([
      "createEmailConversation",
      "addKolProfile",
      "createEmailConversation",
      "previewEmailDraft",
    ]);
    expect(JSON.parse(String(calls.find((row) => row.name === "addKolProfile")?.args.requestJson))).toMatchObject({
      kolName: "qiyou1984",
      contactEmail: "qiyou1984@gmail.com",
    });
    const retry = calls.filter((row) => row.name === "createEmailConversation")[1];
    expect(JSON.parse(String(retry?.args.requestJson))).toMatchObject({
      mailboxEmail: "henry.wei@amperetime.com",
      recipientEmail: "qiyou1984@gmail.com",
      kolUid: "KOLTEST001",
    });
    expect(preview.data).toMatchObject({ sent: false, conversationId: 202 });
  });

  it("explains when the contact email belongs to another tenant library", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name, args: Json = {}) {
        calls.push({ name, args });
        if (name === "createEmailConversation") throw new Error("红人画像不存在");
        if (name === "addKolProfile") throw new Error("联系邮箱已被其他红人占用");
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const compose = await executeEmailMcpTask("email_compose", {
      to: "qiyou1984@gmail.com",
      mailboxEmail: "henry.wei@amperetime.com",
      subject: "LiTime MCP 连通测试",
    });
    expect(calls.map((item) => item.name).filter((name) => !["pageMailboxes", "pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual(["createEmailConversation", "addKolProfile"]);
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(compose.data.error).toBe("联系邮箱已被其他红人占用");
    expect(String(card.summary)).toContain("收件邮箱 qiyou1984@gmail.com 已有红人画像");
    expect(String(card.summary)).toContain("灵工登录");
    expect(String(card.summary)).toContain("Starry 身份");
    expect(String(card.summary)).toContain("不要换收件邮箱");
    expect(card.recommended_actions).toContain("个人设置 → 连接 Starry，用该红人负责人账号重新连接");
  });

  it("explains when the MCP account has no owner mailbox", async () => {
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
      to: "qiyou1984@gmail.com",
      mailboxEmail: "henry.wei@amperetime.com",
      subject: "LiTime MCP 连通测试",
    });
    expect(calls.map((item) => item.name).filter((name) => !["pageMailboxes", "pageKolProfiles", "listAllKolProfiles", "pageEmailConversations", "getKolProfileDetail"].includes(name))).toEqual(["createEmailConversation", "addKolProfile"]);
    expect(compose.data).toMatchObject({
      needs_input: true,
      error: "负责人无可用邮箱",
      missing_fields: ["mailboxEmail"],
    });
    const card = emailMcpResultCard("email_compose", compose.data);
    expect(card.summary).toBe("发件邮箱 henry.wei@amperetime.com 未授权给当前账号，无法用它新建红人画像或发出首封邮件。请改用已授权的发件邮箱，或请管理员在邮箱权限里开通。");
    expect(card.recommended_actions).toContain("请改用已授权的发件邮箱后再写邮件");
  });

  it("explains when the Starry gateway rejects a request without user JWT", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool() {
        throw new Error("登录过期,亲，请先登录呦！");
      },
      async close() { /* noop */ },
    }));
    await expect(executeEmailMcpTask("email_mailbox_list", {})).rejects.toMatchObject({
      status: 401,
      detail: expect.objectContaining({ code: "starrykol_login_required" }),
    });
  });

  it("asks for a recipient or conversation before composing", async () => {
    const compose = await executeEmailMcpTask("email_compose", {});
    expect(calls).toEqual([]);
    expect(compose.data).toMatchObject({ needs_input: true, missing_fields: ["mailboxEmail", "to", "subject"] });
  });
});

describe("Email MCP KOL library", () => {
  it("queries profiles through pageKolProfiles and never decrypts contacts", async () => {
    const { data, operations } = await executeEmailMcpTask("creator_library_query", {
      keyword: "户外电源",
      status: "初步接触",
    });
    expect(calls.map((item) => item.name)).toEqual(["pageKolProfiles", "getKolProfileSidebarMetrics"]);
    expect(JSON.parse(String(calls[0].args.requestJson))).toMatchObject({
      keyword: "户外电源",
      stageCodes: ["初步接触"],
      pageNo: 1,
      pageSize: 20,
    });
    expect(data).toMatchObject({ total: 1 });
    expect(operations[0]).toMatchObject({ name: "starrykol.pageKolProfiles", status: "done" });
    expect(operations.map((item) => item.name).join(",")).not.toContain("decryptKolContact");
    expect(emailMcpResultCard("creator_library_query", data).title).toBe("达人库查询结果");
  });

  it("unwraps pageKolProfiles when the MCP payload is a raw data array", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name: string) {
        calls.push({ name, args: {} });
        if (name === "pageKolProfiles") {
          return { data: [{ kolUid: "KOLARR", kolName: "数组达人", ownerName: "陈组长" }] };
        }
        if (name === "getKolProfileSidebarMetrics") return { data: { creatorCount: 1 } };
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const { data } = await executeEmailMcpTask("creator_library_query", {});
    expect(data.list).toEqual([expect.objectContaining({ kolUid: "KOLARR", kolName: "数组达人" })]);
    expect(String(emailMcpResultCard("creator_library_query", data).summary)).toContain("1 条");
  });

  it("falls back to listAllKolProfiles when pageKolProfiles is empty", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        calls.push({ name, args });
        if (name === "pageKolProfiles") return { data: { pageNo: 1, pageSize: 20, total: 0, list: [] } };
        if (name === "getKolProfileSidebarMetrics") return { data: { creatorCount: 12 } };
        if (name === "listAllKolProfiles") {
          return { data: { total: 1, list: [{ kolUid: "KOLWENDELL", kolName: "Wendell Fishing", ownerName: "赵良玉" }] } };
        }
        throw new Error(`unexpected tool ${name}`);
      },
      async close() { /* noop */ },
    }));
    const { data, operations } = await executeEmailMcpTask("creator_library_query", { keyword: "Wendell" });
    expect(operations.map((item) => item.name)).toContain("starrykol.listAllKolProfiles");
    expect(data.list).toEqual([expect.objectContaining({ kolName: "Wendell Fishing" })]);
    expect(JSON.stringify(emailMcpResultCard("creator_library_query", data).sections)).toContain("Wendell Fishing");
  });

  it("loads profile detail by kolUid and attaches platform data", async () => {
    const { data, operations } = await executeEmailMcpTask("creator_profile", { kolUid: "KOLTEST001" });
    expect(calls.map((item) => item.name)).toEqual([
      "getKolProfileDetail",
      "listKolPlatformData",
      "pageEmailConversations",
    ]);
    expect(calls[0].args).toMatchObject({ kolUid: "KOLTEST001" });
    expect(data).toMatchObject({ kolUid: "KOLTEST001", kolName: "户外电源达人" });
    expect(operations.map((item) => item.name).join(",")).not.toContain("decryptKolContact");
    const card = emailMcpResultCard("creator_profile", data);
    expect(card.title).toBe("达人画像");
    expect(JSON.stringify(card.sections)).toContain("平台数据");
    expect(JSON.stringify(card.sections)).toContain("红人绑定 / 负责人");
    expect(JSON.stringify(card.sections)).toContain("画像说明");
    expect(JSON.stringify(card.sections)).not.toContain("这项信息");
    expect(JSON.stringify(card.sections)).not.toContain("摘要数据");
  });

  it("updates KOL owner through getKolProfileDetail and updateKolProfile", async () => {
    const { data, operations } = await executeEmailMcpTask("creator_owner_update", {
      kolUid: "KOLTEST001",
      owner: "王主管",
    });
    expect(calls.map((item) => item.name)).toEqual([
      "getKolProfileDetail",
      "updateKolProfile",
      "getKolProfileDetail",
    ]);
    expect(JSON.parse(String(calls[1].args.requestJson))).toMatchObject({
      kolUid: "KOLTEST001",
      ownerUserName: "王主管",
    });
    expect(data).toMatchObject({ updated: true, kolUid: "KOLTEST001" });
    expect(operations.map((item) => item.name).join(",")).not.toContain("decryptKolContact");
    expect(emailMcpResultCard("creator_owner_update", data).title).toBe("红人负责人更新结果");
  });

  it("resolves a profile from a name when kolUid is missing", async () => {
    const { data } = await executeEmailMcpTask("creator_profile", { name: "户外电源达人" });
    expect(calls.map((item) => item.name)[0]).toBe("pageKolProfiles");
    expect(data).toMatchObject({ kolUid: "KOLTEST001" });
  });

  it("syncs a new creator after email/name lookup, and skips add on duplicate name", async () => {
    const created = await executeEmailMcpTask("creator_library_sync", {
      name: "新测试达人",
      email: "new.creator@example.com",
    });
    expect(calls.map((item) => item.name)).toEqual(["pageKolProfiles", "pageKolProfiles", "addKolProfile"]);
    expect(created.data).toMatchObject({
      ok: true,
      created: true,
      kolName: "新测试达人",
      contactEmail: "new.creator@example.com",
    });
    expect(String(emailMcpResultCard("creator_library_sync", created.data).summary)).toContain("新增达人画像");
    expect(JSON.parse(String(calls[2].args.requestJson))).toMatchObject({
      kolName: "新测试达人",
      contactEmail: "new.creator@example.com",
    });

    calls.length = 0;
    const duplicate = await executeEmailMcpTask("creator_library_sync", {
      name: "户外电源达人",
      email: "qiyou1984@gmail.com",
    });
    expect(calls.map((item) => item.name)).toEqual(["pageKolProfiles"]);
    expect(duplicate.data).toMatchObject({ ok: true, duplicate: true });
  });

  it("does not write when sync is missing a name or contact email", async () => {
    const sync = await executeEmailMcpTask("creator_library_sync", { name: "缺邮箱" });
    expect(calls).toEqual([]);
    expect(sync.data).toMatchObject({ needs_input: true, missing_fields: ["contactEmail"] });
  });

  it("lists all visible profiles through listAllKolProfiles", async () => {
    const { data, operations } = await executeEmailMcpTask("creator_library_all", {});
    expect(calls.map((item) => item.name)).toEqual(["listAllKolProfiles"]);
    expect(data).toMatchObject({ total: 1 });
    expect(operations[0]).toMatchObject({ name: "starrykol.listAllKolProfiles", status: "done" });
    expect(emailMcpResultCard("creator_library_all", data).title).toBe("达人库全量结果");
  });

  it("updates creator stage through updateKolProfile after reading detail", async () => {
    const { data } = await executeEmailMcpTask("creator_status_update", {
      kolUid: "KOLTEST001",
      status: "已签约",
    });
    expect(calls.map((item) => item.name)).toEqual([
      "getKolProfileDetail",
      "updateKolProfile",
      "getKolProfileDetail",
    ]);
    expect(JSON.parse(String(calls[1].args.requestJson))).toMatchObject({
      kolUid: "KOLTEST001",
      cooperationStageCode: "CONTRACTING",
      cooperationStageName: "合同签署",
    });
    expect(data).toMatchObject({ updated: true, kolUid: "KOLTEST001" });
  });

  it("writes official cooperationStageCode instead of legacy Starry codes", async () => {
    const { data } = await executeEmailMcpTask("creator_status_update", {
      kolUid: "KOLTEST001",
      cooperationStageCode: "INTERESTED",
    });
    expect(JSON.parse(String(calls.find((row) => row.name === "updateKolProfile")?.args.requestJson))).toMatchObject({
      kolUid: "KOLTEST001",
      cooperationStageCode: "INTERESTED",
      cooperationStageName: "已回复-有兴趣",
    });
    expect(JSON.stringify(calls.find((row) => row.name === "updateKolProfile")?.args)).not.toContain("INTEREST_CONFIRMED");
    expect(data).toMatchObject({ updated: true });
  });

  it("decrypts contact only when that skill is invoked", async () => {
    const { data } = await executeEmailMcpTask("creator_contact_decrypt", { kolUid: "KOLTEST001" });
    expect(calls.map((item) => item.name)).toEqual(["decryptKolContact"]);
    expect(JSON.parse(String(calls[0].args.requestJson))).toMatchObject({ kolUid: "KOLTEST001" });
    expect(data).toMatchObject({ decrypted: true, contactEmail: "qiyou1984@gmail.com" });
    expect(emailMcpResultCard("creator_contact_decrypt", data).title).toBe("达人联系方式");
  });

  it("loads lifecycle, risk conversations, filter options and app conversations", async () => {
    await executeEmailMcpTask("creator_lifecycle_kanban", {});
    await executeEmailMcpTask("creator_risk_conversations", {});
    await executeEmailMcpTask("risk_scan", {});
    await executeEmailMcpTask("creator_filter_options", { parentKey: "kol_primary_platform" });
    await executeEmailMcpTask("email_app_conversation_list", { keyword: "qiyou1984@gmail.com" });
    expect(calls.map((item) => item.name)).toEqual([
      "pageLifecycleKanban",
      "pageRiskConversations",
      "summarizeRiskConversations",
      "pageRiskConversations",
      "summarizeRiskConversations",
      "listDictionaryOptions",
      "listCooperationStageOptions",
      "listRiskTagOptions",
      "listDictionaryOptions",
      "listDictionaryOptions",
      "pageAppEmailConversations",
    ]);
    const scan = await executeEmailMcpTask("risk_scan", {});
    expect(Array.isArray(scan.data.overdue)).toBe(true);
    expect((scan.data.overdue as Json[]).some((row) => row.handle === "小美妆日记")).toBe(true);
    const card = emailMcpResultCard("risk_scan", scan.data);
    expect(card.title).toBe("超时/风险扫描");
    expect(JSON.stringify(card.sections)).toContain("T8 失联与延期");
    expect(JSON.stringify(card.sections)).toContain("风险汇总");
    expect(JSON.stringify(card.sections)).toContain("@小美妆日记");
  });

  it("analyzes a reply into a 15-stage checklist without writing stage or sending", async () => {
    const { data, operations } = await executeEmailMcpTask("reply_analysis", {
      to: "qiyou1984@gmail.com",
    });
    expect(operations.map((item) => item.name)).toEqual([
      "starrykol.pageEmailConversations",
      "starrykol.getEmailConversation",
      "starrykol.getEmailConversationSubjectGroups",
      "starrykol.translateEmailToChinese",
      "starrykol.listCooperationStageOptions",
      "starrykol.getStageRiskMatrix",
      "starrykol.getKolProfileDetail",
      "starrykol.pageRiskConversations",
    ]);
    expect(operations.every((item) => !/updateKolProfile|sendEmailNow|changeLifecycleStage|createWorkApproval/.test(String(item.name)))).toBe(true);
    expect(data.pointer).toBe("INTERESTED");
    expect(data.current_stage).toBe("INITIAL_CONTACT");
    expect(data.completed).toEqual([]);
    expect(data.evidenced).toContain("INTERESTED");
    expect(Array.isArray(data.checklist)).toBe(true);
    expect((data.checklist as Json[]).some((row) => row.code === "INTERESTED" && String(row.note || "").includes("当前指针"))).toBe(true);
    expect((data.checklist as Json[]).some((row) => row.code === "PUBLISHED" && row.status === "未开始")).toBe(true);
    const card = emailMcpResultCard("reply_analysis", data);
    expect(card.title).toBe("回复分析");
    expect(card.summary).toContain("已回复-有兴趣");
    expect(JSON.stringify(card.sections)).toContain("十五阶段清单");
    expect(card.recommended_actions).toEqual([
      "写合作邮件 qiyou1984@gmail.com",
      "提出阶段变更 @户外电源达人 已回复-有兴趣",
    ]);
  });
});

describe("Email MCP task run path", () => {
  it("runs all Email MCP catalog tasks from text and persists a result card", async () => {
    const prompts: Record<(typeof EMAIL_MCP_TASKS)[number], string> = {
      email_mailbox_list: "品牌邮箱列表",
      email_conversation_list: "邮件会话列表",
      email_conversation_read: "读取邮件会话 会话ID 101",
      email_compose: "写合作邮件 发件箱 henry.wei@amperetime.com 发给 qiyou1984@gmail.com 主题：LiTime MCP 连通测试",
      email_app_conversation_list: "应用邮件会话",
      creator_library_query: "查询达人库 关键词：户外电源",
      creator_library_all: "全量达人库",
      creator_library_sync: "添加达人 新测试达人 new.creator@example.com",
      creator_profile: "达人画像 达人 UID KOLTEST001",
      creator_owner_update: "更新红人负责人 达人 UID KOLTEST001 负责人：王主管",
      creator_status_update: "更新达人状态 达人 UID KOLTEST001 状态：已建联",
      creator_contact_decrypt: "解密达人联系方式 达人 UID KOLTEST001",
      creator_lifecycle_kanban: "合作生命周期看板",
      creator_risk_conversations: "达人风险会话",
      creator_filter_options: "达人筛选字典",
      risk_scan: "风险扫描",
      reply_analysis: "分析回复 qiyou1984@gmail.com",
    };
    for (const taskType of EMAIL_MCP_TASKS) {
      const created = await request("POST", "/api/tasks/from-text", { text: prompts[taskType] });
      expect(created.status, `${taskType}: create`).toBe(201);
      const task = created.body.task as Json;
      expect(task.task_type).toBe(taskType);
      const queued = await request("POST", `/api/tasks/${task.id}/run`, {});
      expect(queued.status, `${taskType}: queue`).toBe(202);
      const executed = await request(
        "POST",
        `/api/sessions/${queued.body.session_id}/messages`,
        queued.body.pending_message,
      );
      expect(executed.status, `${taskType}: run`).toBe(200);
      const messages = executed.body.messages as Json[];
      expect(messages.some((message) => message.kind === "task_result_card"), `${taskType}: card`).toBe(true);
      expect((executed.body.worker as Json)?.skill).toBe(taskType);
      const detail = await request("GET", `/api/tasks/${task.id}`);
      expect((detail.body.artifacts as Json[]).some((artifact) => artifact.artifact_type === "task_result_card")).toBe(true);
    }
  });

  it("blocks real employee submission while the KOL Agent is unpublished", async () => {
    const previous = process.env.CODEX_MODE;
    process.env.CODEX_MODE = "real";
    try {
      const created = await request("POST", "/api/sessions", { title: "达人库查询" });
      const posted = await request("POST", `/api/sessions/${created.body.id}/messages`, {
        text: "查询达人库 关键词：户外电源",
        intent: "creator_library_query",
        act: "ask",
      });
      expect(posted.status).toBe(409);
      expect(posted.body.detail).toMatchObject({ code: "agent_not_published" });
    } finally {
      process.env.CODEX_MODE = previous;
      setEmailMcpClientFactory(mockClient);
    }
  });

  it("maps HTML MCP payloads to a gateway error", async () => {
    setEmailMcpClientFactory(() => ({
      async callTool() {
        throw new SyntaxError("Unexpected token '<', \"<html><h\"... is not valid JSON");
      },
      async close() { /* noop */ },
    }));
    await expect(executeEmailMcpTask("creator_library_query", { keyword: "户外电源" })).rejects.toMatchObject({
      status: 502,
      detail: expect.objectContaining({ code: "starrykol_bad_gateway" }),
    });
  });
});
