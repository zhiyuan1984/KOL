import { describe, expect, it } from "vitest";
import {
  DISCOVERY_CANCELLED_MESSAGE,
  DISCOVERY_CANCELLED_TITLE,
  DISCOVERY_CRAWL_ACTIVE_MESSAGE,
  DISCOVERY_GENERIC_FALLBACK,
  DISCOVERY_GENERIC_TITLE,
  DISCOVERY_TIMEOUT_MESSAGE,
  DISCOVERY_TIMEOUT_TITLE,
  DiscoveryWaitCancelledError,
  DiscoveryWaitTimeoutError,
  presentDiscoveryError,
} from "../../frontend/src/home/discovery-error.ts";

describe("presentDiscoveryError", () => {
  it("uses the fallback when errorText is JSON, and hides empty-code blobs from detail", () => {
    const view = presentDiscoveryError('{"code":"","":""}', DISCOVERY_GENERIC_FALLBACK);
    expect(view.title).toBe(DISCOVERY_GENERIC_TITLE);
    expect(view.message).toBe(DISCOVERY_GENERIC_FALLBACK);
    expect(view.message).not.toMatch(/\{/);
    expect(view.detail).toBeNull();
  });

  it("maps crawl_active JSON to Chinese copy without leaking the job id", () => {
    const view = presentDiscoveryError(
      '{"code":"crawl_active","crawl_job_id":"crawl_9c8e64463310"}',
      "检索没有完成，可调整条件后重试。",
    );
    expect(view.message).toBe(DISCOVERY_CRAWL_ACTIVE_MESSAGE);
    expect(view.detail).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/crawl_9c8e64463310|crawl_job_id/);
  });

  it("uses Error.message JSON as fallback, not as the employee line", () => {
    const view = presentDiscoveryError(
      new Error('{"code":"","":""}'),
      "检索没有完成，可调整条件后重试。",
    );
    expect(view.message).toBe("检索没有完成，可调整条件后重试。");
    expect(view.detail).toBeNull();
  });

  it("keeps human Chinese copy when it is not JSON", () => {
    const view = presentDiscoveryError("发现未完成，请稍后重试。", DISCOVERY_GENERIC_FALLBACK);
    expect(view.message).toBe("发现未完成，请稍后重试。");
    expect(view.detail).toBeNull();
  });

  it("maps wait timeout to recover-wait, never as empty success", () => {
    const view = presentDiscoveryError(new DiscoveryWaitTimeoutError({ candidates: [] }));
    expect(view.kind).toBe("timeout");
    expect(view.title).toBe(DISCOVERY_TIMEOUT_TITLE);
    expect(view.message).toBe(DISCOVERY_TIMEOUT_MESSAGE);
    expect(view.recover).toBe("wait");
    expect(view.retryLabel).toBe("继续等待");
    expect(view.detail).toBeNull();
  });

  it("maps cancelled wait to recover-wait", () => {
    const view = presentDiscoveryError(new DiscoveryWaitCancelledError());
    expect(view.kind).toBe("cancelled");
    expect(view.title).toBe(DISCOVERY_CANCELLED_TITLE);
    expect(view.message).toBe(DISCOVERY_CANCELLED_MESSAGE);
    expect(view.recover).toBe("wait");
    expect(view.retryLabel).toBe("继续等待");
  });
});
