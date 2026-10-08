import { describe, expect, it } from "vitest";
import { isFormalAuthorityPath } from "../src/app.js";
import { isSerializationFailure } from "../src/postgres/pool.js";

/** 鉴权路径与序列化冲突判定（无 PG 依赖）。 */
describe("formal authority paths", () => {
  it("covers KOL lead/cooperation APIs", () => {
    expect(isFormalAuthorityPath("/api/kol/leads")).toBe(true);
    expect(isFormalAuthorityPath("/api/kol/leads/lead_1")).toBe(true);
    expect(isFormalAuthorityPath("/api/kol/leads/lead_1/lead-events")).toBe(true);
    expect(isFormalAuthorityPath("/api/kol/cooperations")).toBe(true);
    expect(isFormalAuthorityPath("/api/kol/cooperations/coop_1/coop-events")).toBe(true);
  });

  it("keeps existing formal paths", () => {
    expect(isFormalAuthorityPath("/api/tickets")).toBe(true);
    expect(isFormalAuthorityPath("/api/tickets/abc")).toBe(true);
    expect(isFormalAuthorityPath("/api/task-work-orders")).toBe(true);
    expect(isFormalAuthorityPath("/api/cron/jobs")).toBe(true);
    expect(isFormalAuthorityPath("/api/admin/work-orders/templates")).toBe(true);
  });

  it("rejects non-formal paths", () => {
    expect(isFormalAuthorityPath("/api/kolx/leads")).toBe(false);
    expect(isFormalAuthorityPath("/api/health")).toBe(false);
    expect(isFormalAuthorityPath("/api/me")).toBe(false);
  });
});

describe("isSerializationFailure", () => {
  it("detects PG 40001 by code or message", () => {
    expect(isSerializationFailure(Object.assign(new Error("x"), { code: "40001" }))).toBe(true);
    expect(isSerializationFailure(new Error("could not serialize access due to read/write dependencies among transactions"))).toBe(true);
    expect(isSerializationFailure(new Error("connection refused"))).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
  });
});
