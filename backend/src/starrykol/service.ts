import { AsyncLocalStorage } from "node:async_hooks";
import { audit, getConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import { scopedUser } from "../auth.js";
import { normalizeEmail } from "../host/identity.js";
import { boundStarryBearer, matchesFollowedMailbox, publicStarryBinding, starryBindingRow } from "../host/starry-bind.js";
import { codexMode, starryKolMcpBearer, starryKolMcpConfigured, starryKolMcpHeaders, starryKolMcpUrl } from "../config.js";
import {
  dictionaryOptionsFor,
  enrichListProfile,
  normalizeRiskTag,
  RISK_TAG_OPTIONS,
  starryCooperationStageOptions,
  starryStageWriteFields,
} from "./remote-contract.js";
import {
  codeFromLabel,
  evidencedPointer,
  label,
  normalizeStage,
  planStarryAdjacentWalk,
  stageChecklist,
  toLegacyStarryStage,
} from "../stages.js";
import { taskDefinition } from "../tasks/registry.js";
import { libraryQueryKeyword } from "../tasks/resolver.js";
import { fieldLabel, missingFieldsMessage } from "../labels.js";
import { mailSendReceipt } from "../host/receipt.js";
import { composeFactsFromContext, composePromptFromEntities, seedComposeDraft } from "../host/compose-loop.js";
import { parseQuoteRate } from "../host/quote-amount.js";
import { conversationSubject, realMailboxEmail, replySubjectOf } from "./mail-fields.js";
import { profileBriefingFromFacts } from "./profile-briefing.js";
import { stubInternalZh } from "./translate-zh.js";
import { readFollowStyleTags, suggestFollowStyleTags } from "../follow-style-tags.js";
import { extractNestedCreateDrafts } from "../worker/parse.js";
import type { Json } from "../types.js";

export const STARRY_KOL_TASKS = [
  "email_mailbox_list",
  "email_conversation_list",
  "email_conversation_read",
  "email_compose",
  "email_app_conversation_list",
  "creator_library_query",
  "creator_library_all",
  "creator_library_sync",
  "creator_profile",
  "creator_owner_update",
  "creator_status_update",
  "creator_contact_decrypt",
  "creator_lifecycle_kanban",
  "creator_risk_conversations",
  "creator_filter_options",
  "risk_scan",
  "reply_analysis",
] as const;

export type StarryKolTask = (typeof STARRY_KOL_TASKS)[number];
export const EMAIL_MCP_TASKS = STARRY_KOL_TASKS;
export type EmailMcpTask = StarryKolTask;

/** Skills that write, send, preview-send, or decrypt. Stay Codex-strict in real mode. */
export const STARRY_KOL_WRITE_TASKS = [
  "email_compose",
  "creator_library_sync",
  "creator_owner_update",
  "creator_status_update",
  "creator_contact_decrypt",
] as const;

export type StarryKolWriteTask = (typeof STARRY_KOL_WRITE_TASKS)[number];

/** L1 reads. Host may invoke these MCP tools when Codex `approvalPolicy: never` rejects them. */
export const STARRY_KOL_READ_TASKS = STARRY_KOL_TASKS.filter(
  (task) => !(STARRY_KOL_WRITE_TASKS as readonly string[]).includes(task),
) as readonly Exclude<StarryKolTask, StarryKolWriteTask>[];

export function isStarryKolTask(value: string | null | undefined): value is StarryKolTask {
  return Boolean(value && (STARRY_KOL_TASKS as readonly string[]).includes(value));
}
export const isEmailMcpTask = isStarryKolTask;

export function isStarryKolWriteTask(value: string | null | undefined): value is StarryKolWriteTask {
  return Boolean(value && (STARRY_KOL_WRITE_TASKS as readonly string[]).includes(value));
}

export function isStarryKolReadTask(value: string | null | undefined): boolean {
  return isStarryKolTask(value) && !isStarryKolWriteTask(value);
}

type StarryKolClient = Pick<RemoteMcpClient, "callTool" | "close">;
let clientFactory: (() => StarryKolClient) | null = null;
const callScope = new AsyncLocalStorage<{ bearer?: string; ignoreUser?: boolean }>();

export function withStarryCallScope<T>(scope: { bearer?: string; ignoreUser?: boolean }, fn: () => Promise<T>): Promise<T> {
  return callScope.run(scope, fn);
}

function resolveStarryBearer(): string {
  const scope = callScope.getStore();
  if (scope?.bearer) return scope.bearer;
  if (!scope?.ignoreUser) {
    const bound = boundStarryBearer(scopedUser()?.id);
    if (bound) return bound;
  }
  return starryKolMcpBearer();
}

export function setStarryKolClientFactory(factory?: () => StarryKolClient): void {
  clientFactory = factory || null;
}
export const setEmailMcpClientFactory = setStarryKolClientFactory;

function json(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function asListPayload(items: unknown[], total?: unknown): Json {
  return { list: items as Json[], total: Number.isFinite(Number(total)) ? Number(total) : items.length };
}

export function normalizeStarryKolResult(value: Json): Json {
  if (Array.isArray(value)) return asListPayload(value);
  if (typeof value.text === "string" && value.text && !value.data && !value.list && !value.records) {
    try {
      const parsed = JSON.parse(value.text);
      return parsed && typeof parsed === "object" ? normalizeStarryKolResult(json(parsed)) : { text: value.text };
    } catch {
      return { error: value.text, needs_input: true };
    }
  }
  if (typeof value.result === "string") {
    try {
      const parsed = JSON.parse(value.result);
      return parsed && typeof parsed === "object" ? normalizeStarryKolResult(json(parsed)) : { value: parsed };
    } catch {
      return { text: value.result };
    }
  }
  if (Array.isArray(value.data)) return asListPayload(value.data, value.total);
  if (value.data && typeof value.data === "object") return normalizeStarryKolResult(json(value.data));
  if (Array.isArray(value.result)) return asListPayload(value.result, value.total);
  if (value.result && typeof value.result === "object") return normalizeStarryKolResult(json(value.result));
  return value;
}

export const normalizeEmailMcpResult = normalizeStarryKolResult;

function mockProfile(overrides: Json = {}): Json {
  return enrichListProfile({
    kolUid: "KOLTEST001",
    kolId: 101,
    kolName: "户外电源达人",
    nickname: "户外电源达人",
    followers: 85000,
    cooperationStageCode: "INITIAL_CONTACT",
    cooperationStageName: "初步接触",
    primaryPlatform: "YouTube",
    platform: "YouTube",
    contactEmailMasked: "q***@gmail.com",
    engagementRate: 0.037,
    audienceGeo: "美国",
    ownerUserId: "u_chen",
    ownerUserName: "陈组长",
    ownerName: "陈组长",
    ownerMailbox: "henry.wei@amperetime.com",
    nicheTagsText: "户外",
    notes: null,
    wechat: null,
    lastConversationId: 101,
    ...overrides,
  });
}

function mockLarryFollowed(overrides: Json = {}): Json {
  return mockProfile({
    kolUid: "KOLLARRY001",
    kolName: "营地灯测评娘",
    nickname: "营地灯测评娘",
    followers: 180000,
    primaryPlatform: "抖音",
    audienceGeo: "中国",
    ownerUserId: "u_larry",
    ownerName: "赵良玉",
    ownerUserName: "赵良玉",
    ownerMailbox: "larry.zhao@amperetime.com",
    mailboxEmail: "larry.zhao@amperetime.com",
    ...overrides,
  });
}

/** Sparse Starry detail that previously dumped as 这项信息 / 摘要数据. */
function mockQq01(overrides: Json = {}): Json {
  return {
    id: 4,
    brandId: 1,
    kolUid: "KOL9D62420657814F6BAEC8",
    kolName: "测试网红-qq-01",
    languageKey: "EN_US",
    contactEmailMasked: "1***@qq.com",
    cooperationStageCode: "TESTING",
    riskTagCode: "CONTENT",
    followType: "MANUAL",
    crawlerSyncStatus: "PENDING_SUPPLEMENT",
    remark: "待补充",
    updateTime: "2026-09-02 07:52:19",
    kolId: 273,
    ownerUserName: "赵良玉",
    ...overrides,
  };
}

function isQq01Lookup(value: unknown): boolean {
  return /qq-01|KOL9D62420657814F6BAEC8/i.test(String(value || ""));
}

function mockCall(name: string, args: Json): Json {
  const mailbox = {
    id: 14,
    mailboxEmail: "henry.wei@amperetime.com",
    brandCode: "LT",
    brandName: "LT品牌",
    ownerUserName: "测试负责人",
  };
  const larryMailbox = {
    id: 6,
    mailboxEmail: "larry.zhao@amperetime.com",
    brandCode: "RO",
    brandName: "RO品牌",
    ownerUserName: "赵良玉",
  };
  if (name === "pageMailboxes") {
    return { pageNo: 1, pageSize: 20, total: 2, list: [mailbox, larryMailbox], statistics: { mailboxCount: 2 } };
  }
  if (name === "getMailboxDetail") {
    return { ...mailbox, id: args.id || mailbox.id };
  }
  if (name === "listNylasAccounts") {
    return { items: [{ id: 4, mailboxEmail: mailbox.mailboxEmail, grantStatus: "VALID", enabled: true }] };
  }
  if (name === "pageEmailConversations") {
    return { pageNo: 1, pageSize: 10, total: 1, list: [{
      id: 101,
      conversationId: 101,
      subject: "LiTime 合作沟通",
      recipientEmail: String(args.keyword || "qiyou1984@gmail.com"),
      mailboxEmail: "larry.zhao@amperetime.com",
      status: "open",
    }] };
  }
  if (name === "getEmailConversation") {
    return {
      id: args.conversationId || 101,
      conversationId: args.conversationId || 101,
      subject: "LiTime 合作沟通",
      recipientEmail: "qiyou1984@gmail.com",
      mailboxEmail: "larry.zhao@amperetime.com",
      kolUid: "KOLTEST001",
      messages: [{
        id: 1,
        direction: "inbound",
        to: "larry.zhao@amperetime.com",
        mailboxEmail: "larry.zhao@amperetime.com",
        body: "Thanks, I am interested in the collaboration. Please send the rate card.",
      }],
    };
  }
  if (name === "getEmailConversationSubjectGroups") {
    return { conversationId: args.conversationId || 101, list: [{ subject: "LiTime 合作沟通", count: 1 }] };
  }
  if (name === "translateEmailToChinese") {
    const text = String(args.text || args.body || "").trim();
    return { text: text ? stubInternalZh(text) : "谢谢，我对这次合作有兴趣。请发报价单。" };
  }
  if (name === "getStageRiskMatrix") {
    return {
      list: [
        { code: "DELAY", name: "延期" },
        { code: "CONTENT", name: "内容风险" },
        { code: "LOST_CONTACT", name: "失联" },
      ],
    };
  }
  if (name === "createEmailConversation") {
    return { id: 101, conversationId: 101, subject: "LiTime MCP 连通测试" };
  }
  if (name === "addKolProfile") {
    return { kolUid: "KOLTEST001" };
  }
  if (name === "importKolProfilesFromCrawler") {
    const fileName = String(args.fileName || "discovery-follow.csv");
    const csv = Buffer.from(String(args.fileBase64 || ""), "base64").toString("utf8");
    const line = csv.split(/\r?\n/).map((row) => row.replace(/^\uFEFF/, "")).find((row, index) => index > 0 && row.trim());
    const cells = line ? line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()) : [];
    const account = cells[2] || cells[1] || "DISC";
    const slug = account.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "DISC";
    return {
      kolUid: `KOL${slug}`,
      imported: 1,
      fileName,
      list: [{ kolUid: `KOL${slug}`, kolName: cells[1] || account }],
    };
  }
  if (name === "pageKolProfiles") {
    let body: Json = {};
    try {
      body = json(JSON.parse(String(args.requestJson || "{}")));
    } catch {
      body = {};
    }
    const keyword = String(body.keyword || "").trim();
    if (keyword && /新(测试)?达人/.test(keyword)) {
      return { pageNo: Number(body.pageNo || 1), pageSize: Number(body.pageSize || 20), total: 0, list: [] };
    }
    if (isQq01Lookup(keyword)) {
      return { pageNo: Number(body.pageNo || 1), pageSize: Number(body.pageSize || 20), total: 1, list: [mockQq01()] };
    }
    return {
      pageNo: Number(body.pageNo || 1),
      pageSize: Number(body.pageSize || 20),
      total: 2,
      list: [mockProfile(), mockLarryFollowed()],
    };
  }
  if (name === "listAllKolProfiles") {
    return { total: 2, list: [mockProfile(), mockLarryFollowed()] };
  }
  if (name === "getKolProfileDetail") {
    if (isQq01Lookup(args.kolUid) || isQq01Lookup(args.kolName)) return mockQq01({ kolUid: args.kolUid || mockQq01().kolUid });
    return mockProfile({
      kolUid: args.kolUid || "KOLTEST001",
      bio: "户外电源内容创作者",
    });
  }
  if (name === "updateKolProfile") {
    let body: Json = {};
    try {
      body = json(JSON.parse(String(args.requestJson || "{}")));
    } catch {
      body = {};
    }
    return mockProfile({
      kolUid: body.kolUid || args.kolUid || "KOLTEST001",
      ownerUserId: body.ownerUserId || body.owner_user_id || "u_chen",
      ownerUserName: body.ownerUserName || body.owner_user_name || body.owner || "陈组长",
      ...(body.cooperationStageCode || body.cooperationStageName || body.status
        ? starryStageWriteFields(String(body.cooperationStageCode || body.cooperationStageName || body.status))
        : {}),
      followStyleTags: body.followStyleTags || [],
      notes: body.notes ?? null,
      wechat: body.wechat ?? null,
      updated: true,
    });
  }
  if (name === "decryptKolContact") {
    let body: Json = {};
    try {
      body = json(JSON.parse(String(args.requestJson || "{}")));
    } catch {
      body = {};
    }
    return {
      kolUid: body.kolUid || args.kolUid || "KOLTEST001",
      contactEmail: "qiyou1984@gmail.com",
      phone: "+1-555-0100",
      decrypted: true,
    };
  }
  if (name === "pageLifecycleKanban") {
    return {
      total: 1,
      list: [mockProfile({ cooperationStageName: "初步接触", daysInStage: 3 })],
    };
  }
  if (name === "pageRiskConversations") {
    return {
      pageNo: 1,
      pageSize: 10,
      total: 1,
      list: [{
        id: 201,
        kolUid: "KOLRISK001",
        kolName: "户外电源达人",
        subject: "风险跟进：逾期未回复",
        riskTag: "DELAY",
        ownerUserName: "陈组长",
      }],
    };
  }
  if (name === "summarizeRiskConversations") {
    return { total: 1, summary: "1 条风险会话待处理（逾期未回复）。" };
  }
  if (name === "listDictionaryOptions") {
    const parentKey = String(args.parentKey || "kol_primary_platform");
    return {
      parentKey,
      list: dictionaryOptionsFor(parentKey),
    };
  }
  if (name === "listCooperationStageOptions") {
    return {
      list: starryCooperationStageOptions().map((row) => ({
        code: row.stageCode,
        name: row.stageName,
        stageCode: row.stageCode,
        stageName: row.stageName,
        aliases: row.aliases,
        main: row.main,
      })),
    };
  }
  if (name === "listRiskTagOptions") {
    return { list: RISK_TAG_OPTIONS.map((row) => ({ ...row })) };
  }
  if (name === "pageAppEmailConversations") {
    return { pageNo: 1, pageSize: 10, total: 1, list: [{
      id: 301,
      subject: "应用侧合作沟通",
      kolUid: args.kolUid || "KOLTEST001",
      recipientEmail: String(args.keyword || "qiyou1984@gmail.com"),
      status: "open",
    }] };
  }
  if (name === "listKolPlatformData") {
    return {
      list: [{ platform: "YouTube", account: "@outdoor-power", followers: 85000, stableViews: 120000 }],
    };
  }
  if (name === "getKolProfileSidebarMetrics") {
    return { creatorCount: 12, stageCount: 6, riskConversationCount: 2 };
  }
  if (name === "previewEmailDraft") {
    let prompt = "";
    let subject = "LiTime collaboration";
    let req: Json = {};
    try {
      req = json(JSON.parse(String(args.requestJson || "{}")));
      prompt = String(req.prompt || "");
      subject = String(req.subject || subject);
    } catch {
      /* keep defaults */
    }
    const rate = parseQuoteRate(prompt);
    const facts = composeFactsFromContext({
      stage: "QUOTE_PENDING",
      raw: prompt,
      amount_usd: rate.amount_usd,
      currency: rate.currency,
      rate_unit: rate.rate_unit,
    });
    const seeded = seedComposeDraft(facts, prompt);
    const body = rate.amount_usd != null || /quote|报价|rate|USD/i.test(prompt)
      ? seeded.body
      : "Hi, this is a preview only.";
    const mailbox = firstEmail(req.mailboxEmail || req.from);
    const to = emails(req.to || req.recipient);
    return {
      subject,
      body,
      to: to.length ? to : ["qiyou1984@gmail.com"],
      ...(mailbox ? { mailboxEmail: mailbox, from: mailbox } : {}),
    };
  }
  if (name === "sendEmailNow") {
    return { ok: true, sent: true, conversationId: args.conversationId || 101 };
  }
  if (name === "changeLifecycleStage") {
    let body: Json = {};
    try {
      body = json(JSON.parse(String(args.requestJson || "{}")));
    } catch {
      body = {};
    }
    const fields = starryStageWriteFields(String(
      body.toStageCode || body.cooperationStageCode || body.stageCode || args.stageCode || "INTERESTED",
    ));
    return {
      updated: true,
      lifecycleId: args.lifecycleId ?? body.lifecycleId,
      ...fields,
      toStageCode: fields.cooperationStageCode,
      stageCode: fields.cooperationStageCode,
    };
  }
  throw new Error(`unknown starry-kol-mcp tool: ${name}`);
}

export async function callStarryKolTool(name: string, args: Json = {}): Promise<Json> {
  const { rejectDiscoveryHarnessTool } = await import("../gateway/discovery-harness.js");
  rejectDiscoveryHarnessTool(name);
  return call(name, args);
}

/**
 * Starry profiles expose the current 合作轮次 as `lastLifecycleId`, not `lifecycleId`.
 * Only propagate a known remote numeric id. Local placeholders like `lc_*` must not
 * be sent — that is what produced 合作轮次不存在 when the Host omitted/invented the id.
 */
export function remoteLifecycleIdFrom(
  ...sources: Array<Record<string, unknown> | null | undefined>
): number | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const nested = [
      source.profile,
      source.creator,
      source.payload,
    ].flatMap((value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) return [value as Record<string, unknown>];
      if (typeof value === "string" && value.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          return parsed && typeof parsed === "object" ? [parsed] : [];
        } catch {
          return [];
        }
      }
      return [];
    });
    for (const row of [source, ...nested]) {
      for (const key of ["lastLifecycleId", "last_lifecycle_id", "lifecycleId", "lifecycle_id"]) {
        const id = parseRemoteLifecycleId(row[key]);
        if (id != null) return id;
      }
    }
  }
  return null;
}

