import { afterEach, describe, expect, it, vi } from "vitest";
import { QA_CONTEXT_VERSION, type QaContext } from "../../shared/knowledge-qa.js";
import { readQaContext } from "../src/knowledge/qa-contract.js";
import { callQaLuna, QaLunaUnavailable } from "../src/knowledge/qa-luna.js";
import { parseRewriteProposal, rewriteQa, validateRewriteProposal } from "../src/knowledge/qa-rewriter.js";

const scope = { base_id: "base", doc_ids: ["doc"], include_pending: false };
const documents = [{ id: "doc", title: "LiTime 产品手册", filename: "manual.pdf" }];
const context: QaContext = { version: QA_CONTEXT_VERSION, scope, history_summary: "以前讨论过 LiTime 12V 200Ah",
  last_turn: { query: "介绍 LiTime 12V 100Ah", answer: "LiTime 12V 100Ah 是产品型号", entities: ["LiTime 12V 100Ah"],
    citations: [{ document: "LiTime 产品手册", document_id: "doc", page: 1 }] } };
const proposal = { rewritten: "介绍 LiTime 12V 100Ah 的规格和用途", resolved_entities: ["LiTime 12V 100Ah"], rewrote: true, reason: "唯一主语" };
function transport(value: unknown, usage: unknown = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) {
  return vi.fn(async () => new Response(JSON.stringify({ output_text: typeof value === "string" ? value : JSON.stringify(value), usage }))) as unknown as typeof fetch;
}
afterEach(() => vi.useRealTimers());

