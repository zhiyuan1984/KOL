/**
 * Home AI发现 — first-class discovery pipeline.
 *
 * Prefill / pending confirm only. Crawl completion writes CreatorCandidates.
 * Collaboration is created only on employee confirm-follow.
 * Never sends mail, never writes/advances official stage.
 */
import { authDisabled, isAdmin, scopedUser } from "./auth.js";
import { BRAND_MAILBOXES, DEMO_USER } from "./config.js";
import {
  getCollectorConnectionSnapshot,
  probeMediaCrawlerConnection,
  publicCollectorConnection,
} from "./crawl/connection.js";
import { startCrawl, onCrawlJobSettled } from "./crawl/service.js";
import { OVERSEAS_CRAWL_PLATFORMS } from "./crawl/platforms.js";
import { audit, getConn, nowIso, tx } from "./db.js";
import { recordDiscoveryFact } from "./host/discovery-facts.js";
import { ingestFormalProfile } from "./host/kol-memory.js";
import {
  collectorFailureCode,
  employeeError,
  mapEmployeeError,
  persistableEmployeeError,
  sanitizeSecret,
} from "./discovery-errors.js";
import { emptyDiscoveryHint, expandOverseasSearchKeywords } from "./discovery-keywords.js";
import {
  avgViews10,
  buildCrawlerImportFile,
  candidateHasContactEmail,
  candidateRegionOf,
  creatorExternalId,
  employeeImportError,
  evaluateFollowFilters,
  isPlaceholderKolUid,
  isRealKolUid,
  mapCandidateToCrawlerRow,
  parseFollowThresholds,
  planRegionOf,
  recheckFollowFilters,
  shouldWarnMissingCandidateRegion,
  sourceBatchFor,
  sourceBatchForFollowSet,
  type FollowThresholds,
} from "./discovery-import.js";
import { importKolProfilesFromCrawlerConfirmed } from "./gateway/import-creator.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json, Row } from "./types.js";

const OVERSEAS = new Set<string>(OVERSEAS_CRAWL_PLATFORMS);
/** Empty `platforms` defaults to these two codes — not "all platforms" and not a simultaneous multi-platform crawl. */
const DEFAULT_PLATFORMS = ["youtube", "instagram"] as const;
const MODES = new Set(["search", "detail", "creator"]);
const RUN_ACTIVE = new Set(["queued", "running"]);
const CRAWL_ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);
const MAX_DIRECTIONS = 8;
const MAX_DIRECTION_LEN = 30;
const MAX_FOLLOW_BATCH = 100;
const FOLLOW_BATCH_CONCURRENCY = 3;
const REGION_CODES = new Set(["all", "us", "ca", "eu", "au", "na", "sea"]);
const REQUEST_STATUS_LABEL: Record<string, string> = {
  open: "待确认",
  running: "采集中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "采集中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};
const REGION_LABEL: Record<string, string> = {
  all: "全部",
  us: "美国",
  ca: "加拿大",
  eu: "欧洲",
  au: "澳洲",
  na: "北美",
  sea: "东南亚",
};

let hookRegistered = false;

export function registerDiscoveryCrawlHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  onCrawlJobSettled(ingestDiscoveryFromCrawlJob);
}

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

function connectionPayload(): Json {
  return publicCollectorConnection(getCollectorConnectionSnapshot());
}

function platformLabel(code: unknown): string {
  const key = String(code || "").toLowerCase();
  return PLATFORM_LABEL[key] || String(code || "");
}

function formatFollowers(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 10000) return `${Math.round(n / 10000)}万粉`;
  return `${n}粉`;
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

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function regionLabel(code: unknown): string {
  const key = String(code || "").toLowerCase();
  return REGION_LABEL[key] || String(code || "");
}

function failFilter(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new HttpFail(400, { code, message, ...extra });
}

function normalizeDirectionItems(value: unknown, field: string): string[] {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) {
    failFilter("invalid_directions", "内容方向须为最多 8 个短词。", { field });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (item == null || item === "") continue;
    if (typeof item !== "string" && typeof item !== "number") {
      failFilter("invalid_directions", "内容方向须为文字。", { field });
    }
    const text = String(item).trim();
    if (!text) continue;
    if (text.length > MAX_DIRECTION_LEN) {
      failFilter("direction_too_long", "每个内容方向不超过 30 个字。", { field, max: MAX_DIRECTION_LEN });
    }
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  if (out.length > MAX_DIRECTIONS) {
    failFilter("too_many_directions", "内容方向最多 8 个。", { field, max: MAX_DIRECTIONS });
  }
  return out;
}

function normalizeLegacyNiche(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (typeof value !== "string") {
    failFilter("invalid_niche", "旧版方向字段须为一段文字。", { field: "niche" });
  }
  return normalizeDirectionItems([value], "niche");
}

function normalizeRegion(value: unknown): string {
  const code = String(value ?? "all").trim().toLowerCase();
  if (!code) return "all";
  if (!REGION_CODES.has(code)) {
    failFilter("invalid_region", "地区仅支持 全部、美国、加拿大、欧洲、澳洲。", { field: "region" });
  }
  return code;
}

function normalizeFilters(raw: unknown): { region: string; directions: string[] } {
  if (raw == null || raw === "") return { region: "all", directions: [] };
  if (!isPlainObject(raw)) {
    failFilter("invalid_filters", "筛选条件格式不正确。");
  }
  const directions = normalizeDirectionItems(raw.directions, "directions");
  const niche = normalizeLegacyNiche(raw.niche);
  return {
    region: normalizeRegion(raw.region),
    directions: normalizeDirectionItems([...directions, ...niche], "directions"),
  };
}

function foldSearchKeywords(keywords: string[], directions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...keywords, ...directions]) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function crawlSearchKeywords(keywords: string[], filters: { region: string; directions: string[] }): string[] {
  return expandOverseasSearchKeywords({
    keywords,
    directions: filters.directions,
    region: filters.region,
  });
}

function searchKeywordsOf(row?: Row | null): string[] {
  if (!row) return [];
  return asStringList(parseJson(row.parameters).keywords);
}

function storedFilters(row: Row): { region: string; directions: string[] } {
  const raw = parseJson(row.filters);
  const directions = asStringList(raw.directions);
  const niche = typeof raw.niche === "string" ? String(raw.niche).trim() : "";
  return {
    region: String(raw.region || "all").toLowerCase() || "all",
    directions: foldSearchKeywords(directions, niche ? [niche] : []),
  };
}

