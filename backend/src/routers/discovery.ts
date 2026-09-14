import { Hono } from "hono";
import { requireConnector } from "../auth.js";
import {
  createDiscoveryRequest,
  dismissCandidate,
  followCandidate,
  getCandidate,
  getDiscoveryRequest,
  getDiscoveryRun,
  listDiscoveryRequests,
  listRunCandidates,
  startDiscoveryRun,
} from "../discovery.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";

export const discovery = new Hono();

discovery.post("/discovery/requests", async (c) => {
  requireConnector("claw", "write");
  const body = await c.req.json().catch(() => ({})) as Json;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "");
  const result = await createDiscoveryRequest(body, idempotencyKey || undefined);
  return c.json(result.body, result.status as 200 | 201 | 202);
});

discovery.get("/discovery/requests", (c) => c.json(listDiscoveryRequests()));

discovery.get("/discovery/requests/:id", (c) => c.json(getDiscoveryRequest(c.req.param("id"))));

discovery.post("/discovery/requests/:id/runs", async (c) => {
  requireConnector("claw", "write");
  const body = await c.req.json().catch(() => ({})) as Json;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || nid("idem"));
  const run = await startDiscoveryRun({
    requestId: c.req.param("id"),
    platform: body.platform ? String(body.platform) : undefined,
    idempotencyKey,
  });
  return c.json(run, run.duplicate ? 200 : 202);
});

discovery.get("/discovery/runs/:id", (c) => c.json(getDiscoveryRun(c.req.param("id"))));

discovery.get("/discovery/runs/:id/candidates", (c) => {
  return c.json(listRunCandidates(c.req.param("id"), {
    status: c.req.query("status") || undefined,
    limit: Number(c.req.query("limit") || 20),
    offset: Number(c.req.query("offset") || 0),
  }));
});

discovery.get("/discovery/candidates/:id", (c) => c.json(getCandidate(c.req.param("id"))));

discovery.post("/discovery/candidates/:id/follow", (c) => c.json(followCandidate(c.req.param("id"))));

discovery.post("/discovery/candidates/:id/dismiss", (c) => c.json(dismissCandidate(c.req.param("id"))));
