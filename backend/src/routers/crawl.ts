import { Hono } from "hono";
import { authDisabled, isAdmin, requireConnector, scopedUser } from "../auth.js";
import { ingestMediacrawler } from "../adapters/claw.js";
import { DEMO_USER } from "../config.js";
import {
  clearRemoteHistory,
  crawlEvents,
  crawlJob,
  retryUpload,
  startCrawl,
  stopCrawl,
} from "../crawl/service.js";
import { getConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";

export const crawlRouter = new Hono();

function owner(): string {
  return scopedUser()?.id || (authDisabled() ? DEMO_USER.id : "");
}

function task(id: string): Row {
  const row = getConn().prepare("SELECT * FROM work_items WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin() && String(row.owner_user_id) !== owner())) throw new HttpFail(404, "task not found");
  return row;
}

function jobForTask(taskId: string): Row {
  const row = getConn().prepare(
    "SELECT * FROM crawl_jobs WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(taskId) as Row | undefined;
  if (!row) throw new HttpFail(404, "crawl job not found");
  return row;
}

function requireAdmin(): void {
  if (!isAdmin()) throw new HttpFail(403, "admin required");
}

crawlRouter.post("/tasks/:id/actions/start-crawl", async (c) => {
  requireConnector("claw", "write");
  const item = task(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const parameters = body.parameters && typeof body.parameters === "object"
    ? body.parameters as Json
    : Object.fromEntries(
        ["keywords", "specified_ids", "creator_ids"]
          .filter((key) => body[key] !== undefined)
          .map((key) => [key, body[key]]),
      );
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || nid("idem"));
  const result = await startCrawl({
    ownerUserId: String(item.owner_user_id),
    workItemId: String(item.id),
    sessionId: item.session_id ? String(item.session_id) : null,
    platform: String(body.platform || parameters.platform || ""),
    mode: String(body.mode || parameters.mode || ""),
    parameters,
    idempotencyKey,
  });
  return c.json({ ...result, idempotency_key: idempotencyKey }, result.duplicate ? 200 : 202);
});

crawlRouter.post("/tasks/:id/actions/stop-crawl", async (c) => {
  requireConnector("claw", "write");
  task(c.req.param("id"));
  const job = jobForTask(c.req.param("id"));
  return c.json(await stopCrawl(String(job.id)));
});

crawlRouter.get("/tasks/:id/crawl-job", (c) => {
  requireConnector("claw", "read");
  task(c.req.param("id"));
  const row = jobForTask(c.req.param("id"));
  return c.json(crawlJob(String(row.id)));
});

crawlRouter.get("/tasks/:id/crawl-job/events", (c) => {
  requireConnector("claw", "read");
  task(c.req.param("id"));
  const row = jobForTask(c.req.param("id"));
  return c.json(crawlEvents(String(row.id), Math.max(0, Number(c.req.query("after") || 0))));
});

crawlRouter.post("/admin/crawl-jobs/:id/retry-upload", async (c) => {
  requireAdmin();
  return c.json(await retryUpload(c.req.param("id")));
});

crawlRouter.post("/admin/crawl-history/clear", async (c) => {
  requireAdmin();
  const body = await c.req.json().catch(() => ({})) as Json;
  if (body.confirm !== true) throw new HttpFail(400, "confirm=true required");
  return c.json(await clearRemoteHistory());
});

function requireCrawlIngest(c: { req: { header: (name: string) => string | undefined } }): void {
  if (authDisabled()) return;
  const secret = String(process.env.MEDIACRAWLER_INGEST_TOKEN || process.env.MEDIACRAWLER_MCP_TOKEN || "").trim();
  const presented = String(c.req.header("x-mediacrawler-token") || c.req.header("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (secret && presented && presented === secret) return;
  requireConnector("claw", "write");
}

crawlRouter.post("/integrations/mediacrawler/creators", async (c) => {
  requireCrawlIngest(c);
  const body = await c.req.json() as Json;
  return c.json(ingestMediacrawler(body), 202);
});

crawlRouter.get("/creators/:platform/:platformId", (c) => {
  const row = getConn().prepare(
    "SELECT * FROM claw_creators WHERE platform=? AND platform_creator_id=?",
  ).get(c.req.param("platform"), c.req.param("platformId")) as Row | undefined;
  if (!row) throw new HttpFail(404, "creator not found");
  const payload = (() => {
    try { return JSON.parse(String(row.payload || "{}")); } catch { return {}; }
  })();
  return c.json({ ...row, payload });
});

crawlRouter.get("/creators/:platform/:platformId/score", (c) => {
  const row = getConn().prepare(
    `SELECT score,score_details,followers,recent_views,collected_at
     FROM creator_snapshots WHERE platform=? AND platform_creator_id=?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(c.req.param("platform"), c.req.param("platformId")) as Row | undefined;
  if (!row) throw new HttpFail(404, "creator score not found");
  return c.json({
    ...row,
    score_details: JSON.parse(String(row.score_details || "{}")),
    recent_views: JSON.parse(String(row.recent_views || "[]")),
  });
});
