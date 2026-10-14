import { Hono } from "hono";
import { requireSkill } from "../auth.js";
import { cancelHomeDiscoveryRun, createHomeDiscoveryPlan, discoveryTemplate, followHomeDiscoveryCandidate, getHomeDiscoveryRun, homeDiscoveryCandidateIngestPlaceholder, homeDiscoveryIngestPlaceholder, ignoreHomeDiscoveryCandidate, ingestHomeDiscoveryCandidate, listHomeDiscoveryCandidates, listHomeDiscoveryRuns, retryHomeDiscoveryRun, startHomeDiscoveryRun, } from "../home-discovery.js";
import type { Json } from "../types.js";
import { createDiscoveryWorkspace, pendingDiscoveryWorkspace } from "../crawl/discovery-workspace.js";
import { runtimeCandidateCommand } from "../crawl/candidate-actions.js";
export const homeDiscovery = new Hono();
homeDiscovery.post("/home/discovery/runtime/:actionId/candidates/:candidateId/:verb", async (c) => {
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
homeDiscovery.get("/home/discovery/template", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json((await discoveryTemplate()));
});
homeDiscovery.post("/home/discovery/plan", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  return c.json(await createHomeDiscoveryPlan(body), 201);
});
homeDiscovery.post("/home/discovery/run", async (c) => {
  (await requireSkill("creator_discovery"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const result = await startHomeDiscoveryRun(body);
  return c.json(result, result.duplicate ? 200 : 202);
});
homeDiscovery.get("/home/discovery/runs", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json((await listHomeDiscoveryRuns({ limit: c.req.query("limit") })));
});
homeDiscovery.get("/home/discovery/runs/:id", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json((await getHomeDiscoveryRun(c.req.param("id"))));
});
homeDiscovery.get("/home/discovery/runs/:id/candidates", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json((await listHomeDiscoveryCandidates(c.req.param("id"))));
});
homeDiscovery.post("/home/discovery/runs/:id/retry", async (c) => {
  (await requireSkill("creator_discovery"));
  return c.json(await retryHomeDiscoveryRun(c.req.param("id")));
});
homeDiscovery.post("/home/discovery/runs/:id/cancel", async (c) => {
  (await requireSkill("creator_discovery"));
  return c.json(await cancelHomeDiscoveryRun(c.req.param("id")));
});
homeDiscovery.post("/home/discovery/runs/:id/ingest", async (c) => {
  return c.json((await homeDiscoveryIngestPlaceholder(c.req.param("id"))), 501);
});
homeDiscovery.post("/home/discovery/candidates/:id/ignore", async (c) => {
  return c.json((await ignoreHomeDiscoveryCandidate(c.req.param("id"))));
});
homeDiscovery.post("/home/discovery/candidates/:id/ingest", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  return c.json(await ingestHomeDiscoveryCandidate(c.req.param("id"), body));
});

homeDiscovery.post("/home/discovery/candidates/:id/follow", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  return c.json(await followHomeDiscoveryCandidate(c.req.param("id"), body), 201);
});
