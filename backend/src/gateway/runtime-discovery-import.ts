import { buildCrawlerImportFile, candidateContactEmail, creatorExternalId, isRealKolUid, mapCandidateToCrawlerRow, withKolUid } from "../discovery-import.js";
import { HttpFail } from "../host/errors.js";
import { starryBindingRow } from "../host/starry-bind.js";
import { resolveStarryOwnerForMailbox } from "../starrykol/service.js";
import { addKolProfileConfirmed, findExistingKolUid, importKolProfilesFromCrawlerConfirmed } from "./import-creator.js";
import type { Json } from "../types.js";

export type RuntimeImportCheckpoint = { phase: "preflight" | "add_uncertain" | "profile_ready"; kol_uid?: string };
/** Shared confirmed runtime import. No invented contact or success; checkpoint survives partial writes. */
export async function importRuntimeCandidateProfile(input: {
  candidate: Json; actorId: string; sourceBatch: string;
  knownKolUid?: string; addUncertain?: boolean;
  authorizeCreate: () => void | Promise<void>;
  authorizeImport?: () => void | Promise<void>;
  checkpoint: (value: RuntimeImportCheckpoint) => Promise<void>;
}): Promise<Json> {
  const row = input.candidate;
  const candidateId = String(row.id);
  const externalId = creatorExternalId(row.platform, candidateId);
  const crawlerRow = mapCandidateToCrawlerRow({ ...row, platform_creator_id: candidateId,
    nickname: row.name, profile_url: row.source_url });
  let kolUid = isRealKolUid(input.knownKolUid) ? String(input.knownKolUid) : "";
  if (!kolUid && !input.addUncertain) await input.checkpoint({ phase: "preflight" });
  if (!kolUid) {
    // Lookup failures/ambiguous matches must not be interpreted as permission to add again.
    const found = await findExistingKolUid({ account: crawlerRow.account, keyword: crawlerRow.account,
      platform: String(row.platform).toLowerCase(), profileUrl: crawlerRow.profile_url },
    { actor: input.actorId, strict: true });
    if (found) kolUid = found.kol_uid;
    else if (input.addUncertain) {
      throw new HttpFail(502, { code: "import_creator_uncertain",
        message: "上次建档结果仍不确定，未核对到正式编号；请人工核对 Starry，未重复建档。" });
    } else {
      const contactEmail = candidateContactEmail({ ...row, contact_email: row.contact_email || row.contactEmail });
      if (!contactEmail) throw new HttpFail(409, { code: "import_creator_no_contact_email",
        message: "该候选缺少真实联系邮箱，无法新建 Starry 档案；未加入公海。已有跟进关系保留。" });
      const binding = starryBindingRow(input.actorId);
      const owner = await resolveStarryOwnerForMailbox({ mailboxId: binding?.mailbox_id,
        mailboxEmail: binding?.mailbox_email, ownerName: binding?.owner_name });
      if (!/^\d+$/.test(String(owner.ownerOpenId || "").trim())) throw new HttpFail(409, {
        code: "import_creator_no_owner_open_id", message: "未取得当前员工的 Starry 负责人 openId，未新建档案。" });
      await input.authorizeCreate();
      // Set before dispatch: if the process dies or add times out, retry only reconciles.
      await input.checkpoint({ phase: "add_uncertain" });
      const created = await addKolProfileConfirmed({ kolName: String(row.name || candidateId), contactEmail,
        dataSource: "CRAWLER", owner, sourceBatch: input.sourceBatch, creatorExternalId: externalId,
        candidateId, actor: input.actorId });
      kolUid = String(created.kol_uid || "");
    }
    if (!isRealKolUid(kolUid)) throw new HttpFail(502, {
      code: "import_creator_no_kol_uid", message: "Starry 未确认正式红人编号，未提交平台资料。" });
    // Do not adopt local ownership until enrichment finishes; preserve only the verified remote UID.
    await input.checkpoint({ phase: "profile_ready", kol_uid: kolUid });
  }
  const file = buildCrawlerImportFile([withKolUid(crawlerRow, kolUid)], `runtime-discovery-${candidateId.slice(0, 24)}.csv`);
  await input.authorizeImport?.();
  return importKolProfilesFromCrawlerConfirmed({ file, sourceBatch: input.sourceBatch, actor: input.actorId,
    creatorExternalId: externalId, candidateId, knownKolUid: kolUid, lookupKeyword: crawlerRow.account });
}
