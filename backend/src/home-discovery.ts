/**
 * Home AI Discovery harness — crawl job + discovery_brief.
 * Crawl complete writes CreatorCandidate only. Idle does not write Starry.
 * Follow on this path must not create Collaboration.
 * Real POST /api/home/discovery/ingest (Starry + A.open) is already on main (#174).
 * This harness must not call it on crawl idle. Per-run/candidate ingest is 501 handoff.
 * No from-text. No LIVE send / stage / decrypt.
 */
import { authDisabled, isAdmin, scopedUser } from "./auth.js";
import { DEMO_USER } from "./config.js";
import { avgViews10, candidateContactEmail, recentViewsOf } from "./discovery-import.js";
import { emptyDiscoveryHint } from "./discovery-keywords.js";
import {
  DISCOVERY_BRIEF_SCHEMA,
  emptyDiscoveryBrief,
  publicBrief,
  validateDiscoveryBrief,
  type DiscoveryBrief,
} from "./discovery-brief.js";
import {
  DEFAULT_DISCOVERY_THRESHOLDS,
  DISCOVERY_MODES,
  MAX_DISCOVERY_DIRECTIONS,
  MAX_DISCOVERY_TARGET,
  discoveryTemplate,
  employeeAuthorizedBrands,
  employeeDefaultBrand,
  employeeDefaultRegion,
  isDiscoveryPlatform,
  isDiscoveryRegion,
  isDomesticPlatform,
} from "./discovery-template.js";
import { onCrawlJobSettled, startCrawl, stopCrawl } from "./crawl/service.js";
import { audit, getConn, nowIso, tx } from "./db.js";
import {
  FROM_TEXT_FORBIDDEN_TASK_TYPES,
  runInDiscoveryHarness,
} from "./gateway/discovery-harness.js";
import { HttpFail } from "./host/errors.js";
import { normalizeBrandCode } from "./host/pep.js";
import { persistValidatedSkillResult, skillResultMemoryStatus } from "./host/skill-result-memory.js";
import { createRunTraceSink } from "./host/run-trace.js";
import { nid } from "./ids.js";
import { appendTaskEvent } from "./routers/tasks.js";
import type { Json, Row, WorkerResult } from "./types.js";
import type { WorkerProgress } from "./worker/progress.js";
import { runWorker } from "./worker/runner.js";
import { taskDefinition } from "./tasks/registry.js";

export { discoveryTemplate };

const HOME_KIND = "home";
const ACTIVE_RUN = new Set(["queued", "crawling", "ranking"]);
const CRAWL_SLOT_ACTIVE = new Set([
  "queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping",
]);

type DiscoverySpec = {
  platforms: string[];
  mode: string;
  keywords: string[];
  directions: string[];
  brand: string | null;
  region: string;
  thresholds: {
    min_followers: number;
    max_followers: number;
    min_avg_views_10: number;
    target_count: number;
  };
  target_count_clamped?: boolean;
};

type BriefRunnerInput = {
  sessionId: string;
  prompt: string;
  extra: Json;
  /** Harness progress → task_events rows; the Codex 推理 stream lives here. */
  onStream?: (progress: WorkerProgress) => void;
};

type BriefRunner = (input: BriefRunnerInput) => Promise<WorkerResult | Json>;

let briefRunner: BriefRunner | null = null;
let planRunner: BriefRunner | null = null;
const pendingWork = new Set<Promise<void>>();
let hookRegistered = false;

export function setDiscoveryBriefRunner(fn?: BriefRunner | null): void {
  briefRunner = fn || null;
}

export function setDiscoveryPlanRunner(fn?: BriefRunner | null): void {
  planRunner = fn || null;
}

export function registerHomeDiscoveryHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  onCrawlJobSettled(onHomeCrawlSettled);
}

export async function awaitHomeDiscoveryWork(): Promise<void> {
  while (pendingWork.size) await Promise.all([...pendingWork]);
}

function track(work: Promise<void>): void {
  pendingWork.add(work);
  work.finally(() => pendingWork.delete(work));
}

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

function parseJson(value: unknown): Json {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Nested payload values arrive already parsed; JSON columns arrive as text. */
function objectOf(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : parseJson(value);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/** Absent / blank / non-numeric all fold to null — 0 is a value, not a stand-in for missing. */
function nullableNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function tableExists(name: string): boolean {
  const row = getConn().prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function event(
  workItemId: string | null,
  type: string,
  status: string,
  summary: string,
): void {
  if (!workItemId) return;
  appendTaskEvent(workItemId, null, type, summary, status, summary);
}

function homeRunRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(id) as Row | undefined;
  if (!row || String(row.kind || "") !== HOME_KIND) {
    throw new HttpFail(404, { code: "discovery_run_not_found", message: "未找到该发现运行" });
  }
  if (!isAdmin() && String(row.owner_user_id) !== ownerId()) {
    throw new HttpFail(404, { code: "discovery_run_not_found", message: "未找到该发现运行" });
  }
  return row;
}

function homeCandidateRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, { code: "creator_candidate_not_found", message: "未找到该发现候选人" });
  const run = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(row.run_id) as Row | undefined;
  if (!run || String(run.kind || "") !== HOME_KIND) {
    throw new HttpFail(404, { code: "creator_candidate_not_found", message: "未找到该发现候选人" });
  }
  if (!isAdmin() && String(row.owner_user_id) !== ownerId()) {
    throw new HttpFail(404, { code: "creator_candidate_not_found", message: "未找到该发现候选人" });
  }
  return row;
}

export function isHomeDiscoveryRun(run: Row | null | undefined): boolean {
  return Boolean(run && String(run.kind || "") === HOME_KIND);
}

export function assertNotFromTextDiscovery(taskType: string | null | undefined): void {
  const type = String(taskType || "").trim();
  if (!FROM_TEXT_FORBIDDEN_TASK_TYPES.has(type)) return;
  throw new HttpFail(400, {
    code: "from_text_forbidden",
    message: "发现计划与采集不能从 from-text 发起。",
    task_type: type,
  });
}

