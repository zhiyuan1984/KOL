import { starryKolMcpConfigured } from "../starrykol/connection.js";
/**
 * Gateway：import_creator（ADR-022 / policies/import_creator.yaml）。
 * 人确认后由 Host 调 starrykol.importKolProfilesFromCrawler。
 * Worker / Skill 禁止调这个函数。禁止 sendEmailNow / changeLifecycleStage / decryptKolContact。
 */
import {
  codexMode,
  liveRemoteSideEffectsEnabled,
} from "../config.js";
import { audit } from "../db.js";
import { sanitizeSecret } from "../discovery-errors.js";
import {
  employeeImportError,
  FORBIDDEN_FOLLOW_TOOLS,
  IMPORT_CREATOR_POLICY,
  IMPORT_CREATOR_TOOL,
  isRealKolUid,
  parseImportedKolUid,
  type CrawlerImportFile,
} from "../discovery-import.js";
import { HttpFail } from "../host/errors.js";
import { callStarryKolTool } from "../starrykol/service.js";
import type { Json } from "../types.js";

export type ImportCreatorInput = {
  file: CrawlerImportFile;
  sourceBatch: string;
  creatorExternalId: string;
  candidateId?: string;
  actor?: string;
  lookupKeyword?: string;
  /**
   * 两段式入库的第二步：uid 已由 `addKolProfileConfirmed` 拿到，Starry 的
   * 更新回包只给 totalCount/updatedCount 这类计数，不一定回传 kolUid。
   */
  knownKolUid?: string;
};

export type AddKolProfileInput = {
  kolName: string;  contactEmail: string;
  dataSource?: string;
  /** 负责人字段（ownerOpenId 必填）：`resolveStarryOwnerForMailbox` 的结果。 */
  owner: Json;
  sourceBatch: string;
  creatorExternalId: string;
  candidateId?: string;
  actor?: string;
};

export const ADD_KOL_PROFILE_TOOL = "addKolProfile";

/**
 * Starry MCP 调用的硬上限：底层 managed client 没有超时，无限挂起会被
 * nginx 60s 掐断（504）。超时后走既有的 isStarryTimeout 兜底路径
 *（pageKolProfiles 核对），返回真实状态，不伪造完成。
 */
const STARRY_IMPORT_TIMEOUT_MS = 120_000;
// 总预算覆盖 keyword(20s) + listAll(60s)，不让快速查询吃掉全量核对预算。
const STARRY_LOOKUP_TIMEOUT_MS = 100_000;
const STARRY_KEYWORD_LOOKUP_MS = 20_000;
const STARRY_LISTALL_LOOKUP_MS = 60_000;

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} request timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const CONTACT_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Starry 列表行的字段名（见 `PROFILE_LIST_WHITELIST`）。 */
const PROFILE_URL_KEYS = [
  "profileUrl", "profile_url", "homepageUrl", "homepage_url", "homepage", "channelUrl", "channel_url",
] as const;
const PROFILE_PLATFORM_KEYS = [
  "primaryPlatform", "primary_platform", "platform", "platformName", "platformCode",
] as const;
const PROFILE_HANDLE_KEYS = ["accountHandle", "account_handle", "account", "handle", "username"] as const;

export type KolLookupTarget = {
  /** 候选的「平台账号」（`mapCandidateToCrawlerRow().account`），也是 keyword 查询词。 */
  keyword?: string;
  account?: string;
  /** 小写平台代码。 */
  platform?: string;
  /** 候选主页 / 频道链接（`profileUrlOf()` 或 `youtubeChannelUrlOf()`）。 */
  profileUrl?: string;
};

export type ExistingKolProfile = {
  kol_uid: string;
  via: "keyword" | "list_all";
  profile: Json;
};

export function isStarryTimeout(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /timeout|etimedout|aborted|und_err_connect_timeout|request timed? ?out/i.test(text);
}

