import { Hono } from "hono";
import { getExpertForViewer, listPublishedExperts, summonExpert } from "../experts.js";
import type { Json } from "../types.js";

export const experts = new Hono();

experts.get("/experts", (c) => c.json(listPublishedExperts()));

experts.get("/experts/:id", (c) => c.json(getExpertForViewer(c.req.param("id"))));

experts.post("/experts/:id/summon", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Json;
  return c.json(await summonExpert(c.req.param("id"), {
    title: body.title ? String(body.title) : undefined,
    collaboration_id: body.collaboration_id ? String(body.collaboration_id) : undefined,
  }));
});
