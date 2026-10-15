import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { dataDir } from "../../src/config.js";
import { postgresPool } from "../../src/postgres/pool.js";
import { processExecutionJobById } from "../../src/execution-jobs/dispatcher.js";
import { enqueueScope, saveScope, scopeDetail } from "../../src/knowledge/scopes.js";
import * as structured from "../../src/worker/structured-background.js";

/** A deterministic test model, followed by the real candidate/check workflow.
 * The old stub PageIndex bridge stores one plain-text PDF fixture but no pages
 * JSON. Supply that fixture evidence to the real scope job rather than directly
 * marking a row checked/published or removing the new revision's scope guard.
 */
export async function confirmFixtureDocumentScope(id: string, actor: string, tenant: string): Promise<void> {
  if (process.env.KNOWLEDGE_ENGINE_MODE !== "stub") throw new Error("scope fixture requires stub knowledge engine");
  const doc = (await postgresPool().query("SELECT source_path,artifacts FROM knowledge_documents WHERE id=$1", [id])).rows[0];
  if (!doc) throw new Error("scope fixture document missing");
  const artifacts = typeof doc.artifacts === "string" ? JSON.parse(doc.artifacts) : doc.artifacts;
  const index = artifacts.index;
  const source = path.isAbsolute(doc.source_path) ? doc.source_path : path.join(dataDir(), doc.source_path);
  const library = path.isAbsolute(index.library) ? index.library : path.join(dataDir(), index.library);
  const directory = path.join(library, "docs", index.doc_id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "pages.json"), JSON.stringify([{ page_index: 1, text: fs.readFileSync(source, "utf8") }]) + "\n");
  const model = vi.spyOn(structured, "structuredBackground").mockImplementation(async (prompt) => {
    const payload = JSON.parse(prompt.slice(prompt.indexOf("数据：") + "数据：".length));
    return {
      summary: "测试规格原文支持的资料概览",
      entities: [],
      topics: [{ label: "规格资料", evidence_ids: [payload.evidence[0].id] }],
      question_types: ["overview"],
      limitations: ["仅覆盖当前测试原件，不声明完整目录"],
      unverified_notes: [],
    };
  });
  try {
    const before = await scopeDetail(actor, tenant, id);
    const { jobId } = await enqueueScope(actor, tenant, id, before.revision, { mode: "manual" });
    if (!jobId) throw new Error("scope fixture did not create or reuse an execution job");
    const outcome = await processExecutionJobById(jobId, "scope-fixture-worker");
    if (outcome?.outcome !== "processed") throw new Error(`scope fixture generation failed: ${outcome?.outcome}`);
    const candidate = await scopeDetail(actor, tenant, id);
    if (candidate.state !== "candidate" || !candidate.scope) throw new Error("scope fixture did not produce a candidate");
    const checked = await saveScope(actor, tenant, id, { expectedRevision: candidate.revision, checked: true });
    if (checked.state !== "checked") throw new Error("scope fixture human check did not persist");
  } finally {
    model.mockRestore();
  }
}