function asObject(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  return {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function listOf(data: Json): Json[] {
  const nested = [data.list, data.records, asObject(data.data).list, asObject(data.data).records];
  for (const value of nested) {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object") as Json[];
  }
  return [];
}

/**
 * 主页链接比较前先归一：去协议、去 www、去 query/hash、去尾斜杠。
 * `https://www.youtube.com/@x/` 与 `youtube.com/@x` 是同一个频道。
 */
function normalizeProfileUrl(value: unknown): string {
  return String(value || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function sameText(a: string, b: string): boolean {
  return Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function realKolUidOf(row: Json): string {
  const uid = firstString(row.kolUid, row.kol_uid, row.uid);
  return isRealKolUid(uid) ? uid : "";
}

/**
 * 只按可复核的标识匹配：主页链接，或「平台 + 平台账号」。
 * 不拿昵称/粉丝数之类的软信号去认人 —— 认错人会把别人的档案当成自己的。
 */
function profileRowMatches(row: Json, target: KolLookupTarget): boolean {
  const wantUrl = normalizeProfileUrl(target.profileUrl);
  if (wantUrl && PROFILE_URL_KEYS.some((key) => normalizeProfileUrl(row[key]) === wantUrl)) return true;
  const handle = firstString(...PROFILE_HANDLE_KEYS.map((key) => row[key]));
  if (!handle) return false;
  const wantPlatform = String(target.platform || "").trim().toLowerCase();
  const rowPlatform = firstString(...PROFILE_PLATFORM_KEYS.map((key) => row[key])).trim().toLowerCase();
  if (wantPlatform && rowPlatform && rowPlatform !== wantPlatform) return false;
  const want = firstString(target.account, target.keyword);
  return Boolean(want) && sameText(handle, want);
}

/** 多命中就是不认识：返回 undefined，让调用方按「没找到」处理。 */
function pickProfileRow(list: Json[], target: KolLookupTarget): Json | undefined {
  const hits = list.filter((row) => realKolUidOf(row) && profileRowMatches(row, target));
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * 查询失败不阻塞入库：记为「没找到」，流程退回到原来的「直接 add」。
 * 命中多条时 `pickProfileRow` 已经按同一个口径拒绝，不猜。
 */
async function safeStarryList(tool: string, args: Json, actor: string): Promise<Json> {
  try {
    return await callStarryKolTool(tool, args);
  } catch (error) {
    audit(actor, "host.find_existing_kol_uid.failed", {
      tool,
      reason: isStarryTimeout(error) ? "timeout" : "failed",
      retried: false,
    });
    return {};
  }
}

/**
 * 入库前「找回已建档的 uid」。两段式第一步 add 成功、第二步 import 失败会留下
 * 「Starry 有档案、本地无回执」的孤儿；重试时再 add 会撞 Starry 的
 * 「联系邮箱已被其他红人占用」，于是永远补不回来。
 *
 * 顺序：先 `pageKolProfiles`（keyword），拿不到再 `listAllKolProfiles` 兜底 ——
 * Starry 的 keyword 查询对**刚新建**的档案查不到（`getKolProfileDetail` 也查不到），
 * 但 listAll 能看到。只在拿到真实编号（`KOL…`，非 `disc_`）时才复用。
 */
export async function findExistingKolUid(
  target: KolLookupTarget,
  opts: { actor?: string } = {},
): Promise<ExistingKolProfile | null> {
  const actor = opts.actor || "host";
  const keyword = firstString(target.keyword, target.account);
  if (keyword) {
    const listed = await safeStarryList("pageKolProfiles", {
      requestJson: JSON.stringify({ pageNo: 1, pageSize: 20, keyword }),
    }, actor);
    const hit = pickProfileRow(listOf(asObject(listed)), target);
    if (hit) return { kol_uid: realKolUidOf(hit), via: "keyword", profile: hit };
  }
  const all = await safeStarryList("listAllKolProfiles", {}, actor);
  const hit = pickProfileRow(listOf(asObject(all)), target);
  return hit ? { kol_uid: realKolUidOf(hit), via: "list_all", profile: hit } : null;
}

/** Timeout / uncertain path: query Starry first. Never blindly retry import. */
export async function lookupImportedKolUid(input: {
  keyword?: string;
  creatorExternalId?: string;
}): Promise<string> {
  const keyword = firstString(input.keyword, String(input.creatorExternalId || "").split(":").pop());
  if (!keyword) return "";
  const listed = await callStarryKolTool("pageKolProfiles", {
    requestJson: JSON.stringify({ pageNo: 1, pageSize: 20, keyword }),
  }, { timeoutMs: STARRY_KEYWORD_LOOKUP_MS });
  const platform = String(input.creatorExternalId || "").split(":")[0];
  const target = { account: keyword, platform: platform || undefined };
  const provenPlatform = (item: Json) => !platform || PROFILE_PLATFORM_KEYS.some(key => String(item[key] || "").trim().toLowerCase() === platform.toLowerCase());
  const hit = pickProfileRow(listOf(asObject(listed)).filter(provenPlatform), target);
  if (hit) return realKolUidOf(hit);
  // Starry 对刚新建的档案 keyword 查不到，但 listAll 能看到：兜底扫全量，
  // 否则会把"已入库"误判为"未入库"，删行重派发后撞上达人库的重复拒绝。
  const all = await callStarryKolTool("listAllKolProfiles", {}, { timeoutMs: STARRY_LISTALL_LOOKUP_MS });
  const allHit = pickProfileRow(listOf(asObject(all)).filter(provenPlatform), target);
  return allHit ? realKolUidOf(allHit) : "";
}

export async function importKolProfilesFromCrawlerConfirmed(input: ImportCreatorInput): Promise<Json> {
  const { rejectDiscoveryHarnessTool } = await import("./discovery-harness.js");
  rejectDiscoveryHarnessTool("importKolProfilesFromCrawler");
  const actor = input.actor || "host";
  if (codexMode() !== "stub") {
    if (!liveRemoteSideEffectsEnabled() || !starryKolMcpConfigured()) {
      throw new HttpFail(409, {
        code: "import_creator_live_disabled",
        message: "当前未开启主档写入，无法加入跟进。",
        policy: IMPORT_CREATOR_POLICY,
      });
    }
  }
  if (!input.file.fileName || !input.file.fileBase64) {
    throw new HttpFail(400, { code: "import_file_required", message: "写入红人档案缺少导入文件。" });
  }
  if (/contactEmail|联系邮箱/i.test(input.file.csv)) {
    throw new HttpFail(500, { code: "fabricated_contact_email", message: "写入红人档案失败，未加入跟进。" });
  }
  let data: Json;
  let lookedUpAfterTimeout = false;
  try {
    data = await withTimeout(
      callStarryKolTool(IMPORT_CREATOR_TOOL, {
        fileName: input.file.fileName,
        fileBase64: input.file.fileBase64,
      }, { timeoutMs: STARRY_IMPORT_TIMEOUT_MS }),
      STARRY_IMPORT_TIMEOUT_MS,
      "importKolProfilesFromCrawler",
    );
  } catch (error) {
    if (isStarryTimeout(error)) {
      audit(actor, "host.import_creator.timeout_lookup", {
        policy: IMPORT_CREATOR_POLICY,
        tool: "pageKolProfiles",
        source_batch: input.sourceBatch,
        creator_external_id: input.creatorExternalId,
        candidate_id: input.candidateId || null,
        retried_import: false,
        error_detail: sanitizeSecret(error),
      });
      try {
        const found = await withTimeout(
          lookupImportedKolUid({
            keyword: input.lookupKeyword,
            creatorExternalId: input.creatorExternalId,
          }),
          STARRY_LOOKUP_TIMEOUT_MS,
          "pageKolProfiles",
        );
        if (isRealKolUid(found)) {
          lookedUpAfterTimeout = true;
          data = { kolUid: found, looked_up_after_timeout: true, retried: false };
        } else {
          throw new HttpFail(502, {
            code: "import_creator_uncertain",
            message: "写入超时且未能在达人库核对到档案，未盲目重试。",
            policy: IMPORT_CREATOR_POLICY,
            retried: false,
            looked_up: true,
          });
        }
      } catch (lookupError) {
        audit(actor, "host.import_creator.failed", {
          policy: IMPORT_CREATOR_POLICY, tool: "pageKolProfiles/listAllKolProfiles",
          source_batch: input.sourceBatch, creator_external_id: input.creatorExternalId,
          candidate_id: input.candidateId || null, error_detail: sanitizeSecret(lookupError), retried_import: false,
        });
        if (lookupError instanceof HttpFail) throw lookupError;
        throw new HttpFail(502, {
          code: "import_creator_uncertain",
          message: "写入超时且核对失败，未盲目重试。",
          policy: IMPORT_CREATOR_POLICY,
          retried: false,
          looked_up: true,
        });
      }
    } else {
      audit(actor, "host.import_creator.failed", {
        policy: IMPORT_CREATOR_POLICY,
        tool: IMPORT_CREATOR_TOOL,
        source_batch: input.sourceBatch,
        creator_external_id: input.creatorExternalId,
        candidate_id: input.candidateId || null,
        sent: false,
        stage_changed: false,
        decrypted: false,
        // 脱敏后的远端真实错误：用户文案走白名单兜底时，这里保留可查的真实原因。
        error_detail: sanitizeSecret(error),
      });
      throw new HttpFail(502, {
        code: "import_creator_failed",
        message: employeeImportError(error),
        policy: IMPORT_CREATOR_POLICY,
      });
    }
  }
  const echoed = parseImportedKolUid(data);
  // 更新回包（totalCount/updatedCount…）不带 uid 时，用第一步 addKolProfile 拿到的 uid；
  // 仍然拿不到就诚实失败，不编造编号。
  const kolUid = isRealKolUid(echoed)
    ? echoed
    : (isRealKolUid(input.knownKolUid) ? String(input.knownKolUid).trim() : "");
  if (!isRealKolUid(kolUid)) {
    audit(actor, "host.import_creator.failed", {
      policy: IMPORT_CREATOR_POLICY,
      tool: IMPORT_CREATOR_TOOL,
      source_batch: input.sourceBatch,
      creator_external_id: input.creatorExternalId,
      candidate_id: input.candidateId || null,
      reason: "missing_kol_uid",
      sent: false,
      stage_changed: false,
    });
    throw new HttpFail(502, {
      code: "import_creator_no_kol_uid",
      message: "档案未回传红人编号，未加入跟进。",
      policy: IMPORT_CREATOR_POLICY,
    });
  }
  audit(actor, "host.import_creator", {
    policy: IMPORT_CREATOR_POLICY,
    tool: IMPORT_CREATOR_TOOL,
    source_batch: input.sourceBatch,
    creator_external_id: input.creatorExternalId,
    candidate_id: input.candidateId || null,
    kol_uid: kolUid,
    sent: false,
    stage_changed: false,
    decrypted: false,
    forbidden_tools: FORBIDDEN_FOLLOW_TOOLS,
  });
  return {
    ok: true,
    kol_uid: kolUid,
    source_batch: input.sourceBatch,
    creator_external_id: input.creatorExternalId,
    tool: IMPORT_CREATOR_TOOL,
    policy: IMPORT_CREATOR_POLICY,
    sent: false,
    stage_changed: false,
    looked_up_after_timeout: lookedUpAfterTimeout,
    retried: false,
    data,
  };
}

/**
 * 两段式入库的第一步：`addKolProfile` 建档并拿回 kolUid，第二步再用这个 uid
 * 走 `importKolProfilesFromCrawler` 补频道链接/名称/平台/平台账号。
 * contactEmail 必须是候选的真实邮箱；拿不到就诚实失败，绝不拿负责人邮箱顶。
 */
export async function addKolProfileConfirmed(input: AddKolProfileInput): Promise<Json> {
  const { rejectDiscoveryHarnessTool } = await import("./discovery-harness.js");
  rejectDiscoveryHarnessTool(ADD_KOL_PROFILE_TOOL);
  const actor = input.actor || "host";
  if (codexMode() !== "stub") {
    if (!liveRemoteSideEffectsEnabled() || !starryKolMcpConfigured()) {
      throw new HttpFail(409, {
        code: "import_creator_live_disabled",
        message: "当前未开启主档写入，无法加入跟进。",
        policy: IMPORT_CREATOR_POLICY,
      });
    }
  }
  const kolName = String(input.kolName || "").trim();
  if (!kolName) {
    throw new HttpFail(409, { code: "import_creator_no_kol_name", message: "该线索没有红人名称，未入库。" });
  }
  const contactEmail = String(input.contactEmail || "").trim();
  if (!CONTACT_EMAIL_RE.test(contactEmail)) {
    throw new HttpFail(409, {
      code: "import_creator_no_contact_email",
      message: "该线索没有联系邮箱，未入库。",
      policy: IMPORT_CREATOR_POLICY,
    });
  }
  // 线上只给 ownerUserName 会报「负责人无可用邮箱」，ownerOpenId 必须是数字。
  const ownerOpenId = String(input.owner?.ownerOpenId || "").trim();
  if (!/^\d+$/.test(ownerOpenId)) {
    throw new HttpFail(409, {
      code: "import_creator_no_owner_open_id",
      message: "未取得 Starry 负责人 openId，未入库。",
      policy: IMPORT_CREATOR_POLICY,
    });
  }
  const body: Json = {
    kolName,
    contactEmail,
    dataSource: String(input.dataSource || "CRAWLER"),
    ...input.owner,
  };
  let data: Json;
  try {
    data = await withTimeout(
      callStarryKolTool(ADD_KOL_PROFILE_TOOL, {
        requestJson: JSON.stringify(body),
      }, { timeoutMs: STARRY_IMPORT_TIMEOUT_MS }),
      STARRY_IMPORT_TIMEOUT_MS,
      "addKolProfile",
    );
  } catch (error) {
    const reason = isStarryTimeout(error) ? "timeout" : "failed";
    audit(actor, "host.add_kol_profile.failed", {
      policy: IMPORT_CREATOR_POLICY,
      tool: ADD_KOL_PROFILE_TOOL,
      source_batch: input.sourceBatch,
      creator_external_id: input.creatorExternalId,
      candidate_id: input.candidateId || null,
      reason,
      retried: false,
      sent: false,
      stage_changed: false,
      error_detail: sanitizeSecret(error),
    });
    if (isStarryTimeout(error)) {
      throw new HttpFail(502, {
        code: "import_creator_uncertain",
        message: "建档超时且未确认是否写入，未盲目重试。",
        policy: IMPORT_CREATOR_POLICY,
        retried: false,
      });
    }
    throw new HttpFail(502, {
      code: "import_creator_failed",
      message: employeeImportError(error),
      policy: IMPORT_CREATOR_POLICY,
    });
  }
  const kolUid = parseImportedKolUid(data);
  if (!isRealKolUid(kolUid)) {
    audit(actor, "host.add_kol_profile.failed", {
      policy: IMPORT_CREATOR_POLICY,
      tool: ADD_KOL_PROFILE_TOOL,
      source_batch: input.sourceBatch,
      creator_external_id: input.creatorExternalId,
      candidate_id: input.candidateId || null,
      reason: "missing_kol_uid",
      sent: false,
      stage_changed: false,
    });
    throw new HttpFail(502, {
      code: "import_creator_no_kol_uid",
      message: "档案未回传红人编号，未加入跟进。",
      policy: IMPORT_CREATOR_POLICY,
    });
  }
  audit(actor, "host.add_kol_profile", {
    policy: IMPORT_CREATOR_POLICY,
    tool: ADD_KOL_PROFILE_TOOL,
    source_batch: input.sourceBatch,
    creator_external_id: input.creatorExternalId,
    candidate_id: input.candidateId || null,
    kol_uid: kolUid,
    owner_open_id: ownerOpenId,
    mailbox_email: String(input.owner?.mailboxEmail || ""),
    sent: false,
    stage_changed: false,
    decrypted: false,
    forbidden_tools: FORBIDDEN_FOLLOW_TOOLS,
  });
  return {
    ok: true,
    created: true,
    kol_uid: kolUid,
    source_batch: input.sourceBatch,
    creator_external_id: input.creatorExternalId,
    tool: ADD_KOL_PROFILE_TOOL,
    policy: IMPORT_CREATOR_POLICY,
    sent: false,
    stage_changed: false,
    data,
  };
}
