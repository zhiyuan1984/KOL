/**
 * Gateway：import_creator（ADR-022 / policies/import_creator.yaml）。
 * 人确认后由 Host 调 starrykol.importKolProfilesFromCrawler。
 * Worker / Skill 禁止调这个函数。禁止 sendEmailNow / changeLifecycleStage / decryptKolContact。
 */
import {
  codexMode,
  liveRemoteSideEffectsEnabled,
  starryKolMcpConfigured,
} from "../config.js";
import { audit } from "../db.js";
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

/** Timeout / uncertain path: query Starry first. Never blindly retry import. */
export async function lookupImportedKolUid(input: {
  keyword?: string;
  creatorExternalId?: string;
}): Promise<string> {
  const keyword = firstString(input.keyword, String(input.creatorExternalId || "").split(":").pop());
  if (!keyword) return "";
  const listed = await callStarryKolTool("pageKolProfiles", {
    requestJson: JSON.stringify({ pageNo: 1, pageSize: 20, keyword }),
  });
  const fromList = parseImportedKolUid(listed);
  if (isRealKolUid(fromList)) return fromList;
  for (const row of listOf(asObject(listed))) {
    const uid = firstString(row.kolUid, row.kol_uid, row.uid);
    const handle = firstString(row.kolName, row.nickname, row.handle, row.account);
    if (handle && keyword && handle.toLowerCase() === keyword.toLowerCase() && isRealKolUid(uid)) {
      return uid;
    }
    if (isRealKolUid(uid) && keyword && String(uid).toLowerCase().includes(keyword.toLowerCase())) {
      return uid;
    }
  }
  return parseImportedKolUid(listed);
}

export async function importKolProfilesFromCrawlerConfirmed(input: ImportCreatorInput): Promise<Json> {
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
    data = await callStarryKolTool(IMPORT_CREATOR_TOOL, {
      fileName: input.file.fileName,
      fileBase64: input.file.fileBase64,
    });
  } catch (error) {
    if (isStarryTimeout(error)) {
      audit(actor, "host.import_creator.timeout_lookup", {
        policy: IMPORT_CREATOR_POLICY,
        tool: "pageKolProfiles",
        source_batch: input.sourceBatch,
        creator_external_id: input.creatorExternalId,
        candidate_id: input.candidateId || null,
        retried_import: false,
      });
      try {
        const found = await lookupImportedKolUid({
          keyword: input.lookupKeyword,
          creatorExternalId: input.creatorExternalId,
        });
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
      });
      throw new HttpFail(502, {
        code: "import_creator_failed",
        message: employeeImportError(error),
        policy: IMPORT_CREATOR_POLICY,
      });
    }
  }
  const kolUid = parseImportedKolUid(data);
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
