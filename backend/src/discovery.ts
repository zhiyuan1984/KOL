/**
 * Home AI发现 — first-class discovery pipeline.
 *
 * Prefill / pending confirm only. Crawl completion writes CreatorCandidates.
 * Collaboration is created only on employee confirm-follow.
 * Never sends mail, never writes/advances official stage.
 */
import { authDisabled, isAdmin, scopedUser } from "./auth.js";
import { BRAND_MAILBOXES, DEMO_USER } from "./config.js";
import { startCrawl, onCrawlJobSettled } from "./crawl/service.js";
import { OVERSEAS_CRAWL_PLATFORMS } from "./crawl/platforms.js";
import { audit, getConn, nowIso, tx } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json, Row } from "./types.js";

const OVERSEAS = new Set<string>(OVERSEAS_CRAWL_PLATFORMS);
const DEFAULT_PLATFORMS = ["youtube", "instagram"] as const;
const MODES = new Set(["search", "detail", "creator"]);
const RUN_ACTIVE = new Set(["queued", "running"]);
const CRAWL_ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);
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

function sanitize(value: unknown): string {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/(token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=***")
    .slice(0, 1000);
}

function employeeError(value: unknown): string | null {
  if (value == null || value === "") return null;
  const cleaned = sanitize(value)
    .replace(/MediaCrawler|mediacrawler|RemoteMcpClient|MCP|Codex/gi, "")
    .replace(/\b(crawl_job_id|remote_task_id|work_item_id|task_id|job[_ ]?id)\b/gi, "")
    .replace(/\b(crawl_[a-z0-9]+|tsk_[a-z0-9]+|drun_[a-z0-9]+)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
  return cleaned || "发现未完成，请稍后重试。";
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

function keywordsValue(keywords: string[]): string {
  return keywords.join(",");
}

function validateOverseasPlatforms(platforms: string[]): string[] {
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
  if (!MODES.has(value)) throw new HttpFail(400, "invalid crawl mode");
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
    score: Number(row.score || 0),
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
  };
}

function publicRun(row: Row): Json {
  syncRunFromCrawl(row);
  const current = getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(row.id) as Row;
  const status = String(current.status);
  return {
    id: current.id,
    request_id: current.request_id,
    platform: current.platform,
    status,
    status_label: RUN_STATUS_LABEL[status] || status,
    error: employeeError(current.error),
    candidate_count: Number(current.candidate_count || 0),
    created_at: current.created_at,
    started_at: current.started_at,
    updated_at: current.updated_at,
    completed_at: current.completed_at,
  };
}

function planSummary(row: Row): string {
  const keywords = parseArray(row.keywords).map(String).filter(Boolean);
  const platforms = parseArray(row.platforms).map(platformLabel).filter(Boolean);
  const topic = keywords.length ? `「${keywords.join(" / ")}」` : "关键词";
  const where = platforms.length ? platforms.join("、") : "海外平台";
  return `按 ${topic} 在 ${where} 发现达人`;
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
    title: summary,
    plan_summary: summary,
    brand: current.brand || null,
    latest_run: latest ? publicRun(latest) : null,
    error: employeeError(current.error),
    created_at: current.created_at,
    updated_at: current.updated_at,
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
  return {
    id: current.id,
    status: current.status,
    status_label: REQUEST_STATUS_LABEL[String(current.status)] || String(current.status),
    keywords: parseArray(current.keywords).map(String),
    platforms: parseArray(current.platforms).map(String),
    title: summary,
    plan_summary: summary,
    created_at: current.created_at,
    updated_at: current.updated_at,
    request: publicRequest(current),
    run: run ? publicRun(run) : null,
    candidates,
    counts,
    ready: counts.suggested_count > 0,
    pending_confirm: String(current.status) === "open" || counts.suggested_count > 0,
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
  const error = latest?.error ? sanitize(latest.error) : null;
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
  getConn().prepare(
    `UPDATE discovery_runs
        SET status=?, remote_task_id=COALESCE(?, remote_task_id), error=?,
            started_at=COALESCE(started_at, ?), completed_at=?, updated_at=?, data_version=data_version+1
      WHERE id=?`,
  ).run(
    status,
    job.remote_task_id || null,
    job.error ? sanitize(job.error) : null,
    job.started_at || now,
    completed,
    now,
    run.id,
  );
  refreshRequestStatus(String(run.request_id));
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
  const keywords = parseArray(request.keywords).map(String);
  const parameters: Json = { ...parseJson(request.filters), keywords };
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
        status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'queued',?,?)`,
    ).run(
      runId, request.id, ownerUserId, workItemId, platform, mode,
      JSON.stringify(parameters), idempotencyKey, now, now,
    );
    db.prepare(
      "UPDATE discovery_requests SET latest_run_id=?, status='running', updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(runId, now, request.id);
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
    const safe = employeeError(error instanceof HttpFail ? error.detail : error) || "发现未完成，请稍后重试。";
    getConn().prepare(
      `UPDATE discovery_runs
          SET status='failed', error=?, completed_at=?, updated_at=?, data_version=data_version+1
        WHERE id=?`,
    ).run(safe, nowIso(), nowIso(), runId);
    refreshRequestStatus(String(request.id));
    if (error instanceof HttpFail && error.status === 503) {
      throw new HttpFail(503, { code: "discovery_not_ready", message: "发现服务暂未就绪，请稍后重试。", next_action: "请确认后再启动发现。" });
    }
    throw new HttpFail(error instanceof HttpFail ? error.status : 502, safe);
  }
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
      JSON.stringify(body.filters && typeof body.filters === "object" ? body.filters : {}),
      body.brand ? String(body.brand) : null,
      JSON.stringify(body.scope && typeof body.scope === "object" ? body.scope : {}),
      now,
      now,
    );
  });
  audit(owner, "discovery.request.created", { request_id: id, platforms, mode });
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

function existingCollaboration(candidate: Row): Row | undefined {
  if (candidate.collaboration_id) {
    const byId = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(candidate.collaboration_id) as
      | Row
      | undefined;
    if (byId) return byId;
  }
  const handle = String(candidate.handle || candidate.nickname || "").trim();
  const uid = discoveryKolUid(candidate);
  const byUid = getConn().prepare("SELECT * FROM collaborations WHERE kol_uid=?").get(uid) as Row | undefined;
  if (byUid) return byUid;
  if (!handle) return undefined;
  return getConn().prepare(
    "SELECT * FROM collaborations WHERE handle=? OR display_name=?",
  ).get(handle, handle) as Row | undefined;
}

function discoveryKolUid(candidate: Row): string {
  return `disc_${candidate.platform}_${String(candidate.platform_creator_id).replace(/[^A-Za-z0-9._-]/g, "_")}`.slice(0, 80);
}

/**
 * Employee confirm-follow. The only discovery path that may create/link a Collaboration.
 * Does not send mail and does not write/advance official stage.
 */
export function followCandidate(id: string): Json {
  const candidate = candidateRow(id);
  const existing = existingCollaboration(candidate);
  const now = nowIso();
  const brand = String(
    (getConn().prepare("SELECT brand FROM discovery_requests WHERE id=?").get(candidate.request_id) as { brand?: string } | undefined)?.brand
    || "LT",
  );
  const handle = String(candidate.handle || candidate.nickname || candidate.platform_creator_id).trim();
  const cid = String(existing?.id || nid("col"));
  if (!existing) {
    const uid = discoveryKolUid(candidate);
    tx((db) => {
      db.prepare(
        `INSERT INTO collaborations
         (id, handle, display_name, brand, platform, followers, email, mailbox_from,
          lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
          stage_version, locked, kol_uid, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        uid,
        "discovery",
      );
    });
  }
  getConn().prepare(
    `UPDATE creator_candidates
        SET status='followed', collaboration_id=?, followed_at=COALESCE(followed_at, ?),
            dismissed_at=NULL, updated_at=?
      WHERE id=?`,
  ).run(cid, now, now, candidate.id);
  audit(ownerId(), "discovery.candidate.followed", {
    candidate_id: candidate.id,
    collaboration_id: cid,
    created: !existing,
  });
  const collaboration = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(cid) as Row;
  return {
    ...publicCandidate(getConn().prepare("SELECT * FROM creator_candidates WHERE id=?").get(candidate.id) as Row),
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
    created: !existing,
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