function validateSpec(body: Json): DiscoverySpec {
  const platforms = asStringList(body.platforms ?? body.platform).map((code) => code.toLowerCase());
  if (!platforms.length) {
    throw new HttpFail(400, { code: "platforms_required", message: "请选择海外平台。" });
  }
  const domestic = platforms.filter(isDomesticPlatform);
  if (domestic.length) {
    throw new HttpFail(400, {
      code: "overseas_platforms_only",
      message: "AI发现只支持 YouTube、Instagram、Facebook。",
      platforms: domestic,
    });
  }
  const invalid = platforms.filter((code) => !isDiscoveryPlatform(code));
  if (invalid.length) {
    throw new HttpFail(400, {
      code: "overseas_platforms_only",
      message: "AI发现只支持 YouTube、Instagram、Facebook。",
      platforms: invalid,
    });
  }
  const mode = String(body.mode || "search").toLowerCase();
  if (!(DISCOVERY_MODES as readonly string[]).includes(mode)) {
    throw new HttpFail(400, { code: "invalid_crawl_mode", message: "采集方式不正确。" });
  }
  const keywords = asStringList(body.keywords ?? body.keyword);
  if (mode === "search" && !keywords.length) {
    throw new HttpFail(400, { code: "keywords_required", message: "请先填写要发现的关键词。" });
  }
  const directions = asStringList(body.directions ?? (body.filters as Json | undefined)?.directions);
  if (directions.length > MAX_DISCOVERY_DIRECTIONS) {
    throw new HttpFail(400, {
      code: "too_many_directions",
      message: "内容方向最多 8 个。",
      max: MAX_DISCOVERY_DIRECTIONS,
    });
  }
  const brandRaw = body.brand == null || body.brand === "" ? employeeDefaultBrand() : String(body.brand);
  const brand = brandRaw ? normalizeBrandCode(brandRaw) || String(brandRaw).toUpperCase() : null;
  if (brand) {
    const authorized = new Set(employeeAuthorizedBrands().map((item) => item.toUpperCase()));
    if (!authorized.has(brand.toUpperCase())) {
      throw new HttpFail(403, { code: "brand_not_authorized", message: "当前账号无权使用该品牌。" });
    }
  }
  const regionRaw = String(body.region ?? (body.filters as Json | undefined)?.region ?? employeeDefaultRegion())
    .trim()
    .toLowerCase();
  const region = isDiscoveryRegion(regionRaw) ? regionRaw : employeeDefaultRegion();
  const rawThresholds = (body.thresholds && typeof body.thresholds === "object" ? body.thresholds : body) as Json;
  // Frontend ships `min_avg_plays_10` / `expect_count`; the Host columns keep the
  // older names. Read both so the 均播 / 期望人数 inputs are not silently ignored.
  let targetCount = Number(
    rawThresholds.target_count ?? rawThresholds.expect_count ?? DEFAULT_DISCOVERY_THRESHOLDS.target_count,
  );
  if (!Number.isFinite(targetCount) || targetCount <= 0) targetCount = DEFAULT_DISCOVERY_THRESHOLDS.target_count;
  const clamped = targetCount > MAX_DISCOVERY_TARGET;
  if (clamped) targetCount = MAX_DISCOVERY_TARGET;
  return {
    platforms: [...new Set(platforms)],
    mode,
    keywords,
    directions,
    brand,
    region,
    thresholds: {
      min_followers: Number(rawThresholds.min_followers ?? DEFAULT_DISCOVERY_THRESHOLDS.min_followers),
      max_followers: Number(rawThresholds.max_followers ?? DEFAULT_DISCOVERY_THRESHOLDS.max_followers),
      min_avg_views_10: Number(
        rawThresholds.min_avg_views_10
          ?? rawThresholds.min_avg_plays_10
          ?? DEFAULT_DISCOVERY_THRESHOLDS.min_avg_views_10,
      ),
      target_count: targetCount,
    },
    target_count_clamped: clamped,
  };
}

/**
 * Request columns hold JSON arrays. Reading them as plain strings kept the JSON
 * punctuation, so `["youtube"]` came back as `['["youtube"]']` on every run spec.
 * Legacy comma-separated rows still parse.
 */
function storedList(value: unknown): string[] {
  const parsed = parseArray(value);
  return parsed.length ? asStringList(parsed) : asStringList(value);
}

function specOf(run: Row): DiscoverySpec {
  const parameters = parseJson(run.parameters);
  const request = getConn().prepare("SELECT * FROM discovery_requests WHERE id=?").get(run.request_id) as
    | Row
    | undefined;
  const filters = parseJson(request?.filters);
  const requestPlatforms = storedList(request?.platforms);
  const requestKeywords = storedList(request?.keywords);
  return {
    platforms: requestPlatforms.length ? requestPlatforms : [String(run.platform || "youtube")],
    mode: String(run.mode || parameters.mode || "search"),
    keywords: asStringList(parameters.keywords).length
      ? asStringList(parameters.keywords)
      : requestKeywords,
    directions: asStringList(filters.directions),
    brand: request?.brand ? String(request.brand) : null,
    region: String(filters.region || employeeDefaultRegion()),
    thresholds: {
      min_followers: Number(parameters.min_followers ?? filters.min_followers ?? DEFAULT_DISCOVERY_THRESHOLDS.min_followers),
      max_followers: Number(parameters.max_followers ?? filters.max_followers ?? DEFAULT_DISCOVERY_THRESHOLDS.max_followers),
      min_avg_views_10: Number(
        parameters.min_avg_views_10 ?? filters.min_avg_views_10 ?? DEFAULT_DISCOVERY_THRESHOLDS.min_avg_views_10,
      ),
      target_count: Number(parameters.target_count ?? filters.target_count ?? DEFAULT_DISCOVERY_THRESHOLDS.target_count),
    },
  };
}

