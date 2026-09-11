import { describe, expect, it } from "vitest";
import { mailSendReceipt } from "../src/host/receipt.js";
import { parseExpectedVersion } from "../src/host/version.js";
import { HttpFail } from "../src/host/errors.js";

describe("mailSendReceipt", () => {
  it("requires an explicit vendor success signal", () => {
    expect(mailSendReceipt({}).sent).toBe(false);
    expect(mailSendReceipt({ sent: false }).sent).toBe(false);
    expect(mailSendReceipt({ messageId: "m-1" }).sent).toBe(false);
    expect(mailSendReceipt({ sent: true, messageId: "m-1" })).toMatchObject({
      sent: true,
      remote_id: "m-1",
    });
    expect(mailSendReceipt({ ok: true }).sent).toBe(true);
    expect(mailSendReceipt({ status: "SENT" }).sent).toBe(true);
    expect(mailSendReceipt({ state: "SENT", id: 1210 }).sent).toBe(true);
    expect(mailSendReceipt({ operation: "SYNC_SENT", messageId: "<x@amperetime.com>" })).toMatchObject({
      sent: true,
      remote_id: "<x@amperetime.com>",
    });
    expect(mailSendReceipt({ code: 0 }).sent).toBe(true);
    expect(mailSendReceipt({ data: { ok: true, message_id: "nested" } })).toMatchObject({
      sent: true,
      remote_id: "nested",
    });
  });
});

describe("parseExpectedVersion", () => {
  it("accepts only non-negative integers and ignores empty values", () => {
    expect(parseExpectedVersion(null)).toBeUndefined();
    expect(parseExpectedVersion(undefined)).toBeUndefined();
    expect(parseExpectedVersion("")).toBeUndefined();
    expect(parseExpectedVersion(0)).toBe(0);
    expect(parseExpectedVersion("3")).toBe(3);
    expect(() => parseExpectedVersion(-1)).toThrow(HttpFail);
    expect(() => parseExpectedVersion(1.5)).toThrow(HttpFail);
    expect(() => parseExpectedVersion("01")).toThrow(HttpFail);
    expect(() => parseExpectedVersion("foo")).toThrow(HttpFail);
  });
});
