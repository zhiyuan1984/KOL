import { Hono } from "hono";
import { listBusinessEvents } from "../business-events.js";
import { HttpFail } from "../host/errors.js";

export const events = new Hono();

events.get("/events", (c) => {
  const rawLimit = c.req.query("limit");
  let limit = 50;
  if (rawLimit != null && rawLimit !== "") {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed < 1) throw new HttpFail(400, "invalid limit");
    limit = Math.min(200, Math.floor(parsed));
  }
  return c.json({
    events: listBusinessEvents({
      objectType: c.req.query("object_type") || undefined,
      objectId: c.req.query("object_id") || undefined,
      eventType: c.req.query("event_type") || undefined,
      before: c.req.query("before") || undefined,
      limit,
    }),
  });
});
