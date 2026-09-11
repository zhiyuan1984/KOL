/**
 * 达人画像：Host 只提供 Starry 事实，Codex app-server 写成运营话术。
 * stub / Codex 失败时用确定性话术兜底，永不回「这项信息」原始字段墙。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mailAnalysisTimeout } from "../config.js";
import { remoteMailAnalysisEnabled } from "../host/mail-summary.js";
import { label } from "../stages.js";
import {
  extractRemoteIntentText,
  intentLlmApiKey,
  intentLlmFetch,
  intentLlmFetchOverridden,
  intentLlmModel,
} from "../tasks/openai-intent.js";
import type { Json } from "../types.js";
import { CodexAppServer } from "../worker/codex.js";

export type ProfileBriefing = {
  summary: string;
  briefing: string;
  highlights: string[];
  recommended_actions: string[];
  briefing_source: "codex" | "luna" | "facts";
};

const ENUM_ZH: Record<string, string> = {
  EN_US: "英语",
  EN: "英语",
  ZH_CN: "中文",
  ZH: "中文",
  CONTENT_RISK: "内容风险",
  CONTENT: "内容风险",
  DELAY: "延期",
  LOST_CONTACT: "失联",
  MANUAL: "人工跟进",
  AUTO: "自动跟进",
  PENDING_SUPPLEMENT: "待补充",
  PENDING: "待处理",
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return firstString(value[0]);
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function humanEnum(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (ENUM_ZH[raw]) return ENUM_ZH[raw];
  const staged = label(raw);
  if (staged && staged !== raw) return staged;
  if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(raw)) return "";
  return raw;
}

export function profileFactsForModel(data: Json): Json {
  const name = firstString(data.kolName, data.nickname, data.name, data.handle);
  const uid = firstString(data.kolUid, data.kol_uid);
  const stage = humanEnum(data.cooperationStageName || data.cooperationStageCode || data.stageName || data.stage);
  const risk = humanEnum(data.riskTagName || data.riskTag || data.riskTagCode);
  const language = humanEnum(data.languageKey || data.language);
  const email = firstString(data.contactEmailMasked, data.contact_email_masked, data.emailMasked);
  const owner = firstString(data.ownerUserName, data.ownerName, data.owner);
  const follow = humanEnum(data.followType || data.sourceType || data.source);
  const platform = firstString(data.primaryPlatform, data.platform);
  const followers = data.followers ?? data.followerCount ?? data.followerCountTenThousands;
  const sync = humanEnum(data.crawlerSyncStatus) || firstString(data.crawlerSyncStatus);
  const updated = firstString(data.updateTime, data.updatedAt, data.update_time);
  const niche = firstString(data.nicheTagsText, data.niche, data.tags);
  const notes = firstString(data.notes, data.remark, data.bio);
  const missing: string[] = [];
  if (!platform) missing.push("主平台");
  if (followers == null || followers === "") missing.push("粉丝数");
  if (!email) missing.push("联系邮箱");
  if (sync === "待补充" || String(data.crawlerSyncStatus || "").includes("待补充")) missing.push("爬虫同步");
  return {
    name: name || "这位红人",
    uid,
    stage,
    risk,
    language,
    email_masked: email,
    owner,
    platform,
    followers,
    follow,
    sync,
    updated,
    missing,
    niche,
    notes: notes === "待补充" ? "" : notes,
  };
}

export function profileBriefingFromFacts(data: Json): ProfileBriefing {
  const facts = profileFactsForModel(data);
  const name = String(facts.name);
  const paragraphs: string[] = [];
  paragraphs.push(`${name} 已在红人库。下面只根据已核验字段说明，缺的会标明待补充。`);
  if (facts.stage) {
    paragraphs.push(`合作阶段是${facts.stage}。发送邮件不会改阶段，要推进需人确认。`);
  } else {
    paragraphs.push("合作阶段还没有落到人话标签，不能当成已推进。");
  }
  const bits: string[] = [];
  if (facts.owner) bits.push(`负责人 ${facts.owner}`);
  if (facts.platform) bits.push(`平台 ${facts.platform}`);
  if (facts.followers != null && facts.followers !== "") bits.push(`粉丝 ${facts.followers}`);
  if (facts.language) bits.push(`沟通语言 ${facts.language}`);
  if (facts.email_masked) bits.push(`联系邮箱已脱敏为 ${facts.email_masked}，未解密`);
  if (facts.follow) bits.push(`跟进方式 ${facts.follow}`);
  if (facts.risk) bits.push(`风险：${facts.risk}`);
  if (facts.sync) bits.push(`同步状态 ${facts.sync}`);
  if (facts.niche) bits.push(`内容方向 ${facts.niche}`);
  if (bits.length) paragraphs.push(bits.join("。") + "。");
  if (facts.notes) paragraphs.push(`库内备注：${facts.notes}`);
  const missing = Array.isArray(facts.missing) ? facts.missing as string[] : [];
  if (missing.length) {
    paragraphs.push(`待补充：${missing.join("、")}。不要编造受众、互动或明文联系方式。`);
  } else {
    paragraphs.push("基础字段已齐，可以据此写跟进，但仍不要擅自解密联系方式。");
  }
  const highlights = [
    facts.stage ? `阶段 ${facts.stage}` : "",
    facts.risk ? `风险 ${facts.risk}` : "",
    facts.email_masked ? `邮箱 ${facts.email_masked}` : "",
    missing.length ? `待补充 ${missing.join("、")}` : "",
  ].filter(Boolean);
  const summary = missing.length
    ? `${name} 的画像还不齐，先看阶段和待补字段。`
    : `${name} 的画像已可跟进，阶段是${facts.stage || "未知"}。`;
  const handle = name.startsWith("@") ? name : `@${name}`;
  return {
    summary,
    briefing: paragraphs.join("\n\n"),
    highlights,
    recommended_actions: [`写合作邮件 ${handle}`, "更新红人负责人"],
    briefing_source: "facts",
  };
}

const briefingSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    briefing: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    recommended_actions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "briefing"],
  additionalProperties: false,
};

function profileAnalysisPrompt(data: Json): string {
  return [
    "你是灵工运营助手。根据下面的红人事实写给运营看的中文画像话术。",
    "只使用这些事实，不要编造粉丝、受众、互动、转化或明文邮箱。脱敏邮箱保持脱敏。",
    "阶段码、风险码要说成人话。缺字段就写「待补充」。",
    "不要出现 MCP、Codex、Host、这项信息、摘要数据。",
    "不发信、不改阶段。建议下一步只预填口令，例如「写合作邮件 @名称」。",
    "返回 JSON {\"summary\":\"一句话\",\"briefing\":\"两到四段话术\",\"highlights\":[\"要点\"],\"recommended_actions\":[\"写合作邮件 @名称\"]}。",
    "",
    JSON.stringify(profileFactsForModel(data), null, 2),
  ].join("\n");
}

function parseBriefing(text: string, fallback: ProfileBriefing): ProfileBriefing | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Json;
    const briefing = String(parsed.briefing || parsed.body || "").trim();
    const summary = String(parsed.summary || "").trim();
    if (!briefing && !summary) return null;
    if (/这项信息|摘要数据|\bMCP\b|\bCodex\b|\bHost\b/i.test(`${summary}\n${briefing}`)) return null;
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map((item) => String(item || "").trim()).filter(Boolean)
      : fallback.highlights;
    const actions = Array.isArray(parsed.recommended_actions)
      ? parsed.recommended_actions.map((item) => String(item || "").trim()).filter((item) => item && !/确认发送|decrypt|解密联系/.test(item))
      : fallback.recommended_actions;
    return {
      summary: summary || fallback.summary,
      briefing: briefing || fallback.briefing,
      highlights: highlights.length ? highlights : fallback.highlights,
      recommended_actions: actions.length ? actions : fallback.recommended_actions,
      briefing_source: "codex",
    };
  } catch {
    return null;
  }
}

function noteFailure(where: string, err: unknown): void {
  const text = err instanceof Error ? err.message : String(err || "unknown");
  process.stderr.write(`[creator-profile] ${where}: ${text}\n`);
}

async function briefingWithCodexAppServer(data: Json, fallback: ProfileBriefing): Promise<ProfileBriefing | null> {
  let cwd = "";
  let rpc: CodexAppServer | null = null;
  try {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-creator-profile-"));
    rpc = new CodexAppServer(mailAnalysisTimeout());
    await rpc.handshake();
    await rpc.requireAuth();
    const started = await rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { mcp_servers: {}, model: intentLlmModel() },
    });
    const thread = (started.thread as { id?: string } | undefined) || started;
    const threadId = String((thread as { id?: string }).id || "");
    if (!threadId) {
      noteFailure("codex thread/start", "missing thread id");
      return null;
    }
    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: profileAnalysisPrompt(data) }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      summary: "concise",
      effort: "low",
      outputSchema: briefingSchema,
    });
    const completed = await rpc.waitTurn(mailAnalysisTimeout());
    const extras = completed.turn && typeof completed.turn === "object"
      ? JSON.stringify((completed.turn as { output?: unknown }).output || {})
      : "";
    const parsed = parseBriefing([...rpc.agentTexts, extras].join("\n"), fallback);
    if (!parsed) noteFailure("codex parse", "no briefing in app-server output");
    return parsed;
  } catch (err) {
    noteFailure("codex app-server", err);
    return null;
  } finally {
    rpc?.close();
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function briefingWithLuna(data: Json, fallback: ProfileBriefing): Promise<ProfileBriefing | null> {
  const key = intentLlmApiKey();
  if (!key) return null;
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mailAnalysisTimeout() * 1000);
  try {
    const response = await intentLlmFetch()(`${base}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: intentLlmModel(),
        instructions: "你是灵工运营助手。根据红人事实写中文画像话术。不编造联系方式，不改阶段。",
        input: profileAnalysisPrompt(data),
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "creator_profile_briefing",
            strict: false,
            schema: briefingSchema,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      noteFailure("luna", `HTTP ${response.status}`);
      return null;
    }
    const parsed = parseBriefing(extractRemoteIntentText(await response.json()), fallback);
    if (!parsed) noteFailure("luna parse", "no briefing in response");
    if (parsed) parsed.briefing_source = "luna";
    return parsed;
  } catch (err) {
    noteFailure("luna", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeCreatorProfile(data: Json): Promise<ProfileBriefing> {
  const fallback = profileBriefingFromFacts(data);
  if (!remoteMailAnalysisEnabled()) return fallback;
  if (intentLlmFetchOverridden()) {
    const luna = await briefingWithLuna(data, fallback);
    return luna || fallback;
  }
  const fromCodex = await briefingWithCodexAppServer(data, fallback);
  if (fromCodex) return fromCodex;
  const fromLuna = await briefingWithLuna(data, fallback);
  return fromLuna || fallback;
}
