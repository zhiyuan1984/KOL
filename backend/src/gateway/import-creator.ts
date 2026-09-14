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
};

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
  try {
    data = await callStarryKolTool(IMPORT_CREATOR_TOOL, {
      fileName: input.file.fileName,
      fileBase64: input.file.fileBase64,
    });
  } catch (error) {
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
    data,
  };
}