function parseRemoteLifecycleId(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  const text = String(value).trim();
  if (!text || /^lc_/i.test(text) || /^conv_/i.test(text)) return null;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

type RemoteStageWriteInput = {
  kolUid: string;
  lifecycleId?: string | number | null;
  lastLifecycleId?: string | number | null;
  last_lifecycle_id?: string | number | null;
  stageCode: string;
  fromStage?: string | null;
  reason?: string | null;
};

/**
 * Host kernel only: one Starry hop (physical adapter). Worker must not call this.
 * Product-legal jumps are accepted on Host; this function only talks to a remote
 * that currently needs adjacent hops. Use writeRemoteOfficialStageWalk for
 * multi-hop, or return not_supported_by_remote.
 *
 * LIVE-proven ChangeStageRequest (KOL202607300002 / lifecycle 16):
 * top-level args are exactly `{ lifecycleId, requestJson }`;
 * requestJson is `{ toStageCode, reason }` with a Starry-native code.
 * `cooperationStageCode` / `targetStageCode` / `stageCode` return misleading 回退.
 */
export async function writeRemoteOfficialStage(input: RemoteStageWriteInput): Promise<Json> {
  const fields = starryStageWriteFields(input.stageCode);
  if (input.fromStage != null && String(input.fromStage).trim()) {
    const plan = planStarryAdjacentWalk(String(input.fromStage), input.stageCode);
    if (plan.kind !== "adjacent") {
      throw new HttpFail(400, {
        code: "not_adjacent_forward",
        message: "远程 Starry 单次写入只接受相邻 hop（物理适配，不是产品禁止）。跨段请走 walk 适配器，回退/异常请诚实失败 not_supported_by_remote。",
        from: plan.from,
        to: plan.to,
        hops: plan.nativeHops,
      });
    }
  }
  const lifecycleId = remoteLifecycleIdFrom(input as Record<string, unknown>);
  if (lifecycleId == null) {
    throw new HttpFail(400, {
      code: "missing_lifecycle_id",
      message: "Starry changeLifecycleStage 需要已知的远程 lifecycleId（lastLifecycleId）",
    });
  }
  const toStageCode = fields.cooperationStageCode;
  const data = await call("changeLifecycleStage", {
    lifecycleId,
    requestJson: JSON.stringify({
      toStageCode,
      reason: String(input.reason || ""),
    }),
  });
  return {
    ...json(data),
    ...fields,
    toStageCode,
    tool: "changeLifecycleStage",
    updated: data.updated !== false,
  };
}

/** Physical adapter: successive adjacent Starry hops. Host already accepted the product edge. */
export async function writeRemoteOfficialStageWalk(input: RemoteStageWriteInput & { fromStage: string }): Promise<Json> {
  const plan = planStarryAdjacentWalk(input.fromStage, input.stageCode);
  if (plan.kind === "not_forward") {
    return {
      skipped: true,
      reason: "not_supported_by_remote",
      walk: plan,
      tool: "changeLifecycleStage",
      updated: false,
    };
  }
  const hops: Json[] = [];
  let cursor = plan.from;
  for (const hop of plan.hops) {
    try {
      const data = await writeRemoteOfficialStage({
        ...input,
        fromStage: cursor,
        stageCode: hop,
        reason: `会话确认进入 ${label(hop)}`,
      });
      hops.push({
        from: cursor,
        to: hop,
        native: toLegacyStarryStage(hop),
        tool: data.tool,
        updated: Boolean(data.updated),
      });
      cursor = hop;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: true,
        message,
        tool: "changeLifecycleStage",
        updated: false,
        walk: plan,
        hops,
        failed_hop: hop,
        failed_native: toLegacyStarryStage(hop),
      };
    }
  }
  return {
    ...starryStageWriteFields(input.stageCode),
    tool: "changeLifecycleStage",
    updated: true,
    walk: plan,
    hops,
  };
}

async function call(name: string, args: Json = {}): Promise<Json> {
  if (!clientFactory && codexMode() === "stub") return mockCall(name, args);
  if (!clientFactory && !starryKolMcpConfigured()) {
    throw new HttpFail(503, {
      code: "starrykol_not_configured",
      message: "Starry KOL MCP 未配置。",
      next_action: "请配置 STARRY_KOL_MCP_URL、STARRY_KOL_MCP_API_KEY，以及网关所需的 STARRY_KOL_MCP_BEARER 后重启。",
    });
  }
  const client = clientFactory
    ? clientFactory()
    : new RemoteMcpClient({
      url: starryKolMcpUrl(),
      headers: starryKolMcpHeaders(resolveStarryBearer()),
    });
  try {
    return normalizeStarryKolResult(await client.callTool(name, args));
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/登录过期|请先登录/.test(message)) {
      throw new HttpFail(401, {
        code: "starrykol_login_required",
        message: "Starry 网关需要用户 JWT（Authorization Bearer）。当前请求只有 X-MCP-API-KEY。",
        next_action: "在个人设置里重新连接 Starry，或粘贴有效的用户 JWT。",
      });
    }
    if (/Invalid or missing X-MCP-API-KEY/.test(message)) {
      throw new HttpFail(401, {
        code: "starrykol_api_key_required",
        message: "Starry MCP 拒绝了请求：缺少有效的 X-MCP-API-KEY。",
        next_action: "检查 STARRY_KOL_MCP_API_KEY，不要把用户 JWT 填进 API Key。",
      });
    }
    if (/Unexpected token|is not valid JSON|<html/i.test(message)) {
      throw new HttpFail(502, {
        code: "starrykol_bad_gateway",
        message: "达人库服务返回了无效响应。",
        next_action: "请稍后重试；若持续失败请检查 Starry KOL MCP 网关。",
      });
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emails(value: unknown): string[] {
  const text = Array.isArray(value) ? value.map(String).join(" ") : String(value || "");
  return [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]);
}

function firstEmail(value: unknown): string {
  return emails(value)[0] || "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return firstString(value[0]);
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function codes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? text.split(/[、，,\s]+/).map((item) => item.trim()).filter(Boolean) : [];
}

function requestJson(body: Json): Json {
  return { ...body, requestJson: JSON.stringify(body) };
}

function kolUidOf(source: Json, extra: Json = {}): string {
  const nested = source.creator && typeof source.creator === "object" && !Array.isArray(source.creator)
    ? source.creator as Json
    : {};
  const creatorId = firstString(source.creator_id, extra.creator_id, nested.creator_id);
  const asUid = creatorId && !/^cr_/i.test(creatorId) ? creatorId : "";
  return firstString(
    source.kolUid,
    source.kol_uid,
    extra.kolUid,
    extra.kol_uid,
    nested.kolUid,
    nested.kol_uid,
    extra.uid,
    source.uid,
    asUid,
  );
}

function profileKeyword(entities: Json): string {
  const raw = firstString(entities.keyword, entities.name, entities.handle, entities.kolUid, entities.email, entities.to);
  if (raw && raw !== "关键词" && raw !== "[关键词]") return raw;
  return libraryQueryKeyword(firstString(entities.text, entities.prompt, entities.raw, entities.keyword));
}

function profileQueryBody(entities: Json): Json {
  const keyword = profileKeyword(entities);
  const stageCodes = codes(entities.stageCodes && codes(entities.stageCodes).length ? entities.stageCodes : entities.status);
  const riskTagCodes = codes(entities.riskTagCodes);
  return {
    pageNo: Math.max(1, number(entities.pageNo, 1)),
    pageSize: Math.max(1, Math.min(50, number(entities.pageSize || entities.limit, 20))),
    ...(keyword ? { keyword } : {}),
    ...(stageCodes.length ? { stageCodes } : {}),
    ...(riskTagCodes.length ? { riskTagCodes } : {}),
    ...(entities.sortField ? { sortField: String(entities.sortField) } : {}),
    ...(entities.sortOrder ? { sortOrder: String(entities.sortOrder) } : {}),
  };
}

function isOwnerFieldKey(key: string): boolean {
  return /(owner|responsible|assignee)/i.test(key);
}

const OWNER_FIELD_LABEL: Record<string, string> = {
  ownerUserName: "负责人",
  owner_user_name: "负责人",
  ownerName: "负责人",
  owner: "负责人",
  ownerUserId: "负责人编号",
  owner_user_id: "负责人编号",
  ownerMailbox: "负责人邮箱",
  owner_mailbox: "负责人邮箱",
  responsibleUserName: "负责人",
  responsibleUserId: "负责人编号",
};

function ownerBindingItems(row: Json): string[] {
  const items: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (!isOwnerFieldKey(key) || value == null || Array.isArray(value) || (typeof value === "object")) continue;
    items.push(`${OWNER_FIELD_LABEL[key] || "负责人"} ${String(value)}`);
  }
  return items;
}

