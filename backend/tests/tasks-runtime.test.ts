import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpServerSpecs, writeBoxCodexConfig } from "../mcp/codex-config.js";
import { filterTools } from "../mcp/stdio.js";
import { STARRY_TOOLS } from "../mcp/tools.js";
import { getConn, resetConn } from "../src/db.js";
import { appendTaskEvent } from "../src/routers/tasks.js";
import { SKILL_CATALOG } from "../src/host/skills-catalog.js";
import { profileFor } from "../src/profiles.js";
import { seedAll } from "../src/seed.js";
import { resolveTaskIntent, stubResolveTaskIntent } from "../src/tasks/resolver.js";
import { ALLOWED_TASK_MCP, taskDefinitions } from "../src/tasks/registry.js";

type Json = Record<string, unknown>;
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

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-tasks-"));
  process.env.LINGONG_DB = path.join(tmp, "tasks.db");
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
});

describe("manifest task registry", () => {
  it("loads complete, unique and read-only definitions including 15 SOPs", () => {
    const definitions = taskDefinitions();
    expect(definitions.length).toBe(SKILL_CATALOG.length);
    expect(definitions.filter((row) => row.id.startsWith("sop_"))).toHaveLength(15);
    expect(new Set(definitions.map((definition) => definition.id)).size).toBe(definitions.length);
    for (const definition of definitions) {
      expect(path.basename(path.dirname(definition.path))).toBe(definition.id);
      expect(definition.title).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.permissions).toBeInstanceOf(Array);
      expect(definition.actions).toBeInstanceOf(Array);
      expect(definition.mcp.every((tool) => ALLOWED_TASK_MCP.has(tool))).toBe(true);
      expect(definition.mcp.some((tool) => /send|ingest|confirm_stage/.test(tool))).toBe(false);
    }
  });

  it("keeps compatibility catalog and profile mapping derived from manifests", () => {
    const definitions = taskDefinitions();
    expect(SKILL_CATALOG.map((entry) => entry.id).sort()).toEqual(definitions.map((entry) => entry.id).sort());
    for (const definition of definitions) {
      expect(profileFor(definition.id).id).toBe(definition.profile);
      expect(SKILL_CATALOG.find((entry) => entry.id === definition.id)?.label).toBe(definition.title);
    }
  });
});

