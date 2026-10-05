import { Hono } from "hono";
import { requireSkill } from "../auth.js";
import {
  cancelHomeDiscoveryRun,
  createHomeDiscoveryPlan,
  discoveryTemplate,
  getHomeDiscoveryRun,
  homeDiscoveryCandidateIngestPlaceholder,
  homeDiscoveryFollowForbidden,
  homeDiscoveryIngestPlaceholder,
  ignoreHomeDiscoveryCandidate,
  listHomeDiscoveryCandidates,
  listHomeDiscoveryRuns,
  retryHomeDiscoveryRun,
  startHomeDiscoveryRun,
} from "../home-discovery.js";
import type { Json } from "../types.js";
import { createDiscoveryWorkspace, pendingDiscoveryWorkspace } from "../crawl/discovery-workspace.js";
import { runtimeCandidateCommand } from "../crawl/candidate-actions.js";

export const homeDiscovery = new Hono();
homeDiscovery.post("/home/discovery/runtime/:actionId/candidates/:candidateId/:verb", async c => {
  const body = await c.req.json();
  return c.json(await runtimeCandidateCommand(c.req.param("actionId"), c.req.param("candidateId"), c.req.param("verb"), body));
});

homeDiscovery.post("/home/discovery/workspace", async (c) => {
  const body = await c.req.json().catch(() => null);
  return c.json(await createDiscoveryWorkspace(body), 201);
});

homeDiscovery.get("/home/discovery/workspace/:id/pending", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await pendingDiscoveryWorkspace(c.req.param("id")));
});

homeDiscovery.get("/home/discovery/template", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(discoveryTemplate());
});

homeDiscovery.post("/home/discovery/plan", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  return c.json(await createHomeDiscoveryPlan(body), 201);
});

homeDiscovery.post("/home/discovery/run", async (c) => {
  requireSkill("creator_discovery");
  const body = await c.req.json().catch(() => ({})) as Json;
  const result = await startHomeDiscoveryRun(body);
  return c.json(result, result.duplicate ? 200 : 202);
});

homeDiscovery.get("/home/discovery/runs", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(listHomeDiscoveryRuns({ limit: c.req.query("limit") }));
});

homeDiscovery.get("/home/discovery/runs/:id", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(getHomeDiscoveryRun(c.req.param("id")));
});

homeDiscovery.get("/home/discovery/runs/:id/candidates", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(listHomeDiscoveryCandidates(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/runs/:id/retry", async (c) => {
  requireSkill("creator_discovery");
  return c.json(await retryHomeDiscoveryRun(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/runs/:id/cancel", async (c) => {
  requireSkill("creator_discovery");
  return c.json(await cancelHomeDiscoveryRun(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/runs/:id/ingest", (c) => {
  return c.json(homeDiscoveryIngestPlaceholder(c.req.param("id")), 501);
});

homeDiscovery.post("/home/discovery/candidates/:id/ignore", (c) => {
  return c.json(ignoreHomeDiscoveryCandidate(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/candidates/:id/ingest", (c) => {
  return c.json(homeDiscoveryCandidateIngestPlaceholder(c.req.param("id")), 501);
});

homeDiscovery.post("/home/discovery/candidates/:id/follow", (c) => {
  return c.json(homeDiscoveryFollowForbidden(c.req.param("id")), 403);
});
