import { HttpFail } from "../host/errors.js";
import { normalizeMcpContent } from "../mcp/remote.js";
import { postgresPool } from "../postgres/pool.js";
import { authorizeConnector, runtimeErrorCode, SkillExecution, type RuntimeContext } from "../runtime/execution.js";
import { isPlatformPrincipal } from "../runtime/platform-principal.js";
import { authorizeBackgroundCrawl, backgroundToolRuntime, type BackgroundToolInvoker } from "./background-crawl.js";
import { pgEnqueueExecutionJob, pgExecutionJobPayload } from "../execution-jobs/postgres-store.js";
import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import type { Json } from "../types.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import type { PoolClient } from "pg";
import { followerEvidence } from "./candidate-evidence.js";
import { DEFAULT_DEDUP_WINDOW_DAYS, dedupeSightings } from "./dedup.js";

export async function enqueueCrawlResults(id: string, actor: string, attempt = "initial", client?: PoolClient): Promise<void> {
  await pgEnqueueExecutionJob({ job_type: "crawler.results", tenant_ref: "runtime", actor_ref: actor,
    idempotency_key: `crawler-results:${id}:${attempt}`, object_ref: { crawl_id: id }, payload: { crawl_id: id },
    risk_level: "low", max_attempts: 3 }, { client, deduplicate_active: true });
}
const fail = (code: string): never => { throw new HttpFail(409, { code }); };
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const number = (value: unknown): number | null => (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function candidateView(value: Json, platform: string): Json {
  const urlValue = String(value.profile_url || value.url || value.homepage || "");
  let url: string | null = null;
  try { const parsed = new URL(urlValue); if (["http:", "https:"].includes(parsed.protocol)) url = parsed.href; } catch { /* missing source */ }
  const views = value.recent_views || value.recent_10_views;
  const recent = Array.isArray(views) ? views.slice(0, 10).map(number) : [];
  const samples = (Array.isArray(value.views) ? value.views : []).slice(0, 10).map(number);
  return { id: String(value.platform_creator_id || value.creator_id || value.user_id || value.id || ""),
    name: String(value.nickname || value.name || value.handle || "未提供名称"), platform, source_url: url,
    avatar_url: typeof value.avatar_url === "string" && /^https?:\/\//i.test(value.avatar_url) ? value.avatar_url : null,
    direction: typeof value.direction === "string" ? value.direction : null,
    followers: number(value.followers ?? value.follower_count ?? value.fans),
    followers_evidence: followerEvidence(value.followers_evidence),
    avg_views_10: recent.length === 10 && recent.every(v => v !== null) ? recent.reduce<number>((sum, v) => sum + v!, 0) / 10 : null,
    sampled_views_count: samples.length,
    sampled_views_avg: samples.length && samples.every(v => v !== null) ? samples.reduce<number>((sum, v) => sum + v!, 0) / samples.length : null,
    region: typeof value.region === "string" ? value.region : null };
}

export async function collectCrawlResults(executionJob: ClaimedExecutionJob, checkpoint: () => Promise<void>,
  createRuntime: (context: RuntimeContext) => SkillExecution | BackgroundToolInvoker = (context) =>
    isPlatformPrincipal(context.userId) ? backgroundToolRuntime(context) : new SkillExecution(context)): Promise<Json> {
  const id = String(pgExecutionJobPayload(executionJob).crawl_id);
  const job = (await postgresPool().query("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [id])).rows[0];
  if (!job || !["succeeded", "cancelled"].includes(job.state)) return { state: "not_ready" };
  if (job.result_state === "ready") return { state: "ready" };
  const runtime = createRuntime(job.context_json);
  try {
    await checkpoint();
    const tool = (await runtime.discover()).tools.find(t => t.connectorId === "claw" && t.remoteName === "get_creators");
    const properties = object(object(tool?.exposed.inputSchema).properties);
    if (!tool || !properties.task_id || !properties.offset || !properties.limit) fail("crawl_result_scope_unsupported");
    const platform = job.args_json.platforms[0];
    const saved = job.result_json;
    const resumable = saved?.task_id === job.remote_task_id && saved?.complete === false && Array.isArray(saved.candidates);
    const candidates: Json[] = resumable ? [...saved.candidates] : [];
    const startOffset = candidates.length;
    const seen = new Set<string>(candidates.map(row => String(row.id)));
    let complete = false;
    let total: number | null = null;
    for (let page = 0; page < 20; page++) {
      await checkpoint();
      const raw = await runtime.invoke(String(tool!.exposed.name), { task_id: job.remote_task_id, offset: startOffset + page * 100, limit: 100,
        ...(properties.platform ? { platform } : {}) });
      const result = normalizeMcpContent(raw);
      const data = object(result.data);
      if (raw.isError || result.ok === false) fail("crawl_result_read_failed");
      if (String(result.task_id || data.task_id || "") !== job.remote_task_id) fail("crawl_result_task_mismatch");
      const rows = result.creators ?? result.items ?? data.creators ?? data.items;
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("crawl_result_invalid");
      if ((rows as Json[]).length > 100 || (result.offset !== undefined && result.offset !== startOffset + page * 100)) fail("crawl_result_pagination_invalid");
      const pageTotal = number(result.total ?? data.total);
      if (resumable && saved.total != null && pageTotal !== saved.total) fail("crawl_result_snapshot_changed");
      if (total !== null && pageTotal !== total) fail("crawl_result_snapshot_changed");
      total = pageTotal;
      for (const row of rows as Json[]) {
        if (row.platform && row.platform !== platform) fail("crawl_result_task_mismatch");
        const candidate = candidateView(row, platform);
        if (!candidate.id) fail("crawl_result_invalid");
        if (seen.has(String(candidate.id))) fail("crawl_result_pagination_invalid");
        seen.add(String(candidate.id)); candidates.push(candidate);
      }
      if ((rows as Json[]).length < 100 || (total !== null && candidates.length >= total)) { complete = true; break; }
    }
    if (total !== null && complete && total !== candidates.length) fail("crawl_result_pagination_invalid");
    await checkpoint();
    if (isPlatformPrincipal(job.context_json?.userId)) authorizeBackgroundCrawl(job.context_json);
    else authorizeConnector(job.context_json, "claw");
    const result = { schema: "crawl_candidates/v1", task_id: job.remote_task_id, platform,
      captured_at: new Date().toISOString(), complete, total, candidates, collection_state: job.state };
    await postgresPool().query("UPDATE runtime_crawl_jobs SET result_state=$2,result_json=$3,result_error=NULL,updated_at=now() WHERE id=$1",
      [id, complete ? "ready" : "partial", JSON.stringify(result)]);
    // 一期去重：回填即记池（跨运行去重基准）。失败不阻塞回填本身。
    try {
      const windowDaysRaw = Number(job.args_json?.dedup_window_days);
      await dedupeSightings(
        candidates.map((row) => {
          const item = row as Json;
          return {
            platform: String(platform).toLowerCase(),
            platform_creator_id: String(item.id || ""),
            handle: String(item.name || "") || null,
            display_name: String(item.name || "") || null,
            profile_snapshot: { captured_at: result.captured_at, task_id: job.remote_task_id },
          };
        }),
        Number.isFinite(windowDaysRaw) ? windowDaysRaw : DEFAULT_DEDUP_WINDOW_DAYS,
      );
    } catch (error) {
      console.error("[discovery-dedup] pool record failed:", error instanceof Error ? error.message : error);
    }
    return { state: complete ? "ready" : "partial", count: candidates.length };
  } catch (error) {
    await postgresPool().query("UPDATE runtime_crawl_jobs SET result_state='failed',result_error=$2,updated_at=now() WHERE id=$1", [id, runtimeErrorCode(error)]);
    throw error;
  } finally { runtime.close(); }
}
registerExecutionHandler("crawler.results", collectCrawlResults);
