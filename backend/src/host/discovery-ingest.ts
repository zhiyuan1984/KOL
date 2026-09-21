/**
 * Host Gateway: POST /api/home/discovery/ingest
 * L3 confirm → addKolProfile（建档拿 kolUid）→ importKolProfilesFromCrawler（补平台字段）
 * → A.pool_status=open。Does not write B.active, Collaboration-as-follow, mail, or stage.
 */
import { importCreatorOrgApprovalRequired } from "../approval/import-creator.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import {
  buildCrawlerImportFile,
  candidateContactEmail,
  candidateHasContactEmail,
  crawlerFileContainsContactEmail,
  IMPORT_CREATOR_POLICY,
  mapCandidateToCrawlerRow,
  profileUrlOf,
  requireStableExternalId,
  withKolUid,
} from "../discovery-import.js";
import {
  addKolProfileConfirmed,
  findExistingKolUid,
  importKolProfilesFromCrawlerConfirmed,
} from "../gateway/import-creator.js";
import { nid } from "../ids.js";
import { resolveStarryOwnerForMailbox } from "../starrykol/service.js";
import type { Json, Row } from "../types.js";
import { recordDiscoveryFact } from "./discovery-facts.js";
import { HttpFail } from "./errors.js";
import {
  ingestFormalProfile,
  memoryCompanyId,
  publicProfileFields,
  trimPrivate,
  upsertPublicProfile,
} from "./kol-memory.js";
import { starryBindingRow } from "./starry-bind.js";

export const DISCOVERY_INGEST_ENTRY = {
  entry: "command",
  kind: "command",
  creates_session: false,
  calls_model: false,
  risk: "L3",
} as const;

function actorId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

function parseJson(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function asIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return [];
}

function runRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin() && !authDisabled() && String(row.owner_user_id) !== actorId())) {
    throw new HttpFail(404, { code: "discovery_run_not_found", message: "未找到该发现运行" });
  }
  return row;
}

export function briefVersionOf(run: Row): number {
  const fromColumn = Number(run.brief_version);
  if (Number.isFinite(fromColumn) && fromColumn > 0) return fromColumn;
  const params = parseJson(run.parameters);
  const fromParams = Number(params.brief_version);
  if (Number.isFinite(fromParams) && fromParams > 0) return fromParams;
  const request = getConn().prepare("SELECT brief_version, data_version FROM discovery_requests WHERE id=?").get(run.request_id) as
    | Row
    | undefined;
  const fromRequest = Number(request?.brief_version || request?.data_version || 1);
  return Number.isFinite(fromRequest) && fromRequest > 0 ? fromRequest : 1;
}

function expectedBriefVersion(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new HttpFail(400, {
      code: "expected_brief_version_required",
      message: "需要 expected_brief_version。",
    });
  }
  return n;
}

function loadCandidates(runId: string, ids: string[]): Row[] {
  if (!ids.length) {
    throw new HttpFail(400, { code: "candidate_ids_required", message: "请选择要入库的线索。" });
  }
  const rows: Row[] = [];
  for (const id of ids) {
    const row = getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(id) as Row | undefined;
    if (!row || String(row.run_id) !== runId) {
      throw new HttpFail(404, { code: "creator_candidate_not_found", message: "未找到该发现候选人", candidate_id: id });
    }
    if (!isAdmin() && !authDisabled() && String(row.owner_user_id) !== actorId()) {
      throw new HttpFail(404, { code: "creator_candidate_not_found", message: "未找到该发现候选人", candidate_id: id });
    }
    rows.push(row);
  }
  return rows;
}

function findReceipt(input: {
  company_id: string;
  source_batch: string;
  platform: string;
  platform_creator_id: string;
}): Row | undefined {
  return getConn().prepare(
    `SELECT * FROM discovery_ingest_receipts
      WHERE company_id=? AND source_batch=? AND platform=? AND platform_creator_id=?`,
  ).get(input.company_id, input.source_batch, input.platform, input.platform_creator_id) as Row | undefined;
}

