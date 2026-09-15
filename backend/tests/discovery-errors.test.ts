import { describe, expect, it } from "vitest";
import {
  CRAWL_ACTIVE_MESSAGE,
  DISCOVERY_FAILED_MESSAGE,
  collectorFailureCode,
  employeeError,
  mapEmployeeError,
  persistableEmployeeError,
} from "../src/discovery-errors.js";
import { HttpFail } from "../src/host/errors.js";

const EMPTY_CODE_JSON = '{"code":"","":""}';

describe("discovery employee error mapping", () => {
  it("does not persist empty-code JSON as the employee message", () => {
    const blobs = [
      EMPTY_CODE_JSON,
      { code: "", "": "" },
      { code: "" },
    ];
    for (const raw of blobs) {
      expect(persistableEmployeeError(raw)).toBe(DISCOVERY_FAILED_MESSAGE);
      expect(employeeError(raw)).toBe(DISCOVERY_FAILED_MESSAGE);
      expect(mapEmployeeError(raw).message).toBe(DISCOVERY_FAILED_MESSAGE);
      expect(mapEmployeeError(raw).message).not.toMatch(/\{/);
    }
  });

  it("maps crawl_active objects and leftover stripped JSON to Chinese copy", () => {
    const sources = [
      { code: "crawl_active", crawl_job_id: "crawl_abc123def" },
      { code: "crawl_active" },
      '{"code":"crawl_active","crawl_job_id":"crawl_9c8e64463310"}',
      new HttpFail(409, { code: "crawl_active", crawl_job_id: "crawl_abc123def" }),
      new HttpFail(409, {
        code: "crawl_active",
        message: CRAWL_ACTIVE_MESSAGE,
        crawl_job_id: "crawl_abc123def",
      }),
    ];
    for (const raw of sources) {
      expect(persistableEmployeeError(raw)).toBe(CRAWL_ACTIVE_MESSAGE);
      expect(employeeError(raw)).toBe(CRAWL_ACTIVE_MESSAGE);
      expect(collectorFailureCode(raw)).toBe("crawl_active");
    }
  });

  it("uses HttpFail.detail.message when present and never stores JSON.stringify(detail)", () => {
    const fail = new HttpFail(409, {
      code: "crawl_active",
      message: CRAWL_ACTIVE_MESSAGE,
      crawl_job_id: "crawl_abc",
    });
    expect(fail.message).toBe(CRAWL_ACTIVE_MESSAGE);
    expect(persistableEmployeeError(fail)).toBe(CRAWL_ACTIVE_MESSAGE);

    const objectOnly = new HttpFail(502, { code: "", "": "" });
    expect(objectOnly.message).toBe(EMPTY_CODE_JSON);
    expect(persistableEmployeeError(objectOnly)).toBe(DISCOVERY_FAILED_MESSAGE);
    expect(persistableEmployeeError(objectOnly.detail)).toBe(DISCOVERY_FAILED_MESSAGE);
  });

  it("still keeps Chinese business copy and connection mapping", () => {
    expect(employeeError("请先填写要发现的关键词。")).toBe("请先填写要发现的关键词。");
    expect(employeeError({ code: "keywords_required", message: "请先填写要发现的关键词。" }))
      .toBe("请先填写要发现的关键词。");
    expect(employeeError("start_crawl returned no task_id")).toBe(DISCOVERY_FAILED_MESSAGE);
  });
});
