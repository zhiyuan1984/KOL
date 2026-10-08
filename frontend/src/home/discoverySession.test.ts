import { describe, expect, it } from "vitest";
import { sessionDiscoveryFromAction } from "./discoveryHome";
import type { RuntimeActionView } from "../api";

function action(overrides: Partial<RuntimeActionView> = {}): RuntimeActionView {
  return {
    id: "action_session_1",
    skill_id: "crawler_collect",
    operation: "start_crawl",
    arguments: { keywords: "camping" },
    state: "succeeded",
    risk: "L3",
    confirmation_version: "v1",
    blocked_reason: null,
    receipt: null,
    error_code: null,
    crawl: {
      id: "action_session_1",
      remote_task_id: "remote_1",
      state: "succeeded",
      status_json: { started_at: "2026-10-08T03:57:11.000Z" },
      error_code: null,
      result_state: "ready",
      result_json: {
        task_id: "remote_1",
        complete: true,
        captured_at: "2026-10-08T04:13:23.000Z",
        candidates: [{
          id: "creator_1", name: "Creator One", platform: "youtube",
          source_url: "https://youtube.com/channel/creator_1", followers: 120000,
          avg_views_10: 8000, region: "US", sampled_views_count: 10,
          sampled_views_avg: 8000, ignored: false, followed: false, in_pool: false,
        }],
      },
    },
    ...overrides,
  };
}

describe("session discovery result adapter", () => {
  it("projects the line-agent runtime snapshot into the discovery view model", () => {
    const result = sessionDiscoveryFromAction(action(), "ses_1");
    expect(result.run).toMatchObject({ id: "action_session_1", session_id: "ses_1", status: "completed", raw_count: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ id: "creator_1", nickname: "Creator One", followers: 120000, avg_plays_10: 8000, run_id: "action_session_1" });
  });

  it("does not invent results when the session has no crawl action", () => {
    const result = sessionDiscoveryFromAction(null, "ses_empty");
    expect(result.run).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.missing).toBe(true);
  });
});
