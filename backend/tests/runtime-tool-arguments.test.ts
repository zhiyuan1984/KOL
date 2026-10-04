import { describe, expect, it } from "vitest";
import { assertRuntimeToolArguments } from "../src/runtime/tool-arguments.js";
import { crawlToolPresentation } from "../src/crawl/tool-contract.js";
import { discoveryCandidateContext } from "../src/worker/discovery-context.js";
import type { Json } from "../src/types.js";
import { startRuntimeProxy } from "../src/runtime/proxy.js";
import type { SkillExecution } from "../src/runtime/execution.js";
import { RemoteMcpClient } from "../src/mcp/remote.js";

// Shape observed in the live MediaCrawler tools/list (read-only inspection).
const remote: Json = { name: "start_crawl", inputSchema: { type: "object", properties: {
  platforms: { type: "array", items: { type: "string" } },
  keywords: { type: "string", default: "" }, crawler_type: { type: "string", default: "search" },
  max_notes_count: { type: "integer", default: 20 }, enable_comments: { type: "boolean", default: false },
  enable_sub_comments: { type: "boolean", default: false }, specified_ids: { type: "string", default: "" },
  creator_ids: { type: "string", default: "" }, login_type: { type: "string", default: "qrcode" },
}, required: ["platforms"] } };
const schemas = [remote.inputSchema as Json, crawlToolPresentation(remote)!.inputSchema as Json];
const args = { platforms: ["youtube"], crawler_type: "search", keywords: "boat life,marine power,sailboat living",
  enable_comments: false, enable_sub_comments: false };

describe("discovery argument diagnostics", () => {
  it("accepts all requested keywords as a string without mutating scope", () => {
    const before = JSON.stringify(args);
    expect(() => assertRuntimeToolArguments(schemas, args)).not.toThrow();
    expect(JSON.stringify(args)).toBe(before);
  });
  it("explains the form-array mismatch without exposing any submitted keyword", () => {
    let failure: any;
    try { assertRuntimeToolArguments(schemas, { ...args, keywords: ["private-search-term"] }); }
    catch (error) { failure = error; }
    expect(failure.detail).toMatchObject({ code: "runtime_tool_arguments_invalid", dispatched: false,
      argument_issues: [{ field: "keywords", issue: "type", expected: ["string"], actual: "array" }] });
    expect(JSON.stringify(failure.detail)).not.toContain("private-search-term");
  });
  it("still rejects missing scope, unsafe switches and multiple platforms", () => {
    for (const invalid of [{ ...args, keywords: undefined }, { ...args, platforms: undefined },
      { ...args, enable_comments: true }, { ...args, platforms: ["youtube", "instagram"] },
      { ...args, upload: true }]) {
      expect(() => assertRuntimeToolArguments(schemas, invalid)).toThrow();
    }
  });
  it("returns actionable type diagnostics through MCP without forwarding an invalid request", async () => {
    let accepted = 0;
    const execution = {
      context: { skillId: "crawler_collect" }, close() {},
      async discover() { return { tools: [{ exposed: crawlToolPresentation(remote) }], unavailable: [] }; },
      async invoke(_name: string, submitted: Json) {
        assertRuntimeToolArguments(schemas, submitted);
        accepted += 1;
        return { content: [{ type: "text", text: "pending-confirmation" }] };
      },
    } as unknown as SkillExecution;
    const proxy = await startRuntimeProxy(execution);
    const client = new RemoteMcpClient({ url: String(proxy.spec.url), headers: proxy.spec.http_headers as Record<string, string> });
    try {
      const invalid = await client.callToolRaw("start_crawl", { ...args, keywords: ["private-search-term"] });
      expect(invalid.isError).toBe(true);
      const detail = JSON.parse(String((invalid.content as Json[])[0].text));
      expect(detail).toMatchObject({ code: "runtime_tool_arguments_invalid", dispatched: false,
        argument_issues: [{ field: "keywords", expected: ["string"], actual: "array" }] });
      expect(JSON.stringify(invalid)).not.toContain("private-search-term");
      expect(accepted).toBe(0);
      const valid = await client.callToolRaw("start_crawl", args);
      expect(valid.isError).not.toBe(true);
      expect(accepted).toBe(1);
    } finally { await client.close(); await proxy.close(); }
  });
});

describe("discovery snapshot context", () => {
  it("does not describe an empty task as an available candidate snapshot", () => {
    expect(discoveryCandidateContext([])).toContain("No persisted collection or candidate snapshot exists");
    expect(discoveryCandidateContext([])).not.toContain("Persisted discovery collection snapshots");
  });
  it("preserves pending, empty and available records with their real completeness", () => {
    const records = [{ result_state: "pending", candidates: [], captured_at: null },
      { result_state: "succeeded", candidate_count: 1, included_count: 1, candidates: [{ id: "real-candidate" }] }];
    const context = discoveryCandidateContext(records);
    expect(context).toContain(JSON.stringify(records));
    expect(context).toContain("not necessarily available candidates");
  });
});