function validateOverseasPlatforms(platforms: string[]): string[] {
  // Empty list is a default of youtube+instagram, not 「全部平台」. One run still uses one platform.
  const list = platforms.length ? platforms : [...DEFAULT_PLATFORMS];
  const invalid = list.filter((code) => !OVERSEAS.has(code));
  if (invalid.length) {
    throw new HttpFail(400, {
      code: "overseas_platforms_only",
      message: "AI发现只支持 YouTube、Instagram、Facebook。",
      platforms: invalid,
    });
  }
  return [...new Set(list)];
}

function validateMode(mode: string): string {
  const value = mode.toLowerCase() || "search";
  if (!MODES.has(value)) {
    throw new HttpFail(400, { code: "invalid_crawl_mode", message: "采集方式不正确。" });
  }
  return value;
}

function runStatusFromCrawl(status: string): string {
  if (["result_ready", "completed", "done"].includes(status)) return "succeeded";
  if (["error", "failed"].includes(status)) return "failed";
  if (["stopped", "cancelled"].includes(status)) return "cancelled";
  if (CRAWL_ACTIVE.has(status)) return status === "queued" ? "queued" : "running";
  return "queued";
}

function requestRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM discovery_requests WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin() && String(row.owner_user_id) !== ownerId())) {
    throw new HttpFail(404, { code: "discovery_request_not_found", message: "未找到该发现请求" });
  }
  return row;
}

function runRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin() && String(row.owner_user_id) !== ownerId())) {
    throw new HttpFail(404, { code: "discovery_run_not_found", message: "未找到该发现运行" });
  }
  return row;
}

function candidateRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin() && String(row.owner_user_id) !== ownerId())) {
    throw new HttpFail(404, { code: "creator_candidate_not_found", message: "未找到该发现候选人" });
  }
  return row;
}

function candidateReason(row: Row): string {
  const handle = String(row.handle || row.nickname || "").trim();
  const bits = [
    platformLabel(row.platform),
    handle ? `@${handle}` : "",
    formatFollowers(row.followers),
    Number(row.score) > 0 ? `评分 ${Number(row.score)}` : "",
    String(row.status) === "suggested" ? "待加入跟进" : "",
  ].filter(Boolean);
  return bits.join(" · ") || "发现候选人";
}

