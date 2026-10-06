/** Opt-in provider smoke check only; never proof of real-document/PageIndex acceptance. */
import { intentLlmApiKey, intentLlmModel } from "../src/tasks/openai-intent.js";
import { rewriteQa } from "../src/knowledge/qa-rewriter.js";
import { maintainQaContext } from "../src/knowledge/qa-context.js";
import { QA_CONTEXT_VERSION, type QaContext } from "../../shared/knowledge-qa.js";

async function main() {
  if (process.env.QA_LIVE_CHECK !== "1") throw new Error("live_check_not_enabled");
  const apiKey = intentLlmApiKey();
  if (!apiKey) throw new Error("missing_credentials");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = intentLlmModel();
  const response = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`catalog_http_${response.status}`);
  const catalog = await response.json() as { data?: Array<{ id?: string }> };
  if (!catalog.data?.some((entry) => entry.id === model)) throw new Error("configured_luna_not_in_catalog");
  const scope = { base_id: "synthetic-smoke", doc_ids: ["synthetic-doc"] };
  const documents = [{ id: "synthetic-doc", title: "产品手册" }];
  const context: QaContext = { version: QA_CONTEXT_VERSION, scope, history_summary: "",
    last_turn: { query: "介绍 LiTime 12V 100Ah", answer: "本轮仅讨论 LiTime 12V 100Ah。", entities: ["LiTime 12V 100Ah"], citations: [{ document: "产品手册", document_id: "synthetic-doc", page: 1 }] } };
  const deps = { apiKey, baseUrl, model };
  const rows: unknown[] = [];
  for (const [id, query, ctx, expectApplied] of [
    ["single_subject", "介绍它的规格参数和用途", context, true],
    ["explicit_new_subject", "LiTime 12V 200Ah 的规格是什么？", context, false],
    ["ambiguous_subject", "介绍它的规格", { ...context, last_turn: { ...context.last_turn!, query: "有哪些型号", answer: "LiTime 12V 100Ah 和 LiTime 12V 200Ah", entities: ["LiTime 12V 100Ah", "LiTime 12V 200Ah"] } }, false],
  ] as const) {
    const started = Date.now();
    const r = await rewriteQa({ query, context: ctx, scope, documents }, deps);
    const passed = r.diagnostic.status === (expectApplied ? "applied" : "unchanged");
    rows.push({ id, passed, elapsed_ms: Date.now() - started, diagnostic: r.diagnostic, usage: r.call?.usage || null });
    if (!passed) { console.log(JSON.stringify({ model, kind: "synthetic_provider_smoke", passed: false, rows }, null, 2)); process.exitCode = 1; return; }
  }
  const turn = { query: "有哪些型号", answer: "LiTime 12V 100Ah 和 LiTime 12V 200Ah。", entities: [], citations: context.last_turn!.citations };
  const maintenance = await maintainQaContext({ scope, turn, history_summary: "" }, deps);
  const extracted = maintenance.result.status === "ready" && ["LiTime 12V 100Ah", "LiTime 12V 200Ah"].every((e) => maintenance.result.entities.includes(e));
  rows.push({ id: "answer_entities", passed: extracted, result: maintenance.result, usage: maintenance.call?.usage || null });
  if (!extracted) { console.log(JSON.stringify({ model, kind: "synthetic_provider_smoke", passed: false, rows }, null, 2)); process.exitCode = 1; return; }
  const compressed = await maintainQaContext({ scope, turn, history_summary: "曾讨论 LiTime 12V 100Ah，其规格未确认。".repeat(100), compress: true }, deps);
  const bounded = compressed.result.status === "ready" && compressed.result.history_summary.length <= 1500 && compressed.result.history_summary.includes("未确认");
  rows.push({ id: "bounded_summary", passed: bounded, result: compressed.result, usage: compressed.call?.usage || null });
  console.log(JSON.stringify({ model, kind: "synthetic_provider_smoke", passed: bounded, rows }, null, 2));
  if (!bounded) process.exitCode = 1;
}
main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "live_check_failed";
  const known = /^(live_check_not_enabled|missing_credentials|catalog_http_\d+|configured_luna_not_in_catalog)$/;
  console.log(JSON.stringify({ kind: "synthetic_provider_smoke", passed: false, reason: known.test(code) ? code : "provider_check_unavailable" }));
  process.exitCode = 1;
});