function ownerValue(entities: Json): string {
  return firstString(
    entities.ownerUserName,
    entities.owner_user_name,
    entities.ownerName,
    entities.owner,
    entities.ownerUserId,
    entities.owner_user_id,
    entities.responsibleUserId,
    entities.responsibleUserName,
    entities.assignee,
  );
}

function profileUpdateRequest(entities: Json, detail: Json): Json {
  const kolUid = kolUidOf(entities, detail);
  const owner = ownerValue(entities);
  const body: Json = { ...(kolUid ? { kolUid } : {}) };
  const ownerKeys = Object.keys(detail).filter(isOwnerFieldKey);
  if (owner) {
    if (ownerKeys.length) {
      for (const key of ownerKeys) {
        if (/id/i.test(key) && /^[A-Za-z0-9_-]+$/.test(owner)) body[key] = owner;
        else if (/name|Name/.test(key) || !/id/i.test(key)) body[key] = owner;
      }
    } else {
      body.ownerUserName = owner;
      if (/^[A-Za-z0-9_-]+$/.test(owner)) body.ownerUserId = owner;
    }
  }
  if (entities.ownerUserId) body.ownerUserId = String(entities.ownerUserId);
  if (entities.ownerUserName) body.ownerUserName = String(entities.ownerUserName);
  const status = firstString(
    entities.cooperationStageCode,
    entities.stage,
    entities.status,
    entities.cooperationStageName,
  );
  const stageCode = codeFromLabel(status);
  if (stageCode) {
    Object.assign(body, starryStageWriteFields(stageCode));
  } else if (entities.confirmed) {
    body.confirmed = String(entities.confirmed);
  }
  for (const key of ["notes", "wechat"] as const) {
    const value = firstString(entities[key]);
    if (value) body[key] = value;
  }
  const followTags = entities.followStyleTags || entities.follow_style_tags;
  if (followTags) body.followStyleTags = followTags;
  const nicheTags = entities.nicheTags || entities.niche_tags;
  if (nicheTags) body.nicheTags = nicheTags;
  return body;
}

function searchKeyword(entities: Json): string {
  if (entities.keyword) return String(entities.keyword).trim();
  return firstEmail(entities.to || entities.email || entities.recipient);
}

const CARD_SKIP_KEYS = [
  "needs_input",
  "mailbox_authorized",
  "starry_actor",
  "profile_owner",
  "sent",
  "created",
  "ok",
  "duplicate",
  "list",
  "items",
  "mailboxes",
  "conversations",
  "messages",
  "nylas",
  "keyword",
  "recipient",
  "missing_fields",
  "error",
  "hint",
  "kolUid",
  "platforms",
  "profiles",
  "creators",
  "sidebar",
  "query",
  "creator",
  "patch",
  "previous_owner",
  "overdue",
  "dictionary",
  "stages",
  "risks",
  "platforms",
  "checklist",
  "translation",
  "pointer",
  "exception",
  "completed",
  "current_stage",
  "subjectGroups",
  "profile",
  "recommended_actions",
  "conversation",
  "conversationId",
  "summary_zh",
  "pointer_label",
  "evidenced",
  "bodyHtml",
  "bodyText",
  "action",
  "requiresHumanSave",
  "id",
  "state",
  "operation",
  "messageId",
  "message_id",
  "mailId",
  "remote_id",
  "receipt_status",
  "briefing",
  "highlights",
  "briefing_summary",
  "briefing_source",
];

function conversationListSummary(data: Json, items: Json[]): string {
  const keyword = String(data.keyword || data.recipient || "").trim();
  if (items.length) return `已返回 ${items.length} 条可核验记录。`;
  return keyword ? `未找到与 ${keyword} 相关的邮件会话。` : "未找到邮件会话。";
}

function conversationListActions(data: Json, items: Json[]): string[] {
  if (items.length) return ["复核结果并选择下一步任务"];
  const recipient = firstEmail(data.recipient || data.keyword);
  return [
    recipient ? `写合作邮件 ${recipient}` : "写合作邮件",
    "品牌邮箱列表",
  ];
}

function conversationText(conversation: Json): string {
  const messages = Array.isArray(conversation.messages) ? conversation.messages as Json[] : [];
  const parts = messages.map((row) => firstString(row.body, row.text, row.content, row.html, row.snippet)).filter(Boolean);
  return firstString(conversation.body, conversation.preview, conversation.snippet, parts.join("\n\n"));
}

function inferCompletedFromText(text: string, current: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/interested|有兴趣|愿意合作|rate card|报价单/.test(t)) out.push("INTERESTED");
  if (/evaluat|评估|选品/.test(t)) out.push("EVALUATING");
  if (/quote|报价|usd\s*\d+|\$\d+/.test(t)) out.push("QUOTE_PENDING");
  if (/contract|合同|签署/.test(t)) out.push("CONTRACTING");
  if (/address|地址|寄样/.test(t)) out.push("SAMPLE_PENDING");
  if (/shipped|运单|已发货/.test(t)) out.push("SHIPPED");
  if (/received|签收|testing/.test(t)) out.push("TESTING");
  if (/https?:\/\/|youtu\.be|published|已发布/.test(t)) out.push("PUBLISHED");
  if (/invoice|payment sent|已付款/.test(t)) out.push("SETTLING");
  const normalized = normalizeStage(current);
  return out.filter((code) => code !== normalized);
}

function detectReplyException(profile: Json, riskConversations: Json, text: string): Json | null {
  const stage = normalizeStage(firstString(
    profile.cooperationStageCode,
    profile.cooperationStageName,
    profile.stage,
    profile.status,
  ));
  if (stage === "DISPUTED") return { code: "EXCEPTION_HANDLING", label: "异常处理中" };
  const uid = kolUidOf(profile);
  const active = rows(riskConversations).find((row) => {
    if (uid && kolUidOf(row) && kolUidOf(row) !== uid) return false;
    const tag = normalizeRiskTag(firstString(row.riskTag, row.code, row.risk_tag, row.tag));
    return /^(DELAY|CONTENT|LOST_CONTACT)$/i.test(tag);
  });
  if (active) {
    const code = normalizeRiskTag(firstString(active.code, active.riskTag)) || "DELAY";
    return {
      code,
      label: firstString(active.name, RISK_TAG_OPTIONS.find((row) => row.code === code)?.name, active.subject, "风险"),
    };
  }
  if (/lost contact|失联|haven.?t heard|no response/i.test(text)) return { code: "LOST_CONTACT", label: "失联" };
  if (/\bdelay\b|延期|postponed/i.test(text) && !/interested|有兴趣/.test(text)) return { code: "DELAY", label: "延期" };
  return null;
}

function usableHandle(value: string): string {
  const handle = String(value || "").trim().replace(/^@+/, "");
  if (!handle || /@/.test(handle) || /\.(com|cn|net|io|org|edu)$/i.test(handle)) return "";
  return handle;
}

function replyAnalysisActions(input: {
  pointer: string | null;
  exception: Json | null;
  recipient: string;
  handle: string;
  suggestedTags?: { id: string; label: string; reason?: string }[];
}): string[] {
  const handle = usableHandle(input.handle);
  const tagActions = (input.suggestedTags || []).slice(0, 1).map((tag) => (
    handle ? `给 @${handle} 打标签 ${tag.label}` : `打标签 ${tag.label}`
  ));
  if (input.exception) {
    return ["查看风险会话", handle ? `记状态 @${handle}` : "提出阶段变更", ...tagActions].filter(Boolean);
  }
  const stageLabel = input.pointer ? label(input.pointer) : "";
  return [
    input.recipient ? `写合作邮件 ${input.recipient}` : "写合作邮件",
    input.pointer
      ? (handle ? `提出阶段变更 @${handle} ${stageLabel}` : `提出阶段变更 ${stageLabel}`)
      : "提出阶段变更",
    ...tagActions,
  ].filter(Boolean);
}

type Operation = { name: string; label: string; status: "running" | "done" | "failed" };

const TOOL_LABELS: Record<string, string> = {
  pageMailboxes: "查询品牌邮箱",
  listNylasAccounts: "查询 Nylas 账号",
  pageEmailConversations: "查询邮件会话",
  getMailboxDetail: "查询邮箱详情",
  getEmailConversation: "读取会话详情",
  createEmailConversation: "建立往来记录",
  addKolProfile: "新增红人画像",
  importKolProfilesFromCrawler: "导入红人档案",
  importKolProfilesV2: "标准模板导入",
  pageKolProfiles: "分页查询达人画像",
  listAllKolProfiles: "全量查询达人画像",
  getKolProfileDetail: "查询达人详情",
  updateKolProfile: "更新达人画像",
  listKolPlatformData: "查询达人平台数据",
  getKolProfileSidebarMetrics: "查询达人库指标",
  decryptKolContact: "解密达人联系方式",
  pageLifecycleKanban: "合作生命周期看板",
  changeLifecycleStage: "改合作阶段",
  pageRiskConversations: "查询风险会话",
  summarizeRiskConversations: "汇总风险会话",
  listDictionaryOptions: "查询字典选项",
  listCooperationStageOptions: "查询合作阶段选项",
  listRiskTagOptions: "查询风险标签选项",
  pageAppEmailConversations: "查询应用邮件会话",
  previewEmailDraft: "生成邮件预览",
  sendEmailNow: "发送邮件",
  translateEmailToChinese: "邮件译成中文",
  getStageRiskMatrix: "阶段风险矩阵",
  getEmailConversationSubjectGroups: "会话主题分组",
};

function title(task: StarryKolTask): string {
  return {
    email_mailbox_list: "邮箱列表",
    email_conversation_list: "邮件会话列表",
    email_conversation_read: "邮件会话详情",
    email_compose: "邮件草稿",
    email_app_conversation_list: "应用邮件会话",
    creator_library_query: "达人库查询结果",
    creator_library_all: "达人库全量结果",
    creator_library_sync: "达人同步结果",
    creator_profile: "达人画像",
    creator_owner_update: "红人负责人更新结果",
    creator_status_update: "达人状态更新结果",
    creator_contact_decrypt: "达人联系方式",
    creator_lifecycle_kanban: "合作生命周期看板",
    creator_risk_conversations: "达人风险会话",
    creator_filter_options: "达人筛选字典",
    risk_scan: "超时/风险扫描",
    reply_analysis: "回复分析",
  }[task];
}

export async function listStarryMailboxes(opts?: { bearer?: string }): Promise<Json[]> {
  const data = await withStarryCallScope(
    { bearer: opts?.bearer, ignoreUser: Boolean(opts?.bearer) },
    () => call("pageMailboxes", { pageNo: 1, pageSize: 50 }),
  );
  return rows(data);
}

function rows(data: Json): Json[] {
  if (Array.isArray(data)) return data as Json[];
  if (data.needs_input && !Array.isArray(data.list) && !Array.isArray(data.records)) return [];
  if (data.kolUid || data.kolName) {
    if (Array.isArray(data.list) && data.list.length) return data.list as Json[];
    if (Array.isArray(data.records) && data.records.length) return data.records as Json[];
    return [data];
  }
  for (const key of ["list", "records", "rows", "items", "content", "mailboxes", "conversations", "messages", "profiles", "creators"]) {
    if (Array.isArray(data[key])) return data[key] as Json[];
  }
  if (data.mailboxEmail || data.subject || data.recipientEmail) return [data];
  return [];
}

function profileMatches(row: Json, keyword: string, stageCodes: string[]): boolean {
  if (keyword) {
    const hay = JSON.stringify(row).toLowerCase();
    if (!hay.includes(keyword.toLowerCase())) return false;
  }
  if (stageCodes.length) {
    const rowStage = firstString(
      row.cooperationStageCode,
      row.cooperationStageName,
      row.stageName,
      row.stage,
      row.status,
    );
    if (rowStage && !stageCodes.some((code) => rowStage.includes(code) || code.includes(rowStage))) return false;
  }
  return true;
}

function kolIdOf(row: Json): number {
  return number(row.kolId || row.kol_id);
}

function existingConversationId(row: Json): number {
  return number(row.lastConversationId || row.last_conversation_id || row.conversationId);
}

