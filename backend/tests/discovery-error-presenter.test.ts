import { describe, expect, it } from "vitest";
import {
  DISCOVERY_CRAWL_ACTIVE_MESSAGE,
  DISCOVERY_GENERIC_FALLBACK,
  DISCOVERY_GENERIC_TITLE,
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
});