function publicCandidate(row: Row): Json {
  const payload = parseJson(row.payload);
  const handle = String(row.handle || row.nickname || "");
  const nickname = String(row.nickname || row.handle || "");
  const reason = candidateReason(row);
  const title = handle ? `发现 @${handle}` : "发现新达人";
  return {
    id: row.id,
    request_id: row.request_id,
    run_id: row.run_id,
    platform: row.platform,
    handle,
    nickname,
    followers: Number(row.followers || 0),
    avg_views_10: avgViews10(row),
    score: Number(row.score || 0),
    has_contact_email: candidateHasContactEmail(row),
    region: candidateRegionOf(row) || null,
    avatar_url: payload.avatar_url || payload.avatar || payload.profile_image || null,
    title,
    reason,
    summary: reason,
    source: "ai",
    source_label: "AI发现",
    intent: "creator_profile",
    signals: parseJson(row.signals),
    status: row.status,
    collaboration_id: row.collaboration_id || null,
    dismissed_at: row.dismissed_at || null,
    followed_at: row.followed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function countsFor(requestId: string): {
  candidate_count: number;
  suggested_count: number;
  followed_count: number;
  dismissed_count: number;
} {
  const row = getConn().prepare(
    `SELECT
        COUNT(*) AS candidate_count,
        SUM(CASE WHEN status='suggested' THEN 1 ELSE 0 END) AS suggested_count,
        SUM(CASE WHEN status='followed' THEN 1 ELSE 0 END) AS followed_count,
        SUM(CASE WHEN status='dismissed' THEN 1 ELSE 0 END) AS dismissed_count
       FROM creator_candidates WHERE request_id=?`,
  ).get(requestId) as Row;
  return {
    candidate_count: Number(row.candidate_count || 0),
    suggested_count: Number(row.suggested_count || 0),
    followed_count: Number(row.followed_count || 0),
    dismissed_count: Number(row.dismissed_count || 0),
  };
}

function topCandidates(requestId: string, limit = 8): Json[] {
  return (getConn().prepare(
    `SELECT * FROM creator_candidates
      WHERE request_id=? AND status='suggested'
      ORDER BY score DESC, followers DESC, created_at DESC LIMIT ?`,
  ).all(requestId, limit) as Row[]).map(publicCandidate);
}

export function discoveryResult(requestId: string, run?: Row | null): Json {
  const counts = countsFor(requestId);
  const latest = run || latestRun(requestId);
  const errors = [employeeError(latest?.error)].filter(Boolean);
  return {
    ...counts,
    top_candidates: topCandidates(requestId),
    errors,
    ready: counts.suggested_count > 0,
    pending_confirm: counts.suggested_count > 0,
    connection: connectionPayload(),
  };
}

function publicRun(row: Row): Json {
  syncRunFromCrawl(row);
  const current = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(row.id) as Row;
  const status = String(current.status);
  const searchKeywords = searchKeywordsOf(current);
  const candidateCount = Number(current.candidate_count || 0);
  return {
    id: current.id,
    request_id: current.request_id,
    platform: current.platform,
    status,
    status_label: RUN_STATUS_LABEL[status] || status,
    error: employeeError(current.error),
    search_keywords: searchKeywords,
    empty_hint: status === "succeeded" && candidateCount === 0 ? emptyDiscoveryHint(searchKeywords) : null,
    brief_version: Number(current.brief_version || parseJson(current.parameters).brief_version || 1),
    candidate_count: candidateCount,
    created_at: current.created_at,
    started_at: current.started_at,
    updated_at: current.updated_at,
    completed_at: current.completed_at,
    connection: connectionPayload(),
  };
}

function planSummary(row: Row): string {
  const filters = storedFilters(row);
  const keywords = foldSearchKeywords(parseArray(row.keywords).map(String), filters.directions);
  const platforms = parseArray(row.platforms).map(platformLabel).filter(Boolean);
  const topic = keywords.length ? `「${keywords.join(" / ")}」` : "关键词";
  const where = platforms.length ? platforms.join("、") : "海外平台";
  const region = filters.region && filters.region !== "all" ? regionLabel(filters.region) : "";
  return region ? `按 ${topic} 在 ${where} 发现达人 · ${region}` : `按 ${topic} 在 ${where} 发现达人`;
}

function latestRun(requestId: string): Row | undefined {
  return getConn().prepare(
    "SELECT * FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(requestId) as Row | undefined;
}

function publicRequest(row: Row): Json {
  const latest = row.latest_run_id
    ? getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(row.latest_run_id) as Row | undefined
    : latestRun(String(row.id));
  if (latest) syncRunFromCrawl(latest);
  const current = getConn().prepare("SELECT * FROM discovery_requests WHERE id=?").get(row.id) as Row;
  const status = String(current.status);
  const summary = planSummary(current);
  return {
    id: current.id,
    status,
    status_label: REQUEST_STATUS_LABEL[status] || status,
    keywords: parseArray(current.keywords).map(String),
    platforms: parseArray(current.platforms).map(String),
    filters: storedFilters(current),
    title: summary,
    plan_summary: summary,
    brand: current.brand || null,
    latest_run: latest ? publicRun(latest) : null,
    error: employeeError(current.error),
    created_at: current.created_at,
    updated_at: current.updated_at,
    connection: connectionPayload(),
  };
}

export function getDiscoveryResults(id: string): Json {
  const request = requestRow(id);
  const latest = latestRun(String(request.id));
  if (latest) {
    syncRunFromCrawl(latest);
    if (latest.crawl_job_id) {
      const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(latest.crawl_job_id) as Row | undefined;
      if (job && String(job.status) === "result_ready") ingestDiscoveryFromCrawlJob(job);
    }
  }
  const current = getConn().prepare("SELECT * FROM discovery_requests WHERE id=?").get(request.id) as Row;
  const run = latestRun(String(current.id));
  const counts = countsFor(String(current.id));
  const candidates = (getConn().prepare(
    `SELECT * FROM creator_candidates WHERE request_id=?
      ORDER BY CASE status WHEN 'suggested' THEN 0 WHEN 'followed' THEN 1 ELSE 2 END,
               score DESC, followers DESC, created_at DESC`,
  ).all(current.id) as Row[]).map(publicCandidate);
  const summary = planSummary(current);
  const searchKeywords = searchKeywordsOf(run);
  const succeeded = String(current.status) === "succeeded" || String(run?.status) === "succeeded";
  return {
    id: current.id,
    status: current.status,
    status_label: REQUEST_STATUS_LABEL[String(current.status)] || String(current.status),
    keywords: parseArray(current.keywords).map(String),
    platforms: parseArray(current.platforms).map(String),
    filters: storedFilters(current),
    title: summary,
    plan_summary: summary,
    created_at: current.created_at,
    updated_at: current.updated_at,
    request: publicRequest(current),
    run: run ? publicRun(run) : null,
    candidates,
    counts,
    error: employeeError(current.error),
    search_keywords: searchKeywords,
    empty_hint: succeeded && counts.candidate_count === 0 ? emptyDiscoveryHint(searchKeywords) : null,
    ready: counts.suggested_count > 0,
    pending_confirm: String(current.status) === "open" || counts.suggested_count > 0,
    connection: connectionPayload(),
  };
}

function refreshRequestStatus(requestId: string): void {
  const runs = getConn().prepare(
    "SELECT status, error FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC",
  ).all(requestId) as Row[];
  const latest = runs[0];
  let status = "open";
  if (runs.some((run) => RUN_ACTIVE.has(String(run.status)))) status = "running";
  else if (runs.some((run) => String(run.status) === "succeeded")) status = "succeeded";
  else if (runs.some((run) => String(run.status) === "failed")) status = "failed";
  else if (runs.some((run) => String(run.status) === "cancelled")) status = "cancelled";
  const error = latest?.error ? persistableEmployeeError(latest.error) : null;
  getConn().prepare(
    `UPDATE discovery_requests
        SET status=?, error=?, latest_run_id=COALESCE(
          (SELECT id FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC LIMIT 1), latest_run_id
        ), updated_at=?, data_version=data_version+1
      WHERE id=?`,
  ).run(status, error, requestId, nowIso(), requestId);
}

function persistRunFromCrawl(run: Row, job: Row): void {
  const status = runStatusFromCrawl(String(job.status));
  const now = nowIso();
  const completed = ["succeeded", "failed", "cancelled"].includes(status) ? (job.completed_at || now) : null;
  const previous = String(run.status || "");
  getConn().prepare(
    `UPDATE discovery_runs
        SET status=?, remote_task_id=COALESCE(?, remote_task_id), error=?,
            started_at=COALESCE(started_at, ?), completed_at=?, updated_at=?, data_version=data_version+1
      WHERE id=?`,
  ).run(
    status,
    job.remote_task_id || null,
    job.error ? persistableEmployeeError(job.error) : null,
    job.started_at || now,
    completed,
    now,
    run.id,
  );
  refreshRequestStatus(String(run.request_id));
  const jobStatus = String(job.status || "");
  if ((jobStatus === "idle" || status === "succeeded") && previous !== "succeeded") {
    recordDiscoveryFact({
      kind: "crawl_idle",
      object_type: "discovery_run",
      object_id: String(run.id),
      payload: { crawl_status: jobStatus, run_status: status },
      actor: String(run.owner_user_id || "host"),
      source_version: String(run.brief_version || 1),
    });
  }
}

function syncRunFromCrawl(run: Row): void {
  if (!run.crawl_job_id) return;
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(run.crawl_job_id) as Row | undefined;
  if (!job) return;
  persistRunFromCrawl(run, job);
}

function upsertCandidatesFromJob(run: Row, job: Row): number {
  const snapshots = getConn().prepare(
    `SELECT s.*, c.id AS claw_creator_id, c.handle AS claw_handle, c.name AS claw_name
       FROM creator_snapshots s
       JOIN claw_creators c ON c.id = s.creator_id
      WHERE s.crawl_job_id=?
      ORDER BY s.created_at DESC`,
  ).all(job.id) as Row[];
  const seen = new Set<string>();
  const now = nowIso();
  let written = 0;
  tx((db) => {
    for (const snap of snapshots) {
      const platform = String(snap.platform || job.platform || "").toLowerCase();
      const platformCreatorId = String(snap.platform_creator_id || "").trim();
      if (!OVERSEAS.has(platform) || !platformCreatorId) continue;
      const key = `${platform}:${platformCreatorId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const nickname = String(snap.nickname || snap.claw_name || snap.claw_handle || "").trim();
      const existing = db.prepare(
        "SELECT * FROM creator_candidates WHERE request_id=? AND platform=? AND platform_creator_id=?",
      ).get(run.request_id, platform, platformCreatorId) as Row | undefined;
      const payload = {
        ...parseJson(snap.score_details),
        platform,
        platform_creator_id: platformCreatorId,
        nickname,
        followers: Number(snap.followers || 0),
        recent_views: parseArray(snap.recent_views),
        score: Number(snap.score || 0),
        score_details: parseJson(snap.score_details),
        collected_at: snap.collected_at,
        crawl_job_id: job.id,
        source: "ai",
        contact_needed: true,
      };
      const signals = {
        score: Number(snap.score || 0),
        followers: Number(snap.followers || 0),
        recent_views: parseArray(snap.recent_views),
        sample_confidence: Number(parseJson(snap.score_details).sample_confidence || 0),
      };
      if (existing) {
        db.prepare(
          `UPDATE creator_candidates
              SET run_id=?, claw_creator_id=?, handle=?, nickname=?, followers=?, score=?,
                  signals=?, payload=?, updated_at=?
            WHERE id=?`,
        ).run(
          run.id, snap.claw_creator_id || existing.claw_creator_id, nickname, nickname,
          Number(snap.followers || 0), Number(snap.score || 0),
          JSON.stringify(signals), JSON.stringify(payload), now, existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO creator_candidates
           (id,request_id,run_id,owner_user_id,platform,platform_creator_id,claw_creator_id,
            handle,nickname,followers,score,signals,payload,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'suggested',?,?)`,
        ).run(
          nid("cand"), run.request_id, run.id, run.owner_user_id, platform, platformCreatorId,
          snap.claw_creator_id || null, nickname, nickname, Number(snap.followers || 0),
          Number(snap.score || 0), JSON.stringify(signals), JSON.stringify(payload), now, now,
        );
      }
      written += 1;
    }
    db.prepare(
      "UPDATE discovery_runs SET candidate_count=?, updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(written, now, run.id);
  });
  return written;
}

export function ingestDiscoveryFromCrawlJob(job: Row): void {
  const run = getConn().prepare("SELECT * FROM discovery_runs WHERE crawl_job_id=?").get(job.id) as Row | undefined;
  if (!run) return;
  if (String(run.kind || "") === "home") return;
  persistRunFromCrawl(run, job);
  if (String(job.status) === "result_ready") {
    upsertCandidatesFromJob(run, job);
    refreshRequestStatus(String(run.request_id));
  }
}

function createContainerWorkItem(input: {
  ownerUserId: string;
  platform: string;
  mode: string;
  keywords: string[];
}): string {
  const id = nid("tsk");
  const now = nowIso();
  const title = `AI发现 · ${input.platform} · ${input.keywords.join(" ") || input.mode}`.slice(0, 200);
  getConn().prepare(
    `INSERT INTO work_items
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,
      input,entities,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  ).run(
    id,
    input.ownerUserId,
    "creator_discovery",
    title,
    "discovery",
    "pending",
    "normal",
    "creator_discovery",
    "lead",
    JSON.stringify({
      prompt: title,
      platform: input.platform,
      keywords: input.keywords,
      insight: true,
    }),
    JSON.stringify({ platform: input.platform, keywords: input.keywords }),
    now,
    now,
  );
  return id;
}

function pickPlatform(request: Row, requested?: string): string {
  const platforms = parseArray(request.platforms).map((item) => String(item).toLowerCase());
  if (requested) {
    const platform = requested.toLowerCase();
    if (!platforms.includes(platform)) {
      throw new HttpFail(400, { code: "platform_not_in_request", message: "该平台不在本次发现请求内。", platform });
    }
    return validateOverseasPlatforms([platform])[0];
  }
  const used = new Set(
    (getConn().prepare(
      "SELECT platform, status FROM discovery_runs WHERE request_id=?",
    ).all(request.id) as Row[])
      .filter((row) => ["queued", "running", "succeeded"].includes(String(row.status)))
      .map((row) => String(row.platform)),
  );
  const next = platforms.find((code) => !used.has(code));
  return validateOverseasPlatforms([next || platforms[0] || "youtube"])[0];
}

export async function startDiscoveryRun(input: {
  requestId: string;
  platform?: string;
  idempotencyKey?: string;
}): Promise<Json> {
  registerDiscoveryCrawlHook();
  const request = requestRow(input.requestId);
  const platform = pickPlatform(request, input.platform);
  const mode = String(request.mode || "search");
  const filters = storedFilters(request);
  const submitted = parseArray(request.keywords).map(String);
  const keywords = crawlSearchKeywords(submitted, filters);
  const parameters: Json = { ...filters, keywords };
  const idempotencyKey = String(input.idempotencyKey || `disc:${request.id}:${platform}:${nid("idem")}`);
  const existing = getConn().prepare("SELECT * FROM discovery_runs WHERE idempotency_key=?").get(idempotencyKey) as
    | Row
    | undefined;
  if (existing) return { ...publicRun(existing), duplicate: true };

  const ownerUserId = String(request.owner_user_id);
  const workItemId = createContainerWorkItem({ ownerUserId, platform, mode, keywords });
  const runId = nid("drun");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO discovery_runs
       (id,request_id,owner_user_id,work_item_id,platform,mode,parameters,idempotency_key,
        status,brief_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'queued',?,?,?)`,
    ).run(
      runId, request.id, ownerUserId, workItemId, platform, mode,
      JSON.stringify({ ...parameters, brief_version: Number(request.brief_version || request.data_version || 1) }),
      idempotencyKey,
      Number(request.brief_version || request.data_version || 1),
      now, now,
    );
    db.prepare(
      "UPDATE discovery_requests SET latest_run_id=?, status='running', updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(runId, now, request.id);
  });
  recordDiscoveryFact({
    kind: "run_create",
    object_type: "discovery_run",
    object_id: runId,
    payload: {
      request_id: String(request.id),
      platform,
      brief_version: Number(request.brief_version || request.data_version || 1),
    },
    actor: ownerUserId,
    source_version: String(request.brief_version || 1),
  });

  try {
    const job = await startCrawl({
      ownerUserId,
      workItemId,
      platform,
      mode,
      parameters,
      idempotencyKey,
    });
    const crawlJobId = String(job.id);
    getConn().prepare(
      `UPDATE discovery_runs
          SET crawl_job_id=?, remote_task_id=?, status=?, started_at=?, updated_at=?, data_version=data_version+1
        WHERE id=?`,
    ).run(
      crawlJobId,
      job.remote_task_id || null,
      runStatusFromCrawl(String(job.status)),
      nowIso(),
      nowIso(),
      runId,
    );
    refreshRequestStatus(String(request.id));
    const run = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(runId) as Row;
    if (String(job.status) === "result_ready") ingestDiscoveryFromCrawlJob(job as Row);
    return publicRun(run);
  } catch (error) {
    const source = error instanceof HttpFail ? error.detail ?? error : error;
    const mapped = mapEmployeeError(source);
    const safe = mapped.message;
    const sourceObj = source && typeof source === "object" && !Array.isArray(source)
      ? source as { crawl_job_id?: unknown }
      : null;
    console.warn("[discovery.run] failed", {
      request_id: String(request.id),
      run_id: runId,
      code: collectorFailureCode(source),
      error: sanitizeSecret(source),
      ...(typeof sourceObj?.crawl_job_id === "string" && sourceObj.crawl_job_id
        ? { crawl_job_id: sourceObj.crawl_job_id }
        : {}),
    });
    getConn().prepare(
      `UPDATE discovery_runs
          SET status='failed', error=?, completed_at=?, updated_at=?, data_version=data_version+1
        WHERE id=?`,
    ).run(safe, nowIso(), nowIso(), runId);
    refreshRequestStatus(String(request.id));
    if (error instanceof HttpFail && error.status === 503) {
      throw new HttpFail(503, {
        code: "discovery_not_ready",
        message: "发现服务暂未就绪，请稍后重试。",
        next_action: "请确认后再启动发现。",
      });
    }
    throw new HttpFail(error instanceof HttpFail ? error.status : 502, {
      code: collectorFailureCode(source),
      message: safe,
    });
  }
}

export async function checkDiscoveryConnection(): Promise<Json> {
  return publicCollectorConnection(await probeMediaCrawlerConnection());
}

export function createDiscoveryRequest(body: Json): Json {
  const keywords = asStringList(body.keywords ?? body.keyword);
  const mode = validateMode(String(body.mode || "search"));
  if (mode === "search" && !keywords.length) {
    throw new HttpFail(400, { code: "keywords_required", message: "请先填写要发现的关键词。" });
  }
  const platforms = validateOverseasPlatforms(
    asStringList(body.platforms ?? body.platform).map((code) => code.toLowerCase()),
  );
  const filters = normalizeFilters(body.filters);
  const owner = ownerId();
  const id = nid("dreq");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO discovery_requests
       (id,owner_user_id,keywords,platforms,mode,filters,brand,scope,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'open',?,?)`,
    ).run(
      id,
      owner,
      JSON.stringify(keywords),
      JSON.stringify(platforms),
      mode,
      JSON.stringify(filters),
      body.brand ? String(body.brand) : null,
      JSON.stringify(body.scope && typeof body.scope === "object" ? body.scope : {}),
      now,
      now,
    );
  });
  audit(owner, "discovery.request.created", { request_id: id, platforms, mode });
  recordDiscoveryFact({
    kind: "brief",
    object_type: "discovery_request",
    object_id: id,
    payload: { platforms, mode, keywords, brief_version: 1 },
    actor: owner,
    source_version: "1",
  });
  return publicRequest(requestRow(id));
}

export function listDiscoveryRequests(): Json[] {
  const adminAll = isAdmin();
  const rows = adminAll
    ? getConn().prepare("SELECT * FROM discovery_requests ORDER BY updated_at DESC").all() as Row[]
    : getConn().prepare(
        "SELECT * FROM discovery_requests WHERE owner_user_id=? ORDER BY updated_at DESC",
      ).all(ownerId()) as Row[];
  return rows.map(publicRequest);
}

export function getDiscoveryRequest(id: string): Json {
  return publicRequest(requestRow(id));
}

export function getDiscoveryRun(id: string): Json {
  return publicRun(runRow(id));
}

export function listRunCandidates(runId: string, query: {
  status?: string;
  limit?: number;
  offset?: number;
}): Json {
  const run = runRow(runId);
  syncRunFromCrawl(run);
  if (run.crawl_job_id) {
    const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(run.crawl_job_id) as Row | undefined;
    if (job && String(job.status) === "result_ready") ingestDiscoveryFromCrawlJob(job);
  }
  const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
  const offset = Math.max(0, Number(query.offset || 0));
  const status = String(query.status || "").trim();
  const rows = (status
    ? getConn().prepare(
        `SELECT * FROM creator_candidates WHERE run_id=? AND status=?
          ORDER BY score DESC, followers DESC, created_at DESC LIMIT ? OFFSET ?`,
      ).all(run.id, status, limit, offset)
    : getConn().prepare(
        `SELECT * FROM creator_candidates WHERE run_id=?
          ORDER BY score DESC, followers DESC, created_at DESC LIMIT ? OFFSET ?`,
      ).all(run.id, limit, offset)) as Row[];
  const totalRow = (status
    ? getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE run_id=? AND status=?").get(run.id, status)
    : getConn().prepare("SELECT COUNT(*) AS n FROM creator_candidates WHERE run_id=?").get(run.id)) as { n: number };
  const total = Number(totalRow.n);
  return {
    items: rows.map(publicCandidate),
    total,
    limit,
    offset,
    run: publicRun(getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(run.id) as Row),
  };
}

export function getCandidate(id: string): Json {
  return publicCandidate(candidateRow(id));
}

/**
 * Link an existing Collaboration to this candidate.
 * Prefer real kol_uid, then platform + platform_creator_id / candidate.collaboration_id.
 * Bare handle/display_name is only for leftover source=discovery + disc_* rows of THIS creator.
 * Never attach a real Starry kolUid onto an unrelated Starry-sourced collab via handle.
 */
function existingCollaboration(candidate: Row, kolUid?: string): Row | undefined {
  if (candidate.collaboration_id) {
    const byId = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(candidate.collaboration_id) as
      | Row
      | undefined;
    if (byId) return byId;
  }
  if (kolUid && isRealKolUid(kolUid)) {
    const byReal = getConn().prepare("SELECT * FROM collaborations WHERE kol_uid=?").get(kolUid) as Row | undefined;
    if (byReal) return byReal;
  }
  const sibling = getConn().prepare(
    `SELECT c.* FROM creator_candidates cand
       JOIN collaborations c ON c.id = cand.collaboration_id
      WHERE cand.platform=? AND cand.platform_creator_id=? AND cand.status='followed'
        AND cand.collaboration_id IS NOT NULL
      ORDER BY cand.followed_at DESC LIMIT 1`,
  ).get(candidate.platform, candidate.platform_creator_id) as Row | undefined;
  if (sibling) return sibling;
  return leftoverDiscoveryPlaceholderByHandle(candidate);
}

function leftoverDiscoveryPlaceholderByHandle(candidate: Row): Row | undefined {
  const handle = String(candidate.handle || candidate.nickname || "").trim();
  if (!handle) return undefined;
  const expected = discoveryPlaceholderKolUid(candidate);
  const rows = getConn().prepare(
    `SELECT * FROM collaborations
      WHERE (handle=? OR display_name=?) AND source='discovery'`,
  ).all(handle, handle) as Row[];
  return rows.find((row) => isPlaceholderKolUid(row.kol_uid) && String(row.kol_uid) === expected);
}

/** Residual local placeholder from pre-ADR-022 follow. Success path must not keep this. */
export function discoveryPlaceholderKolUid(candidate: Row): string {
  return `disc_${candidate.platform}_${String(candidate.platform_creator_id).replace(/[^A-Za-z0-9._-]/g, "_")}`.slice(0, 80);
}

function ingestDiscoveryProfile(collaboration: Row, candidate?: Row): void {
  const kolUid = String(collaboration.kol_uid || "").trim();
  if (!kolUid) return;
  ingestFormalProfile({
    kol_uid: kolUid,
    handle: String(collaboration.handle || candidate?.handle || ""),
    display_name: String(collaboration.display_name || candidate?.nickname || ""),
    platform: String(collaboration.platform || candidate?.platform || ""),
    homepage_url: String(candidate?.homepage_url || candidate?.url || ""),
    followers: String(collaboration.followers || candidate?.followers || ""),
    avg_plays: String(collaboration.avg_views_10 || ""),
    engagement: String(collaboration.engagement_rate || ""),
    direction: String(collaboration.niche || ""),
    region: String(collaboration.audience_geo || ""),
    public_stage: String(collaboration.stage_code || ""),
    ingest_source: "discovery",
  });
}

function followResult(candidateId: string, collaborationId: string, created: boolean, extra: Json = {}): Json {
  const collaboration = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(collaborationId) as Row;
  ingestDiscoveryProfile(collaboration);
  return {
    ...publicCandidate(getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(candidateId) as Row),
    collaboration: {
      id: collaboration.id,
      handle: collaboration.handle,
      display_name: collaboration.display_name,
      platform: collaboration.platform,
      brand: collaboration.brand,
      stage_code: collaboration.stage_code,
      kol_uid: collaboration.kol_uid,
      source: collaboration.source,
    },
    created,
    ...extra,
  };
}

function markCandidateFollowed(candidateId: string, collaborationId: string): void {
  const now = nowIso();
  getConn().prepare(
    `UPDATE creator_candidates
        SET status='followed', collaboration_id=?, followed_at=COALESCE(followed_at, ?),
            dismissed_at=NULL, updated_at=?
      WHERE id=?`,
  ).run(collaborationId, now, now, candidateId);
}

/**
 * Employee confirm-follow (ADR-022 P0). One L3 confirm → Host import_creator
 * → backfill real kolUid → then mark followed + Collaboration.
 * Does not send mail, decrypt contact, or write/advance official stage.
 */
export async function followCandidate(id: string, input: Json = {}): Promise<Json> {
  const candidate = candidateRow(id);
  const request = getConn().prepare("SELECT * FROM discovery_requests WHERE id=?").get(candidate.request_id) as
    | Row
    | undefined;
  recheckFollowFilters(candidate, request, parseFollowThresholds(input.thresholds ?? input.filters));
  if (shouldWarnMissingCandidateRegion(candidate, request)) {
    audit(ownerId(), "discovery.candidate.region_unverified", {
      candidate_id: candidate.id,
      request_id: candidate.request_id,
      plan_region: planRegionOf(request),
      candidate_region: "",
    });
  }
  const sourceBatch = sourceBatchFor(candidate, input.source_batch);
  const externalId = creatorExternalId(candidate.platform, candidate.platform_creator_id);
  const existing = existingCollaboration(candidate);
  if (existing && isRealKolUid(existing.kol_uid) && String(candidate.status) === "followed") {
    markCandidateFollowed(String(candidate.id), String(existing.id));
    audit(ownerId(), "discovery.candidate.followed", {
      candidate_id: candidate.id,
      collaboration_id: existing.id,
      kol_uid: existing.kol_uid,
      source_batch: sourceBatch,
      created: false,
      reused: true,
    });
    return followResult(String(candidate.id), String(existing.id), false, { skipped_duplicate: true });
  }
  if (existing && isRealKolUid(existing.kol_uid) && String(candidate.status) !== "followed") {
    markCandidateFollowed(String(candidate.id), String(existing.id));
    audit(ownerId(), "discovery.candidate.followed", {
      candidate_id: candidate.id,
      collaboration_id: existing.id,
      kol_uid: existing.kol_uid,
      source_batch: sourceBatch,
      created: false,
      reused: true,
    });
    return followResult(String(candidate.id), String(existing.id), false);
  }

  const file = buildCrawlerImportFile(
    [mapCandidateToCrawlerRow(candidate)],
    `discovery-follow-${String(candidate.id).slice(0, 24)}.csv`,
  );
  const imported = await importKolProfilesFromCrawlerConfirmed({
    file,
    sourceBatch,
    creatorExternalId: externalId,
    candidateId: String(candidate.id),
    actor: ownerId(),
  });
  const kolUid = String(imported.kol_uid || "");
  if (!isRealKolUid(kolUid)) {
    throw new HttpFail(502, {
      code: "import_creator_no_kol_uid",
      message: "档案未回传红人编号，未加入跟进。",
    });
  }

  const linked = existingCollaboration(candidate, kolUid);
  const brand = String(request?.brand || "LT");
  const handle = String(candidate.handle || candidate.nickname || candidate.platform_creator_id).trim();
  const cid = String(linked?.id || nid("col"));
  const created = !linked;
  if (!linked) {
    tx((db) => {
      db.prepare(
        `INSERT INTO collaborations
         (id, handle, display_name, brand, platform, followers, email, mailbox_from,
          lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
          stage_version, locked, kol_uid, source, avg_views_10)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        cid,
        handle,
        handle,
        brand || "LT",
        String(candidate.platform),
        String(candidate.followers || ""),
        "",
        BRAND_MAILBOXES[brand] || BRAND_MAILBOXES.LT,
        `lc_${cid}`,
        `conv_${cid}`,
        "INITIAL_CONTACT",
        0,
        "from ai discovery follow",
        0,
        0,
        0,
        kolUid,
        "discovery",
        String(avgViews10(candidate) || ""),
      );
    });
  } else if (isPlaceholderKolUid(linked.kol_uid) || !String(linked.kol_uid || "").trim()) {
    getConn().prepare(
      "UPDATE collaborations SET kol_uid=?, avg_views_10=COALESCE(NULLIF(avg_views_10,''), ?) WHERE id=?",
    ).run(kolUid, String(avgViews10(candidate) || ""), cid);
  }
  markCandidateFollowed(String(candidate.id), cid);
  audit(ownerId(), "discovery.candidate.followed", {
    candidate_id: candidate.id,
    collaboration_id: cid,
    kol_uid: kolUid,
    source_batch: sourceBatch,
    creator_external_id: externalId,
    created,
    sent: false,
    stage_changed: false,
  });
  return followResult(String(candidate.id), cid, created);
}

