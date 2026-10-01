import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { costsSummary, listCostEvents, upsertBudget } from "../costs.js";
import { HttpFail } from "../host/errors.js";
import { parseExpectedVersion } from "../host/version.js";

export const costsRouter = new Hono();

function costsAdmin() {
  // AUTH_MODE=disabled is useful only in the isolated test harness. Cost
  // governance must never silently become anonymously readable or writable.
  if (authDisabled() && process.env.NODE_ENV !== "test") {
    throw new HttpFail(403, "cost governance requires enabled authentication outside tests");
  }
  return requireAdmin();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyFields(body: Record<string, unknown>, fields: readonly string[]): void {
  const allowed = new Set(fields);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new HttpFail(400, "unsupported request field");
}

async function bodyObject(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpFail(400, "request body must be JSON");
  }
  if (!isPlainObject(body)) throw new HttpFail(400, "request body must be an object");
  return body;
}

costsRouter.get("/admin/costs/summary", (c) => {
  costsAdmin();
  const month = c.req.query("month") || null;
  return c.json(costsSummary(month));
});

costsRouter.get("/admin/costs/events", (c) => {
  costsAdmin();
  const rawLimit = Number(c.req.query("limit") || 50);
  const agentId = c.req.query("agent_id") || null;
  return c.json({ events: listCostEvents(Number.isFinite(rawLimit) ? rawLimit : 50, agentId) });
});

costsRouter.put("/admin/costs/budget", async (c) => {
  const admin = costsAdmin();
  const body = await bodyObject(c);
  onlyFields(body, [
    "scope",
    "scope_ref",
    "limit_tokens",
    "warn_percent",
    "hard_stop_percent",
    "enabled",
    "expected_version",
  ]);
  const limitTokens = body.limit_tokens == null
    ? null
    : (typeof body.limit_tokens === "number" ? body.limit_tokens : (() => {
      throw new HttpFail(400, "limit_tokens must be a number or null");
    })());
  for (const field of ["warn_percent", "hard_stop_percent"] as const) {
    if (body[field] != null && typeof body[field] !== "number") throw new HttpFail(400, `${field} must be a number`);
  }
  if (body.enabled != null && typeof body.enabled !== "boolean") throw new HttpFail(400, "enabled must be boolean");
  const expectedVersion = parseExpectedVersion(body.expected_version);
  if (expectedVersion === undefined) throw new HttpFail(400, "expected_version is required");
  const row = upsertBudget({
    scope: String(body.scope ?? ""),
    scopeRef: String(body.scope_ref ?? ""),
    limitTokens,
    warnPercent: (body.warn_percent as number | null | undefined) ?? null,
    hardStopPercent: (body.hard_stop_percent as number | null | undefined) ?? null,
    enabled: body.enabled == null ? null : Boolean(body.enabled),
    expectedVersion,
    actor: admin.id,
  });
  return c.json(row);
});