function lookupFlags(platform: string, platformCreatorId: string): {
  already_in_pool: boolean;
  already_followed: boolean;
  already_in_library: boolean;
} {
  const key = `${platform}:${platformCreatorId}`;
  let alreadyInLibrary = false;
  let alreadyInPool = false;
  let alreadyFollowed = false;
  if (tableExists("kol_profile_index")) {
    const profile = getConn().prepare(
      `SELECT pool_status FROM kol_profile_index
        WHERE lower(platform)=? AND platform_creator_id=? LIMIT 1`,
    ).get(platform, platformCreatorId) as { pool_status?: string } | undefined;
    if (profile) {
      alreadyInLibrary = true;
      alreadyInPool = String(profile.pool_status || "") === "open";
    }
  }
  if (tableExists("kol_follow_index")) {
    const follow = getConn().prepare(
      `SELECT id FROM kol_follow_index
        WHERE status='active' AND kol_uid IN (
          SELECT kol_uid FROM kol_profile_index
           WHERE lower(platform)=? AND platform_creator_id=?
        ) LIMIT 1`,
    ).get(platform, platformCreatorId) as { id?: string } | undefined;
    alreadyFollowed = Boolean(follow?.id);
  }
  const collab = getConn().prepare(
    `SELECT id, owner_name, owner_mailbox, source FROM collaborations
      WHERE lower(COALESCE(platform,''))=? AND (
        COALESCE(kol_uid,'')=? OR handle=? OR display_name=?
      ) LIMIT 1`,
    ).get(platform, key, platformCreatorId, platformCreatorId) as Row | undefined;
  if (collab) {
    alreadyInLibrary = true;
    if (collab.owner_name || collab.owner_mailbox) alreadyFollowed = true;
  }
  const claw = getConn().prepare(
    "SELECT id FROM claw_creators WHERE platform=? AND platform_creator_id=?",
  ).get(platform, platformCreatorId) as { id?: string } | undefined;
  if (claw?.id) alreadyInLibrary = alreadyInLibrary || false;
  const followedCandidate = getConn().prepare(
    `SELECT id FROM creator_candidates
      WHERE platform=? AND platform_creator_id=? AND status='followed' LIMIT 1`,
  ).get(platform, platformCreatorId) as { id?: string } | undefined;
  if (followedCandidate?.id) alreadyFollowed = true;
  return {
    already_in_pool: alreadyInPool,
    already_followed: alreadyFollowed,
    already_in_library: alreadyInLibrary,
  };
}

function libraryHits(candidates: Row[]): Json[] {
  const hits: Json[] = [];
  for (const row of candidates) {
    const flags = lookupFlags(String(row.platform), String(row.platform_creator_id));
    if (flags.already_in_library || flags.already_followed || flags.already_in_pool) {
      hits.push({
        candidate_id: row.id,
        platform: row.platform,
        platform_creator_id: row.platform_creator_id,
        ...flags,
      });
    }
  }
  return hits;
}

/**
 * The row the 结果页 renders. `ranking` is the brief's entry for this candidate —
 * it carries the only copy of why/band/fit (see `briefRanking`), so a missing entry
 * must leave those keys null rather than empty strings.
 */