function writeReceipt(input: {
  company_id: string;
  source_batch: string;
  platform: string;
  platform_creator_id: string;
  kol_uid: string;
  candidate_id: string;
  run_id: string;
  status?: string;
}): void {
  getConn().prepare(
    `INSERT INTO discovery_ingest_receipts
     (id,company_id,source_batch,platform,platform_creator_id,kol_uid,candidate_id,run_id,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(company_id, source_batch, platform, platform_creator_id) DO NOTHING`,
  ).run(
    nid("dir"),
    input.company_id,
    input.source_batch,
    input.platform,
    input.platform_creator_id,
    input.kol_uid,
    input.candidate_id,
    input.run_id,
    input.status || "imported",
    nowIso(),
  );
}

function latestConfirm(runId: string, sourceBatch: string): Row | undefined {
  return getConn().prepare(
    `SELECT * FROM discovery_ingest_confirms
      WHERE run_id=? AND source_batch=?
      ORDER BY created_at DESC LIMIT 1`,
  ).get(runId, sourceBatch) as Row | undefined;
}

function writeConfirm(input: {
  run_id: string;
  source_batch: string;
  expected_brief_version: number;
  candidate_ids: string[];
  status: string;
}): Row {
  const now = nowIso();
  const id = nid("dic");
  getConn().prepare(
    `INSERT INTO discovery_ingest_confirms
     (id,company_id,run_id,source_batch,expected_brief_version,candidate_ids,status,actor_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    memoryCompanyId(),
    input.run_id,
    input.source_batch,
    input.expected_brief_version,
    JSON.stringify(input.candidate_ids),
    input.status,
    actorId(),
    now,
    now,
  );
  return getConn().prepare("SELECT * FROM discovery_ingest_confirms WHERE id=?").get(id) as Row;
}

function voidConfirms(runId: string, sourceBatch: string, reason: string): void {
  getConn().prepare(
    `UPDATE discovery_ingest_confirms
        SET status='voided', updated_at=?
      WHERE run_id=? AND source_batch=? AND status IN ('pending','confirmed')`,
  ).run(nowIso(), runId, sourceBatch);
  recordDiscoveryFact({
    kind: "approval_result",
    object_type: "discovery_run",
    object_id: runId,
    payload: { result: "voided", reason, source_batch: sourceBatch },
    actor: actorId(),
    source_version: sourceBatch,
  });
}

function sanitizeReceipt(item: Json): Json {
  return trimPrivate({
    candidate_id: item.candidate_id,
    platform: item.platform,
    platform_creator_id: item.platform_creator_id,
    status: item.status,
    kol_uid: item.kol_uid || null,
    already_imported: Boolean(item.already_imported),
    looked_up_after_timeout: Boolean(item.looked_up_after_timeout),
    retried: false,
    has_contact_email: Boolean(item.has_contact_email),
    profile: item.profile ? publicProfileFields(item.profile as Json) : null,
    error: item.error || null,
  });
}

function writeOpenPool(input: {
  kol_uid: string;
  candidate: Row;
  source_batch: string;
  platform: string;
  platform_creator_id: string;
}): Row {
  const profile = ingestFormalProfile({
    kol_uid: input.kol_uid,
    handle: String(input.candidate.handle || input.candidate.nickname || input.platform_creator_id),
    display_name: String(input.candidate.nickname || input.candidate.handle || input.platform_creator_id),
    platform: input.platform,
    homepage_url: profileUrlOf(input.candidate),
    followers: String(input.candidate.followers || ""),
    avg_plays: String(input.candidate.avg_views_10 || ""),
    direction: String(parseJson(input.candidate.payload).direction || ""),
    region: String(parseJson(input.candidate.payload).region || parseJson(input.candidate.signals).region || ""),
    ingest_source: "crawler",
    source_batch: input.source_batch,
    platform_creator_id: input.platform_creator_id,
    pool_status: "open",
    company_id: memoryCompanyId(),
  });
  if (!profile) {
    return upsertPublicProfile({
      kol_uid: input.kol_uid,
      ingest_source: "crawler",
      source_batch: input.source_batch,
      platform_creator_id: input.platform_creator_id,
      pool_status: "open",
    });
  }
  return profile;
}

/**
 * 负责人身份：工作台绑定的 Starry 邮箱 → 按 mailbox_id / mailbox_email 去邮箱清单取
 * ownerOpenId。取不到就交给调用方诚实失败 —— Starry 只给 ownerUserName 会报
 * 「负责人无可用邮箱」，编一个 id 只会写出错误负责人。
 */
async function ownerFieldsForIngest(): Promise<Json> {
  const binding = starryBindingRow(actorId());
  return resolveStarryOwnerForMailbox({
    mailboxId: binding?.mailbox_id,
    mailboxEmail: binding?.mailbox_email,
    ownerName: binding?.owner_name,
  });
}

async function ingestOne(input: {
  candidate: Row;
  source_batch: string;
  run_id: string;
}): Promise<Json> {
  const companyId = memoryCompanyId();
  const external = requireStableExternalId(input.candidate);
  const existing = findReceipt({
    company_id: companyId,
    source_batch: input.source_batch,
    platform: external.platform,
    platform_creator_id: external.platform_creator_id,
  });
  if (existing && String(existing.kol_uid || "")) {
    const profile = getConn().prepare(
      "SELECT * FROM kol_profile_index WHERE company_id=? AND kol_uid=?",
    ).get(companyId, existing.kol_uid) as Row | undefined;
    return {
      candidate_id: input.candidate.id,
      platform: external.platform,
      platform_creator_id: external.platform_creator_id,
      status: "already_imported",
      already_imported: true,
      kol_uid: existing.kol_uid,
      has_contact_email: candidateHasContactEmail(input.candidate),
      profile,
    };
  }

  // 没有真实联系邮箱就没有第一步可做：不编造、不拿负责人邮箱顶，诚实失败。
  const contactEmail = candidateContactEmail(input.candidate);
  if (!contactEmail) {
    throw new HttpFail(409, {
      code: "import_creator_no_contact_email",
      message: "该线索没有联系邮箱，未入库。",
    });
  }

  // 先找回已建档的 uid：上一次 add 成功但 import 失败会留下孤儿，重试再 add 会撞
  // 「联系邮箱已被其他红人占用」。找回用的正是要写进 Starry 的那两列（频道链接/平台账号）。
  const crawlerRow = mapCandidateToCrawlerRow(input.candidate);
  const found = await findExistingKolUid({
    keyword: crawlerRow.account,
    account: crawlerRow.account,
    platform: external.platform,
    profileUrl: crawlerRow.profile_url,
  }, { actor: actorId() });

  let kolUid = "";
  if (found) {
    kolUid = found.kol_uid;
    audit(actorId(), "host.add_kol_profile", {
      policy: IMPORT_CREATOR_POLICY,
      tool: "addKolProfile",
      skipped: true,
      reused_existing: true,
      via: found.via,
      kol_uid: kolUid,
      source_batch: input.source_batch,
      creator_external_id: external.external_id,
      candidate_id: String(input.candidate.id),
      sent: false,
      stage_changed: false,
    });
  } else {
    const owner = await ownerFieldsForIngest();
    if (!/^\d+$/.test(String(owner.ownerOpenId || "").trim())) {
      throw new HttpFail(409, {
        code: "import_creator_no_owner_open_id",
        message: "未取得 Starry 负责人 openId，未入库。",
        owner_mailbox: String(owner.ownerMailbox || owner.mailboxEmail || ""),
      });
    }
    const created = await addKolProfileConfirmed({
      kolName: String(
        input.candidate.nickname || input.candidate.handle || external.platform_creator_id,
      ).trim(),
      contactEmail,
      dataSource: "CRAWLER",
      owner,
      sourceBatch: input.source_batch,
      creatorExternalId: external.external_id,
      candidateId: String(input.candidate.id),
      actor: actorId(),
    });
    kolUid = String(created.kol_uid || "");
  }

  const file = buildCrawlerImportFile(
    [withKolUid(crawlerRow, kolUid)],
    `discovery-ingest-${String(input.candidate.id).slice(0, 24)}.csv`,
  );
  if (crawlerFileContainsContactEmail(file) || /@/.test(file.csv) && /contactEmail|联系邮箱/i.test(file.csv)) {
    throw new HttpFail(500, { code: "fabricated_contact_email", message: "禁止编造联系邮箱。" });
  }
  const imported = await importKolProfilesFromCrawlerConfirmed({
    file,
    sourceBatch: input.source_batch,
    creatorExternalId: external.external_id,
    candidateId: String(input.candidate.id),
    actor: actorId(),
    lookupKeyword: String(input.candidate.handle || input.candidate.nickname || external.platform_creator_id),
    knownKolUid: kolUid,
  });
  const importedUid = String(imported.kol_uid || "");
  const finalUid = importedUid || kolUid;
  const profile = writeOpenPool({
    kol_uid: finalUid,
    candidate: input.candidate,
    source_batch: input.source_batch,
    platform: external.platform,
    platform_creator_id: external.platform_creator_id,
  });
  writeReceipt({
    company_id: companyId,
    source_batch: input.source_batch,
    platform: external.platform,
    platform_creator_id: external.platform_creator_id,
    kol_uid: finalUid,
    candidate_id: String(input.candidate.id),
    run_id: input.run_id,
  });
  recordDiscoveryFact({
    kind: "ingest_receipt",
    object_type: "discovery_run",
    object_id: input.run_id,
    payload: {
      candidate_id: input.candidate.id,
      kol_uid: finalUid,
      source_batch: input.source_batch,
      platform: external.platform,
      platform_creator_id: external.platform_creator_id,
      already_imported: false,
      looked_up_after_timeout: Boolean(imported.looked_up_after_timeout),
    },
    actor: actorId(),
    source_version: input.source_batch,
  });
  return {
    candidate_id: input.candidate.id,
    platform: external.platform,
    platform_creator_id: external.platform_creator_id,
    status: "imported",
    already_imported: false,
    kol_uid: finalUid,
    looked_up_after_timeout: Boolean(imported.looked_up_after_timeout),
    retried: false,
    has_contact_email: true,
    profile,
  };
}

export async function ingestDiscoveryBatch(body: Json = {}): Promise<Json> {
  const runId = String(body.run_id || body.runId || "").trim();
  if (!runId) throw new HttpFail(400, { code: "run_id_required", message: "需要 run_id。" });
  const run = runRow(runId);
  const candidateIds = asIdList(body.candidate_ids ?? body.candidateIds);
  const expected = expectedBriefVersion(body.expected_brief_version ?? body.expectedBriefVersion);
  const currentBrief = briefVersionOf(run);
  const sourceBatch = String(run.id);
  const orgGate = importCreatorOrgApprovalRequired();

  if (currentBrief !== expected) {
    voidConfirms(runId, sourceBatch, "brief_version_mismatch");
    throw new HttpFail(409, {
      code: "brief_version_mismatch",
      message: "发现 Brief 已变化，原确认作废。",
      expected_brief_version: expected,
      brief_version: currentBrief,
      confirmation_void: true,
    });
  }

  const cancel = body.cancel === true || body.cancelled === true || body.confirmed === false || body.confirmed === "false";
  if (cancel && body.confirmed !== true && body.confirmed !== "true") {
    writeConfirm({
      run_id: runId,
      source_batch: sourceBatch,
      expected_brief_version: expected,
      candidate_ids: candidateIds,
      status: "cancelled",
    });
    recordDiscoveryFact({
      kind: "approval_result",
      object_type: "discovery_run",
      object_id: runId,
      payload: { result: "cancelled", risk: "L3", source_batch: sourceBatch },
      actor: actorId(),
      source_version: sourceBatch,
    });
    audit(actorId(), "discovery.ingest.cancelled", {
      run_id: runId,
      source_batch: sourceBatch,
      sent: false,
      stage_changed: false,
      claimed: false,
    });
    return {
      ...DISCOVERY_INGEST_ENTRY,
      status: "cancelled",
      cancelled: true,
      run_id: runId,
      source_batch: sourceBatch,
      brief_version: currentBrief,
      items: [],
      claimed: false,
      sent: false,
      stage_changed: false,
      org_approval: orgGate,
    };
  }

  if (body.confirmed !== true && body.confirmed !== "true") {
    const pending = writeConfirm({
      run_id: runId,
      source_batch: sourceBatch,
      expected_brief_version: expected,
      candidate_ids: candidateIds,
      status: "pending",
    });
    return {
      ...DISCOVERY_INGEST_ENTRY,
      status: "needs_confirmation",
      confirmation_id: pending.id,
      confirmed: false,
      run_id: runId,
      source_batch: sourceBatch,
      brief_version: currentBrief,
      claimed: false,
      sent: false,
      stage_changed: false,
      org_approval: orgGate,
    };
  }

  const prior = latestConfirm(runId, sourceBatch);
  if (prior && String(prior.status) === "cancelled") {
    throw new HttpFail(409, {
      code: "l3_cancelled",
      message: "该确认已取消，未写入达人库。",
      confirmation_id: prior.id,
    });
  }
  if (prior && String(prior.status) === "voided") {
    throw new HttpFail(409, {
      code: "l3_voided",
      message: "原确认已作废，请重新确认。",
      confirmation_id: prior.id,
    });
  }

  writeConfirm({
    run_id: runId,
    source_batch: sourceBatch,
    expected_brief_version: expected,
    candidate_ids: candidateIds,
    status: "confirmed",
  });
  recordDiscoveryFact({
    kind: "approval_result",
    object_type: "discovery_run",
    object_id: runId,
    payload: {
      result: "l3_confirmed",
      org_ticket: false,
      gap: orgGate.gap || null,
      source_batch: sourceBatch,
    },
    actor: actorId(),
    source_version: sourceBatch,
  });

  const candidates = loadCandidates(runId, candidateIds);
  const items: Json[] = [];
  for (const candidate of candidates) {
    try {
      const item = await ingestOne({ candidate, source_batch: sourceBatch, run_id: runId });
      items.push(sanitizeReceipt(item));
    } catch (error) {
      const detail = error instanceof HttpFail ? error.detail : { message: "入库失败" };
      items.push(sanitizeReceipt({
        candidate_id: candidate.id,
        platform: candidate.platform,
        platform_creator_id: candidate.platform_creator_id,
        status: "failed",
        error: typeof detail === "object" && detail ? detail : { message: String(detail) },
        has_contact_email: candidateHasContactEmail(candidate),
      }));
    }
  }

  const imported = items.filter((row) => row.status === "imported" || row.status === "already_imported");
  audit(actorId(), "discovery.ingest", {
    run_id: runId,
    source_batch: sourceBatch,
    imported: imported.length,
    failed: items.length - imported.length,
    claimed: false,
    sent: false,
    stage_changed: false,
    tool: "importKolProfilesFromCrawler",
  });

  return {
    ...DISCOVERY_INGEST_ENTRY,
    status: "completed",
    confirmed: true,
    run_id: runId,
    source_batch: sourceBatch,
    brief_version: currentBrief,
    items,
    counts: {
      selected: candidates.length,
      imported: items.filter((row) => row.status === "imported").length,
      already_imported: items.filter((row) => row.status === "already_imported").length,
      failed: items.filter((row) => row.status === "failed").length,
    },
    claimed: false,
    b_active_written: false,
    collaboration_as_follow: false,
    sent: false,
    stage_changed: false,
    org_approval: orgGate,
  };
}