describe("admin QA rewrite contract", () => {
  it("RW02 calls Luna once and returns a clean question, not appended history", async () => {
    const fetchFn = transport(proposal);
    const result = await rewriteQa({ query: "介绍它的规格和用途", scope, context, documents }, { apiKey: "test", fetch: fetchFn });
    expect(result.diagnostic.status).toBe("applied");
    expect(result.diagnostic.effective_query).toBe(proposal.rewritten);
    expect(result.call?.usage?.total_tokens).toBe(15);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0];
    expect(String(url)).toMatch(/\/responses$/);
    const body = JSON.parse(String(init?.body));
    expect(body.text.format.strict).toBe(false);
    expect(body.store).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(JSON.parse(body.input).last_turn.entities).toEqual(context.last_turn?.entities);
  });
  it("RW01/RW04 complete first questions still call Luna", async () => {
    const fetchFn = transport({ rewritten: "有哪些产品型号", resolved_entities: [], rewrote: false, reason: "问题完整" });
    const result = await rewriteQa({ query: "有哪些产品型号", scope, documents }, { apiKey: "test", fetch: fetchFn });
    expect(result.diagnostic).toMatchObject({ status: "unchanged", effective_query: "有哪些产品型号" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.parse(String(vi.mocked(fetchFn).mock.calls[0][1]?.body)).input).last_turn).toBeNull();
  });
  it.each(["LiTime 12V 100Ah", "LiTime 产品手册", "LiTime 12V 200Ah"])("RW05 permits entity provenance: %s", (entity) => {
    const c = readQaContext(context, scope, documents);
    expect(() => validateRewriteProposal("它呢", c, { ...proposal, rewritten: `${entity} 的规格`, resolved_entities: [entity] })).not.toThrow();
  });
  it.each([
    [{ ...proposal, resolved_entities: ["编造型号"] }, "entity_not_in_rewritten"],
    [{ ...proposal, rewritten: "编造型号 的规格", resolved_entities: ["编造型号"] }, "entity_without_source"],
    [{ ...proposal, rewritten: "介绍规格" }, "entity_not_in_rewritten"],
    [{ ...proposal, resolved_entities: [] }, "unverifiable_rewrite"],
    [{ ...proposal, rewrote: false }, "unchanged_query_mismatch"],
    [{ ...proposal, resolved_entities: ["LiTime 12V 100Ah", "LiTime 12V 200Ah"] }, "entity_not_in_rewritten"],
    [{ ...proposal, scope: { base_id: "outside" } }, "unexpected_model_field"],
    [{ ...proposal, rewrote: "true" }, "invalid_rewrote"],
    [{ ...proposal, rewritten: "" }, "empty_rewritten"],
    ["invalid JSON", "invalid_model_json"],
  ])("RW06–09 rejects invalid proposals without changing effective query", async (value, code) => {
    const result = await rewriteQa({ query: "它呢", scope, context, documents }, { apiKey: "test", fetch: transport(value) });
    expect(result.diagnostic).toMatchObject({ status: "rejected", effective_query: "它呢", resolved_entities: [] });
    expect(result.reason_code).toBe(code);
    expect(result.call?.usage?.total_tokens).toBe(15);
  });
  it("RW10 does not force a rewrite for ambiguous pronouns", async () => {
    const result = await rewriteQa({ query: "它呢", scope, context, documents }, { apiKey: "test", fetch: transport({ rewritten: "它呢", resolved_entities: [], rewrote: false, reason: "请指定型号" }) });
    expect(result.diagnostic.status).toBe("unchanged");
    expect(result.diagnostic.reason).toBe("请指定型号");
  });
  it("CT09 rejects context scope or citations before model dispatch", async () => {
    const fetchFn = transport(proposal);
    for (const bad of [ { ...context, scope: { ...scope, base_id: "other" } },
      { ...context, last_turn: { ...context.last_turn!, citations: [{ document: "other", document_id: "outside", page: 1 }] } } ]) {
      const result = await rewriteQa({ query: "它呢", scope, context: bad, documents }, { apiKey: "test", fetch: fetchFn });
      expect(result.diagnostic.status).toBe("rejected");
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("CT10 refuses oversized context rather than silently truncating entities", () => {
    expect(() => readQaContext({ ...context, history_summary: "x".repeat(1501) }, scope, documents)).toThrow("context_limit_exceeded");
    expect(() => parseRewriteProposal(JSON.stringify({ ...proposal, resolved_entities: Array(257).fill("x") }))).toThrow();
  });
  it.each([401, 429, 500])("FB01 returns original query on HTTP %s", async (status) => {
    const result = await rewriteQa({ query: "它呢", scope, context, documents }, { apiKey: "test", fetch: vi.fn(async () => new Response("error", { status })) });
    expect(result.diagnostic).toMatchObject({ status: "unavailable", effective_query: "它呢" });
    expect(result.reason_code).toBe(`http_${status}`);
  });
  it("FB01 has no retry when transport throws", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("secret provider detail"); });
    const result = await rewriteQa({ query: "它呢", scope, context, documents }, { apiKey: "test", fetch: fetchFn });
    expect(result.reason_code).toBe("transport_error");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("secret provider detail");
  });
  it("FB01 missing credentials immediately degrades with no network", async () => {
    const fetchFn = transport(proposal);
    const result = await rewriteQa({ query: "它呢", scope, context, documents }, { apiKey: "", fetch: fetchFn });
    expect(result.reason_code).toBe("missing_credentials");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("bounded QA Responses transport", () => {
  it.each(["headers", "body"])("FB02 bounds hung %s", async (phase) => {
    vi.useFakeTimers();
    const fetchFn = phase === "headers" ? vi.fn(() => new Promise<Response>(() => {})) : vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response);
    const promise = callQaLuna({ name: "test", instructions: "data only", input: {}, schema: {}, timeoutMs: 5 }, { apiKey: "test", fetch: fetchFn as typeof fetch });
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(6);
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("does not report unknown usage as zero", async () => {
    const r = await callQaLuna({ name: "test", instructions: "", input: {}, schema: {}, timeoutMs: 100 }, { apiKey: "test", fetch: transport({}, null) });
    expect(r.usage).toBeNull();
  });
  it("does not leak credentials through errors", () => expect(new QaLunaUnavailable("transport_error").message).toBe("transport_error"));
});
