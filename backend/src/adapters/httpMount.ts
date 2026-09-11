/**
 * Starry / Claw mock HTTP。给 Host / Gateway 用。
 * Skill 禁止打这些 URL；Codex 只走 MCP（backend/mcp）。
 */
import { Hono } from "hono";
import { clawApiKey } from "../config.js";
import { HttpFail } from "../host/errors.js";
import * as mockClaw from "./claw.js";
import * as mockStarry from "./starry.js";
import { KeyError } from "./starry.js";
import type { Json } from "../types.js";

export const starryRouter = new Hono();
export const clawRouter = new Hono();

starryRouter.get("/api/v1/kol/config/cooperation-stages/options", (c) => c.json(mockStarry.stageOptions()));
starryRouter.get("/api/kol/dictionaries/options", (c) =>
  c.json(mockStarry.dictionaryOptions(c.req.query("parentKey") || "")),
);
starryRouter.post("/api/v1/kol-cooperation-lifecycles/:lifecycle_id/stage", async (c) => {
  try {
    return c.json(mockStarry.confirmStage(c.req.param("lifecycle_id"), (await c.req.json()) as Json));
  } catch (e) {
    if (e instanceof KeyError) throw new HttpFail(404, "lifecycle not found");
    throw e;
  }
});
starryRouter.post("/api/v1/kol-email/conversations/:conversation_id/send", async (c) =>
  c.json(mockStarry.sendConversation(c.req.param("conversation_id"), (await c.req.json()) as Json)),
);
starryRouter.post("/api/v1/kol-email/ai/translate-zh", async (c) =>
  c.json(mockStarry.translateZh((await c.req.json()) as Json)),
);
starryRouter.get("/api/v1/kol-email/conversations/:conversation_id", (c) => {
  const row = mockStarry.getConversation(c.req.param("conversation_id"));
  if (!row) throw new HttpFail(404, "Not Found");
  return c.json(row);
});

function requireKey(c: { req: { header: (n: string) => string | undefined } }): void {
  if (c.req.header("X-API-Key") !== clawApiKey()) throw new HttpFail(401, "X-API-Key required");
}

clawRouter.get("/api/v1/health", (c) => {
  requireKey(c);
  return c.json(mockClaw.health());
});
clawRouter.get("/api/v1/creators", (c) => {
  requireKey(c);
  return c.json(mockClaw.listCreators());
});
clawRouter.post("/api/v1/creators", async (c) => {
  requireKey(c);
  return c.json(mockClaw.createCreator((await c.req.json()) as Json));
});
clawRouter.get("/api/v1/creators/:cid", (c) => {
  requireKey(c);
  const row = mockClaw.getCreator(c.req.param("cid"));
  if (!row) throw new HttpFail(404, "Not Found");
  return c.json(row);
});
clawRouter.get("/api/v1/creators/:cid/outreach-script", (c) => {
  requireKey(c);
  try {
    return c.json(mockClaw.outreachScript(c.req.param("cid")));
  } catch {
    throw new HttpFail(404, "Not Found");
  }
});
clawRouter.patch("/api/v1/creators/:cid/status", async (c) => {
  requireKey(c);
  return c.json(mockClaw.patchStatus(c.req.param("cid"), (await c.req.json()) as Json));
});
clawRouter.get("/api/v1/analysis/creators", (c) => {
  requireKey(c);
  return c.json(mockClaw.analysis(null));
});
clawRouter.get("/api/v1/analysis/creators/:cid", (c) => {
  requireKey(c);
  return c.json(mockClaw.analysis(c.req.param("cid")));
});
clawRouter.get("/api/v1/tasks/daily", (c) => {
  requireKey(c);
  return c.json(mockClaw.dailyTasks());
});
clawRouter.get("/api/v1/campaigns", (c) => {
  requireKey(c);
  return c.json(mockClaw.campaigns());
});
clawRouter.get("/api/v1/campaigns/budget-report", (c) => {
  requireKey(c);
  return c.json(mockClaw.budgetReport());
});
clawRouter.post("/api/v1/ingestions/mediacrawler", async (c) => {
  requireKey(c);
  return c.json(mockClaw.ingestMediacrawler((await c.req.json()) as Json));
});