describe("task intent resolution", () => {
  it("keeps explicit task_type authoritative even when text names another task", () => {
    const result = resolveTaskIntent({
      task_type: "risk_scan",
      text: "请执行合同审查",
    });
    expect(result.task_type).toBe("risk_scan");
    expect(result.confidence).toBe(1);
  });

  it("returns clarification for low-confidence free text", () => {
    const result = resolveTaskIntent({ text: "帮我看看这个" });
    expect(result.task_type).toBeNull();
    expect(result.needs_clarification).toBe(true);
    expect(result.alternatives.map((item) => item.task_type)).toEqual([
      "creator_lifecycle_kanban",
      "reply_analysis",
      "risk_scan",
    ]);
  });

  it("offers Email MCP skills when mailbox language is too vague to auto-run", () => {
    const result = resolveTaskIntent({ text: "帮我看一下邮箱情况" });
    expect(result.task_type).toBeNull();
    expect(result.needs_clarification).toBe(true);
    expect(result.alternatives.map((item) => item.task_type)).toEqual([
      "email_mailbox_list",
      "email_conversation_list",
      "email_compose",
    ]);
  });

  it("does not pick a skill from operator text without a locked task_type", () => {
    expect(resolveTaskIntent({ text: "写合作邮件" }).task_type).toBeNull();
    expect(resolveTaskIntent({ text: "搜索 YouTube 露营达人" }).clarification_kind).toBe("direction");
    expect(resolveTaskIntent({ text: "记状态 @小美妆日记" }).task_type).toBeNull();
  });

  it("recognizes platform creator-search language and extracts crawl entities", () => {
    const result = stubResolveTaskIntent({ text: "搜索 YouTube 露营达人" });
    expect(result).toMatchObject({
      task_type: "creator_discovery",
      confidence: 0.97,
      entities: {
        platform: "youtube",
        keywords: ["露营"],
      },
      needs_clarification: false,
    });
  });

  it("splits quoted Chinese keyword lists for crawl plans", () => {
    expect(stubResolveTaskIntent({ text: "搜索 Instagram“户外电源、房车露营”达人。" })).toMatchObject({
      task_type: "creator_discovery",
      entities: {
        platform: "instagram",
        keywords: ["户外电源", "房车露营"],
      },
    });
  });

  it("keeps YouTube as a first-class MediaCrawler platform instead of falling back to xhs", () => {
    expect(stubResolveTaskIntent({ text: "搜索 YouTube 户外电源达人" })).toMatchObject({
      task_type: "creator_discovery",
      entities: { platform: "youtube", keywords: ["户外电源"] },
    });
  });

  it("recognizes Email MCP library and KOL Claw scoring phrases", async () => {
    expect(stubResolveTaskIntent({ text: "查询达人库 关键词：户外电源 状态：待建联" })).toMatchObject({
      task_type: "creator_library_query",
      entities: { keyword: "户外电源", status: "待建联" },
    });
    expect(stubResolveTaskIntent({ text: "达人库查询 Wendell Fishing" })).toMatchObject({
      task_type: "creator_library_query",
      entities: { keyword: "Wendell Fishing" },
    });
    expect(stubResolveTaskIntent({ text: "达人库查询 [关键词]" }).entities.keyword).toBeUndefined();
    expect(stubResolveTaskIntent({ text: "按关键词、合作阶段和风险标签分页查询红人库" }).entities.keyword).toBeUndefined();
    expect(stubResolveTaskIntent({ text: "添加达人 户外电源达人 粉丝 85000 播放量 120000、110000" })).toMatchObject({
      task_type: "creator_library_sync",
      entities: { name: "户外电源达人", followers: 85000, views: [120000, 110000] },
    });
    expect(stubResolveTaskIntent({ text: "达人画像 达人 UID KOLTEST001" })).toMatchObject({
      task_type: "creator_profile",
      entities: { kolUid: "KOLTEST001" },
    });
    expect(stubResolveTaskIntent({ text: "达人评分 目标CPM 12" })).toMatchObject({
      task_type: "creator_scoring",
      entities: { target_cpm: 12 },
    });
    expect(stubResolveTaskIntent({ text: "生成建联话术 达人名称：户外电源达人 产品：露营灯" })).toMatchObject({
      task_type: "creator_outreach",
      entities: { name: "户外电源达人", product: "露营灯" },
    });
    expect(stubResolveTaskIntent({ text: "更新达人状态 达人名称：户外电源达人 状态：已建联" })).toMatchObject({
      task_type: "creator_status_update",
      entities: { name: "户外电源达人", status: "已建联" },
    });
    expect(stubResolveTaskIntent({ text: "把达人 UID KOLTEST001 标记为已签约" })).toMatchObject({
      task_type: "confirm_stage",
      entities: { kolUid: "KOLTEST001" },
    });
    expect(stubResolveTaskIntent({ text: "更新红人负责人 达人 UID KOLTEST001 负责人：王主管" })).toMatchObject({
      task_type: "creator_owner_update",
      entities: { kolUid: "KOLTEST001", owner: "王主管" },
    });
    expect(stubResolveTaskIntent({ text: "全量达人库" })).toMatchObject({ task_type: "creator_library_all" });
    expect(stubResolveTaskIntent({ text: "解密达人联系方式 达人 UID KOLTEST001" })).toMatchObject({
      task_type: "creator_contact_decrypt",
      entities: { kolUid: "KOLTEST001" },
    });
    expect(stubResolveTaskIntent({ text: "合作生命周期看板" })).toMatchObject({ task_type: "creator_lifecycle_kanban" });
    expect(stubResolveTaskIntent({ text: "达人风险会话" })).toMatchObject({ task_type: "creator_risk_conversations" });
    expect(stubResolveTaskIntent({ text: "风险扫描" })).toMatchObject({ task_type: "risk_scan" });
    expect(stubResolveTaskIntent({ text: "扫描在途风险" })).toMatchObject({ task_type: "risk_scan" });
    expect(stubResolveTaskIntent({ text: "扫描" })).toMatchObject({ task_type: "risk_scan" });
    expect(stubResolveTaskIntent({ text: "T8" })).toMatchObject({ task_type: "risk_scan" });
    expect(stubResolveTaskIntent({ text: "达人筛选字典" })).toMatchObject({ task_type: "creator_filter_options" });
    expect(stubResolveTaskIntent({ text: "达人筛选 关键词：户外电源" })).toMatchObject({
      task_type: "creator_library_query",
      entities: { keyword: "户外电源" },
    });
    expect(stubResolveTaskIntent({ text: "应用邮件会话" })).toMatchObject({ task_type: "email_app_conversation_list" });
    expect(stubResolveTaskIntent({ text: "今日KOL任务" })).toMatchObject({ task_type: "creator_daily_tasks" });
    expect(stubResolveTaskIntent({ text: "延期关怀 @小美妆日记" })).toMatchObject({ task_type: "risk_scan" });
    expect(stubResolveTaskIntent({ text: "失联跟进 @小美妆日记" })).toMatchObject({ task_type: "risk_scan" });
    expect(stubResolveTaskIntent({ text: "记状态 @小美妆日记" })).toMatchObject({ task_type: "confirm_stage" });
    expect(stubResolveTaskIntent({ text: "Deal Memory @旅行电源菌" })).toMatchObject({ task_type: "deal_memory" });
    expect(stubResolveTaskIntent({ text: "KOL预算 项目ID 1" })).toMatchObject({
      task_type: "creator_budget_report",
      entities: { campaign_id: 1 },
    });
    expect(stubResolveTaskIntent({ text: "黎玉燕要申请5万美国KOL推广预算" }).task_type).toBe("business_approval");
    expect(stubResolveTaskIntent({ text: "expense approval 50000 USD" }).task_type).toBe("business_approval");
    expect(stubResolveTaskIntent({ text: "写报价信 金额 680" }).task_type).toBe("email_compose");
    expect(stubResolveTaskIntent({ text: "给@小美妆日记 写阶段跟进邮件" })).toMatchObject({
      task_type: "email_compose",
      needs_clarification: false,
      missing_fields: [],
      entities: { handle: "小美妆日记" },
    });
    expect(stubResolveTaskIntent({ text: "催大纲 [红人或合作]" })).toMatchObject({
      task_type: "email_compose",
      needs_clarification: false,
      missing_fields: [],
    });
  });

  it("recognizes Email MCP mailbox and compose phrases", () => {
    expect(stubResolveTaskIntent({ text: "查发件箱和授权" })).toMatchObject({
      task_type: "email_mailbox_list",
      confidence: 0.97,
      needs_clarification: false,
    });
    expect(stubResolveTaskIntent({ text: "帮我查一下发件箱授权" })).toMatchObject({
      task_type: "email_mailbox_list",
    });
    expect(stubResolveTaskIntent({ text: "查收件会话 qiyou1984@gmail.com" })).toMatchObject({
      task_type: "email_conversation_list",
      entities: { email: "qiyou1984@gmail.com" },
    });
    expect(stubResolveTaskIntent({ text: "品牌邮箱列表" })).toMatchObject({
      task_type: "email_mailbox_list",
    });
    expect(stubResolveTaskIntent({ text: "邮件会话列表" })).toMatchObject({
      task_type: "email_conversation_list",
    });
    expect(stubResolveTaskIntent({ text: "读取邮件会话 会话ID 101" })).toMatchObject({
      task_type: "email_conversation_read",
      entities: { conversationId: 101 },
    });
    expect(stubResolveTaskIntent({
      text: "回复会话 320 发件: larry.zhao@amperetime.com 收件: qiyou1984@gmail.com 主题: Re: KOL合作",
    })).toMatchObject({
      task_type: "email_compose",
      entities: {
        conversationId: 320,
        mailboxEmail: "larry.zhao@amperetime.com",
        to: ["qiyou1984@gmail.com"],
        subject: "Re: KOL合作",
      },
    });
    expect(stubResolveTaskIntent({ text: "分析回复 qiyou1984@gmail.com" })).toMatchObject({
      task_type: "reply_analysis",
      entities: { email: "qiyou1984@gmail.com" },
    });
    expect(stubResolveTaskIntent({
      text: "写合作邮件 qiyou1984@gmail.com qiyouhuang@163.com 主题：LiTime MCP 连通测试 确认发送",
    })).toMatchObject({
      task_type: "email_compose",
      needs_clarification: true,
      missing_fields: ["mailboxEmail"],
      entities: {
        to: ["qiyou1984@gmail.com", "qiyouhuang@163.com"],
        email: "qiyou1984@gmail.com",
        subject: "LiTime MCP 连通测试",
        confirm_send: true,
      },
    });
    expect(stubResolveTaskIntent({
      text: "写合作邮件 发件箱 henry.wei@amperetime.com 发给 qiyou1984@gmail.com qiyouhuang@163.com 主题：LiTime MCP 连通测试 确认发送",
    })).toMatchObject({
      task_type: "email_compose",
      needs_clarification: false,
      missing_fields: [],
      entities: {
        mailboxEmail: "henry.wei@amperetime.com",
        to: ["qiyou1984@gmail.com", "qiyouhuang@163.com"],
        subject: "LiTime MCP 连通测试",
        confirm_send: true,
      },
    });
  });

  it("treats template placeholders as missing compose fields", () => {
    const result = stubResolveTaskIntent({
      text: "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]",
    });
    expect(result.task_type).toBe("email_compose");
    expect(result.missing_fields).toEqual(["mailboxEmail", "to", "subject"]);
    expect(result.entities.subject).toBeUndefined();
  });
});

