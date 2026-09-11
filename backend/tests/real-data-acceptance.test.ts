import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES } from "../src/config.js";
import { SKILL_CATALOG } from "../src/host/skills-catalog.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { EMAIL_TEMPLATES, templateAllowedForStage } from "../src/email-templates.js";
import { LEGACY_STAGE_ALIASES, MAIN_STAGES, label, normalizeStage } from "../src/stages.js";
import { judgeCollaborationStage } from "../src/stage-judgment.js";
import { executeStarryKolTask, setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";
import {
  PORTRAIT_SHEET_EMAILS,
  WENDELL_UID,
  exceptionTemplateRows,
  flowTemplateRows,
  mailboxBindRows,
  portraitRows,
  readRealText,
  starryMailboxes,
  starryProfiles,
  starryStages,
  starryToolNames,
  wendellProfile,
  type StarryProfile,
} from "./fixtures/real-data/load.js";

let tmp = "";
let chatApp: Hono;
const calls: Array<{ name: string; args: Json }> = [];

function mockFromSnapshot() {
  const profiles = starryProfiles();
  const mailboxes = starryMailboxes();
  const stages = starryStages();
  return {
    async callTool(name: string, args: Json = {}): Promise<Json> {
      calls.push({ name, args });
      if (name === "decryptKolContact") throw new Error("decryptKolContact must not run on whitelist reads");
      if (name === "listAllKolProfiles") return { data: { total: profiles.length, list: profiles } };
      if (name === "pageKolProfiles") {
        let body: Json = {};
        try { body = JSON.parse(String(args.requestJson || "{}")) as Json; } catch { body = args; }
        const keyword = String(body.keyword || "").trim().toLowerCase();
        const list = keyword
          ? profiles.filter((row) => JSON.stringify(row).toLowerCase().includes(keyword))
          : profiles.slice(0, Number(body.pageSize || 20));
        return { data: { pageNo: 1, pageSize: list.length, total: list.length, list } };
      }
      if (name === "getKolProfileDetail") {
        const hit = profiles.find((row) => row.kolUid === args.kolUid) || profiles[0];
        return { data: hit };
      }
      if (name === "pageMailboxes") return { data: { total: mailboxes.length, list: mailboxes } };
      if (name === "listNylasAccounts") return { data: { items: [] } };
      if (name === "listCooperationStageOptions") return { data: stages };
      if (name === "listKolPlatformData") return { data: { list: [] } };
      if (name === "pageEmailConversations") return { data: { total: 0, list: [] } };
      if (name === "pageLifecycleKanban") return { data: { total: 0, list: [] } };
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

async function request(method: string, url: string, body?: unknown) {
  const response = await chatApp.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

async function ask(prompt: string, intent?: string, collaborationId?: string, expectStatus = 200) {
  const session = await request("POST", "/api/sessions", { title: prompt.slice(0, 40) });
  const payload: Json = { text: prompt, content: prompt, act: "ask", model_tier: "default" };
  if (intent) payload.intent = intent;
  if (collaborationId) payload.collaboration_id = collaborationId;
  const listed = await request("POST", `/api/sessions/${session.body.id}/messages`, payload);
  expect(listed.status, JSON.stringify(listed.body)).toBe(expectStatus);
  return [String(session.body.id), listed.body] as const;
}

function portraitEmail(name: string): string {
  return portraitRows().find((row) => row["名称"] === name)?.["邮箱"] || "";
}

function insertCollaboration(profile: StarryProfile, stageCode = "INITIAL_CONTACT"): string {
  const id = `col_${profile.kolUid}`;
  const followers = profile.followerCountTenThousands != null ? `${profile.followerCountTenThousands}万` : "";
  const geo = profile.audienceGeo && typeof profile.audienceGeo === "object"
    ? Object.entries(profile.audienceGeo).sort((a, b) => Number.parseFloat(b[1]) - Number.parseFloat(a[1]))[0]?.[0] || ""
    : String(profile.countryName || "");
  const boundEmail = portraitEmail(profile.kolName) || `${profile.kolUid.toLowerCase()}@litime.example`;
  getConn().prepare(
    `INSERT OR REPLACE INTO collaborations
     (id, handle, display_name, brand, platform, followers, email, mailbox_from,
      lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
      stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    profile.kolName,
    profile.kolName,
    String(profile.brandName || "LT").replace(/品牌$/, ""),
    profile.platform || "YouTube",
    followers,
    boundEmail,
    BRAND_MAILBOXES.LT,
    `lc_${profile.kolUid}`,
    `conv_${profile.kolUid}`,
    stageCode,
    9,
    String(profile.nicheTagsText || "").slice(0, 80),
    0,
    0,
    "",
    "",
    "",
    profile.countryName || "",
    "",
    "LT-MINI-12",
    "1",
    0,
  );
  getConn().prepare(
    `UPDATE collaborations SET owner_name=?, engagement_rate=?, audience_geo=?, duplicate_checked=1
     WHERE id=?`,
  ).run(
    profile.ownerName || "",
    profile.avgVideoEngagementRate10 ?? "",
    geo,
    id,
  );
  return id;
}

function insertUnboundCreator(portrait: Record<string, string>): void {
  const id = `cr_md_${portrait["名称"].replace(/\s+/g, "_")}`;
  getConn().prepare(
    `INSERT OR REPLACE INTO claw_creators
     (id, handle, name, platform, followers, score, status, outreach_script, payload)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    portrait["名称"],
    portrait["名称"],
    portrait["主平台"] || "youtube",
    Math.round(Number(portrait["粉丝量/万"] || 0) * 10000),
    0.7,
    "discovered",
    portrait["备注"] || "画像台账导入，待建联",
    JSON.stringify({
      niche: "vanlife",
      brand_fit: portrait["品牌"] || "LT",
      email: portrait["邮箱"] || "",
      unbound: true,
    }),
  );
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-real-data-"));
  process.env.LINGONG_DB = path.join(tmp, "real.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  calls.length = 0;
  setStarryKolClientFactory(mockFromSnapshot);
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  chatApp = createApp();
});

afterEach(() => {
  setStarryKolClientFactory();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("real markdown + Starry KOL MCP fixtures", () => {
  it("loads 220 Starry profiles including Wendell Fishing from the live snapshot", () => {
    const profiles = starryProfiles();
    expect(profiles.length).toBe(220);
    const wendell = profiles.filter((row) => row.kolName === "Wendell Fishing");
    expect(wendell.length).toBeGreaterThanOrEqual(1);
    expect(wendell.some((row) => row.platform === "YouTube" && row.countryName === "美国")).toBe(true);
    expect(wendell.some((row) => Number(row.followerCountTenThousands) >= 8)).toBe(true);
    expect(profiles.filter((row) => row.brandName === "LT品牌").length).toBeGreaterThan(200);
    expect(wendellProfile().kolUid).toBe(WENDELL_UID);
  });

  it("keeps the uploaded portrait sheet names as expected business records", () => {
    const portraits = portraitRows();
    expect(portraits.map((row) => row["名称"])).toEqual([
      "Wendell Fishing",
      "Holly Yoo",
      "jeremyfishfr",
      "RV LIFE",
      "Charlie at RV Central",
    ]);
    expect(portraits.every((row) => row["跟进人"] === "叶观旺")).toBe(true);
    expect(portraits.every((row) => /litime/i.test(row["品牌"]))).toBe(true);
    expect(portraits.find((row) => row["名称"] === "Charlie at RV Central")?.["邮箱"]).toBe("");
    expect(portraits.find((row) => row["名称"] === "Charlie at RV Central")?.["备注"]).toMatch(/私信|没邮箱/);
  });

  it("matches Wendell Fishing between the portrait markdown and Starry KOL MCP", () => {
    const sheet = portraitRows().find((row) => row["名称"] === "Wendell Fishing")!;
    const mcp = starryProfiles().filter((row) => row.kolName === "Wendell Fishing");
    expect(mcp.length).toBeGreaterThan(0);
    expect(sheet["主平台"].toLowerCase()).toContain("youtube");
    expect(mcp.some((row) => String(row.platform).toLowerCase() === "youtube")).toBe(true);
    expect(sheet["红人所属国家"]).toBe("美国");
    expect(mcp.some((row) => row.countryName === "美国")).toBe(true);
    const sheetFollowers = Number(sheet["粉丝量/万"]);
    expect(mcp.some((row) => Math.abs(Number(row.followerCountTenThousands) - sheetFollowers) < 1.5)).toBe(true);
  });

  it("puts official stage, risk, and tag fields on every Starry list-all profile", () => {
    const rows = starryProfiles();
    expect(rows).toHaveLength(220);
    for (const row of rows) {
      expect(row.cooperationStageCode, row.kolUid).toBeTruthy();
      expect(normalizeStage(String(row.cooperationStageCode))).toBe(row.cooperationStageCode);
      expect(Array.isArray(row.followStyleTags)).toBe(true);
      expect(Array.isArray(row.nicheTags)).toBe(true);
      expect(Array.isArray(row.riskTagCodes)).toBe(true);
    }
  });

  it("flags portrait-sheet creators that Starry has not ingested yet", () => {
    const names = new Set(starryProfiles().map((row) => row.kolName));
    const missing = portraitRows().filter((row) => !names.has(row["名称"]));
    expect(missing.map((row) => row["名称"])).toEqual([
      "Holly Yoo",
      "jeremyfishfr",
      "RV LIFE",
      "Charlie at RV Central",
    ]);
  });

  it("does not store portrait-sheet emails in the whitelist snapshot", () => {
    const blob = JSON.stringify(starryProfiles()).toLowerCase();
    for (const email of PORTRAIT_SHEET_EMAILS) {
      expect(blob).not.toContain(email);
    }
  });

  it("loads 5 real Starry mailboxes and 22 markdown mailbox-owner rows", () => {
    const mcp = starryMailboxes();
    const sheet = mailboxBindRows();
    expect(mcp).toHaveLength(5);
    expect(sheet).toHaveLength(22);
    expect(mcp.map((row) => row.mailboxEmail)).toContain("henry.wei@amperetime.com");
    expect(mcp.map((row) => row.mailboxEmail)).toContain("brandmarketing@litime.com");
    expect(sheet.some((row) => row["邮箱地址"] === "marketing.us@litime.com" && row["负责人姓名"] === "钟槿年")).toBe(true);
    expect(sheet.some((row) => row["邮箱地址"] === "marketing-bd.us@litime.com" && row["负责人姓名"] === "叶观旺")).toBe(true);
  });

  it("aligns brandmarketing mailbox owner with the bind sheet", () => {
    const sheet = mailboxBindRows().find((row) => row["邮箱地址"] === "brandmarketing@litime.com");
    const mcp = starryMailboxes().find((row) => row.mailboxEmail === "brandmarketing@litime.com") as Json;
    expect(sheet?.["负责人姓名"]).toBe("张干");
    expect(mcp.ownerUserName).toBe("张干");
  });

  it("exposes official 15+side Starry stage options with legacy aliases", () => {
    const stages = starryStages();
    expect(stages).toHaveLength(21);
    const official = stages.filter((row) => row.main !== false && MAIN_STAGES.some((stage) => stage.code === row.stageCode));
    expect(official).toHaveLength(15);
    for (const row of stages) {
      expect(normalizeStage(row.stageCode)).toBe(row.stageCode);
      expect(label(row.stageCode).replace(/\s/g, "")).toBe(row.stageName.replace(/\s/g, ""));
      for (const alias of row.aliases || []) {
        expect(normalizeStage(alias)).toBe(row.stageCode);
      }
    }
    expect(normalizeStage("EXCEPTION_HANDLING")).toBe("DISPUTED");
    expect(normalizeStage("INTEREST_CONFIRMED")).toBe("INTERESTED");
    expect(Object.keys(LEGACY_STAGE_ALIASES).length).toBeGreaterThanOrEqual(7);
  });

  it("lists 62 tools from the uploaded Starry KOL MCP inventory", () => {
    const tools = starryToolNames();
    expect(tools).toHaveLength(62);
    expect(tools).toContain("listAllKolProfiles");
    expect(tools).toContain("pageMailboxes");
    expect(tools).toContain("listCooperationStageOptions");
    expect(tools).toContain("decryptKolContact");
    expect(tools).toContain("pageLifecycleKanban");
  });
});

describe("markdown stage tables vs product catalog", () => {
  it("covers 15 official stages from the uploaded main-flow sheet", () => {
    const rows = flowTemplateRows();
    expect(rows).toHaveLength(15);
    const labels = rows.map((row) => row["阶段"].replace(/\s/g, ""));
    for (const stage of MAIN_STAGES) {
      expect(labels, stage.label).toContain(stage.label.replace(/\s/g, ""));
    }
  });

  it("keeps a catalog letter whose subject matches each uploaded main-flow row", () => {
    for (const row of flowTemplateRows()) {
      const stageName = row["阶段"].replace(/\s/g, "");
      const stage = MAIN_STAGES.find((item) => item.label.replace(/\s/g, "") === stageName);
      expect(stage, row["阶段"]).toBeTruthy();
      const fold = (value: string) => value.replace(/\{\{[^}]+\}\}/g, "Creator").replace(/\s+/g, " ").toLowerCase();
      const subject = fold(row["邮件主题"]);
      expect(
        EMAIL_TEMPLATES.some((tpl) => {
          if (!tpl.stages.includes(stage!.code)) return false;
          const catalog = fold(tpl.subject);
          return subject.includes(catalog) || catalog.includes(subject.split(" / ")[0]);
        }),
        row["模板类型"],
      ).toBe(true);
    }
  });

  it("maps long-term and exception sheet rows onto catalog skills", () => {
    const mapping: Record<string, string> = {
      联盟项目邀请: "affiliate_invite",
      联盟信息配置: "affiliate_setup",
      素材授权确认: "content_license",
      复投邀请邮件: "repeat_collab",
      合作延期邮件: "delay_followup",
      修改未完成: "revision_nudge",
      失联跟进: "lost_contact",
    };
    const rows = exceptionTemplateRows();
    for (const [title, skill] of Object.entries(mapping)) {
      const sheet = rows.find((row) => row["邮件类型/动作"] === title);
      expect(sheet, title).toBeTruthy();
      const tpl = EMAIL_TEMPLATES.find((item) => item.skill === skill);
      expect(tpl, skill).toBeTruthy();
      expect(sheet!["邮件模板/典型主题"]).toBe(tpl!.subject);
    }
  });

  it("judges each uploaded main-flow keyword set onto the official stage", () => {
    const cases: Array<{ stage: string; body: string }> = [
      { stage: "INTERESTED", body: "We are interested and would love to collaborate. Keen to learn more." },
      { stage: "EVALUATING", body: "Sharing the media kit and audience demographics plus engagement rate." },
      { stage: "QUOTE_PENDING", body: "Could you share your collaboration rates and pricing quote?" },
      { stage: "NEGOTIATING", body: "Here is a counteroffer. Happy to negotiate a revised rate within budget." },
      { stage: "PLAN_PENDING", body: "Please confirm the final terms so we can move forward." },
      { stage: "CONTRACTING", body: "Please review the collaboration agreement on DocuSign and add your signature." },
      { stage: "SAMPLE_PENDING", body: "Please confirm the shipping address, ZIP code and sample shipping SKU." },
      { stage: "SHIPPED", body: "The sample shipped via UPS. Tracking number 1Z999AA10123456784." },
      { stage: "TESTING", body: "The product arrived and we have started testing and installation." },
      { stage: "CONTENT_PLANNING", body: "Here is the content brief, talking points and filming plan." },
      { stage: "CONTENT_REVIEW", body: "Please review the draft / rough cut. Requested changes are in the preview." },
      { stage: "PUBLISH_PENDING", body: "The video is scheduled with an embargo. Confirm the posting date." },
      { stage: "PUBLISHED", body: "The video is now live: https://youtube.com/watch?v=abc123" },
      { stage: "SETTLING", body: "Payment sent. Transaction id TX-88." },
    ];
    for (const item of cases) {
      const result = judgeCollaborationStage({
        subject: "Re: Collaboration Opportunity with LiTime",
        body: item.body,
        current_stage: "INITIAL_CONTACT",
      });
      expect(result.suggested_stage, item.body).toBe(item.stage);
      expect(result.evidence.some((hit: { source: string }) => hit.source === "body"), item.stage).toBe(true);
    }
  });

  it("judges stage from body over subject, as the uploaded Agent rules require", () => {
    const rules = readRealText("Agent判断合作阶段核心规则.md");
    expect(rules).toContain("正文明确动作 > 附件和链接 > 履约字段 > 邮件主题");
    const result = judgeCollaborationStage({
      subject: "Collaboration Opportunity with LiTime",
      body: "The video is now live: https://youtube.com/watch?v=abc123",
    });
    expect(result.suggested_stage).toBe("PUBLISHED");
    expect(result.evidence.some((item: { source: string }) => item.source === "body")).toBe(true);
  });

  it("does not treat a thank-you-only reply as 已回复-有兴趣", () => {
    const result = judgeCollaborationStage({
      subject: "Re: Collaboration Opportunity / Interested in Working with LiTime",
      body: "Thank you for your email.",
    });
    expect(result.suggested_stage).not.toBe("INTERESTED");
    expect(result.flags).toContain("thank_you_only");
  });

  it("follows the exception sheet: later is pause, family emergency is care, reject is reject", () => {
    const later = judgeCollaborationStage({
      subject: "Re: Collaboration Opportunity",
      body: "Not available now but open later. Maybe next quarter.",
    });
    expect(later.suggested_stage).toBe("PAUSED");
    expect(later.flags).toContain("later_not_reject");

    const care = judgeCollaborationStage({
      subject: "Update on the Content Timeline",
      body: "Family emergency, we need to delay and reschedule the publish date.",
    });
    expect(care.suggested_stage).toBeNull();
    expect(care.flags).toContain("delay_care");

    const reject = judgeCollaborationStage({
      subject: "Re: Collaboration Opportunity",
      body: "Thanks for reaching out but we are not interested and will pass.",
    });
    expect(reject.suggested_stage).toBe("REJECTED");
  });

  it("blocks 催大纲 on 初步接触, matching the official gate", () => {
    expect(templateAllowedForStage("content_nudge.outline", "INITIAL_CONTACT")).toBe(false);
    expect(templateAllowedForStage("content_nudge.outline", "TESTING")).toBe(true);
    expect(templateAllowedForStage("content_nudge.outline", "CONTENT_PLANNING")).toBe(true);
  });
});

describe("Starry KOL MCP functional path with the real snapshot", () => {
  it("returns all 220 library profiles through creator_library_all", async () => {
    const { data, operations } = await executeStarryKolTask("creator_library_all", {});
    expect(calls.map((item) => item.name)).toEqual(["listAllKolProfiles"]);
    expect(operations[0]).toMatchObject({ name: "starrykol.listAllKolProfiles", status: "done" });
    expect(Number(data.total)).toBe(220);
    const list = data.list as Json[];
    expect(list.some((row) => row.kolName === "Wendell Fishing")).toBe(true);
    expect(list.some((row) => row.kolUid === WENDELL_UID)).toBe(true);
  });

  it("finds Wendell Fishing through pageKolProfiles without decrypting contact", async () => {
    const { data } = await executeStarryKolTask("creator_library_query", { keyword: "Wendell Fishing" });
    expect(calls[0].name).toBe("pageKolProfiles");
    expect(calls.map((item) => item.name)).not.toContain("decryptKolContact");
    const list = (data.list as Json[]) || [];
    expect(list.some((row) => row.kolName === "Wendell Fishing")).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/wendellfishing@gmail\.com/);
  });

  it("loads Wendell Fishing profile detail by the real kolUid", async () => {
    const { data } = await executeStarryKolTask("creator_profile", { kolUid: WENDELL_UID });
    expect(calls.map((item) => item.name)).toContain("getKolProfileDetail");
    expect(calls.map((item) => item.name)).not.toContain("decryptKolContact");
    expect(data.kolName).toBe("Wendell Fishing");
    expect(data.platform).toBe("YouTube");
    expect(data.countryName).toBe("美国");
    expect(data.ownerName).toBe("张浩城");
  });

  it("lists the real Starry mailboxes including henry.wei and brandmarketing", async () => {
    const { data } = await executeStarryKolTask("email_mailbox_list", {});
    expect(calls.map((item) => item.name)).toContain("pageMailboxes");
    const list = data.list as Json[];
    expect(list.some((row) => row.mailboxEmail === "henry.wei@amperetime.com")).toBe(true);
    expect(list.some((row) => row.mailboxEmail === "brandmarketing@litime.com" && row.ownerUserName === "张干")).toBe(true);
  });

  it("returns an empty lifecycle kanban, matching the live Starry snapshot", async () => {
    const { data } = await executeStarryKolTask("creator_lifecycle_kanban", {});
    expect(calls.map((item) => item.name)).toContain("pageLifecycleKanban");
    expect(Number(data.total || 0)).toBe(0);
    expect(((data.list as Json[]) || [])).toHaveLength(0);
  });
});

describe("home board and host flows with Starry + markdown creators", () => {
  it("loads Wendell Fishing from the Starry library sync, not markdown-only creators", async () => {
    const listed = await request("GET", "/api/home/board");
    expect(listed.status).toBe(200);
    const kols = listed.body.kols as Json[];
    const tabs = listed.body.tabs as Json[];
    const library = listed.body.library as Json;
    expect(tabs).toHaveLength(17);
    expect(tabs.every((tab) => tab.history_summary == null)).toBe(true);
    expect(library).toMatchObject({ ok: true, source: "starry", tool: "listAllKolProfiles" });
    expect(Number(library.count)).toBe(220);
    expect(kols.length).toBe(220);
    expect(calls.map((item) => item.name)).toContain("listAllKolProfiles");
    expect(calls.map((item) => item.name)).not.toContain("decryptKolContact");

    const card = kols.find((row) => String(row.kol_uid || row.kolUid) === WENDELL_UID) as Json;
    expect(card.kol_name).toBe("Wendell Fishing");
    expect(String(card.collab_summary)).toMatch(/LT|张浩城/);
    expect(String(card.current_stage)).toContain("初步接触");
    expect(card.suggested_stage).toBe("已回复-有兴趣");
    expect((card.profile_tags as Json[]).some((tag) => tag.label === "YouTube" || tag.label === "美国受众")).toBe(true);

    expect(kols.find((row) => row.handle === "Holly Yoo")).toBeUndefined();
    expect(kols.find((row) => row.handle === "小美妆日记")).toBeUndefined();
  });

  it("keeps the skill home catalog while the board uses real creator rows", async () => {
    const home = await request("GET", "/api/home");
    expect((home.body.recs as Json[]).length).toBe(SKILL_CATALOG.length);
    expect((home.body.recs as Json[]).every((rec) => rec.act === "ask")).toBe(true);
    expect((home.body.recs as Json[]).some((rec) => rec.id === "business_approval")).toBe(true);
  });

  it("sends a follow-up to Wendell Fishing without changing the official stage", async () => {
    const id = insertCollaboration(wendellProfile(), "INITIAL_CONTACT");
    const [sid] = await ask("记状态 @Wendell Fishing", "confirm_stage", id);
    const { persistDraft } = await import("../src/host/api.js");
    const { BRAND_MAILBOXES } = await import("../src/config.js");
    const draft = persistDraft(sid, {
      skill: "email_compose",
      template_id: "stage_mail.followup",
      from: BRAND_MAILBOXES.LT,
      to: "wendellfishing@gmail.com",
      subject: "Following up — LiTime collab kit",
      body: "Hi,\n\nJust a follow-up.\n",
      keep_stage: true,
      official_stage: "INITIAL_CONTACT",
      collaboration_id: id,
    });
    expect(Boolean(draft.keep_stage)).toBe(true);
    expect(String(draft.to || draft.to_addr)).toBe("wendellfishing@gmail.com");
    const sent = await request("POST", `/api/drafts/${draft.id}/send`, {});
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.stage_changed).toBe(false);
    expect(sent.body.official_stage).toBe("INITIAL_CONTACT");
    const row = getConn().prepare("SELECT stage_code FROM collaborations WHERE id=?").get(id) as { stage_code: string };
    expect(row.stage_code).toBe("INITIAL_CONTACT");
  });
});

describe("Starry KOL MCP live smoke", () => {
  const live = Boolean(process.env.RUN_LIVE_STARRY_KOL);

  it.skipIf(!live)("still lists Wendell Fishing from the test MCP", async () => {
    const { RemoteMcpClient } = await import("../src/mcp/remote.js");
    const client = new RemoteMcpClient({
      url: process.env.STARRY_KOL_MCP_URL || "http://47.251.65.112:9091/mcp",
      headers: { "X-MCP-API-KEY": process.env.STARRY_KOL_MCP_API_KEY || "email-agent-mcp-dev" },
      timeoutMs: 20000,
    });
    try {
      const listed = await client.callTool("listAllKolProfiles", {});
      const data = (listed.data || listed) as { list?: Json[] };
      expect((data.list || []).some((row) => row.kolName === "Wendell Fishing")).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
