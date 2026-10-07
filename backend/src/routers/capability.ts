/**
 * 能力注册表管理端接口（2026-10-07）。
 * 设计：docs/superpowers/specs/2026-10-07-media-transcribe-capability-registry-design.md §2
 */
import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import {
  listCapabilities,
  registerCapability,
  updateCapability,
  resolveCapability,
} from "../capability/registry.js";
import { knowledgeActorId } from "../host/knowledge.js";
import type { Json } from "../types.js";

export const capabilityRouter = new Hono();

capabilityRouter.get("/admin/capabilities", (c) => {
  requireAdmin();
  const query = c.req.query();
  return c.json({
    capabilities: listCapabilities({
      kind: query.kind,
      status: query.status,
      q: query.q,
    }),
  });
});

capabilityRouter.get("/admin/capabilities/resolve", (c) => {
  requireAdmin();
  const query = c.req.query();
  return c.json({
    capability: resolveCapability(String(query.kind || ""), String(query.ref_id || "")),
  });
});

capabilityRouter.post("/admin/capabilities", async (c) => {
  const input = (await c.req.json()) as Json;
  return c.json(
    { capability: registerCapability(input as Parameters<typeof registerCapability>[0], knowledgeActorId()) },
    201,
  );
});

capabilityRouter.patch("/admin/capabilities/:id", async (c) => {
  const input = (await c.req.json()) as Json;
  return c.json({
    capability: updateCapability(c.req.param("id"), input as Parameters<typeof updateCapability>[1], knowledgeActorId()),
  });
});
