import { Hono } from "hono";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { HttpFail } from "../host/errors.js";
import { claimOfficialProfile, listOfficialPool, publicPoolProfile } from "../kol-pool.js";
import type { Json } from "../types.js";

export const kols = new Hono();

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

/** Open-pool listing (table A). Ingested profiles are visible here before claim. */
kols.get("/kols/pool", (c) => {
  return c.json(listOfficialPool({
    poolStatus: c.req.query("pool_status") || c.req.query("status") || undefined,
    limit: Number(c.req.query("limit") || 50),
    offset: Number(c.req.query("offset") || 0),
    ownerUserId: ownerId(),
  }));
});

/** Exclusive follow (table B). Profile must already exist in A. */
kols.post("/kols/:kolUid/claim", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const owner = ownerId();
  const result = claimOfficialProfile(c.req.param("kolUid"), owner);
  return c.json({
    ...publicPoolProfile(result.profile, owner),
    follow: result.follow,
    created: result.created,
    claimed: true,
    sent: false,
    stage_changed: false,
    confirmed: body.confirmed !== false,
  }, result.created ? 201 : 200);
});
