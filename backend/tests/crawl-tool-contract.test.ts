import { describe, expect, it } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { crawlToolPresentation } from "../src/crawl/tool-contract.js";
import { candidateView } from "../src/crawl/results.js";

describe("governed collection contract", () => {
  it("exposes only the accepted scope while preserving remote requirements", () => {
    const remote = { name: "start_crawl", inputSchema: { type: "object", properties: {
      platforms: { type: "array" }, crawler_type: { type: "string" }, keywords: { type: "string" },
      specified_ids: { type: "string" }, creator_ids: { type: "string" }, max_count: { type: "integer", default: 50 },
      max_notes_count: { type: "integer" }, enable_comments: { type: "boolean" }, enable_sub_comments: { type: "boolean" },
    }, required: ["platforms", "crawler_type"], additionalProperties: false } };
    const exposed = crawlToolPresentation(remote)!;
    const validate = new AjvJsonSchemaValidator().getValidator(exposed.inputSchema as object);
    const good = { platforms: ["youtube"], crawler_type: "search", keywords: "camping" };
    expect(validate(good).valid).toBe(true);
    expect(validate({ ...good, max_count: 50 }).valid).toBe(false);
    expect(validate({ ...good, max_notes_count: 50, enable_comments: false, enable_sub_comments: false }).valid).toBe(true);
    expect(validate({ ...good, enable_comments: true }).valid).toBe(false);
    expect(validate({ ...good, max_notes_count: 10001 }).valid).toBe(false);
    expect(validate({ ...good, platforms: ["youtube", "instagram"] }).valid).toBe(false);
    expect(validate({ platforms: ["youtube"], crawler_type: "search" }).valid).toBe(false);
    expect(remote.inputSchema.properties.max_count).toBeDefined();
  });
  it("requires a persisted task ID for status queries", () => {
    const tool = crawlToolPresentation({ name: "get_crawl_status", inputSchema: { type: "object", properties: { task_id: { type: "string" } } } })!;
    const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema as object);
    expect(validate({}).valid).toBe(false);
    expect(validate({ task_id: "owned-task" }).valid).toBe(true);
    expect(crawlToolPresentation({ name: "get_creators", inputSchema: { type: "object", properties: { limit: { type: "number" } } } })).toBeNull();
  });
  it("keeps unknown metrics unknown and strips unsafe source links", () => {
    expect(candidateView({ id: "a", followers: null, url: "javascript:alert(1)", recent_views: [100] }, "youtube"))
      .toMatchObject({ followers: null, avg_views_10: null, source_url: null });
    expect(candidateView({ id: "a", followers: 0, recent_views: Array(10).fill(10) }, "youtube"))
      .toMatchObject({ followers: 0, avg_views_10: 10 });
    expect(candidateView({ id: "a", followers: false, recent_views: Array(10).fill([]) }, "youtube"))
      .toMatchObject({ followers: null, avg_views_10: null });
    expect(candidateView({ id: "a", views: Array(10).fill(100) }, "youtube"))
      .toMatchObject({ avg_views_10: null, sampled_views_count: 10, sampled_views_avg: 100 });
  });
});
