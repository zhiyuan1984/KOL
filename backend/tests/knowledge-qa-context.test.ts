import { describe, expect, it, vi } from "vitest";
import { maintainQaContext, parseMaintenanceProposal, readMaintenanceInput } from "../src/knowledge/qa-context.js";
import type { QaMaintenanceInput } from "../../shared/knowledge-qa.js";
const docs = [{ id: "doc", title: "产品手册" }];
const input: QaMaintenanceInput = {
  scope: { base_id: "base", doc_ids: ["doc"] },
  turn: { query: "有哪些型号", answer: "LiTime 12V 100Ah 和 LiTime 12V 200Ah", entities: [], citations: [{ document: "产品手册", document_id: "doc", page: 1 }] },
  history_summary: "之前明确讨论了 LiTime 12V 100Ah", compress: false,
};
function fetchResult(value: unknown) { return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ output_text: JSON.stringify(value), usage: { input_tokens: 20, output_tokens: 8 } }))); }
describe("QA context maintenance", () => {
  it("CT01 extracts all answer entities, not rewrite resolutions", async () => {
    const f = fetchResult({ entities: ["LiTime 12V 100Ah", "LiTime 12V 200Ah"], history_summary: input.history_summary });
    const outcome = await maintainQaContext(input, { apiKey: "test", fetch: f });
    expect(outcome.result).toMatchObject({ status: "ready", entities: ["LiTime 12V 100Ah", "LiTime 12V 200Ah"], compressed: false });
    expect(outcome.call?.usage?.total_tokens).toBe(28);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("CT03 sends full answer including its tail for extraction", async () => {
    const full = { ...input, turn: { ...input.turn, answer: `${"说明。".repeat(1500)}LiTime 12V 200Ah` } };
    const f = fetchResult({ entities: ["LiTime 12V 200Ah"], history_summary: input.history_summary });
    await maintainQaContext(full, { apiKey: "test", fetch: f });
    const body = JSON.parse(String(f.mock.calls[0]?.[1]?.body));
    expect(JSON.parse(body.input).turn.answer).toBe(full.turn.answer);
  });
  it.each([
    [{ entities: ["LiTime 48V 999Ah"], history_summary: input.history_summary }, "entity_without_source"],
    [{ entities: ["LiTime 12V 100Ah"], history_summary: "model altered history" }, "unexpected_summary_change"],
    [{ entities: [], history_summary: "" }, "empty_summary"],
    [{ entities: [], history_summary: "x".repeat(1501) }, "context_limit_exceeded"],
    [{ entities: [], history_summary: input.history_summary, scope: "outside" }, "unexpected_model_field"],
  ])("CT02/CT07 refuses unsupported entities or unsafe summary changes", (p, code) => {
    expect(() => parseMaintenanceProposal(JSON.stringify(p), input)).toThrow(String(code));
  });
  it("CT07 compresses history and extracts entities in a single call", async () => {
    const pending = { ...input, compress: true, history_summary: "以前。".repeat(600) };
    const f = fetchResult({ entities: ["LiTime 12V 100Ah"], history_summary: "以前讨论过产品" });
    const result = await maintainQaContext(pending, { apiKey: "test", fetch: f });
    expect(result.result).toMatchObject({ status: "ready", compressed: true, summary_truncated: false });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("CT07/CT08 failure preserves answer and bounds fallback summary", async () => {
    const pending = { ...input, history_summary: `${"旧。".repeat(800)}最新型号 LiTime 12V 200Ah`, compress: true };
    const before = structuredClone(pending);
    const result = await maintainQaContext(pending, { apiKey: "test", fetch: vi.fn(async () => { throw new Error("provider secret"); }) });
    expect(result.result).toMatchObject({ status: "degraded", entities: [], compressed: false, summary_truncated: true });
    expect(result.result.history_summary.length).toBe(1500);
    expect(result.result.history_summary).toContain("最新型号 LiTime 12V 200Ah");
    expect(pending).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("provider secret");
  });
  it("CT08 missing credentials produces an explicit partial-context state", async () => {
    const result = await maintainQaContext(input, { apiKey: "" });
    expect(result.result).toMatchObject({ status: "degraded", history_summary: input.history_summary, reason: "missing_credentials" });
  });
  it("CT09 canonicalizes citation names only through server-known documents", () => {
    const parsed = readMaintenanceInput({ ...input, turn: { ...input.turn, citations: [{ document: "client-name", document_id: "doc", page: 1 }] } }, docs);
    expect(parsed.turn.citations[0].document).toBe("产品手册");
    expect(() => readMaintenanceInput({ ...input, turn: { ...input.turn, citations: [{ document: "other", document_id: "outside", page: 1 }] } }, docs)).toThrow("context_citation_out_of_scope");
  });
  it("CT10 rejects over-limit metadata without dropping individual citations silently", () => {
    expect(() => readMaintenanceInput({ ...input, turn: { ...input.turn, answer: "x".repeat(64001) } }, docs)).toThrow("context_limit_exceeded");
    expect(() => readMaintenanceInput({ ...input, turn: { ...input.turn, entities: Array(257).fill("x") } }, docs)).toThrow();
  });
});