function requestForCandidate(candidate: Row): Row | undefined {
  return getConn().prepare("SELECT * FROM discovery_requests WHERE id=?").get(candidate.request_id) as
    | Row
    | undefined;
}

function loadFollowBatchCandidates(input: Json): Row[] {
  const ids = asStringList(input.candidate_ids ?? input.candidateIds);
  if (ids.length) {
    if (ids.length > MAX_FOLLOW_BATCH) {
      throw new HttpFail(400, {
        code: "follow_batch_too_large",
        message: "一次最多加入 100 条线索。",
        max: MAX_FOLLOW_BATCH,
      });
    }
    return ids.map((id) => candidateRow(id));
  }
  const runId = String(input.run_id || input.runId || "").trim();
  if (runId) {
    const run = runRow(runId);
    return getConn().prepare(
      `SELECT * FROM creator_candidates WHERE run_id=? AND status IN ('suggested','followed')
        ORDER BY CASE status WHEN 'suggested' THEN 0 ELSE 1 END, score DESC, followers DESC, created_at DESC
        LIMIT ?`,
    ).all(run.id, MAX_FOLLOW_BATCH) as Row[];
  }
  const requestId = String(input.request_id || input.requestId || "").trim();
  if (requestId) {
    const request = requestRow(requestId);
    return getConn().prepare(
      `SELECT * FROM creator_candidates WHERE request_id=? AND status IN ('suggested','followed')
        ORDER BY CASE status WHEN 'suggested' THEN 0 ELSE 1 END, score DESC, followers DESC, created_at DESC
        LIMIT ?`,
    ).all(request.id, MAX_FOLLOW_BATCH) as Row[];
  }
  throw new HttpFail(400, {
    code: "follow_batch_empty",
    message: "请先勾选红人，或按条件筛选后再加入跟进。",
  });
}