function publicCandidate(row: Row, ranking?: Json | null): Json {
  const payload = parseJson(row.payload);
  const signals = parseJson(row.signals);
  const followersPresent = row.followers != null && String(row.followers) !== "";
  const views = recentViewsOf(row);
  const metricsMissing = Number(row.metrics_missing || 0) === 1
    || Boolean(signals.metrics_missing)
    || !followersPresent
    || !views.length;
  const alreadyInPool = Boolean(signals.already_in_pool);
  const alreadyFollowed = Boolean(signals.already_followed);
  const alreadyInLibrary = Boolean(signals.already_in_library);
  // 规格的 library 只有三态，`already_in_library`（在 Starry / 公海）没有第四态可落，
  // 因此并入 pool。`in_library` 保持旧口径（公海/在库，不含 followed），
  // 否则「可入库」的行会被翻成「已在库」。followed 由 already_followed / library_status 表达。
  const libraryStatus = alreadyFollowed
    ? "followed"
    : alreadyInPool || alreadyInLibrary ? "pool" : "not_in_library";
  const scoreDetails = objectOf(payload.score_details);
  const why = asStringList(ranking?.why);
  const matchReason = why.length ? why.join(" · ") : null;
  const contactEmail = candidateContactEmail(row) || null;
  // This is an explainable pre-flight projection only. The L3 gateway repeats
  // every authority, version, de-duplication and source-batch check before it
  // ever writes Starry. Do not turn this view hint into an approval decision.
  const ingestReadiness = alreadyFollowed
    ? "already_followed"
    : alreadyInPool || alreadyInLibrary
      ? "already_in_library"
      : !contactEmail
        ? "needs_contact"
        : metricsMissing || !ranking
          ? "needs_review"
          : "ready";
  const ingestBlockReason = ingestReadiness === "already_followed"
    ? "该红人已有跟进关系，不重复导入或领取。"
    : ingestReadiness === "already_in_library"
      ? "该红人已在 Starry 库中，不重复导入。"
      : ingestReadiness === "needs_contact"
        ? "缺少经采集验证的联系邮箱，不能入库。"
        : ingestReadiness === "needs_review"
          ? metricsMissing
            ? "采集指标不完整，请复核数据后再决定是否入库。"
            : "尚无完整的 AI 推荐证据，请人工复核后再选择入库。"
          : null;
  return {
    id: row.id,
    request_id: row.request_id,
    run_id: row.run_id,
    platform: row.platform,
    platform_creator_id: row.platform_creator_id,
    handle: row.handle || row.nickname || "",
    nickname: row.nickname || row.handle || "",
    followers: followersPresent ? Number(row.followers || 0) : null,
    avg_views_10: views.length ? avgViews10(row) : null,
    // 列上的 score 只由 applyRanking 写，没被排名的候选恒为列默认值 0（或同一 request
    // 上一轮的旧分）。行上必须区分「真的 0 分」与「从没打过分」，所以只认 brief。
    score: ranking ? nullableNumber(ranking.score) : null,
    order_index: row.order_index == null ? null : Number(row.order_index),
    metrics_missing: metricsMissing,
    already_in_pool: alreadyInPool,
    already_followed: alreadyFollowed,
    already_in_library: alreadyInLibrary,
    in_library: alreadyInPool || alreadyInLibrary,
    library_status: libraryStatus,
    band: nullableString(ranking?.band),
    fit: nullableString(ranking?.fit),
    match_reason: matchReason,
    why: matchReason,
    view_mean: nullableNumber(scoreDetails.view_mean),
    view_median: nullableNumber(scoreDetails.view_median),
    stability: nullableNumber(scoreDetails.stability),
    view_follower_ratio: nullableNumber(scoreDetails.view_follower_ratio),
    confidence: nullableNumber(ranking?.confidence) ?? nullableNumber(scoreDetails.sample_confidence),
    sample_size: nullableNumber(scoreDetails.sample_size),
    recent_views: views,
    collected_at: nullableString(payload.collected_at),
    profile_url: nullableString(payload.profile_url),
    avatar_url: nullableString(payload.avatar_url),
    email: contactEmail,
    ingest_readiness: ingestReadiness,
    ingest_block_reason: ingestBlockReason,
    matched_keywords: asStringList(payload.matched_keywords),
    status: row.status,
    payload,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * `applyRanking()` only writes score + order_index back onto the candidate, so the
 * brief's ranking is the only source for why/band/fit. Read it once per list instead
 * of querying per candidate.
 */
function briefRanking(workItemId: string): Map<string, Json> {
  const index = new Map<string, Json>();
  const brief = briefArtifact(workItemId);
  const ranking = brief?.ranking;
  if (!Array.isArray(ranking)) return index;
  for (const item of ranking) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Json;
    const candidateId = String(entry.candidate_id || "").trim();
    if (candidateId) index.set(candidateId, entry);
  }
  return index;
}

function briefArtifact(workItemId: string): Json | null {
  if (!workItemId) return null;
  const artifact = getConn().prepare(
    `SELECT payload FROM task_artifacts
      WHERE work_item_id=? AND artifact_type='discovery_brief'
      ORDER BY created_at DESC LIMIT 1`,
  ).get(workItemId) as { payload?: string } | undefined;
  return artifact?.payload ? parseJson(artifact.payload) : null;
}

function publicRun(row: Row): Json {
  const spec = specOf(row);
  const searchKeywords = spec.keywords;
  const candidateCount = Number(row.candidate_count || 0);
  const workItemId = row.work_item_id ? String(row.work_item_id) : "";
  const events = workItemId
    ? (getConn().prepare(
        "SELECT * FROM task_events WHERE work_item_id=? ORDER BY sequence",
      ).all(workItemId) as Row[]).map((item) => ({
        type: item.event_type,
        status: item.status,
        summary: item.safe_summary,
        created_at: item.time,
      }))
    : [];
  const status = String(row.status);
  return {
    id: row.id,
    request_id: row.request_id,
    session_id: row.session_id || null,
    work_item_id: row.work_item_id || null,
    platform: row.platform,
    status,
    memory_validity: skillResultMemoryStatus(String(row.owner_user_id || ""), "creator_discovery", String(row.id || "")),
    spec,
    search_keywords: searchKeywords,
    candidate_count: candidateCount,
    raw_count: row.raw_count == null ? null : Number(row.raw_count),
    empty_hint: status === "completed" && candidateCount === 0 ? emptyDiscoveryHint(searchKeywords) : null,
    error: row.error || null,
    brief: briefArtifact(workItemId),
    events,
    created_at: row.created_at,
    started_at: row.started_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

function createSession(owner: string, title: string): string {
  const id = nid("ses");
  const now = nowIso();
  getConn().prepare(
    "INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id) VALUES (?,?,?,?,?,?,?)",
  ).run(id, title, now, now, "discovery", 0, owner);
  return id;
}

function createWorkItem(input: {
  owner: string;
  sessionId: string;
  taskType: string;
  skill: string;
  title: string;
  payload: Json;
}): string {
  const id = nid("tsk");
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO work_items
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,
      session_id,input,entities,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  ).run(
    id,
    input.owner,
    input.taskType,
    input.title,
    "home_discovery",
    "pending",
    "normal",
    input.skill,
    "lead",
    input.sessionId,
    JSON.stringify(input.payload),
    JSON.stringify(input.payload),
    now,
    now,
  );
  return id;
}

function updateRunStatus(runId: string, status: string, extra: { error?: string | null; completed?: boolean } = {}): void {
  const now = nowIso();
  getConn().prepare(
    `UPDATE discovery_runs
        SET status=?, error=?, completed_at=?, updated_at=?, data_version=data_version+1
      WHERE id=?`,
  ).run(
    status,
    extra.error ?? null,
    extra.completed || ["completed", "crawl_failed", "rank_failed", "cancelled"].includes(status) ? now : null,
    now,
    runId,
  );
  const run = getConn().prepare("SELECT request_id, work_item_id FROM discovery_runs WHERE id=?").get(runId) as
    | { request_id: string; work_item_id?: string | null }
    | undefined;
  if (run) {
    getConn().prepare(
      "UPDATE discovery_requests SET status=?, error=?, updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(status, extra.error ?? null, now, run.request_id);
    const taskStatus = status === "completed" ? "completed"
      : status === "cancelled" ? "cancelled"
        : status === "crawl_failed" || status === "rank_failed" ? "failed"
          : status === "queued" ? "waiting"
            : "running";
    if (run.work_item_id) {
      getConn().prepare(
        `UPDATE work_items
            SET status=?, completed_at=?, updated_at=?, data_version=data_version+1
          WHERE id=?`,
      ).run(
        taskStatus,
        ["completed", "cancelled", "failed"].includes(taskStatus) ? now : null,
        now,
        run.work_item_id,
      );
    }
  }
}

function tenantCrawlBusy(): boolean {
  const row = getConn().prepare(
    `SELECT id FROM crawl_jobs
      WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')
      LIMIT 1`,
  ).get() as { id?: string } | undefined;
  return Boolean(row?.id);
}

async function startHomeCrawl(run: Row): Promise<void> {
  const spec = specOf(run);
  if (tenantCrawlBusy()) {
    updateRunStatus(String(run.id), "queued");
    event(String(run.work_item_id || ""), "discovery.queued", "queued", "发现采集排队中");
    return;
  }
  try {
    const job = await startCrawl({
      ownerUserId: String(run.owner_user_id),
      workItemId: String(run.work_item_id),
      sessionId: run.session_id ? String(run.session_id) : null,
      platform: String(run.platform),
      mode: String(run.mode || spec.mode || "search"),
      parameters: {
        keywords: spec.keywords,
        directions: spec.directions,
        region: spec.region,
        ...spec.thresholds,
      },
      idempotencyKey: String(run.idempotency_key),
    });
    getConn().prepare(
      `UPDATE discovery_runs
          SET crawl_job_id=?, remote_task_id=?, status='crawling', started_at=COALESCE(started_at,?),
              updated_at=?, data_version=data_version+1
        WHERE id=?`,
    ).run(job.id, job.remote_task_id || null, nowIso(), nowIso(), run.id);
    getConn().prepare(
      "UPDATE work_items SET status='running', completed_at=NULL, updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(nowIso(), run.work_item_id);
    event(String(run.work_item_id || ""), "crawl_started", "crawling", "发现采集已开始");
  } catch (error) {
    if (error instanceof HttpFail && String((error.detail as Json | undefined)?.code || "") === "crawl_active") {
      updateRunStatus(String(run.id), "queued");
      event(String(run.work_item_id || ""), "discovery.queued", "queued", "发现采集排队中");
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    // Keep the Host's operator next_action with the reason: without it the run
    // reads as an unexplained failure and the missing collector stays invisible.
    const nextAction = error instanceof HttpFail
      ? String((error.detail as Json | undefined)?.next_action || "").trim()
      : "";
    updateRunStatus(String(run.id), "crawl_failed", {
      error: nextAction ? `${message}${nextAction}` : message,
      completed: true,
    });
    event(String(run.work_item_id || ""), "failed", "crawl_failed", "发现采集失败");
  }
}

function pumpQueuedHomeRuns(): void {
  if (tenantCrawlBusy()) return;
  const next = getConn().prepare(
    `SELECT * FROM discovery_runs
      WHERE kind=? AND status='queued' AND crawl_job_id IS NULL
      ORDER BY created_at LIMIT 1`,
  ).get(HOME_KIND) as Row | undefined;
  if (!next) return;
  track(startHomeCrawl(next));
}

function hostFilterSnapshots(run: Row, job: Row): { kept: Row[]; raw: number; dropped: number } {
  const spec = specOf(run);
  const snapshots = getConn().prepare(
    `SELECT s.*, c.id AS claw_creator_id, c.handle AS claw_handle, c.name AS claw_name,
            c.payload AS claw_payload
       FROM creator_snapshots s
       JOIN claw_creators c ON c.id = s.creator_id
      WHERE s.crawl_job_id=?
      ORDER BY s.created_at DESC`,
  ).all(job.id) as Row[];
  const seen = new Set<string>();
  const kept: Row[] = [];
  let dropped = 0;
  for (const snap of snapshots) {
    const platform = String(snap.platform || job.platform || "").toLowerCase();
    const platformCreatorId = String(snap.platform_creator_id || "").trim();
    if (!isDiscoveryPlatform(platform) || !platformCreatorId) {
      dropped += 1;
      continue;
    }
    const key = `${platform}:${platformCreatorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const followersPresent = snap.followers != null && String(snap.followers) !== "";
    const views = recentViewsOf(snap);
    const followers = followersPresent ? Number(snap.followers || 0) : null;
    const avg = views.length ? avgViews10(snap) : null;
    if (followers != null) {
      if (followers < spec.thresholds.min_followers || followers > spec.thresholds.max_followers) {
        dropped += 1;
        continue;
      }
    }
    if (avg != null && avg < spec.thresholds.min_avg_views_10) {
      dropped += 1;
      continue;
    }
    kept.push(snap);
    if (kept.length >= spec.thresholds.target_count) break;
  }
  return { kept, raw: snapshots.length, dropped };
}

function persistFilteredCandidates(run: Row, job: Row): { written: number; raw: number; dropped: number } {
  const { kept, raw, dropped } = hostFilterSnapshots(run, job);
  const now = nowIso();
  let written = 0;
  tx((db) => {
    for (const [index, snap] of kept.entries()) {
      const platform = String(snap.platform || job.platform || "").toLowerCase();
      const platformCreatorId = String(snap.platform_creator_id || "").trim();
      const nickname = String(snap.nickname || snap.claw_name || snap.claw_handle || "").trim();
      const followersPresent = snap.followers != null && String(snap.followers) !== "";
      const views = recentViewsOf(snap);
      const flags = lookupFlags(platform, platformCreatorId);
      const metricsMissing = !followersPresent || !views.length;
      const existing = db.prepare(
        "SELECT * FROM creator_candidates WHERE request_id=? AND platform=? AND platform_creator_id=?",
      ).get(run.request_id, platform, platformCreatorId) as Row | undefined;
      const payload = {
        platform,
        platform_creator_id: platformCreatorId,
        nickname,
        followers: followersPresent ? Number(snap.followers || 0) : null,
        recent_views: views,
        collected_at: snap.collected_at,
        crawl_job_id: job.id,
        source: "ai",
        contact_needed: true,
        ...crawlerFieldsOf(parseJson(snap.claw_payload), snap),
      };
      const signals = {
        ...flags,
        metrics_missing: metricsMissing,
        followers: followersPresent ? Number(snap.followers || 0) : null,
        recent_views: views,
        avg_views_10: views.length ? avgViews10(snap) : null,
      };
      if (existing) {
        db.prepare(
          `UPDATE creator_candidates
              SET run_id=?, claw_creator_id=?, handle=?, nickname=?, followers=?, score=?,
                  signals=?, payload=?, order_index=?, metrics_missing=?, avg_views_10=?, updated_at=?
            WHERE id=?`,
        ).run(
          run.id,
          snap.claw_creator_id || existing.claw_creator_id,
          nickname,
          nickname,
          followersPresent ? Number(snap.followers || 0) : 0,
          Number(existing.score || 0),
          JSON.stringify(signals),
          JSON.stringify(payload),
          index,
          metricsMissing ? 1 : 0,
          views.length ? avgViews10(snap) : null,
          now,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO creator_candidates
           (id,request_id,run_id,owner_user_id,platform,platform_creator_id,claw_creator_id,
            handle,nickname,followers,score,signals,payload,status,order_index,metrics_missing,
            avg_views_10,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'suggested',?,?,?,?,?)`,
        ).run(
          nid("cand"),
          run.request_id,
          run.id,
          run.owner_user_id,
          platform,
          platformCreatorId,
          snap.claw_creator_id || null,
          nickname,
          nickname,
          followersPresent ? Number(snap.followers || 0) : 0,
          0,
          JSON.stringify(signals),
          JSON.stringify(payload),
          index,
          metricsMissing ? 1 : 0,
          views.length ? avgViews10(snap) : null,
          now,
          now,
        );
      }
      written += 1;
    }
    db.prepare(
      `UPDATE discovery_runs
          SET raw_count=?, candidate_count=?, updated_at=?, data_version=data_version+1
        WHERE id=?`,
    ).run(raw, written, now, run.id);
  });
  return { written, raw, dropped };
}

/**
 * `claw_creators.payload` is where the crawler's extra fields land, but the candidate
 * keeps a closed payload — so anything the result row must show has to be copied here.
 * A missing key stays missing: `publicCandidate` reads it back as null / [].
 */
function crawlerFieldsOf(clawPayload: Json, snapshot: Row): Json {
  const fields: Json = {};
  const profileUrl = nullableString(clawPayload.profile_url);
  if (profileUrl) fields.profile_url = profileUrl;
  const avatarUrl = nullableString(clawPayload.avatar_url);
  if (avatarUrl) fields.avatar_url = avatarUrl;
  // MediaCrawler 现在只回**有邮箱**的创作者，`email` 是字符串、`emails` 是数组。
  // 候选 payload 是封闭的，不在这里抄一份，入库就拿不到真实联系邮箱。
  const email = nullableString(clawPayload.email);
  if (email) fields.email = email;
  const emails = asStringList(clawPayload.emails);
  if (emails.length) fields.emails = emails;
  const keywords = asStringList(clawPayload.matched_keywords);
  if (keywords.length) fields.matched_keywords = keywords;
  // 本次快照优先：`claw_creators` 是每个 creator 一行、会被更晚的 ingest 覆盖，
  // 用它的 score_details 会让 confidence / sample_size 与同一行的播放数不是同一次采集。
  const fromSnapshot = objectOf(snapshot.score_details);
  const scoreDetails = Object.keys(fromSnapshot).length ? fromSnapshot : objectOf(clawPayload.score_details);
  if (Object.keys(scoreDetails).length) fields.score_details = scoreDetails;
  return fields;
}

function writeBriefArtifact(run: Row, brief: DiscoveryBrief, status: string): void {
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO task_artifacts
     (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
     VALUES (?,?,NULL,'discovery_brief',NULL,1,?,?)`,
  ).run(nid("art"), run.work_item_id, JSON.stringify(brief), now);
  updateRunStatus(String(run.id), status, { completed: status !== "ranking" });
}

function applyRanking(run: Row, brief: DiscoveryBrief): void {
  const now = nowIso();
  tx((db) => {
    for (const [index, item] of brief.ranking.entries()) {
      db.prepare(
        "UPDATE creator_candidates SET score=?, order_index=?, updated_at=? WHERE id=? AND run_id=?",
      ).run(Number(item.score || 0), index, now, item.candidate_id, run.id);
    }
  });
}

export function applyDiscoveryBriefResult(runId: string, value: unknown): Json {
  const run = homeRunRow(runId);
  const validated = validateDiscoveryBrief(value);
  if (!validated.ok) {
    updateRunStatus(runId, "rank_failed", { error: validated.message, completed: true });
    event(String(run.work_item_id || ""), "failed", "rank_failed", validated.message);
    return publicRun(homeRunRow(runId));
  }
  applyRanking(run, validated.brief);
  writeBriefArtifact(run, validated.brief, "completed");
  const parameters = parseJson(run.parameters) as Record<string, unknown>;
  const contract = parameters.skill_contract && typeof parameters.skill_contract === "object"
    ? parameters.skill_contract as Record<string, unknown> : {};
  const policy = contract.memory_policy && typeof contract.memory_policy === "object"
    ? contract.memory_policy as Record<string, unknown> : {};
  if (contract.skill_id === "creator_discovery" && policy.kind === "skill_result"
    && policy.auto_persist === "on_complete" && policy.scope === "owner") {
    persistValidatedSkillResult({
      owner: String(run.owner_user_id || ""),
      skillId: "creator_discovery",
      runId,
      sourceVersion: String(contract.skill_version || "unversioned"),
      staleRefs: Array.isArray(policy.stale_refs) ? policy.stale_refs.map(String) : [],
      summary: {
        headline: validated.brief.headline,
        counts: validated.brief.counts as unknown as Json,
      },
    });
  }
  event(String(run.work_item_id || ""), "artifact_ready", "completed", validated.brief.headline);
  return publicRun(homeRunRow(runId));
}

function trimmedCandidates(runId: string): Json[] {
  return (getConn().prepare(
    `SELECT * FROM creator_candidates WHERE run_id=? ORDER BY order_index ASC, created_at DESC LIMIT 40`,
  ).all(runId) as Row[]).map((row) => {
    const pub = publicCandidate(row);
    return {
      id: pub.id,
      platform: pub.platform,
      platform_creator_id: pub.platform_creator_id,
      handle: pub.handle,
      nickname: pub.nickname,
      followers: pub.followers,
      avg_views_10: pub.avg_views_10,
      metrics_missing: pub.metrics_missing,
      already_in_pool: pub.already_in_pool,
      already_followed: pub.already_followed,
      already_in_library: pub.already_in_library,
    };
  });
}

async function rankHomeDiscoveryRun(run: Row, counts: { raw: number; written: number; dropped: number }): Promise<void> {
  const spec = specOf(run);
  if (counts.written === 0) {
    const brief = emptyDiscoveryBrief({
      headline: emptyDiscoveryHint(spec.keywords),
      raw: counts.raw,
      afterHostFilter: 0,
      searchKeywords: spec.keywords,
    });
    writeBriefArtifact(run, brief, "completed");
    event(String(run.work_item_id || ""), "crawl_idle", "completed", brief.headline);
    return;
  }
  updateRunStatus(String(run.id), "ranking");
  event(String(run.work_item_id || ""), "ranking_started", "ranking", "开始生成发现简报");
  const sessionId = String(run.session_id || createSession(String(run.owner_user_id), "发现简报"));
  if (!run.session_id) {
    getConn().prepare("UPDATE discovery_runs SET session_id=?, updated_at=? WHERE id=?").run(sessionId, nowIso(), run.id);
  }
  const pack = {
    spec,
    candidates: trimmedCandidates(String(run.id)),
    library_hits: libraryHits(
      getConn().prepare("SELECT * FROM creator_candidates WHERE run_id=?").all(run.id) as Row[],
    ),
    counts: {
      raw: counts.raw,
      after_host_filter: counts.written,
      dropped: counts.dropped,
    },
  };
  const extra: Json = {
    work_item_id: run.work_item_id,
    discovery_run_id: run.id,
    pack,
    memory_stitch: false,
    allowed_skills: ["discovery_brief"],
  };
  // task_events.run_id is an FK to task_runs, and a discovery run has no
  // task_runs row: its trace rows carry run_id NULL like the rest of its events.
  const trace = createRunTraceSink({ workItemId: String(run.work_item_id || ""), runId: null });
  try {
    const result = await runInDiscoveryHarness(
      {
        skill: "discovery_brief",
        session_id: sessionId,
        work_item_id: String(run.work_item_id || ""),
        run_id: String(run.id),
      },
      () => (briefRunner || defaultBriefRunner)({
        sessionId,
        prompt: "根据 Host 已过滤的候选人写 discovery_brief/v1。不要编造粉丝、播放或邮箱。",
        extra,
        onStream: trace.onStream,
      }),
    );
    // 先收尾推理行，再落简报终态事件：工作项的最后一条事件仍是终态，
    // 与今日规划一致（home-board 用 MAX(sequence) 当「最新状态」）。
    trace.finish(false);
    const items = (result as WorkerResult).items || (result as Json).items || result;
    const applied = applyDiscoveryBriefResult(String(run.id), { items: Array.isArray(items) ? items : [items] });
    // 简报没通过校验就是这轮没有产出，推理行不能显示成功。
    if (String(applied.status) === "rank_failed") trace.finish(true);
  } catch (error) {
    trace.finish(true);
    const message = error instanceof Error ? error.message : String(error);
    updateRunStatus(String(run.id), "rank_failed", { error: message, completed: true });
    event(String(run.work_item_id || ""), "failed", "rank_failed", "发现简报失败，已保留原始候选人。");
  }
}

async function defaultBriefRunner(input: BriefRunnerInput): Promise<WorkerResult | Json> {
  return runWorker(input.sessionId, "discovery_brief", input.prompt, input.extra, undefined, input.onStream);
}

async function defaultPlanRunner(input: { sessionId: string; prompt: string; extra: Json }): Promise<WorkerResult | Json> {
  return runWorker(input.sessionId, "discovery_plan", input.prompt, input.extra);
}

function onHomeCrawlSettled(job: Row): void {
  const run = getConn().prepare(
    "SELECT * FROM discovery_runs WHERE crawl_job_id=? AND kind=?",
  ).get(job.id, HOME_KIND) as Row | undefined;
  if (run) {
    const status = String(job.status);
    if (status === "result_ready") {
      try {
        event(String(run.work_item_id || ""), "crawl_progress", "crawling", "采集结果已就绪");
        const counts = persistFilteredCandidates(run, job);
        event(String(run.work_item_id || ""), "crawl_idle", "ranking", "采集空闲，已写入 CreatorCandidate");
        track(rankHomeDiscoveryRun(getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(run.id) as Row, counts));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateRunStatus(String(run.id), "crawl_failed", { error: message, completed: true });
        event(String(run.work_item_id || ""), "failed", "crawl_failed", message);
      }
    } else if (["error", "failed", "stopped", "cancelled"].includes(status)) {
      const next = status === "stopped" || status === "cancelled" ? "cancelled" : "crawl_failed";
      updateRunStatus(String(run.id), next, { error: job.error ? String(job.error) : null, completed: true });
      event(String(run.work_item_id || ""), "failed", next, next === "cancelled" ? "发现采集已取消" : "发现采集失败");
    }
  }
  pumpQueuedHomeRuns();
}

export function restoreActiveHomeDiscoveryRuns(): void {
  registerHomeDiscoveryHook();
  const rows = getConn().prepare(
    "SELECT * FROM discovery_runs WHERE kind=? AND status IN ('queued','crawling','ranking')",
  ).all(HOME_KIND) as Row[];
  for (const row of rows) {
    try {
      if (String(row.status) === "queued" && !row.crawl_job_id) track(startHomeCrawl(row));
      else if (row.crawl_job_id) {
        const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(row.crawl_job_id) as Row | undefined;
        if (job) onHomeCrawlSettled(job);
      }
    } catch {
      // Restart restore is best-effort.
    }
  }
}

export function listHomeDiscoveryRuns(): Json {
  registerHomeDiscoveryHook();
  const owner = ownerId();
  const rows = (isAdmin()
    ? getConn().prepare("SELECT * FROM discovery_runs WHERE kind=? ORDER BY updated_at DESC").all(HOME_KIND)
    : getConn().prepare(
        "SELECT * FROM discovery_runs WHERE kind=? AND owner_user_id=? ORDER BY updated_at DESC",
      ).all(HOME_KIND, owner)) as Row[];
  return {
    entry: "memory",
    creates_session: false,
    calls_model: false,
    runs: rows.map(publicRun),
  };
}

export function getHomeDiscoveryRun(id: string): Json {
  registerHomeDiscoveryHook();
  return {
    entry: "memory",
    creates_session: false,
    calls_model: false,
    run: publicRun(homeRunRow(id)),
  };
}

export function listHomeDiscoveryCandidates(id: string): Json {
  registerHomeDiscoveryHook();
  const run = homeRunRow(id);
  const rows = getConn().prepare(
    `SELECT * FROM creator_candidates WHERE run_id=?
      ORDER BY CASE WHEN order_index IS NULL THEN 1 ELSE 0 END, order_index ASC, score DESC, created_at DESC`,
  ).all(run.id) as Row[];
  const ranking = briefRanking(String(run.work_item_id || ""));
  // 缺邮箱的线索仍须可见：员工需要知道其数据价值和具体阻塞原因；
  // 但 `ingest_readiness=needs_contact` 会让结果页禁止把它带入 L3。
  // Gateway 也会在真正写入前再次拒绝，绝不编造联系方式。
  return {
    entry: "memory",
    creates_session: false,
    calls_model: false,
    run_id: run.id,
    candidates: rows.map((row) => publicCandidate(row, ranking.get(String(row.id)) || null)),
  };
}

export async function createHomeDiscoveryPlan(body: Json): Promise<Json> {
  registerHomeDiscoveryHook();
  const owner = ownerId();
  const title = "发现计划草稿";
  const sessionId = createSession(owner, title);
  const workItemId = createWorkItem({
    owner,
    sessionId,
    taskType: "discovery_plan",
    skill: "discovery_plan",
    title,
    payload: { text: body.text || body.prompt || "", locked: true },
  });
  event(workItemId, "discovery.plan_started", "running", "正在生成发现计划草稿");
  const extra: Json = {
    work_item_id: workItemId,
    text: body.text || body.prompt || "",
    memory_stitch: false,
    allowed_skills: ["discovery_plan"],
    employee: {
      brands: employeeAuthorizedBrands(),
      default_brand: employeeDefaultBrand(),
      default_region: employeeDefaultRegion(),
    },
  };
  const result = await runInDiscoveryHarness(
    { skill: "discovery_plan", session_id: sessionId, work_item_id: workItemId },
    () => (planRunner || defaultPlanRunner)({
      sessionId,
      prompt: String(body.text || body.prompt || "请把发现目标写成 spec 草稿，不要采集。"),
      extra,
    }),
  );
  const items = (result as WorkerResult).items || [];
  const specItem = items.find((item) => item && typeof item === "object" && (item.spec || item.schema === "discovery_spec/v1"));
  const spec = (specItem?.spec || specItem || {}) as Json;
  getConn().prepare(
    `INSERT INTO task_artifacts
     (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
     VALUES (?,?,NULL,'discovery_spec',NULL,1,?,?)`,
  ).run(nid("art"), workItemId, JSON.stringify({ schema: "discovery_spec/v1", ...spec }), nowIso());
  getConn().prepare("UPDATE work_items SET status='waiting',updated_at=? WHERE id=?").run(nowIso(), workItemId);
  return {
    entry: "think",
    task_type: "discovery_plan",
    skill: "discovery_plan",
    session_id: sessionId,
    work_item_id: workItemId,
    crawled: false,
    ingested: false,
    spec: { schema: "discovery_spec/v1", ...spec },
  };
}

export async function startHomeDiscoveryRun(body: Json): Promise<Json> {
  registerHomeDiscoveryHook();
  const owner = ownerId();
  const existing = getConn().prepare(
    `SELECT * FROM discovery_runs
      WHERE kind=? AND owner_user_id=? AND status IN ('queued','crawling','ranking')
      ORDER BY created_at DESC LIMIT 1`,
  ).get(HOME_KIND, owner) as Row | undefined;
  if (existing) {
    return { ...publicRun(existing), duplicate: true, reused: true };
  }
  const spec = validateSpec(body);
  const skill = taskDefinition("creator_discovery");
  const lockedSkillContract = skill ? {
    skill_id: skill.id,
    skill_version: "unversioned",
    memory_policy: skill.memory_policy || null,
    result_type: skill.result_type || null,
  } : null;
  const platform = spec.platforms[0];
  const title = `AI发现 · ${platform} · ${spec.keywords.join(" ") || spec.mode}`.slice(0, 200);
  const sessionId = createSession(owner, title);
  const workItemId = createWorkItem({
    owner,
    sessionId,
    taskType: "discovery_crawl",
    skill: "discovery_brief",
    title,
    payload: spec,
  });
  const requestId = nid("dreq");
  const runId = nid("drun");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO discovery_requests
       (id,owner_user_id,keywords,platforms,mode,filters,brand,scope,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'queued',?,?)`,
    ).run(
      requestId,
      owner,
      JSON.stringify(spec.keywords),
      JSON.stringify(spec.platforms),
      spec.mode,
      JSON.stringify({
        region: spec.region,
        directions: spec.directions,
        ...spec.thresholds,
      }),
      spec.brand,
      JSON.stringify({ kind: HOME_KIND }),
      now,
      now,
    );
    db.prepare(
      `INSERT INTO discovery_runs
       (id,request_id,owner_user_id,work_item_id,session_id,platform,mode,parameters,idempotency_key,
        status,kind,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'queued',?,?,?)`,
    ).run(
      runId,
      requestId,
      owner,
      workItemId,
      sessionId,
      platform,
      spec.mode,
      JSON.stringify({
        keywords: spec.keywords,
        directions: spec.directions,
        region: spec.region,
        ...(lockedSkillContract ? { skill_contract: lockedSkillContract } : {}),
        ...spec.thresholds,
      }),
      `home:${requestId}:${platform}:${nid("idem")}`,
      HOME_KIND,
      now,
      now,
    );
    db.prepare("UPDATE discovery_requests SET latest_run_id=? WHERE id=?").run(runId, requestId);
  });
  event(workItemId, "discovery.queued", "queued", "发现采集已排队");
  if (spec.target_count_clamped) {
    event(workItemId, "discovery.target_clamped", "queued", "目标人数已限制为 80");
  }
  const run = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(runId) as Row;
  await startHomeCrawl(run);
  return publicRun(getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(runId) as Row);
}

