import { Hono } from "hono";
import { requireConnector } from "../auth.js";
import {
  cancelHomeDiscoveryRun,
  createHomeDiscoveryPlan,
  discoveryTemplate,
  getHomeDiscoveryRun,
  homeDiscoveryCandidateIngestPlaceholder,
  homeDiscoveryIngestPlaceholder,
  ignoreHomeDiscoveryCandidate,
  listHomeDiscoveryCandidates,
  listHomeDiscoveryRuns,
  retryHomeDiscoveryRun,
  startHomeDiscoveryRun,
} from "../home-discovery.js";
import type { Json } from "../types.js";

export const homeDiscovery = new Hono();

homeDiscovery.get("/home/discovery/template", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(discoveryTemplate());
});

homeDiscovery.post("/home/discovery/plan", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  return c.json(await createHomeDiscoveryPlan(body), 201);
});

homeDiscovery.post("/home/discovery/run", async (c) => {
  requireConnector("claw", "write");
  const body = await c.req.json().catch(() => ({})) as Json;
  const result = await startHomeDiscoveryRun(body);
  return c.json(result, result.duplicate ? 200 : 202);
});

homeDiscovery.get("/home/discovery/runs", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(listHomeDiscoveryRuns());
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
  requireConnector("claw", "write");
  return c.json(await retryHomeDiscoveryRun(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/runs/:id/cancel", async (c) => {
  requireConnector("claw", "write");
  return c.json(await cancelHomeDiscoveryRun(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/runs/:id/ingest", (c) => {
  return c.json(homeDiscoveryIngestPlaceholder(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/candidates/:id/ignore", (c) => {
  return c.json(ignoreHomeDiscoveryCandidate(c.req.param("id")));
});

homeDiscovery.post("/home/discovery/candidates/:id/ingest", (c) => {
  return c.json(homeDiscoveryCandidateIngestPlaceholder(c.req.param("id")));
});
