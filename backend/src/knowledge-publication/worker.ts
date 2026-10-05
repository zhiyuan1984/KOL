import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import { executePublication } from "./service.js";
registerExecutionHandler("knowledge.publication", async (job, checkpoint) => {
  await checkpoint();
  const payload = JSON.parse(String(job.payload_json || "{}"));
  return executePublication(String(job.tenant_ref), String(payload.instanceId));
});