function batchFailItem(candidate: Row, code: string, message: string): Json {
  return {
    candidate_id: candidate.id,
    handle: String(candidate.handle || candidate.nickname || ""),
    code,
    message,
  };
}

function failFromFollowError(candidate: Row, error: unknown): Json {
  if (error instanceof HttpFail) {
    const detail = error.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const body = detail as Json;
      return batchFailItem(
        candidate,
        String(body.code || "follow_failed"),
        String(body.message || employeeImportError(error)),
      );
    }
    if (typeof detail === "string") {
      return batchFailItem(candidate, "follow_failed", employeeImportError(detail));
    }
  }
  return batchFailItem(candidate, "follow_failed", employeeImportError(error));
}

async function runLimited<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergePlanFilter(
  request: Row | undefined,
  thresholds: FollowThresholds | null,
): FollowThresholds | null {
  if (!thresholds && !request) return null;
  const planPlatforms = parseArray(request?.platforms).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  const planRegion = planRegionOf(request);
  const merged: FollowThresholds = { ...(thresholds || {}) };
  if (!merged.platform && planPlatforms.length === 1) merged.platform = planPlatforms[0];
  if (!merged.region && planRegion && planRegion !== "all") merged.region = planRegion;
  return Object.keys(merged).length ? merged : null;
}