function conversationCreateBody(input: {
  mailboxEmail: string;
  recipientEmail: string;
  kolUid?: string;
  kolId?: number;
  subject?: string;
}): Json {
  return {
    mailboxEmail: input.mailboxEmail,
    recipientEmail: input.recipientEmail,
    ...(input.kolId ? { kolId: input.kolId } : input.kolUid ? { kolUid: input.kolUid } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
  };
}

function mailboxRowEmail(row: Json): string {
  return firstEmail(row.mailboxEmail || row.mailbox_email || row.email);
}

function sameMailbox(row: Json, email: string): boolean {
  const got = mailboxRowEmail(row);
  return Boolean(got && email && normalizeEmail(got) === normalizeEmail(email));
}

function ownerFromMailboxRow(row: Json): Json {
  const mailboxEmail = mailboxRowEmail(row);
  const ownerUserName = firstString(row.ownerUserName, row.owner_user_name, row.ownerName, row.owner);
  const ownerOpenId = firstString(row.ownerOpenId, row.owner_open_id, row.ownerUserId, row.owner_user_id);
  return {
    ...(mailboxEmail ? { mailboxEmail, ownerMailbox: mailboxEmail } : {}),
    ...(ownerUserName ? { ownerUserName, ownerName: ownerUserName } : {}),
    ...(ownerOpenId ? { ownerOpenId, ownerUserId: ownerOpenId } : {}),
  };
}

function ownerFromBinding(fromAddr: string): Json {
  if (!fromAddr) return {};
  try {
    const user = scopedUser();
    if (!user) return {};
    const row = starryBindingRow(user.id);
    if (!row) return {};
    if (normalizeEmail(String(row.mailbox_email || "")) !== normalizeEmail(fromAddr)) return {};
    const ownerUserName = firstString(row.owner_name);
    return {
      mailboxEmail: fromAddr,
      ownerMailbox: fromAddr,
      ...(ownerUserName ? { ownerUserName, ownerName: ownerUserName } : {}),
    };
  } catch {
    return {};
  }
}

function profileAddBody(recipientEmail: string, name?: string, owner: Json = {}): Json {
  return {
    kolName: (name || recipientEmail.split("@")[0] || "邮件联络人").trim(),
    contactEmail: recipientEmail,
    ...owner,
  };
}

async function ingestCreatorNow(kolName: string, contactEmail: string): Promise<Json> {
  const created = await call("addKolProfile", requestJson(profileAddBody(contactEmail, kolName)));
  return {
    ok: true,
    created: true,
    creator: created,
    kolName,
    contactEmail,
    kolUid: kolUidOf(created),
  };
}

function isMissingMailboxOwner(error: string): boolean {
  return /负责人无可用邮箱/.test(error);
}

function isMissingKolProfile(error: string): boolean {
  return /红人画像不存在|还没有红人画像|无此画像/.test(error);
}

function resultError(result: Json): string {
  return firstString(result.error, result.message, result.msg, result.text);
}

function conversationMissingProfile(result: Json): boolean {
  if (number(result.conversationId || result.id)) return false;
  return isMissingKolProfile(resultError(result));
}

function isEmailTakenByOtherKol(error: string): boolean {
  return /联系邮箱已被其他红人占用/.test(error);
}

function profileMatchesContact(row: Json, email: string): boolean {
  const got = firstEmail(row.contactEmail || row.email || row.contact_email);
  return Boolean(got && email && normalizeEmail(got) === normalizeEmail(email));
}

function emailParts(value: string): { local: string; domain: string } {
  const normalized = normalizeEmail(value);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return { local: "", domain: "" };
  return { local: normalized.slice(0, at), domain: normalized.slice(at + 1) };
}

function maskedEmailMatches(masked: unknown, email: string): boolean {
  const mask = String(masked || "").trim().toLowerCase();
  if (!mask.includes("*") || !email) return false;
  const want = emailParts(email);
  const got = emailParts(mask);
  if (!want.local || !want.domain || !got.local || !got.domain) return false;
  if (want.domain !== got.domain) return false;
  const star = got.local.indexOf("*");
  if (star < 1) return false;
  const prefix = got.local.slice(0, star);
  const suffix = got.local.slice(star).replace(/\*+/g, "");
  if (!want.local.startsWith(prefix)) return false;
  if (suffix && !want.local.endsWith(suffix)) return false;
  const visible = got.local.replace(/\*/g, "");
  return visible.length > 0 && visible.length < want.local.length;
}

function profileMaskedContact(row: Json): string {
  return firstString(row.contactEmailMasked, row.contact_email_masked, row.emailMasked, row.email_masked);
}

function profileFollowScope(fromAddr?: string): { mailbox_email: string; owner_name: string } {
  try {
    const user = scopedUser();
    const bind = publicStarryBinding(user ? starryBindingRow(user.id) : null);
    return {
      mailbox_email: fromAddr || bind.mailbox_email,
      owner_name: bind.owner_name,
    };
  } catch {
    return { mailbox_email: fromAddr || "", owner_name: "" };
  }
}

function profileFollowsMailbox(row: Json, fromAddr?: string): boolean {
  const scope = profileFollowScope(fromAddr);
  if (!scope.mailbox_email && !scope.owner_name) return false;
  return matchesFollowedMailbox({
    owner_name: firstString(row.ownerUserName, row.owner_user_name, row.ownerName, row.owner_name, row.owner),
    owner_mailbox: firstEmail(row.ownerMailbox || row.owner_mailbox || row.mailboxEmail || row.mailbox_from),
    mailbox_from: firstEmail(row.mailbox_from),
    mailboxEmail: firstEmail(row.mailboxEmail),
  }, scope);
}

function pickContactProfile(list: Json[], email: string, opts?: { allowSingle?: boolean; fromAddr?: string }): Json | undefined {
  if (!list.length) return undefined;
  const exact = list.filter((row) => profileMatchesContact(row, email) && kolUidOf(row));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const followed = exact.filter((row) => profileFollowsMailbox(row, opts?.fromAddr));
    return followed[0] || exact[0];
  }
  const masked = list.filter((row) => maskedEmailMatches(profileMaskedContact(row), email) && kolUidOf(row));
  if (masked.length === 1) return masked[0];
  if (masked.length > 1) {
    const followed = masked.filter((row) => profileFollowsMailbox(row, opts?.fromAddr));
    return followed.length === 1 ? followed[0] : undefined;
  }
  if (opts?.allowSingle && list.length === 1 && kolUidOf(list[0])) return list[0];
  return undefined;
}

function localFollowedProfile(email: string, fromAddr?: string): Json | undefined {
  if (!email) return undefined;
  try {
    const found = getConn().prepare(
      "SELECT * FROM collaborations WHERE lower(trim(email)) = ?",
    ).all(normalizeEmail(email)) as Array<Record<string, unknown>>;
    const withUid = found.filter((row) => String(row.kol_uid || "").trim());
    if (!withUid.length) return undefined;
    const followed = withUid.filter((row) => matchesFollowedMailbox(row, profileFollowScope(fromAddr)));
    const chosen = followed.length ? followed : withUid;
    const uids = new Set(chosen.map((row) => String(row.kol_uid || "").trim()));
    if (uids.size !== 1) return undefined;
    const row = chosen[0];
    const kolId = number(row.kol_id);
    return {
      kolUid: String(row.kol_uid || ""),
      ...(kolId ? { kolId } : {}),
      kolName: firstString(row.display_name, row.handle),
      contactEmail: firstString(row.email),
      ownerUserName: firstString(row.owner_name),
      ownerMailbox: firstEmail(row.owner_mailbox || row.mailbox_from),
      mailboxEmail: firstEmail(row.owner_mailbox || row.mailbox_from),
    };
  } catch {
    return undefined;
  }
}

function conversationProfile(row: Json, email: string): Json | undefined {
  const recipient = firstEmail(row.recipientEmail || row.to || row.email || row.kolEmail);
  const uid = kolUidOf(row);
  if (!uid || !recipient || normalizeEmail(recipient) !== normalizeEmail(email)) return undefined;
  const kolId = kolIdOf(row);
  const conversationId = existingConversationId(row) || number(row.id);
  return {
    kolUid: uid,
    ...(kolId ? { kolId } : {}),
    ...(conversationId ? { lastConversationId: conversationId, conversationId } : {}),
    kolName: firstString(row.kolName, row.nickname, row.recipientName),
    contactEmail: recipient,
    ownerUserName: firstString(row.ownerUserName, row.ownerName),
    ownerMailbox: firstEmail(row.mailboxEmail || row.ownerMailbox),
    mailboxEmail: firstEmail(row.mailboxEmail || row.ownerMailbox),
  };
}

function uidInText(text: string): string {
  const match = String(text || "").match(/KOL[A-Z0-9]{8,}/i);
  return match?.[0] || "";
}

function asJsonObject(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  if (typeof value !== "string") return {};
  try {
    return json(JSON.parse(value));
  } catch {
    return {};
  }
}

function profileFromTaken(source: unknown): Json | undefined {
  if (!source) return undefined;
  if (source instanceof Error) {
    const fromJson = profileFromTaken(asJsonObject(source.message));
    if (fromJson) return fromJson;
    const uid = uidInText(source.message);
    return uid ? { kolUid: uid } : undefined;
  }
  const row = asJsonObject(source);
  const nested = [row, json(row.data), json(row.profile), json(row.existing), json(row.creator)];
  for (const item of nested) {
    const uid = kolUidOf(item) || uidInText(resultError(item) || JSON.stringify(item));
    if (uid) return { ...item, kolUid: uid };
  }
  const uid = uidInText(resultError(row) || String(source));
  return uid ? { ...row, kolUid: uid } : undefined;
}

function localFollowedCandidates(fromAddr?: string): Json[] {
  try {
    const found = getConn().prepare(
      "SELECT * FROM collaborations WHERE kol_uid IS NOT NULL AND trim(kol_uid) != ''",
    ).all() as Array<Record<string, unknown>>;
    const scope = profileFollowScope(fromAddr);
    return found.filter((row) => matchesFollowedMailbox(row, scope)).map((row) => ({
      kolUid: String(row.kol_uid || ""),
      kolName: firstString(row.display_name, row.handle),
      contactEmail: firstString(row.email),
      ownerUserName: firstString(row.owner_name),
      ownerMailbox: firstEmail(row.owner_mailbox || row.mailbox_from),
      mailboxEmail: firstEmail(row.owner_mailbox || row.mailbox_from),
    }));
  } catch {
    return [];
  }
}

async function findProfileByContact(
  email: string,
  invokeOptional: (tool: string, args?: Json) => Promise<Json>,
  fromAddr?: string,
): Promise<{ profile: Json; via: "user" | "host" } | undefined> {
  if (!email) return undefined;
  const local = localFollowedProfile(email, fromAddr);
  const withLocal = (hit: Json | undefined, via: "user" | "host"): { profile: Json; via: "user" | "host" } | undefined => {
    if (!hit) return undefined;
    if (local && kolUidOf(local) && kolUidOf(hit) && kolUidOf(local) === kolUidOf(hit)) {
      return { profile: { ...local, ...hit }, via };
    }
    return { profile: hit, via };
  };
  const localPart = emailParts(email).local;
  const keywords = [email, localPart.length >= 5 && localPart !== email ? localPart : ""].filter(Boolean);
  const fromPage = async (scoped?: { ignoreUser: boolean }) => {
    for (const keyword of keywords) {
      const run = () => invokeOptional("pageKolProfiles", requestJson({ pageNo: 1, pageSize: 20, keyword }));
      const payload = scoped ? await withStarryCallScope(scoped, run) : await run();
      const hit = pickContactProfile(rows(payload), email, { allowSingle: true, fromAddr });
      if (hit) return hit;
    }
    return undefined;
  };
  const fromAll = async (scoped?: { ignoreUser: boolean }) => {
    const run = () => invokeOptional("listAllKolProfiles", {});
    const payload = scoped ? await withStarryCallScope(scoped, run) : await run();
    return pickContactProfile(rows(payload), email, { allowSingle: false, fromAddr });
  };
  const fromConversations = async (scoped?: { ignoreUser: boolean }) => {
    const run = () => invokeOptional("pageEmailConversations", {
      pageNo: 1,
      pageSize: 20,
      keyword: email,
      ...(fromAddr ? { mailboxEmail: fromAddr } : {}),
    });
    const payload = scoped ? await withStarryCallScope(scoped, run) : await run();
    const hits = rows(payload).map((row) => conversationProfile(row, email)).filter(Boolean) as Json[];
    if (!hits.length) return undefined;
    const uids = new Set(hits.map((row) => kolUidOf(row)));
    return uids.size === 1 ? hits[0] : undefined;
  };
  const fromFollowedDetails = async (scoped?: { ignoreUser: boolean }) => {
    const seen = new Set<string>();
    const candidates: Json[] = [];
    const push = (row: Json) => {
      const uid = kolUidOf(row);
      if (!uid || seen.has(uid)) return;
      if (fromAddr && !profileFollowsMailbox(row, fromAddr)) return;
      seen.add(uid);
      candidates.push(row);
    };
    if (!scoped) {
      for (const row of localFollowedCandidates(fromAddr)) push(row);
    }
    const listed = async (tool: "pageKolProfiles" | "listAllKolProfiles", body: Json) => {
      const run = () => invokeOptional(tool, tool === "pageKolProfiles" ? requestJson(body) : body);
      const payload = scoped ? await withStarryCallScope(scoped, run) : await run();
      for (const row of rows(payload)) push(row);
    };
    const ownerName = profileFollowScope(fromAddr).owner_name;
    await listed("pageKolProfiles", {
      pageNo: 1,
      pageSize: 20,
      ...(ownerName ? { ownerUserName: ownerName } : {}),
    });
    await listed("listAllKolProfiles", {});
    const matches: Json[] = [];
    for (const row of candidates.slice(0, 20)) {
      const run = () => invokeOptional("getKolProfileDetail", { kolUid: kolUidOf(row) });
      const detail = scoped ? await withStarryCallScope(scoped, run) : await run();
      const merged = { ...row, ...json(detail) };
      if (pickContactProfile([merged], email, { allowSingle: false, fromAddr })) matches.push(merged);
    }
    return matches.length === 1 ? matches[0] : undefined;
  };
  const userPage = withLocal(await fromPage(), "user");
  if (userPage) return userPage;
  const userConv = withLocal(await fromConversations(), "user");
  if (userConv) return userConv;
  const userAll = withLocal(await fromAll(), "user");
  if (userAll) return userAll;
  const userDetail = withLocal(await fromFollowedDetails(), "user");
  if (userDetail) return userDetail;
  if (local) return { profile: local, via: "user" };
  const hostPage = await fromPage({ ignoreUser: true });
  if (hostPage) return { profile: hostPage, via: "host" };
  const hostConv = await fromConversations({ ignoreUser: true });
  if (hostConv) return { profile: hostConv, via: "host" };
  const hostAll = await fromAll({ ignoreUser: true });
  if (hostAll) return { profile: hostAll, via: "host" };
  const hostDetail = await fromFollowedDetails({ ignoreUser: true });
  if (hostDetail) return { profile: hostDetail, via: "host" };
  return undefined;
}