describe("task CRUD and run flow", () => {
  it("creates, runs, records ordered events, status and artifacts", async () => {
    const created = await request("POST", "/api/tasks", {
      task_type: "risk_scan",
      title: "扫描风险",
      priority: "high",
    });
    expect(created.status).toBe(201);
    const taskId = String(created.body.id);

    const listed = await request("GET", "/api/tasks?priority=high&profile=commander");
    expect((listed.body as unknown as Json[]).some((task) => task.id === taskId)).toBe(true);

    const queued = await request("POST", `/api/tasks/${taskId}/run`, { text: "风险扫描" });
    expect(queued.status).toBe(202);
    expect((queued.body.task as Json).id).toBe(taskId);
    expect((queued.body.pending as Json)).toMatchObject({
      work_item_id: taskId,
      task_type: "risk_scan",
      intent: "risk_scan",
    });
    const pending = queued.body.pending_message as Json;
    const executed = await request(
      "POST",
      `/api/sessions/${queued.body.session_id}/messages`,
      pending,
    );
    expect(executed.status).toBe(200);
    const bySession = await request("GET", `/api/tasks/by-session/${queued.body.session_id}`);
    expect(bySession.body.id).toBe(taskId);

    const detail = await request("GET", `/api/tasks/${taskId}`);
    expect(detail.body.status).toBe("waiting");
    expect((detail.body.artifacts as Json[]).some((artifact) => artifact.artifact_type === "task_result_card")).toBe(true);
    const events = await request("GET", `/api/tasks/${taskId}/events`);
    const rows = events.body as unknown as Json[];
    expect(rows.map((event) => event.sequence)).toEqual(rows.map((_, index) => index + 1));
    expect(rows.every((event) => event.type && event.title && event.created_at)).toBe(true);
    expect(rows.map((event) => event.event_type)).toContain("run.completed");
    const completed = await request("POST", `/api/tasks/${taskId}/complete`, {});
    expect(completed.body.status).toBe("completed");
  });

  it("does not create a task from ambiguous text", async () => {
    const response = await request("POST", "/api/tasks/from-text", { text: "帮我处理一下" });
    expect(response.status).toBe(200);
    expect(response.body.needs_clarification).toBe(true);
    expect(response.body.task).toBeNull();
  });

  it("keeps numbered free text as one utterance for the intent model", async () => {
    const response = await request("POST", "/api/tasks/from-text", {
      text: "1. 回复分析\n2. 风险扫描",
    });
    expect(response.status).toBe(201);
    const tasks = response.body.tasks as unknown as Json[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task_type).toBe("reply_analysis");
  });

  it("keeps tasks with missing manifest inputs in clarification state without running", async () => {
    const created = await request("POST", "/api/tasks", {
      definition_id: "confirm_stage",
      title: "提出阶段变更",
    });
    expect(created.body.status).toBe("needs_clarification");
    const run = await request("POST", `/api/tasks/${created.body.id}/run`, {});
    expect(run.status).toBe(422);
    expect(run.body.needs_clarification).toBe(true);
  });

  it("turns a creator-search phrase into a crawl plan without calling remote start", async () => {
    const created = await request("POST", "/api/tasks/from-text", { text: "搜索 YouTube 露营达人" });
    expect(created.status).toBe(201);
    const task = created.body.task as Json;
    expect(task.task_type).toBe("creator_discovery");
    const queued = await request("POST", `/api/tasks/${task.id}/run`, {});
    const executed = await request(
      "POST",
      `/api/sessions/${queued.body.session_id}/messages`,
      queued.body.pending_message,
    );
    expect(executed.status).toBe(200);
    const plan = (executed.body.messages as Json[]).find((message) => message.kind === "crawl_plan");
    expect((plan?.payload as Json).crawl_plan).toMatchObject({
      platform: "youtube",
      mode: "search",
      keywords: ["露营"],
      requires_confirmation: false,
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM crawl_jobs").get()).toMatchObject({ n: 0 });
  });

  it("keeps YouTube discovery as a first-class crawl platform instead of falling back to xhs", async () => {
    const created = await request("POST", "/api/tasks/from-text", { text: "搜索 YouTube 户外电源达人" });
    const task = created.body.task as Json;
    const queued = await request("POST", `/api/tasks/${task.id}/run`, {});
    const executed = await request(
      "POST",
      `/api/sessions/${queued.body.session_id}/messages`,
      queued.body.pending_message,
    );
    const plan = (executed.body.messages as Json[]).find((message) => message.kind === "crawl_plan");
    expect((plan?.payload as Json).crawl_plan).toMatchObject({
      platform: "youtube",
      mode: "search",
      keywords: ["户外电源"],
    });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM crawl_jobs").get()).toMatchObject({ n: 0 });
  });

  it("skips task events when the work item or run is already gone", async () => {
    const created = await request("POST", "/api/tasks/from-text", { text: "搜索 YouTube 露营达人" });
    expect(created.status).toBe(201);
    const task = created.body.task as Json;
    const queued = await request("POST", `/api/tasks/${task.id}/run`, {});
    const runId = String(queued.body.run_id || "");
    expect(appendTaskEvent(String(task.id), runId, "run.progress", "准备任务", "running")).toMatchObject({
      work_item_id: task.id,
      run_id: runId,
      event_type: "run.progress",
    });
    getConn().prepare("DELETE FROM task_events WHERE work_item_id=?").run(task.id);
    getConn().prepare("DELETE FROM task_runs WHERE work_item_id=?").run(task.id);
    getConn().prepare("DELETE FROM work_items WHERE id=?").run(task.id);
    expect(appendTaskEvent(String(task.id), runId, "crawl.start_failed", "远程采集启动失败", "failed")).toBeNull();
    expect(appendTaskEvent("wi_missing", null, "task.created", "gone", "pending")).toBeNull();
  });

  it("turns an Instagram search phrase into a crawl plan", async () => {
    const created = await request("POST", "/api/tasks/from-text", { text: "搜索 Instagram camping 达人" });
    expect(created.status).toBe(201);
    const queued = await request("POST", `/api/tasks/${(created.body.task as Json).id}/run`, {});
    const executed = await request(
      "POST",
      `/api/sessions/${queued.body.session_id}/messages`,
      queued.body.pending_message,
    );
    const plan = (executed.body.messages as Json[]).find((message) => message.kind === "crawl_plan");
    expect((plan?.payload as Json).crawl_plan).toMatchObject({
      platform: "instagram",
      mode: "search",
      keywords: ["camping"],
    });
  });
});

describe("MCP minimization", () => {
  it("filters exact tools and passes per-task allowlists to servers", () => {
    expect(filterTools(STARRY_TOOLS, ["get_collaboration"]).map((tool) => tool.name)).toEqual(["get_collaboration"]);
    const definition = taskDefinitions().find((item) => item.id === "confirm_stage")!;
    const specs = mcpServerSpecs(definition.mcp) as Record<string, { args: string[] }>;
    expect(Object.keys(specs)).toEqual(["starry"]);
    expect(specs.starry.args.join(" ")).toContain("get_collaboration");
  });

  it("wires remote starrykol and kolclaw servers from Skill mcp names", () => {
    const previous = {
      url: process.env.STARRY_KOL_MCP_URL,
      key: process.env.STARRY_KOL_MCP_API_KEY,
      bearer: process.env.STARRY_KOL_MCP_BEARER,
      clawUrl: process.env.KOLCLAW_MCP_URL,
      clawToken: process.env.KOLCLAW_MCP_TOKEN,
    };
    process.env.STARRY_KOL_MCP_URL = "https://starrykol.example/mcp";
    process.env.STARRY_KOL_MCP_API_KEY = "sk-test-key";
    process.env.STARRY_KOL_MCP_BEARER = "starry-bearer";
    process.env.KOLCLAW_MCP_URL = "https://kolclaw.example/mcp";
    process.env.KOLCLAW_MCP_TOKEN = "claw-token";
    try {
      const compose = taskDefinitions().find((item) => item.id === "email_compose")!;
      expect(compose.mcp).toContain("starrykol.previewEmailDraft");
      expect(compose.mcp.some((tool) => /send|ingest/.test(tool))).toBe(false);
      const specs = mcpServerSpecs(compose.mcp) as Record<string, Json>;
      expect(specs.starrykol).toMatchObject({
        url: "https://starrykol.example/mcp",
        http_headers: {
          "X-MCP-API-KEY": "sk-test-key",
          Authorization: "Bearer starry-bearer",
        },
      });
      expect(specs.starrykol).not.toHaveProperty("bearer_token");
      expect(specs.starrykol).not.toHaveProperty("extra_headers");
      expect((specs.starrykol.enabled_tools as string[])).toContain("previewEmailDraft");
      expect(specs.starrykol).not.toHaveProperty("command");
      const scoring = taskDefinitions().find((item) => item.id === "creator_scoring")!;
      const claw = mcpServerSpecs(scoring.mcp) as Record<string, Json>;
      expect(claw.kolclaw).toMatchObject({
        url: "https://kolclaw.example/mcp",
        bearer_token_env_var: "KOLCLAW_MCP_TOKEN",
      });
      expect(claw.kolclaw).not.toHaveProperty("bearer_token");
      const box = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-codex-box-"));
      writeBoxCodexConfig(box, compose.mcp);
      const toml = fs.readFileSync(path.join(box, ".codex", "config.toml"), "utf8");
      expect(toml).not.toMatch(/^bearer_token\s*=/m);
      expect(toml).toContain("[mcp_servers.starrykol.http_headers]");
      expect(toml).toContain('"Authorization" = "Bearer starry-bearer"');
      expect(toml).toContain('"X-MCP-API-KEY" = "sk-test-key"');
      fs.rmSync(box, { recursive: true, force: true });
    } finally {
      restoreEnv("STARRY_KOL_MCP_URL", previous.url);
      restoreEnv("STARRY_KOL_MCP_API_KEY", previous.key);
      restoreEnv("STARRY_KOL_MCP_BEARER", previous.bearer);
      restoreEnv("KOLCLAW_MCP_URL", previous.clawUrl);
      restoreEnv("KOLCLAW_MCP_TOKEN", previous.clawToken);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}
