import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmStage } from "../src/adapters/starry.js";
import {
  appendBusinessEvent,
  listBusinessEvents,
  loadEventCatalog,
  resetEventCatalogCache,
  stageEventType,
} from "../src/business-events.js";
import { getConn, resetConn } from "../src/db.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono | null = null;

async function request(method: string, url: string) {
  if (!app) throw new Error("app not ready");
  const response = await app.request(url, { method, headers: { "Content-Type": "application/json" } });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-events-"));
  process.env.LINGONG_DB = path.join(tmp, "events.db");
  process.env.LINGONG_DATA = tmp;
  process.env.NODE_ENV = "test";
  resetEventCatalogCache();
  resetConn();
  getConn();
});

afterEach(() => {
  resetEventCatalogCache();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function eventCount(): number {
  return Number((getConn().prepare("SELECT COUNT(*) AS n FROM business_events").get() as { n: number }).n);
}

describe("business events ledger", () => {
  it("maps stage transitions to catalog event types", () => {
    expect(stageEventType("INITIAL_CONTACT", "INTERESTED")).toBe("stage.advanced");
    expect(stageEventType("INITIAL_CONTACT", "CONTRACTING")).toBe("stage.forward_skipped");
    expect(stageEventType("CONTRACTING", "INITIAL_CONTACT")).toBe("stage.regressed");
    expect(stageEventType("INTERESTED", "PAUSED")).toBe("stage.exception_entered");
    expect(stageEventType("PAUSED", "INTERESTED")).toBe("stage.exception_left");
    expect(stageEventType("SETTLING", "COMPLETED")).toBe("stage.completed");
    const catalog = loadEventCatalog({ refresh: true });
    expect(catalog).toBeTruthy();
    for (const code of [
      "stage.advanced",
      "stage.forward_skipped",
      "stage.regressed",
      "stage.exception_entered",
      "stage.exception_left",
      "stage.completed",
      "email.received",
    ]) {
      expect(catalog!.codes.has(code), code).toBe(true);
    }
  });

  it("appends idempotent, immutable facts and rejects unknown types in strict mode", () => {
    const input = {
      eventType: "email.received",
      objectType: "email",
      objectId: "kmi_test",
      source: "starry",
      actorType: "external" as const,
      idempotencyKey: "email.received:test-1",
    };
    expect(appendBusinessEvent(input, { strict: true }).inserted).toBe(true);
    expect(appendBusinessEvent(input, { strict: true }).inserted).toBe(false);
    expect(eventCount()).toBe(1);
    expect(() =>
      appendBusinessEvent({ ...input, eventType: "nope.not_registered", idempotencyKey: "x" }, { strict: true }),
    ).toThrow(/not_registered/);
    expect(() => getConn().prepare("UPDATE business_events SET payload='{}'").run()).toThrow(/immutable/);
    expect(() => getConn().prepare("DELETE FROM business_events").run()).toThrow(/immutable/);
  });

  it("lists events with filters and clamps limit", () => {
    const base = {
      source: "host",
      actorType: "system" as const,
      occurredAt: "2026-10-01T00:00:00.000Z",
      receivedAt: "2026-10-01T00:00:01.000Z",
    };
    appendBusinessEvent({ ...base, eventType: "email.received", objectType: "email", objectId: "e1", idempotencyKey: "k1" });
    appendBusinessEvent({ ...base, eventType: "stage.advanced", objectType: "collaboration", objectId: "c1", idempotencyKey: "k2" });
    expect(listBusinessEvents({ objectType: "email" })).toHaveLength(1);
    expect(listBusinessEvents({ eventType: "stage.advanced" })).toHaveLength(1);
    expect(listBusinessEvents({ limit: 1 })).toHaveLength(1);
    expect(() => listBusinessEvents({ limit: 0 })).not.toThrow();
  });

  it("records confirm_stage transitions into the ledger (stage wiring)", () => {
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO collaborations
       (id,handle,display_name,brand,platform,followers,email,mailbox_from,lifecycle_id,conversation_id,
        stage_code,days_in_stage,notes,overdue,kol_uid,stage_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_events", "KOL_EVENTS", "事件测试合作", "LT", "YouTube", "1", "kol@example.com", "from@example.com",
      "lc_events", "conv_events", "INITIAL_CONTACT", 0, "", 0, "KOL_EVENTS", 0,
    );
    const result = confirmStage("lc_events", { stage_code: "INTERESTED", actor: "host", reason: "测试前进" }) as unknown as {
      transition_id: string;
    };
    const rows = listBusinessEvents({ eventType: "stage.advanced" });
    expect(rows).toHaveLength(1);
    expect(rows[0].object_type).toBe("collaboration");
    expect(rows[0].object_id).toBe("col_events");
    expect(rows[0].idempotency_key).toBe(`stage_transition:${result.transition_id}`);
    expect((rows[0].payload as Json).from_stage).toBe("INITIAL_CONTACT");
    expect((rows[0].payload as Json).to_stage).toBe("INTERESTED");
    // 重放同一转移不得落第二条事实（幂等键去重）。
    const replay = appendBusinessEvent({
      eventType: "stage.advanced",
      objectType: "collaboration",
      objectId: "col_events",
      source: "starry",
      actorType: "human",
      idempotencyKey: `stage_transition:${result.transition_id}`,
    });
    expect(replay.inserted).toBe(false);
    expect(eventCount()).toBe(1);
  });

  it("keeps the ledger empty-safe across demo resets", async () => {
    const { seedAll, resetDemoRuntimeState } = await import("../src/seed.js");
    seedAll();
    appendBusinessEvent({
      eventType: "email.received",
      objectType: "email",
      objectId: "reset-x",
      source: "test",
      actorType: "external",
      idempotencyKey: "reset-1",
    });
    expect(eventCount()).toBe(1);
    resetDemoRuntimeState();
    expect(eventCount()).toBe(0);
    appendBusinessEvent({
      eventType: "email.received",
      objectType: "email",
      objectId: "reset-y",
      source: "test",
      actorType: "external",
      idempotencyKey: "reset-2",
    });
    expect(eventCount()).toBe(1);
    expect(() => getConn().prepare("DELETE FROM business_events").run()).toThrow(/immutable/);
  });

  it("serves GET /api/events", async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    appendBusinessEvent({
      eventType: "email.received",
      objectType: "email",
      objectId: "kmi_api",
      source: "starry",
      actorType: "external",
      idempotencyKey: "email.received:api-1",
    });
    const response = await request("GET", "/api/events?event_type=email.received");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const events = response.body.events as Json[];
    expect(events).toHaveLength(1);
    expect(events[0].object_id).toBe("kmi_api");
  });
});