export function describeStarryActor(): Json {
  const user = scopedUser();
  const bind = publicStarryBinding(user ? starryBindingRow(user.id) : null);
  const workbench = user
    ? `${user.name || "未命名"}（${user.handle}${user.email ? `，${user.email}` : ""}）`
    : "未登录（演示会话）";
  const starry = bind.has_token
    ? `个人设置绑定的 Starry 用户 JWT${bind.mailbox_email ? `，发件箱 ${bind.mailbox_email}` : ""}${bind.owner_name ? `，负责人 ${bind.owner_name}` : ""}`
    : starryKolMcpBearer()
      ? "进程级 STARRY_KOL_MCP_BEARER（网关身份，不是个人设置里绑定的用户）"
      : "未连接 Starry";
  return {
    workbench,
    starry,
    via: bind.has_token ? "bound_jwt" : (starryKolMcpBearer() ? "process_bearer" : "none"),
    bound_mailbox: bind.mailbox_email,
    bound_owner: bind.owner_name,
    label: `灵工登录是 ${workbench}。Starry 身份是 ${starry}。`,
  };
}

function isOwnerMailboxAsContact(error: string): boolean {
  return /联系邮箱不能与.*负责人邮箱/.test(error) || /负责人邮箱重复/.test(error);
}

function composeRecipient(data: Json): string {
  return firstEmail(data.recipient || data.to || data.recipientEmail);
}

function isStaleComposeNeedError(error: string): boolean {
  return /还需要补充：必要字段/.test(error);
}

function composeBlocked(data: Json): boolean {
  const error = String(data.error || "");
  if (isStaleComposeNeedError(error)) return false;
  return isOwnerMailboxAsContact(error)
    || isMissingMailboxOwner(error)
    || isEmailTakenByOtherKol(error)
    || isMissingKolProfile(error);
}

function composeOpenFields(data: Json): string[] {
  if (data.sent) return [];
  const mailbox = firstEmail(data.mailboxEmail || data.from);
  const recipient = composeRecipient(data);
  const subject = firstString(data.subject);
  const conversationId = number(data.conversationId || data.conversation_id);
  return [
    !mailbox && !conversationId ? "mailboxEmail" : "",
    !recipient && !conversationId ? "to" : "",
    !subject && !conversationId ? "subject" : "",
  ].filter(Boolean);
}

function composeNeedsInputSummary(data: Json): string {
  const error = String(data.error || "");
  const mailbox = firstEmail(data.mailboxEmail || data.from);
  const recipient = composeRecipient(data);
  if (isOwnerMailboxAsContact(error)) {
    const bad = recipient || mailbox;
    return bad
      ? `${bad} 是品牌发件箱负责人邮箱，不能当作红人收件邮箱。请把发件邮箱和收件邮箱分开填写。`
      : "联系邮箱不能与负责人邮箱重复。请把发件邮箱和收件邮箱分开填写。";
  }
  if (isMissingMailboxOwner(error)) {
    if (data.mailbox_authorized && mailbox) {
      return `发件邮箱 ${mailbox} 已在授权列表中。当前 Starry 账号没有负责人身份，无法新建红人画像。请用该邮箱负责人的账号连接 Starry，或请管理员把本账号设为负责人。`;
    }
    return mailbox
      ? `发件邮箱 ${mailbox} 未授权给当前账号，无法用它新建红人画像或发出首封邮件。请改用已授权的发件邮箱，或请管理员在邮箱权限里开通。`
      : "当前账号没有可用的品牌发件箱，无法新建红人画像或发出首封邮件。请先在邮箱权限里给本账号分配发件箱。";
  }
  if (isEmailTakenByOtherKol(error)) {
    const actor = data.starry_actor && typeof data.starry_actor === "object"
      ? data.starry_actor as Json
      : describeStarryActor();
    const owner = firstString(data.profile_owner, data.ownerUserName, data.ownerName);
    const bound = firstEmail(actor.bound_mailbox);
    const alreadyBound = Boolean(mailbox && bound && normalizeEmail(mailbox) === normalizeEmail(bound));
    return [
      recipient
        ? `收件邮箱 ${recipient} 已有红人画像，但没对上跟进编号，无法建立往来。`
        : "该收件邮箱已有红人画像，但没对上跟进编号。",
      String(actor.label || ""),
      owner ? `该红人负责人是 ${owner}。` : "",
      alreadyBound
        ? "不要换收件邮箱。发件箱已经是当前绑定的 Starry 身份，不用再粘贴 JWT。"
        : "不要换收件邮箱。到个人设置 → 连接 Starry，用该红人负责人的账号粘贴 JWT 并绑定对应发件箱后重试。",
    ].filter(Boolean).join("");
  }
  if (isMissingKolProfile(error)) {
    return recipient
      ? `收件邮箱 ${recipient} 还没有红人画像，无法发出首封邮件。`
      : "该收件人还没有红人画像，无法发出首封邮件。";
  }
  const open = composeOpenFields(data);
  return open.length ? missingFieldsMessage(open) : "";
}

function composeNeedsInputActions(data: Json): string[] {
  const error = String(data.error || "");
  if (isOwnerMailboxAsContact(error)) {
    return ["写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]", "品牌邮箱列表"];
  }
  if (isEmailTakenByOtherKol(error)) {
    return ["个人设置 → 连接 Starry，用该红人负责人账号重新连接", "品牌邮箱列表"];
  }
  if (isMissingMailboxOwner(error)) {
    return ["品牌邮箱列表", "请改用已授权的发件邮箱后再写邮件"];
  }
  if (isMissingKolProfile(error)) {
    return ["该收件人需要先有红人画像才能发出首封邮件", "品牌邮箱列表"];
  }
  const open = composeOpenFields(data);
  if (open.length) return [`还需要补充：${open.map((field) => fieldLabel(field)).join("、")}`];
  return ["核对预览后回复「确认发送」"];
}

async function resolveBrandMailbox(
  entities: Json,
  invoke: (tool: string, args?: Json) => Promise<Json>,
): Promise<{ mailboxEmail: string; mailboxId?: number }> {
  const givenEmail = firstEmail(entities.mailboxEmail || entities.from);
  const givenId = number(entities.mailboxId || entities.mailbox_id);
  if (givenEmail) return { mailboxEmail: givenEmail, mailboxId: givenId || undefined };
  if (givenId) {
    const detail = await invoke("getMailboxDetail", { id: givenId });
    const mailboxEmail = firstEmail(detail.mailboxEmail);
    if (mailboxEmail) return { mailboxEmail, mailboxId: givenId };
  }
  throw new Error("未指定发件邮箱");
}

function composeAddressSection(data: Json): Json {
  const mailbox = firstEmail(data.mailboxEmail || data.from);
  const to = emails(data.to || data.recipient || data.recipientEmail);
  const subject = firstString(data.subject);
  return {
    title: "收发说明",
    items: [
      `发件邮箱：${mailbox || "未指定"}`,
      `收件邮箱：${to.join("、") || "未指定"}`,
      `邮件主题：${subject || "未指定"}`,
    ],
  };
}

function labeledComposeValue(line: string, labels: string[]): string {
  for (const label of labels) {
    const prefix = `${label}：`;
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return "";
}

export function composePayloadFromItem(item: Json, siblings: Json[] = [], context: Json = {}): Json {
  const nested = json(item.starrykol_data || item.emailmcp_data);
  const lifted = extractNestedCreateDrafts(item)[0] || {};
  const draft = siblings.find((row) => row.type === "create_draft") || lifted;
  const sections = Array.isArray(item.sections) ? item.sections as Json[] : [];
  const lines = sections.flatMap((section) => {
    const rows = Array.isArray(section.items) ? section.items.map(String) : [];
    const body = firstString(section.body, section.content);
    return body ? [...rows, `${section.title || section.heading}：${body}`] : rows;
  });
  let mailbox = firstEmail(
    nested.mailboxEmail || nested.from || item.mailboxEmail || item.from || draft.from
    || context.mailboxEmail || context.from,
  );
  let to = emails(nested.to || nested.recipient || nested.recipientEmail || item.to || draft.to || context.to);
  let subject = firstString(nested.subject, item.subject, draft.subject, context.subject);
  let body = firstString(nested.body, nested.bodyText, nested.preview, item.body, draft.body);
  let state = firstString(nested.state, item.state);
  let operation = firstString(nested.operation, item.operation);
  for (const line of lines) {
    mailbox = mailbox || firstEmail(labeledComposeValue(line, ["发件邮箱"]));
    const recipients = labeledComposeValue(line, ["收件邮箱"]);
    if (recipients && !to.length) to = emails(recipients);
    subject = subject || labeledComposeValue(line, ["邮件主题"]);
    body = body || labeledComposeValue(line, ["正文", "已发正文", "预览正文"]);
    state = state || labeledComposeValue(line, ["state", "状态"]);
    operation = operation || labeledComposeValue(line, ["operation"]);
  }
  const receipt = mailSendReceipt({
    ...nested,
    ...item,
    state,
    operation,
    sent: nested.sent ?? item.sent,
  });
  const sent = receipt.sent
    || firstString(item.title) === "邮件已发送"
    || /已提交发送/.test(firstString(item.summary));
  const amount = nested.amount_usd ?? draft.amount_usd ?? item.amount_usd;
  const currency = firstString(nested.currency, draft.currency, item.currency);
  const templateId = firstString(nested.template_id, draft.template_id, item.template_id);
  const zh = firstString(nested.body_zh_internal, draft.body_zh_internal, item.body_zh_internal);
  return {
    ...nested,
    mailboxEmail: mailbox,
    from: mailbox,
    to,
    recipient: to[0] || firstEmail(nested.recipient),
    subject,
    ...(body ? { body, bodyText: body } : {}),
    ...(zh ? { body_zh_internal: zh } : {}),
    ...(amount != null && amount !== "" ? { amount_usd: Number(amount) } : {}),
    ...(currency ? { currency } : {}),
    ...(templateId ? { template_id: templateId } : {}),
    sent,
    recommended_actions: undefined,
    ...(sent ? { needs_input: false, error: "", missing_fields: [] } : {}),
  };
}

export function composeFollowupEntities(data: Json): Json {
  const to = emails(data.to || data.recipient || data.recipientEmail);
  const mailboxEmail = firstEmail(data.mailboxEmail || data.from);
  const subject = firstString(data.subject);
  const conversationId = number(data.conversationId || data.conversation_id);
  const body = firstString(data.bodyText, data.body, data.preview);
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(mailboxEmail ? { mailboxEmail } : {}),
    ...(to.length ? { to } : {}),
    ...(subject ? { subject } : {}),
    ...(body ? { body } : {}),
  };
}

export function lastComposeFollowup(cards: Json[], opts?: { body?: boolean }): Json {
  for (const card of [...cards].reverse()) {
    const payload = json(card.payload || card);
    if (payload.skill !== "email_compose" && payload.title !== "邮件草稿") continue;
    const data = json(payload.starrykol_data || payload.emailmcp_data || payload);
    const next = composeFollowupEntities(data);
    if (!next.conversationId && !next.mailboxEmail) continue;
    if (opts?.body === false) {
      const { body: _body, ...rest } = next;
      return rest;
    }
    return next;
  }
  return {};
}

export function lastKolMailReply(cards: Json[]): Json {
  let fallback: Json = {};
  for (const card of [...cards].reverse()) {
    if (String(card.kind || "") !== "kol_mail_card") continue;
    const payload = json(card.payload || card);
    const inbound = String(payload.direction || "inbound") !== "outbound";
    const mailbox = inbound
      ? realMailboxEmail(payload.mailbox, payload.to)
      : realMailboxEmail(payload.mailbox, payload.from);
    const kol = inbound
      ? realMailboxEmail(payload.from)
      : realMailboxEmail(payload.to);
    const conversationId = number(payload.conversation_id || payload.conversationId);
    const subject = replySubjectOf(firstString(payload.subject));
    const suggested = firstString(json(payload.judgment).suggested_stage);
    const next: Json = {
      ...(conversationId ? { conversationId } : {}),
      ...(mailbox ? { mailboxEmail: mailbox, from: mailbox } : {}),
      ...(kol ? { to: [kol] } : {}),
      ...(subject ? { subject } : {}),
      ...(suggested ? { suggested_stage: suggested } : {}),
    };
    if (!next.conversationId && !next.mailboxEmail && !next.to) continue;
    if (inbound && next.mailboxEmail) return next;
    if (inbound && !fallback.mailboxEmail) fallback = next;
    else if (!fallback.conversationId && !fallback.mailboxEmail && !fallback.to) fallback = next;
  }
  return fallback;
}

const SKILL_TITLE_SUBJECTS = new Set([
  "发货通知",
  "催大纲",
  "首封建联",
  "写合作邮件",
  "写跟进",
  "写跟进邮件",
  "写报价邮件",
  "写一份报价邮件",
  "写一封报价邮件",
  "核对地址",
  "要媒体包",
  "写谈判邮件",
  "请确认方案",
  "合同沟通",
  "发brief",
  "发内容brief",
  "初稿反馈",
  "确认排期",
  "确认发布排期",
  "请开发票",
  "核对公开链接",
  "写邮件",
  "回复分析",
  "记状态",
  "阶段SOP",
  "提出阶段变更",
  "邮件草稿",
]);

export function isSkillTitleSubject(subject: string, raw = ""): boolean {
  const clean = String(subject || "").replace(/^(Re:\s*)+/i, "").trim();
  if (!SKILL_TITLE_SUBJECTS.has(clean)) return false;
  if (clean === "发货通知" && /运单号|tracking|承运商|carrier/i.test(raw)) return false;
  return true;
}

export function resolveComposeSubject(input: {
  raw?: string;
  prior?: Json;
  extracted?: Json;
  entities?: Json;
}): string {
  const raw = String(input.raw || "");
  const labeled = firstString(input.extracted?.subject);
  const explicit = /(?:主题|subject)\s*[:：]/.test(raw);
  if (explicit && labeled) return labeled;
  if (input.extracted?.another_letter) {
    const next = anotherLetterSubject(input.prior?.subject || input.entities?.subject);
    if (next && !isSkillTitleSubject(next, raw)) return next;
  }
  const prior = firstString(input.prior?.subject);
  if (prior && !isSkillTitleSubject(prior, raw)) return prior;
  const entity = firstString(input.entities?.subject);
  if (entity && !isSkillTitleSubject(entity, raw)) return entity;
  if (labeled && !isSkillTitleSubject(labeled, raw)) return labeled;
  return "";
}