export async function retryHomeDiscoveryRun(id: string): Promise<Json> {
  registerHomeDiscoveryHook();
  const run = homeRunRow(id);
  const status = String(run.status);
  if (status === "crawl_failed") {
    getConn().prepare(
      "UPDATE discovery_runs SET crawl_job_id=NULL, remote_task_id=NULL, error=NULL, completed_at=NULL, updated_at=? WHERE id=?",
    ).run(nowIso(), run.id);
    updateRunStatus(String(run.id), "queued");
    event(String(run.work_item_id || ""), "discovery.queued", "queued", "重新排队采集");
    await startHomeCrawl(getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(run.id) as Row);
    return publicRun(homeRunRow(id));
  }
  if (status === "rank_failed") {
    const count = Number(run.candidate_count || 0);
    const raw = count;
    await rankHomeDiscoveryRun(run, { raw, written: count, dropped: 0 });
    return publicRun(homeRunRow(id));
  }
  throw new HttpFail(409, { code: "retry_not_applicable", message: "当前状态不能重试。" });
}

export async function cancelHomeDiscoveryRun(id: string): Promise<Json> {
  registerHomeDiscoveryHook();
  const run = homeRunRow(id);
  if (run.crawl_job_id) {
    await stopCrawl(String(run.crawl_job_id));
  }
  updateRunStatus(String(run.id), "cancelled", { completed: true });
  event(String(run.work_item_id || ""), "failed", "cancelled", "发现采集已取消");
  return publicRun(homeRunRow(id));
}

