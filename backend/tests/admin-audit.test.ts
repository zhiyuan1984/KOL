import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { audit, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";

let tmp = "";
let app: Hono;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-admin-audit-"));
  process.env.LINGONG_DB = path.join(tmp, "audit.db");
  process.env.LINGONG_DATA = tmp;
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("admin audit reader", () => {
  it("returns a bounded, descending, filterable audit page", async () => {
    audit("admin:a", "execution_job.retry_requested", { execution_job_id: "job_a" });
    audit("admin:b", "ticket.complete", { ticket_id: "tkt_b" });
    const first = await app.request("/api/admin/audit/events?limit=1&event_type=ticket.complete");
    expect(first.status).toBe(200);
    const page = await first.json() as { items: Array<{ id: number; event_type: string; actor: string }>; next_cursor: number | null; source_refs: Array<{ type: string }> };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ event_type: "ticket.complete", actor: "admin:b" });
    expect(page.source_refs).toEqual([{ type: "audit_events", scope: "admin" }]);

    const byActor = await app.request("/api/admin/audit/events?actor=admin:a");
    const actorPage = await byActor.json() as { items: Array<{ event_type: string; actor: string }> };
    expect(actorPage.items.some((event) => event.event_type === "execution_job.retry_requested" && event.actor === "admin:a")).toBe(true);
  });
});