export function anotherLetterSubject(previous?: unknown): string {
  const subject = firstString(previous).replace(/^(Re:\s*)+/i, "").trim();
  return subject ? `Re: ${subject}` : "";
}

function rowText(row: Json): string {
  const name = firstString(
    row.kolName,
    row.nickname,
    row.name,
    row.code && row.name ? `${row.name}` : "",
    row.mailboxEmail,
    row.subject,
    row.recipientEmail,
    row.ownerUserName,
    row.account,
    row.platform,
    row.kolUid ? `UID ${row.kolUid}` : "",
    row.id != null ? `ID ${row.id}` : "",
  ) || "—";
  const details = [
    row.kolUid && name !== `UID ${row.kolUid}` ? `UID ${row.kolUid}` : "",
    row.cooperationStageName || row.stageName || row.stage || row.status
      ? `阶段 ${row.cooperationStageName || row.stageName || row.stage || row.status}`
      : "",
    row.primaryPlatform || row.platform ? `平台 ${row.primaryPlatform || row.platform}` : "",
    row.followers != null || row.followerCountTenThousands != null
      ? `粉丝 ${row.followers != null ? number(row.followers).toLocaleString("zh-CN") : `${row.followerCountTenThousands}万`}`
      : "",
    row.accountHandle ? `账号 ${row.accountHandle}` : "",
    row.stableViews != null ? `稳定播放 ${number(row.stableViews).toLocaleString("zh-CN")}` : "",
    row.brandName || row.brandCode ? `品牌 ${row.brandName || row.brandCode}` : "",
    row.kolUid && (row.ownerUserName || row.ownerName || row.ownerUserId)
      ? `红人负责人 ${row.ownerUserName || row.ownerName || row.ownerUserId}`
      : (row.ownerUserName || row.ownerName) && !row.kolUid ? `邮箱负责人 ${row.ownerUserName || row.ownerName}` : "",
    row.grantStatus ? `授权 ${row.grantStatus}` : "",
    row.recipientEmail ? `收件人 ${row.recipientEmail}` : "",
    row.contactEmailMasked ? `联系邮箱 ${row.contactEmailMasked}` : "",
    row.code ? `编码 ${row.code}` : "",
  ].filter(Boolean);
  return `${name}${details.length ? ` · ${details.join(" · ")}` : ""}`;
}

export function emailMcpResultCard(task: EmailMcpTask, data: Json): Json {
  if (task === "creator_profile" && !data.needs_input && !String(data.briefing || "").trim()) {
    const facts = profileBriefingFromFacts(data);
    data = {
      ...data,
      briefing: facts.briefing,
      highlights: facts.highlights,
      briefing_summary: facts.summary,
      briefing_source: facts.briefing_source,
      recommended_actions: Array.isArray(data.recommended_actions) && data.recommended_actions.length
        ? data.recommended_actions
        : facts.recommended_actions,
    };
  }
  const items = rows(data);
  const primitiveItems = Object.entries(data)
    .filter(([key, value]) => !CARD_SKIP_KEYS.includes(key)
      && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 12)
    .map(([key, value]) => `${fieldLabel(key)}：${String(value)}`);
  const sections: Json[] = [];
  if (task === "email_compose") sections.unshift(composeAddressSection(data));
  const composeSent = task === "email_compose" && Boolean(data.sent);
  const composeOpen = task === "email_compose" ? composeOpenFields(data) : [];
  const composeNeeds = task === "email_compose"
    ? !composeSent && (composeBlocked(data) || composeOpen.length > 0)
    : Boolean(data.needs_input);
  if (composeOpen.length) {
    sections.push({
      title: "待补充字段",
      items: composeOpen.map((field) => fieldLabel(field)),
    });
  } else if (task !== "email_compose" && Array.isArray(data.missing_fields) && data.missing_fields.length) {
    sections.push({
      title: "待补充字段",
      items: (data.missing_fields as unknown[]).map((field) => fieldLabel(String(field))),
    });
  }
  if (data.error && !composeSent && composeNeeds && !isStaleComposeNeedError(String(data.error))) {
    sections.push({
      title: "说明",
      items: [task === "email_compose" ? (composeNeedsInputSummary(data) || String(data.error)) : String(data.error)],
    });
  }
  if (task === "email_conversation_list" && !items.length && !data.needs_input) {
    const keyword = String(data.keyword || data.recipient || "").trim();
    sections.push({
      title: "查询条件",
      items: [
        keyword ? `关键词 ${keyword}` : "未指定关键词（列出全部会话）",
        `匹配数 ${number(data.total)}`,
      ],
    });
    sections.push({
      title: "说明",
      items: [
        "这里列出的是品牌合作往来，不是 Gmail / 163 收件箱。",
        "当前没有匹配的往来记录。发出首封邮件需要已授权的发件邮箱，且收件人必须已有红人画像。",
      ],
    });
  }
  if (task === "creator_library_query" && !items.length && !data.needs_input) {
    const query = data.query && typeof data.query === "object" ? data.query as Json : {};
    const keyword = String(query.keyword || data.keyword || "").trim();
    sections.push({
      title: "查询条件",
      items: [
        keyword ? `关键词 ${keyword}` : "未指定关键词（按账号可见范围分页）",
        `匹配数 ${number(data.total)}`,
      ],
    });
    sections.push({
      title: "说明",
      items: [
        "达人主数据在 Starry KOL MCP 红人库，不走 KOL Claw / 本地爬虫表。",
        "可按关键词、合作阶段或风险标签筛选；联系方式解密不会在查询时自动执行。",
      ],
    });
  }
  if (task === "creator_profile" && data.needs_input && items.length) {
    sections.push({ title: "候选红人", items: items.slice(0, 50).map(rowText) });
  } else if (task !== "reply_analysis" && task !== "email_compose" && task !== "creator_profile" && items.length) {
    sections.push({ title: "明细", items: items.slice(0, 50).map(rowText) });
  }
  const ownerItems = ownerBindingItems(data);
  if (["creator_profile", "creator_owner_update", "creator_status_update"].includes(task) && ownerItems.length) {
    sections.unshift({ title: "红人绑定 / 负责人", items: ownerItems });
  }
  if (task === "creator_profile") {
    const briefing = String(data.briefing || "").trim();
    const highlights = Array.isArray(data.highlights)
      ? (data.highlights as unknown[]).map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (briefing || highlights.length) {
      sections.unshift({
        title: "画像说明",
        body: briefing,
        items: highlights,
      });
    }
  }
  if (Array.isArray(data.previous_owner) && data.previous_owner.length) {
    sections.push({ title: "更新前负责人", items: (data.previous_owner as unknown[]).map(String) });
  }
  if (task === "creator_contact_decrypt" && (data.contactEmail || data.phone)) {
    sections.unshift({
      title: "解密结果",
      items: [
        data.contactEmail ? `邮箱 ${data.contactEmail}` : "",
        data.phone ? `电话 ${data.phone}` : "",
      ].filter(Boolean),
    });
  }
  if (Array.isArray(data.dictionary) && data.dictionary.length) {
    sections.push({ title: "字典选项", items: (data.dictionary as Json[]).slice(0, 30).map(rowText) });
  }
  if (task !== "reply_analysis" && Array.isArray(data.stages) && data.stages.length) {
    sections.push({ title: "合作阶段", items: (data.stages as Json[]).slice(0, 30).map(rowText) });
  }
  if (task !== "reply_analysis" && Array.isArray(data.risks) && data.risks.length) {
    sections.push({ title: "风险标签", items: (data.risks as Json[]).slice(0, 30).map(rowText) });
  }
  if (typeof data.summary === "string" && data.summary && (task === "creator_risk_conversations" || task === "risk_scan")) {
    sections.unshift({ title: "风险汇总", items: [String(data.summary)] });
  }
  if (task === "risk_scan" && Array.isArray(data.overdue)) {
    sections.push({
      title: "T8 失联与延期",
      items: (data.overdue as Json[]).slice(0, 50).map((row) => {
        const handle = firstString(row.handle, row.name) || "—";
        const stage = row.stage_label || row.stage_code || "";
        const days = row.days_in_stage != null || row.days != null ? `${number(row.days_in_stage ?? row.days)} 天` : "";
        return `@${handle}${stage ? ` · ${stage}` : ""}${days ? ` · ${days}` : ""}`;
      }),
    });
  }
  if (Array.isArray(data.platforms) && data.platforms.length) {
    sections.push({ title: "平台数据", items: (data.platforms as Json[]).slice(0, 20).map(rowText) });
  }
  if (task === "creator_profile" && Array.isArray(data.conversations) && data.conversations.length) {
    sections.push({ title: "邮件会话", items: (data.conversations as Json[]).slice(0, 20).map(rowText) });
  }
  if (task === "reply_analysis") {
    if (data.summary_zh || data.translation) {
      sections.unshift({
        title: "中文摘要",
        body: String(data.summary_zh || (data.translation as Json | undefined)?.text || ""),
        items: [],
      });
    }
    if (Array.isArray(data.checklist) && data.checklist.length) {
      sections.push({
        title: "十五阶段清单",
        items: (data.checklist as Json[]).map((row) => {
          const note = row.note ? ` · ${row.note}` : "";
          return `${row.label || row.code}：${row.status || "未开始"}${note}`;
        }),
      });
    }
    if (data.pointer || data.exception) {
      sections.push({
        title: "当前指针",
        items: [
          data.exception ? `异常未解除：${(data.exception as Json).label || (data.exception as Json).code}` : "",
          data.pointer ? `建议确认进入 ${data.pointer_label || label(String(data.pointer))}` : "暂无主流程指针",
          "发送邮件不会修改阶段。确认后才写入。",
        ].filter(Boolean),
      });
    }
    if (Array.isArray(data.suggested_follow_tags) && data.suggested_follow_tags.length) {
      sections.push({
        title: "建议跟进标签",
        items: (data.suggested_follow_tags as Json[]).map((row) => {
          const reason = row.reason ? `${row.reason}，` : "";
          return `${reason}建议打上「${row.label || row.id}」。不改正式阶段。`;
        }),
      });
    }
  }
  if (Array.isArray(data.nylas)) {
    sections.push({ title: "Nylas 账号", items: (data.nylas as Json[]).slice(0, 20).map(rowText) });
  }
  const composeBody = firstString(data.body, data.bodyText, data.preview);
  if (task === "email_compose" && composeBody) {
    sections.splice(1, 0, { title: data.sent ? "已发正文" : "预览正文", body: composeBody, items: [] });
  } else if (task !== "creator_profile" && (data.body || data.preview)) {
    sections.unshift({ title: "预览正文", body: String(data.body || data.preview), items: [] });
  }
  if (task !== "reply_analysis" && task !== "email_compose" && task !== "creator_profile" && primitiveItems.length) {
    sections.push({ title: "摘要数据", items: primitiveItems });
  }
  const sidebar = data.sidebar && typeof data.sidebar === "object" ? data.sidebar as Json : {};
  const needsKolInput = [
    "creator_library_query",
    "creator_library_all",
    "creator_library_sync",
    "creator_profile",
    "creator_owner_update",
    "creator_status_update",
    "creator_contact_decrypt",
  ].includes(task);
  return {
    type: "task_result",
    title: composeSent ? "邮件已发送" : title(task),
    summary: composeSent
      ? "邮件已提交发送。往来已写入会话，发送邮件不会修改阶段。"
      : composeNeeds && task === "email_compose"
      ? composeNeedsInputSummary(data)
      : data.needs_input && task !== "email_compose"
      ? (needsKolInput
        ? missingFieldsMessage(data.missing_fields as unknown[] || [])
        : composeNeedsInputSummary(data))
      : data.sent
        ? "邮件已提交发送。"
        : data.duplicate
          ? "达人画像已存在，未重复写入。"
          : data.created
            ? "已在 Starry KOL MCP 红人库新增达人画像。"
          : data.updated
            ? (task === "creator_owner_update" ? "红人画像负责人已更新。" : "红人画像已更新。")
          : data.decrypted
            ? "已解密达人联系方式，请按权限使用。"
        : task === "email_conversation_list"
          ? conversationListSummary(data, items)
          : task === "creator_library_query" && !items.length
            ? "未找到匹配的达人画像。"
          : task === "reply_analysis"
            ? (data.exception
              ? `异常未解除，主流程暂停：${(data.exception as Json).label || (data.exception as Json).code}。`
              : data.pointer
                ? `当前指针：${data.pointer_label || label(String(data.pointer))}。发送 ≠ 推进阶段。`
                : "已按来信核对十五阶段，未改正式阶段。")
          : task === "creator_profile"
            ? (String(data.briefing_summary || data.briefing || "").trim().slice(0, 80)
              || "达人画像已整理，未改阶段、未解密联系方式。")
          : task === "email_compose"
            ? (composeBody ? "邮件草稿已生成，请核对后回复「确认发送」。" : "邮件草稿已建立往来，请核对后回复「确认发送」。")
          : items.length ? `已返回 ${items.length} 条可核验记录。` : "Starry KOL 任务已完成。",
    sections,
    metrics: {
      ...(data.total != null ? { total: number(data.total) } : {}),
      ...((data.statistics as Json | undefined)?.mailboxCount != null
        ? { mailboxCount: number((data.statistics as Json).mailboxCount) }
        : {}),
      ...(sidebar.creatorCount != null ? { creatorCount: number(sidebar.creatorCount) } : {}),
      ...(sidebar.stageCount != null ? { stageCount: number(sidebar.stageCount) } : {}),
      ...(sidebar.riskConversationCount != null ? { riskConversationCount: number(sidebar.riskConversationCount) } : {}),
    },
    recommended_actions: task === "email_compose"
      ? (composeNeeds
        ? composeNeedsInputActions(data)
        : composeSent
          ? ["再写一封", "查看邮件会话"]
          : ["核对预览后回复「确认发送」"])
      : Array.isArray(data.recommended_actions) && data.recommended_actions.length
      ? (data.recommended_actions as string[])
      : data.needs_input
      ? (needsKolInput ? ["补充达人 UID、负责人或联系邮箱后重试", "查询达人库"] : composeNeedsInputActions(data))
      : task === "email_conversation_list"
          ? conversationListActions(data, items)
          : task === "creator_library_query" || task === "creator_library_all"
            ? items.length ? ["查看达人画像", "更新红人负责人"] : ["换关键词再查", "写合作邮件"]
          : task === "creator_profile"
            ? ["更新红人负责人", "写合作邮件"]
          : task === "creator_contact_decrypt"
            ? ["仅在授权范围内使用联系方式", "查看达人画像"]
          : ["复核结果并选择下一步任务"],
    skill: task,
    profile: taskDefinition(task)?.profile || "lead",
    starrykol_data: data,
    emailmcp_data: data,
    ...(Array.isArray(data.suggested_follow_tags) ? { suggested_follow_tags: data.suggested_follow_tags } : {}),
    persistent: true,
  };
}