export function ignoreHomeDiscoveryCandidate(id: string): Json {
  const candidate = homeCandidateRow(id);
  const now = nowIso();
  getConn().prepare(
    `UPDATE creator_candidates
        SET status='dismissed', dismissed_at=COALESCE(dismissed_at, ?), updated_at=?
      WHERE id=?`,
  ).run(now, now, candidate.id);
  audit(ownerId(), "discovery.candidate.ignored", { candidate_id: candidate.id });
  return publicCandidate(getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(candidate.id) as Row);
}

const INGEST_HANDOFF = {
  executed: false,
  starry_written: false,
  code: "ingest_handoff",
  message: "采集完成只保留 CreatorCandidate。正式入库由网关 POST /api/home/discovery/ingest 执行，本路径不写 Starry。",
} as const;

export function homeDiscoveryIngestPlaceholder(id: string): Json {
  homeRunRow(id);
  return { ...INGEST_HANDOFF };
}

export function homeDiscoveryCandidateIngestPlaceholder(id: string): Json {
  homeCandidateRow(id);
  return { ...INGEST_HANDOFF };
}

/** This path must not create Collaboration. Real ingest/claim is not owned here. */
export function homeDiscoveryFollowForbidden(id: string): Json {
  homeCandidateRow(id);
  return {
    executed: false,
    collaboration_created: false,
    starry_written: false,
    code: "home_discovery_follow_forbidden",
    message: "本路径禁止 follow 创建 Collaboration。采集完成只保留 CreatorCandidate。",
  };
}

export function starryWriteCounts(): { sends: number; stageWrites: number; transitions: number } {
  return {
    sends: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get() as { n: number }).n),
    stageWrites: Number((getConn().prepare("SELECT COUNT(*) AS n FROM starry_stage_writes").get() as { n: number }).n),
    transitions: Number((getConn().prepare("SELECT COUNT(*) AS n FROM stage_transitions").get() as { n: number }).n),
  };
}
