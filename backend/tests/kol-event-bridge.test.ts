import { describe, expect, it } from "vitest";
import { HttpFail } from "../src/host/errors.js";
import {
  COOP_MANUAL_EVENT_TYPES,
  ensureLeadFromDiscoveryCandidate,
  LEAD_MANUAL_EVENT_TYPES,
  recordCooperationEvent,
  recordLeadEvent,
} from "../src/ticket-domain/kol-event-bridge.js";

/** 事件生产者桥接单测（无 PG 依赖：只覆盖前置校验分支）。 */
describe("kol event bridge", () => {
  it("exposes the 5 lead manual event types", () => {
    expect([...LEAD_MANUAL_EVENT_TYPES].sort()).toEqual(
      ["lead.followup_due", "lead.high_potential_detected", "lead.intent_confirmed", "lead.reply_received", "lead.sample_requested"].sort(),
    );
  });

  it("rejects missing candidate identity before touching PG", async () => {
    await expect(ensureLeadFromDiscoveryCandidate("u1", false, { platform: "", account_handle: "" }))
      .rejects.toMatchObject({ status: 422 });
    await expect(ensureLeadFromDiscoveryCandidate("u1", false, { platform: "douyin", account_handle: "  " }))
      .rejects.toMatchObject({ status: 422 });
  });

  it("rejects disallowed event types before touching PG", async () => {
    await expect(recordLeadEvent("u1", false, "lead_1", {
      event_type: "coop.created", summary: "x", idempotency_key: "12345678",
    })).rejects.toBeInstanceOf(HttpFail);
  });

  it("rejects empty summary and short idempotency keys", async () => {
    await expect(recordLeadEvent("u1", false, "lead_1", {
      event_type: "lead.reply_received", summary: "  ", idempotency_key: "12345678",
    })).rejects.toMatchObject({ status: 422 });
    await expect(recordLeadEvent("u1", false, "lead_1", {
      event_type: "lead.reply_received", summary: "ok", idempotency_key: "short",
    })).rejects.toMatchObject({ status: 422 });
  });

  it("exposes the 17 cooperation manual event types", () => {
    expect(COOP_MANUAL_EVENT_TYPES).toHaveLength(17);
    expect(COOP_MANUAL_EVENT_TYPES).toContain("kol.script_submitted");
    expect(COOP_MANUAL_EVENT_TYPES).toContain("kol.settlement_completed");
    expect(COOP_MANUAL_EVENT_TYPES).toContain("kol.dispute_raised");
  });

  it("rejects disallowed cooperation event types before touching PG", async () => {
    await expect(recordCooperationEvent("u1", false, "coop_1", {
      event_type: "lead.reply_received", summary: "x", idempotency_key: "12345678",
    })).rejects.toBeInstanceOf(HttpFail);
    await expect(recordCooperationEvent("u1", false, "coop_1", {
      event_type: "kol.script_submitted", summary: "  ", idempotency_key: "12345678",
    })).rejects.toMatchObject({ status: 422 });
  });
});