export const starryKolResultCard = emailMcpResultCard;

export async function executeStarryKolTask(
  task: StarryKolTask,
  entities: Json,
  actor = "host",
  onOperation?: (operation: Operation) => void,
): Promise<{
  data: Json;
  operations: Json[];
}> {
  const operations: Operation[] = [];
  const invoke = async (tool: string, args: Json = {}): Promise<Json> => {
    const operation: Operation = { name: `starrykol.${tool}`, label: TOOL_LABELS[tool] || title(task), status: "running" };
    operations.push(operation);
    onOperation?.(operation);
    try {
      const result = await call(tool, args);
      operation.status = "done";
      onOperation?.(operation);
      return result;
    } catch (error) {
      operation.status = "failed";
      onOperation?.(operation);
      throw error;
    }
  };
  const invokeOptional = async (tool: string, args: Json = {}): Promise<Json> => {
    try {
      return await invoke(tool, args);
    } catch {
      return {};
    }
  };

  let data: Json = {};
  if (task === "email_mailbox_list") {
    const mailboxes = await invoke("pageMailboxes", {
      pageNo: Math.max(1, number(entities.pageNo, 1)),
      pageSize: Math.max(1, Math.min(50, number(entities.pageSize, 20))),
      ...(entities.keyword ? { keyword: String(entities.keyword) } : {}),
      ...(entities.brandCode ? { brandCode: String(entities.brandCode) } : {}),
    });
    const nylas = await invoke("listNylasAccounts");
    data = { ...mailboxes, nylas: Array.isArray(nylas.items) ? nylas.items : rows(nylas) };
    const localOwners = getConn().prepare("SELECT * FROM mailbox_owners ORDER BY brand, email").all() as Json[];
    if (localOwners.length) {
      data = {
        ...data,
        mailbox_owners: localOwners,
        list: [...rows(data), ...localOwners.map((row) => ({
          mailboxEmail: row.email,
          brandCode: row.brand,
          ownerUserName: row.owner_name,
          dept: row.dept,
          accountType: row.account_type,
          status: row.status,
          sharedWith: row.shared_with,
          permissionScope: row.permission_scope,
        }))],
      };
    }
  } else if (task === "email_conversation_list") {
    const keyword = searchKeyword(entities);
    const mailboxEmail = firstEmail(entities.mailboxEmail || entities.from || entities.mailbox);
    const listed = await invoke("pageEmailConversations", {
      pageNo: Math.max(1, number(entities.pageNo, 1)),
      pageSize: Math.max(1, Math.min(50, number(entities.pageSize, 10))),
      ...(keyword ? { keyword } : {}),
      ...(mailboxEmail ? { mailboxEmail } : {}),
      ...(entities.status ? { status: String(entities.status) } : {}),
    });
    data = {
      ...listed,
      ...(keyword ? { keyword, recipient: firstEmail(keyword) || firstEmail(entities.to || entities.email) } : {}),
    };
  } else if (task === "email_conversation_read") {
    const conversationId = number(entities.conversationId || entities.conversation_id);
    if (!conversationId) {
      data = { needs_input: true, missing_fields: ["conversationId"] };
    } else {
      data = await invoke("getEmailConversation", { conversationId });
      if (!firstString(data.subject, data.title)) {
        const groups = await invokeOptional("getEmailConversationSubjectGroups", { conversationId });
        const grouped = conversationSubject(data, groups);
        if (grouped) data.subject = grouped;
        if (groups && Object.keys(groups).length) data.subjectGroups = groups;
      }
    }
  } else if (task === "creator_library_query") {
    const query = profileQueryBody(entities);
    const listed = await invoke("pageKolProfiles", requestJson(query));
    const sidebar = await invokeOptional("getKolProfileSidebarMetrics", {});
    let list = rows(listed);
    let source: Json = listed;
    if (!list.length) {
      const all = await invokeOptional("listAllKolProfiles", {});
      const matched = rows(all).filter((row) =>
        profileMatches(row, String(query.keyword || ""), codes(query.stageCodes)),
      );
      const pageNo = number(query.pageNo, 1);
      const pageSize = number(query.pageSize, 20);
      list = matched.slice((pageNo - 1) * pageSize, pageNo * pageSize);
      source = { ...all, total: matched.length, list };
    }
    data = { ...source, query, sidebar, list, total: source.total ?? list.length };
  } else if (task === "creator_library_sync") {
    const kolName = firstString(entities.name, entities.kolName, entities.handle);
    const contactEmail = firstEmail(entities.email || entities.to || entities.contactEmail);
    if (!kolName || !contactEmail) {
      data = {
        needs_input: true,
        missing_fields: [!kolName ? "kolName" : "", !contactEmail ? "contactEmail" : ""].filter(Boolean),
      };
    } else {
      const listed = await invoke("pageKolProfiles", requestJson({ pageNo: 1, pageSize: 20, keyword: contactEmail }));
      const samePerson = (row: Json) => {
        const email = firstEmail(row.contactEmail || row.email || row.mailboxEmail);
        const name = firstString(row.kolName, row.nickname, row.name);
        return (email && email.toLowerCase() === contactEmail.toLowerCase()) || name === kolName;
      };
      let existing = rows(listed).find(samePerson);
      if (!existing) {
        const byName = await invoke("pageKolProfiles", requestJson({ pageNo: 1, pageSize: 20, keyword: kolName }));
        existing = rows(byName).find(samePerson);
      }
      data = existing
        ? { ok: true, duplicate: true, creator: existing, kolUid: kolUidOf(existing) }
        : await ingestCreatorNow(kolName, contactEmail);
    }
  } else if (task === "creator_profile") {
    let kolUid = kolUidOf(entities);
    if (!kolUid) {
      const keyword = profileKeyword(entities);
      if (!keyword) {
        data = { needs_input: true, missing_fields: ["kolUid"] };
      } else {
        const listed = await invoke("pageKolProfiles", requestJson({ pageNo: 1, pageSize: 20, keyword }));
        const matches = rows(listed);
        if (matches.length === 1) {
          kolUid = kolUidOf(matches[0], entities);
          if (!kolUid) {
            data = { needs_input: true, missing_fields: ["kolUid"], query: { keyword }, ...listed, list: matches };
          }
        } else {
          data = {
            needs_input: true,
            missing_fields: ["kolUid"],
            query: { keyword },
            ...listed,
            list: matches,
          };
        }
      }
    }
    if (kolUid && !data.needs_input) {
      const detail = await invoke("getKolProfileDetail", { kolUid });
      const platforms = await invokeOptional("listKolPlatformData", { kolUid });
      const conversations = await invokeOptional("pageEmailConversations", {
        pageNo: 1,
        pageSize: 10,
        kolUid,
        keyword: kolUid,
      });
      data = {
        ...detail,
        kolUid,
        platforms: rows(platforms),
        conversations: rows(conversations),
      };
    }
  } else if (task === "creator_library_all") {
    const listed = await invoke("listAllKolProfiles", {});
    data = { ...listed, list: rows(listed) };
  } else if (task === "email_app_conversation_list") {
    const keyword = searchKeyword(entities);
    const kolUid = kolUidOf(entities);
    const listed = await invoke("pageAppEmailConversations", {
      pageNo: Math.max(1, number(entities.pageNo, 1)),
      pageSize: Math.max(1, Math.min(50, number(entities.pageSize, 10))),
      ...(keyword ? { keyword } : {}),
      ...(kolUid ? { kolUid } : {}),
      ...(entities.status ? { status: String(entities.status) } : {}),
    });
    data = { ...listed, ...(keyword ? { keyword } : {}), ...(kolUid ? { kolUid } : {}) };
  } else if (task === "creator_owner_update" || task === "creator_status_update") {
    let kolUid = kolUidOf(entities);
    if (!kolUid) {
      const keyword = profileKeyword(entities);
      if (!keyword) {
        data = { needs_input: true, missing_fields: ["kolUid"] };
      } else {
        const listed = await invoke("pageKolProfiles", requestJson({ pageNo: 1, pageSize: 20, keyword }));
        const matches = rows(listed);
        if (matches.length === 1) kolUid = kolUidOf(matches[0], entities);
        else {
          data = { needs_input: true, missing_fields: ["kolUid"], ...listed, list: matches };
        }
      }
    }
    const owner = ownerValue(entities);
    const statusPatch = firstString(
      entities.status,
      entities.cooperationStageCode,
      entities.cooperationStageName,
      entities.stage,
      entities.confirmed,
      entities.notes,
      entities.wechat,
    ) || (entities.followStyleTags || entities.follow_style_tags ? "tags" : "");
    if (!data.needs_input && task === "creator_owner_update" && !owner) {
      data = { needs_input: true, missing_fields: ["owner"] };
    }
    if (!data.needs_input && task === "creator_status_update" && !statusPatch) {
      data = { needs_input: true, missing_fields: ["status/confirmed/notes/wechat"] };
    }
    if (kolUid && !data.needs_input) {
      const before = await invoke("getKolProfileDetail", { kolUid });
      const patch = profileUpdateRequest({ ...entities, kolUid }, before);
      const updated = await invoke("updateKolProfile", requestJson(patch));
      const after = await invokeOptional("getKolProfileDetail", { kolUid });
      data = {
        ...(Object.keys(after).length ? after : updated),
        kolUid,
        updated: true,
        patch,
        previous_owner: ownerBindingItems(before),
      };
    }
  } else if (task === "creator_contact_decrypt") {
    const kolUid = kolUidOf(entities);
    if (!kolUid) {
      data = { needs_input: true, missing_fields: ["kolUid"] };
    } else {
      data = await invoke("decryptKolContact", requestJson({
        kolUid,
        ...(entities.decryptRequest && typeof entities.decryptRequest === "object"
          ? entities.decryptRequest as Json
          : {}),
      }));
      data = { ...data, kolUid, decrypted: data.decrypted !== false };
    }
  } else if (task === "creator_lifecycle_kanban") {
    const listed = await invoke("pageLifecycleKanban", {
      pageNo: Math.max(1, number(entities.pageNo, 1)),
      pageSize: Math.max(1, Math.min(50, number(entities.pageSize, 20))),
    });
    data = { ...listed, list: rows(listed) };
  } else if (task === "creator_risk_conversations" || task === "risk_scan") {
    const listed = await invoke("pageRiskConversations", {
      pageNo: Math.max(1, number(entities.pageNo, 1)),
      pageSize: Math.max(1, Math.min(50, number(entities.pageSize, 10))),
      ...(entities.keyword ? { keyword: String(entities.keyword) } : {}),
      ...(kolUidOf(entities) ? { kolUid: kolUidOf(entities) } : {}),
    });
    const summary = await invokeOptional("summarizeRiskConversations", {});
    data = { ...listed, summary: summary.summary || listed.summary, list: rows(listed) };
    if (task === "risk_scan") {
      const overdue = (getConn()
        .prepare("SELECT handle, stage_code, days_in_stage, brand FROM collaborations WHERE overdue = 1")
        .all() as Array<{ handle: string; stage_code: string; days_in_stage: number; brand: string }>)
        .map((row) => ({
          ...row,
          stage_label: label(row.stage_code),
          days: row.days_in_stage,
        }));
      data = { ...data, overdue };
    }
  } else if (task === "creator_filter_options") {
    const parentKey = firstString(entities.parentKey, entities.parent_key) || "kol_primary_platform";
    const dictionary = await invoke("listDictionaryOptions", { parentKey });
    const stages = await invokeOptional("listCooperationStageOptions", {});
    const risks = await invokeOptional("listRiskTagOptions", {});
    const niches = parentKey === "kol_niche" ? {} : await invokeOptional("listDictionaryOptions", { parentKey: "kol_niche" });
    const styles = parentKey === "kol_follow_style" ? {} : await invokeOptional("listDictionaryOptions", { parentKey: "kol_follow_style" });
    data = {
      parentKey,
      dictionary: rows(dictionary),
      stages: rows(stages),
      risks: rows(risks),
      niches: rows(niches),
      styles: rows(styles),
      list: [...rows(dictionary), ...rows(stages), ...rows(risks), ...rows(niches), ...rows(styles)],
    };
  } else if (task === "reply_analysis") {
    const conversationId = number(entities.conversationId || entities.conversation_id);
    const keyword = searchKeyword(entities) || firstString(entities.handle, entities.name);
    let listed: Json = {};
    if (!conversationId) {
      listed = await invoke("pageEmailConversations", {
        pageNo: 1,
        pageSize: 10,
        ...(keyword ? { keyword } : {}),
      });
    }
    const listedRows = rows(listed);
    const id = conversationId || number(listedRows[0]?.id || listedRows[0]?.conversationId);
    if (!id) {
      data = {
        needs_input: true,
        missing_fields: ["conversationId"],
        ...listed,
        recommended_actions: keyword
          ? [`写合作邮件 ${firstEmail(keyword) || keyword}`, "邮件会话列表"]
          : ["邮件会话列表", "写合作邮件"],
      };
    } else {
      const conversation = await invoke("getEmailConversation", { conversationId: id });
      const subjectGroups = await invokeOptional("getEmailConversationSubjectGroups", { conversationId: id });
      const bodyText = conversationText(conversation);
      const translated = bodyText
        ? await invokeOptional("translateEmailToChinese", {
          text: bodyText,
          ...(conversation.subject ? { subject: conversation.subject } : {}),
        })
        : {};
      const stages = await invokeOptional("listCooperationStageOptions", {});
      const riskMatrix = await invokeOptional("getStageRiskMatrix", {});
      let profile: Json = {};
      const kolUid = kolUidOf(entities, conversation) || kolUidOf(listedRows[0] || {});
      if (kolUid) profile = await invokeOptional("getKolProfileDetail", { kolUid });
      const riskConversations = await invokeOptional("pageRiskConversations", {
        pageNo: 1,
        pageSize: 5,
        ...(kolUid ? { kolUid } : {}),
        ...(keyword ? { keyword } : {}),
      });
      const current = codeFromLabel(firstString(
        profile.cooperationStageCode,
        profile.cooperationStageName,
        conversation.stage,
        entities.stage,
      )) || "INITIAL_CONTACT";
      const summaryZh = firstString(translated.text, translated.zh, translated.translation) || bodyText;
      const evidenced = inferCompletedFromText(`${summaryZh}\n${bodyText}`, current);
      const exception = detectReplyException(profile, riskConversations, `${summaryZh}\n${bodyText}`);
      const { pointer: inferredPointer, completed } = evidencedPointer(current, evidenced);
      const pointer = exception ? null : inferredPointer;
      const checklist = stageChecklist(current, completed, {
        evidenced,
        exception: exception ? String(exception.label || exception.code) : null,
        pointer,
      });
      const recipient = firstEmail(conversation.recipientEmail || conversation.to || keyword);
      const handle = firstString(entities.handle, profile.kolName, profile.nickname);
      const local = handle
        ? getConn().prepare("SELECT * FROM collaborations WHERE handle=? OR display_name=?").get(handle, handle) as
          | { follow_style_tags?: unknown; handle?: string } | undefined
        : undefined;
      const currentTags = readFollowStyleTags(local || {});
      const suggestedTags = suggestFollowStyleTags(`${summaryZh}\n${bodyText}`, currentTags);
      const actions = replyAnalysisActions({ pointer, exception, recipient, handle, suggestedTags });
      data = {
        conversationId: id,
        conversation,
        subjectGroups,
        translation: translated,
        stages: rows(stages),
        risks: rows(riskMatrix),
        profile,
        kolUid,
        current_stage: current,
        pointer,
        pointer_label: pointer ? label(pointer) : "",
        exception,
        completed,
        evidenced,
        checklist,
        summary_zh: summaryZh,
        follow_style_tags: currentTags,
        suggested_follow_tags: suggestedTags,
        recommended_actions: actions,
      };
    }
  } else {
    const to = emails(entities.to || entities.email || entities.recipient);
    const mailboxEmail = firstEmail(entities.mailboxEmail || entities.from);
    const conversationId = number(entities.conversationId || entities.conversation_id);
    const subject = String(entities.subject || "").trim();
    const confirmSend = Boolean(entities.confirm_send || entities.confirmSend);
    const missingCompose = [
      !mailboxEmail && !conversationId ? "mailboxEmail" : "",
      !to.length && !conversationId ? "to" : "",
      !subject && !conversationId ? "subject" : "",
    ].filter(Boolean);
    const failFields = (message: string, mailboxAuthorized = false): string[] => {
      if (isOwnerMailboxAsContact(message)) return ["to"];
      if (isMissingMailboxOwner(message) || /发件箱|未指定发件/i.test(message)) {
        return mailboxAuthorized ? [] : ["mailboxEmail"];
      }
      if (isEmailTakenByOtherKol(message) || isMissingKolProfile(message)) return to.length ? [] : ["to"];
      return ["mailboxEmail", "to", "subject"];
    };
    if (missingCompose.length) {
      data = {
        needs_input: true,
        missing_fields: missingCompose,
        mailboxEmail,
        to,
        recipient: to[0] || "",
        subject,
        error: "首封必填发件邮箱、收件邮箱和邮件主题。往来记录会在三项齐全后由发信服务建立，不用先填会话编号。",
      };
    } else {
      let activeId = conversationId;
      let kolUid = String(entities.kolUid || entities.kol_uid || "").trim();
      let fromAddr = mailboxEmail;
      let useHostStarry = false;
      let profileOwner = "";
      let mailboxAuthorized = false;
      const actor = describeStarryActor();
      const failPayload = (error: string, mailboxAuthorized = false): Json => ({
        needs_input: true,
        missing_fields: failFields(error, mailboxAuthorized),
        error,
        mailboxEmail: fromAddr,
        mailbox_authorized: mailboxAuthorized,
        starry_actor: actor,
        ...(profileOwner ? { profile_owner: profileOwner } : {}),
        to,
        recipient: to[0],
        subject,
        ...(kolUid ? { kolUid } : {}),
      });
      if (!activeId) {
        try {
          const mailbox = await resolveBrandMailbox(entities, invoke);
          fromAddr = mailbox.mailboxEmail;
          const listed = rows(await invokeOptional("pageMailboxes", { pageNo: 1, pageSize: 50 }));
          const listedRow = listed.find((row) => sameMailbox(row, fromAddr));
          const owner = listedRow ? ownerFromMailboxRow(listedRow) : ownerFromBinding(fromAddr);
          mailboxAuthorized = Boolean(listedRow) || Boolean(owner.mailboxEmail);
          const createFailed = (result: Json) =>
            conversationMissingProfile(result)
            || isEmailTakenByOtherKol(resultError(result))
            || !number(result.conversationId || result.id);
          const createOnce = async (uid: string, host = useHostStarry, kolId = 0) => {
            const run = () => invoke("createEmailConversation", {
              requestJson: JSON.stringify(conversationCreateBody({
                mailboxEmail: fromAddr,
                recipientEmail: to[0],
                ...(kolId ? { kolId } : uid ? { kolUid: uid } : {}),
                subject,
              })),
            });
            try {
              return host ? await withStarryCallScope({ ignoreUser: true }, run) : await run();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (isMissingKolProfile(message) || isEmailTakenByOtherKol(message)) {
                return { error: message, needs_input: true };
              }
              throw error;
            }
          };
          const tryCreate = async (uid: string, kolId = 0) => {
            let next = await createOnce(uid, useHostStarry, kolId);
            if (createFailed(next) && !useHostStarry) {
              useHostStarry = true;
              next = await createOnce(uid, true, kolId);
            }
            return next;
          };
          const bindFollowedContact = async (uid: string) => {
            if (!uid || !to[0]) return;
            await invokeOptional("updateKolProfile", {
              requestJson: JSON.stringify({
                kolUid: uid,
                contactEmail: to[0],
                email: to[0],
              }),
            });
          };
          const reuseExisting = async (profile: Json): Promise<Json | undefined> => {
            const existingId = existingConversationId(profile);
            if (!existingId) return undefined;
            const conv = await invokeOptional("getEmailConversation", { conversationId: existingId });
            const convBox = firstEmail(conv.mailboxEmail || conv.operatorMailboxEmail);
            if (convBox && normalizeEmail(convBox) !== normalizeEmail(fromAddr)) return undefined;
            if (!number(conv.id || conv.conversationId || existingId)) return undefined;
            if (convBox || number(conv.id || conv.conversationId)) {
              return { conversationId: existingId, id: existingId, mailboxEmail: convBox || fromAddr };
            }
            return undefined;
          };
          const createFromHit = async (hit: { profile: Json; via: "user" | "host" }) => {
            kolUid = kolUidOf(hit.profile);
            const kolId = kolIdOf(hit.profile);
            profileOwner = firstString(hit.profile.ownerUserName, hit.profile.ownerName, hit.profile.owner);
            useHostStarry = hit.via === "host";
            const existing = await reuseExisting(hit.profile);
            if (existing) return existing;
            let next = await tryCreate(kolUid, kolId);
            if (createFailed(next) && (kolUid || kolId)) {
              await bindFollowedContact(kolUid);
              useHostStarry = hit.via === "host";
              next = await tryCreate(kolUid, kolId);
            }
            return next;
          };
          let created: Json = {};
          const addThenCreate = async () => {
            if (listed.length && !mailboxAuthorized) {
              throw Object.assign(new Error("负责人无可用邮箱"), { mailboxAuthorized: false });
            }
            try {
              const added = await invoke("addKolProfile", {
                requestJson: JSON.stringify(profileAddBody(
                  to[0],
                  entities.name ? String(entities.name) : undefined,
                  owner,
                )),
              });
              const addErr = resultError(added);
              kolUid = kolUidOf(added) || kolUidOf(profileFromTaken(added) || {}) || kolUid;
              if (addErr && !kolUid) throw Object.assign(new Error(addErr), { taken: added });
              if (!kolUid) {
                const found = await findProfileByContact(to[0], invokeOptional, fromAddr);
                if (found) return createFromHit(found);
              }
              const next = await createOnce(kolUid, useHostStarry, kolIdOf(added));
              if (conversationMissingProfile(next)) {
                throw new Error(resultError(next) || "红人画像不存在");
              }
              return next;
            } catch (inner) {
              const msg = inner instanceof Error ? inner.message : String(inner);
              const taken = profileFromTaken((inner as { taken?: unknown }).taken || inner);
              if (taken && kolUidOf(taken)) {
                const next = await createFromHit({ profile: taken, via: "user" });
                if (!conversationMissingProfile(next) && number(next.conversationId || next.id)) return next;
              }
              if (isEmailTakenByOtherKol(msg) || isMissingKolProfile(msg)) {
                const found = await findProfileByContact(to[0], invokeOptional, fromAddr);
                if (found) {
                  const next = await createFromHit(found);
                  if (!conversationMissingProfile(next) && number(next.conversationId || next.id)) return next;
                }
              }
              throw Object.assign(inner instanceof Error ? inner : new Error(String(inner)), { mailboxAuthorized });
            }
          };
          const found = await findProfileByContact(to[0], invokeOptional, fromAddr);
          if (found) {
            created = await createFromHit(found);
          } else if (kolUid) {
            created = await tryCreate(kolUid);
          } else {
            created = await createOnce("");
          }
          if (conversationMissingProfile(created) || isEmailTakenByOtherKol(resultError(created))) {
            created = await addThenCreate();
          }
          activeId = number(created.conversationId || created.id);
          if (!activeId || created.error || created.needs_input) {
            const error = String(created.error || created.text || "无法建立往来记录。");
            data = { ...failPayload(error, mailboxAuthorized), ...created };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const authorized = Boolean((error as { mailboxAuthorized?: boolean }).mailboxAuthorized);
          data = failPayload(message, authorized);
        }
      }
      if (activeId && !(data && data.needs_input)) {
        const finish = async () => {
          if (confirmSend) {
            let body = firstString(entities.body, entities.bodyText, entities.preview);
            if (!body) {
              const preview = await invoke("previewEmailDraft", {
                conversationId: activeId,
                requestJson: JSON.stringify({
                  to,
                  recipientEmail: to[0],
                  subject,
                  languageKey: "EN_US",
                  prompt: composePromptFromEntities(entities, "写一封简短的合作沟通邮件。"),
                }),
              });
              body = firstString(preview.bodyText, preview.body, preview.preview, preview.text, preview.content);
            }
            const sent = await invoke("sendEmailNow", {
              conversationId: activeId,
              requestJson: JSON.stringify({
                subject,
                content: body,
                ...(to[0] ? { recipientEmail: to[0] } : {}),
              }),
            });
            const receipt = mailSendReceipt(sent);
            return {
              ...sent,
              sent: receipt.sent,
              receipt_status: receipt.receipt_status,
              remote_id: receipt.remote_id,
              conversationId: activeId,
              mailboxEmail: fromAddr,
              to,
              subject,
              ...(body ? { body, bodyText: body } : {}),
              ...(receipt.sent
                ? { needs_input: false, error: "", missing_fields: [] }
                : { error: "供应商未返回成功回执，邮件未记为已发送。", needs_input: true }),
            };
          }
          const givenBody = firstString(entities.body, entities.bodyText, entities.preview);
          if (givenBody) {
            return {
              conversationId: activeId,
              sent: false,
              mailboxEmail: fromAddr,
              to,
              subject,
              body: givenBody,
              bodyText: givenBody,
            };
          }
          const preview = await invoke("previewEmailDraft", {
            conversationId: activeId,
            requestJson: JSON.stringify({
              to,
              recipientEmail: to[0],
              subject,
              languageKey: "EN_US",
              prompt: composePromptFromEntities(entities, "写一封简短的合作沟通邮件，先不要发送。"),
            }),
          });
          const body = firstString(preview.bodyText, preview.body, preview.preview, preview.text);
          return {
            ...preview,
            conversationId: activeId,
            sent: false,
            mailboxEmail: fromAddr,
            to,
            subject,
            ...(body ? { body, bodyText: body } : {}),
          };
        };
        data = useHostStarry ? await withStarryCallScope({ ignoreUser: true }, finish) : await finish();
      }
    }
  }

  audit(actor, `starrykol.${task}`, {
    task,
    operations: operations.map((item) => item.name),
    sent: Boolean(data.sent),
    write: ["email_compose", "creator_library_sync", "creator_owner_update", "creator_status_update", "creator_contact_decrypt"].includes(task),
    decrypted: Boolean(data.decrypted),
  });
  return { data, operations };
}

export const executeEmailMcpTask = executeStarryKolTask;