/**
 * ADR-022 P1: selected (B) or conditional (C) batch follow.
 * One L3 confirm / source_batch. Per-candidate P0 pipeline, limited concurrency.
 * Partial success: never mark the whole batch followed when some fail.
 */
export async function followCandidatesBatch(input: Json = {}): Promise<Json> {
  const rawFilter = input.filter ?? input.filters ?? input.thresholds;
  const thresholds = parseFollowThresholds(rawFilter);
  const selectedIds = asStringList(input.candidate_ids ?? input.candidateIds);
  const applyPlanChips = !selectedIds.length || rawFilter != null;
  const candidates = loadFollowBatchCandidates(input);
  const preview: Row[] = [];
  const skipped: Json[] = [];
  const failed: Json[] = [];

  for (const candidate of candidates) {
    if (String(candidate.status) === "dismissed") {
      failed.push(batchFailItem(candidate, "candidate_dismissed", "已忽略的线索不能加入跟进。"));
      continue;
    }
    const request = requestForCandidate(candidate);
    const writeFilter = applyPlanChips ? mergePlanFilter(request, thresholds) : null;
    const check = evaluateFollowFilters(candidate, request, writeFilter);
    if (!check.ok) {
      failed.push(batchFailItem(candidate, check.code, check.message));
      continue;
    }
    const existing = existingCollaboration(candidate);
    if (String(candidate.status) === "followed" && existing && isRealKolUid(existing.kol_uid)) {
      skipped.push(followResult(String(candidate.id), String(existing.id), false, { skipped_duplicate: true }));
      continue;
    }
    preview.push(candidate);
  }

  const requestId = String(
    input.request_id || input.requestId || preview[0]?.request_id || candidates[0]?.request_id || "",
  ).trim();
  const sourceBatch = sourceBatchForFollowSet({
    requestId,
    candidateIds: preview.map((row) => String(row.id)),
    filter: thresholds,
    override: input.source_batch,
  });
  const missingEmailCount = preview.filter((row) => !candidateHasContactEmail(row)).length;
  const previewPayload = {
    source_batch: sourceBatch,
    confirmed: false,
    preview: true,
    items: preview.map(publicCandidate),
    followed: [],
    failed,
    skipped_duplicate: skipped,
    filter: thresholds,
    counts: {
      selected: candidates.length,
      preview: preview.length,
      followed: 0,
      failed: failed.length,
      skipped_duplicate: skipped.length,
      missing_email: missingEmailCount,
    },
    sent: false,
    stage_changed: false,
  };
  if (input.preview === true || input.confirmed === false || input.confirmed === "false") {
    return previewPayload;
  }
  if (input.confirmed !== true && input.confirmed !== "true") {
    throw new HttpFail(409, {
      code: "follow_not_confirmed",
      message: "请先确认后再加入跟进。",
      source_batch: sourceBatch,
    });
  }
  if (!preview.length) {
    audit(ownerId(), "discovery.candidates.follow_batch", {
      source_batch: sourceBatch,
      followed: 0,
      failed: failed.length,
      skipped_duplicate: skipped.length,
      sent: false,
      stage_changed: false,
    });
    return {
      source_batch: sourceBatch,
      confirmed: true,
      followed: [],
      failed,
      skipped_duplicate: skipped,
      filter: thresholds,
      counts: {
        selected: candidates.length,
        preview: 0,
        followed: 0,
        failed: failed.length,
        skipped_duplicate: skipped.length,
        missing_email: missingEmailCount,
      },
      message: skipped.length || failed.length ? undefined : "没有符合条件的线索。",
      sent: false,
      stage_changed: false,
    };
  }

  const followed: Json[] = [];
  const outcomes = await runLimited(preview, FOLLOW_BATCH_CONCURRENCY, async (candidate) => {
    const request = requestForCandidate(candidate);
    const writeFilter = applyPlanChips ? mergePlanFilter(request, thresholds) : null;
    const check = evaluateFollowFilters(candidate, request, writeFilter);
    if (!check.ok) {
      return { kind: "failed" as const, item: batchFailItem(candidate, check.code, check.message) };
    }
    try {
      const result = await followCandidate(String(candidate.id), {
        confirmed: true,
        source_batch: sourceBatch,
        ...(writeFilter ? { thresholds: writeFilter } : {}),
      });
      if (result.skipped_duplicate) {
        return { kind: "skipped" as const, item: result };
      }
      return { kind: "followed" as const, item: result };
    } catch (error) {
      return { kind: "failed" as const, item: failFromFollowError(candidate, error) };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.kind === "followed") followed.push(outcome.item);
    else if (outcome.kind === "skipped") skipped.push(outcome.item);
    else failed.push(outcome.item);
  }

  audit(ownerId(), "discovery.candidates.follow_batch", {
    source_batch: sourceBatch,
    followed: followed.length,
    failed: failed.length,
    skipped_duplicate: skipped.length,
    sent: false,
    stage_changed: false,
    policy: "import_creator",
  });

  return {
    source_batch: sourceBatch,
    confirmed: true,
    followed,
    failed,
    skipped_duplicate: skipped,
    filter: thresholds,
    counts: {
      selected: candidates.length,
      preview: preview.length,
      followed: followed.length,
      failed: failed.length,
      skipped_duplicate: skipped.length,
      missing_email: preview.filter((row) => !candidateHasContactEmail(row)).length,
    },
    sent: false,
    stage_changed: false,
  };
}

export function dismissCandidate(id: string): Json {
  const candidate = candidateRow(id);
  if (String(candidate.status) === "followed") {
    throw new HttpFail(409, {
      code: "candidate_already_followed",
      message: "已跟进的候选人不能驳回。",
      collaboration_id: candidate.collaboration_id,
    });
  }
  const now = nowIso();
  getConn().prepare(
    `UPDATE creator_candidates
        SET status='dismissed', dismissed_at=COALESCE(dismissed_at, ?), updated_at=?
      WHERE id=?`,
  ).run(now, now, candidate.id);
  audit(ownerId(), "discovery.candidate.dismissed", { candidate_id: candidate.id });
  return publicCandidate(getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(candidate.id) as Row);
}

export function listPendingDiscoveryCandidates(ownerUserId?: string): Json[] {
  const owner = ownerUserId || (authDisabled() || isAdmin() ? DEMO_USER.id : scopedUser()?.id);
  if (!owner) return [];
  return (getConn().prepare(
    `SELECT * FROM creator_candidates
      WHERE owner_user_id=? AND status='suggested'
      ORDER BY score DESC, followers DESC, updated_at DESC LIMIT 16`,
  ).all(owner) as Row[]).map(publicCandidate);
}

export function restoreActiveDiscoveryRuns(): void {
  registerDiscoveryCrawlHook();
  const rows = getConn().prepare(
    "SELECT * FROM discovery_runs WHERE status IN ('queued','running')",
  ).all() as Row[];
  for (const row of rows) {
    try {
      syncRunFromCrawl(row);
      if (row.crawl_job_id) {
        const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(row.crawl_job_id) as Row | undefined;
        if (job && String(job.status) === "result_ready") ingestDiscoveryFromCrawlJob(job);
      }
    } catch {
      // Restart restore is best-effort; crawl monitor remains authoritative.
    }
  }
}
